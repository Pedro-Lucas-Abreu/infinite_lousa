import { objectBounds, Scene } from "../core/scene";
import { strokeOutline } from "../core/stroke";
import type { Affine, Bounds, FrameObject, PageObject, Stroke } from "../core/types";
import type { BoardAsset, PortableBoard } from "../documents/archive";
import type { PDFDict, PDFDocument, PDFImage, PDFPage } from "@cantoo/pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { assetBlob, openPdf, renderPdfPage } from "./runtime";
import type { OriginalPage } from "./source";

export interface ExportOptions {
  readonly scope?: "all" | "frames";
  readonly frameId?: string;
  readonly background?: string;
  readonly scale?: number;
}

const MAX_PDF_EDGE = 14_400;
const MAX_PNG_EDGE = 8_192;
const MAX_PNG_PIXELS = 24_000_000;
const PDF_FALLBACK_EDGE = 3_600;
const rgbWhite = [1, 1, 1] as const;

function strokeColor(stroke: Stroke, background: string | undefined): string {
  const { color } = stroke.props.brush;
  const defaultInk = color === "#192038" || color === "#1a2433";
  return background === "#171e2d" && !stroke.parentId && defaultInk ? "#ecf2ff" : color;
}

function colorComponents(input: string): readonly [number, number, number] {
  const color = input.toLowerCase() === "white" ? "#ffffff"
    : input.toLowerCase() === "black" ? "#000000" : input;
  const full = /^#[a-f\d]{3}$/i.test(color) ? color.slice(1).replace(/./g, "$&$&") : color.slice(1);
  if (!/^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(color)) throw new Error("Cor de exportação inválida.");
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function exportRegions(scene: Scene, options: ExportOptions): Bounds[] {
  if (options.frameId) {
    const frame = scene.get(options.frameId);
    if (frame?.type !== "frame") throw new Error("O quadro selecionado não está mais na lousa.");
    return [objectBounds(frame)];
  }
  if (options.scope === "frames") {
    const frames = scene.all().filter((object): object is FrameObject => object.type === "frame")
      .sort((a, b) => a.props.order - b.props.order);
    if (frames.length) return frames.map(objectBounds);
  }
  const content = scene.all().filter((object) => object.type !== "frame");
  if (!content.length) throw new Error("A lousa está vazia.");
  const bounds = new Scene(content).bounds()!;
  return [bounds];
}

function dimensions(region: Bounds) {
  const width = region.maxX - region.minX;
  const height = region.maxY - region.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("A região escolhida tem dimensões inválidas.");
  }
  return { width, height };
}

function findAsset(assets: ReadonlyMap<string, BoardAsset>, object: PageObject): BoardAsset {
  const asset = assets.get(object.props.assetId);
  if (!asset) throw new Error("O arquivo original de uma página não foi encontrado.");
  return asset;
}

async function getSourcePdf(
  asset: BoardAsset,
  sources: Map<string, Promise<PDFDocumentProxy>>,
): Promise<PDFDocumentProxy> {
  const source = sources.get(asset.id) ?? openPdf(asset);
  sources.set(asset.id, source);
  return source;
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("O navegador não conseguiu gerar a imagem PNG.");
  return blob;
}

async function renderAsset(
  page: PageObject,
  asset: BoardAsset,
  sources: Map<string, Promise<PDFDocumentProxy>>,
  edge: number,
): Promise<HTMLCanvasElement | ImageBitmap> {
  if (page.type === "pdfPage") return renderPdfPage(await getSourcePdf(asset, sources), page.props.pageIndex ?? 0, edge);
  return createImageBitmap(assetBlob(asset));
}

async function destroySources(sources: Map<string, Promise<PDFDocumentProxy>>): Promise<void> {
  await Promise.allSettled([...sources.values()].map(async (source) => (await source).loadingTask.destroy()));
}

function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, background: string | undefined): void {
  const outline = strokeOutline(stroke);
  if (!outline.length) return;
  context.globalAlpha = stroke.props.brush.opacity ?? 1;
  context.fillStyle = strokeColor(stroke, background);
  context.beginPath();
  context.moveTo(outline[0].x, outline[0].y);
  for (const point of outline.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fill();
}

export async function exportPng(board: PortableBoard, options: ExportOptions = {}): Promise<Blob> {
  const scene = new Scene(board.scene.objects);
  const [region] = exportRegions(scene, options);
  const { width, height } = dimensions(region);
  const requestedScale = options.scale ?? 2;
  const scale = Math.min(requestedScale, MAX_PNG_EDGE / Math.max(width, height), Math.sqrt(MAX_PNG_PIXELS / width / height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context || !Number.isFinite(scale) || scale <= 0) throw new Error("Não foi possível criar a imagem PNG.");
  context.fillStyle = options.background ?? "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, -region.minX * scale, -region.minY * scale);
  const assets = new Map(board.assets.map((asset) => [asset.id, asset]));
  const sources = new Map<string, Promise<PDFDocumentProxy>>();
  try {
    for (const object of scene.search(region)) {
      if (object.type === "frame") continue;
      context.save();
      context.transform(...object.transform);
      if (object.type === "stroke") paintStroke(context, object, options.background);
      else {
        const [a, b, c, d] = object.transform;
        const edge = Math.ceil(Math.max(object.props.width * Math.hypot(a, b), object.props.height * Math.hypot(c, d)) * scale);
        const image = await renderAsset(object, findAsset(assets, object), sources, Math.min(PDF_FALLBACK_EDGE, Math.max(1, edge)));
        context.drawImage(image, 0, 0, object.props.width, object.props.height);
        if ("close" in image) image.close();
        else image.width = image.height = 0;
      }
      context.restore();
    }
    return await canvasBlob(canvas);
  } finally {
    await destroySources(sources);
    canvas.width = canvas.height = 0;
  }
}

async function embedRaster(document: PDFDocument, asset: BoardAsset, rendered?: HTMLCanvasElement): Promise<PDFImage> {
  if (rendered) {
    try {
      return await document.embedPng(await (await canvasBlob(rendered)).arrayBuffer());
    } finally {
      rendered.width = rendered.height = 0;
    }
  }
  if (asset.mime === "image/png") return document.embedPng(asset.bytes);
  if (asset.mime === "image/jpeg") return document.embedJpg(asset.bytes);
  const image = await createImageBitmap(assetBlob(asset));
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível converter uma imagem para o PDF.");
    context.drawImage(image, 0, 0);
    return await document.embedPng(await (await canvasBlob(canvas)).arrayBuffer());
  } finally {
    image.close();
    canvas.width = canvas.height = 0;
  }
}

export async function exportPdf(board: PortableBoard, options: ExportOptions = {}): Promise<{
  bytes: Uint8Array;
  fallbackPages: number;
}> {
  const pdf = await import("@cantoo/pdf-lib");
  const { embedOriginalPage } = await import("./source");
  const output = await pdf.PDFDocument.create();
  const scene = new Scene(board.scene.objects);
  const assets = new Map(board.assets.map((asset) => [asset.id, asset]));
  const sourceDocuments = new Map<string, Promise<PDFDocument>>();
  const renders = new Map<string, Promise<PDFDocumentProxy>>();
  const embeddedPages = new Map<string, Promise<OriginalPage | PDFImage>>();
  const fallbackPages = new Set<string>();
  const extStates = new Map<number, PDFDict>();

  function pushTransform(page: PDFPage, transform: Affine): void {
    page.pushOperators(pdf.pushGraphicsState(), pdf.concatTransformationMatrix(...transform));
  }

  function fillRectangle(page: PDFPage, width: number, height: number, color: readonly [number, number, number]): void {
    page.pushOperators(pdf.setFillingRgbColor(...color), pdf.rectangle(0, 0, width, height), pdf.fill());
  }

  function vectorInk(page: PDFPage, object: Stroke): void {
    const [start, ...rest] = strokeOutline(object);
    if (!start) return;
    const opacity = object.props.brush.opacity ?? 1;
    if (opacity !== 1) {
      const state = extStates.get(opacity) ?? output.context.obj({ Type: "ExtGState", ca: opacity });
      extStates.set(opacity, state);
      const name = page.node.newExtGState("InkOpacity", state);
      page.pushOperators(pdf.setGraphicsState(name));
    }
    page.pushOperators(pdf.setFillingRgbColor(...colorComponents(strokeColor(object, options.background))), pdf.moveTo(start.x, start.y));
    for (const point of rest) page.pushOperators(pdf.lineTo(point.x, point.y));
    page.pushOperators(pdf.closePath(), pdf.fill());
  }

  async function embedPageOrImage(object: PageObject): Promise<OriginalPage | PDFImage> {
    const asset = findAsset(assets, object);
    if (object.type === "image") return embedRaster(output, asset);
    const pageIndex = object.props.pageIndex ?? 0;
    try {
      let source = sourceDocuments.get(asset.id);
      if (!source) {
        source = pdf.PDFDocument.load(asset.bytes, { updateMetadata: false }).then((document) => {
          if (document.catalog.has(pdf.PDFName.of("AcroForm"))) document.getForm().flatten({ updateFieldAppearances: false });
          return document;
        });
        sourceDocuments.set(asset.id, source);
      }
      return await embedOriginalPage(await source, output, pageIndex);
    } catch (sourceError) {
      try {
        const canvas = await renderPdfPage(await getSourcePdf(asset, renders), pageIndex, PDF_FALLBACK_EDGE);
        const raster = await embedRaster(output, asset, canvas);
        fallbackPages.add(`${asset.id}/${pageIndex}`);
        return raster;
      } catch (cause) {
        throw new Error(`Não foi possível exportar a página ${pageIndex + 1} do PDF.`, { cause: new AggregateError([sourceError, cause]) });
      }
    }
  }

  try {
    for (const region of exportRegions(scene, options)) {
      const { width, height } = dimensions(region);
      const scale = Math.min(1, MAX_PDF_EDGE / Math.max(width, height));
      const page = output.addPage([width * scale, height * scale]);
      page.pushOperators(pdf.pushGraphicsState(), pdf.rectangle(0, 0, width * scale, height * scale), pdf.clip(), pdf.endPath());
      fillRectangle(page, width * scale, height * scale, colorComponents(options.background ?? "#ffffff"));
      page.pushOperators(pdf.concatTransformationMatrix(scale, 0, 0, -scale, -region.minX * scale, region.maxY * scale));
      for (const object of scene.search(region)) {
        if (object.type === "frame") continue;
        pushTransform(page, object.transform);
        if (object.type === "stroke") vectorInk(page, object);
        else {
          const { width, height, assetId, pageIndex } = object.props;
          const key = `${assetId}/${object.type === "pdfPage" ? pageIndex ?? 0 : "image"}`;
          const promise = embeddedPages.get(key) ?? embedPageOrImage(object);
          embeddedPages.set(key, promise);
          const content = await promise;
          if (object.type === "pdfPage") fillRectangle(page, width, height, rgbWhite);
          if ("geometry" in content) {
            if (content.embedded) {
              page.pushOperators(pdf.concatTransformationMatrix(width / content.geometry.width, 0, 0, height / content.geometry.height, 0, 0));
              page.pushOperators(pdf.concatTransformationMatrix(...content.geometry.transform));
              page.drawPage(content.embedded, { x: 0, y: 0, xScale: 1, yScale: 1 });
            }
          } else {
            page.pushOperators(pdf.concatTransformationMatrix(1, 0, 0, -1, 0, height));
            page.drawImage(content, { x: 0, y: 0, width, height });
          }
        }
        page.pushOperators(pdf.popGraphicsState());
      }
      page.pushOperators(pdf.popGraphicsState());
    }
    return { bytes: await output.save(), fallbackPages: fallbackPages.size };
  } finally {
    await destroySources(renders);
  }
}
