import type { PDFDocumentProxy } from "pdfjs-dist";
import type { BoardAsset } from "../documents/archive";

const PREVIEW_EDGE = 2_600;

export async function openPdf(asset: BoardAsset): Promise<PDFDocumentProxy> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  const directory = new URL("../pdfjs/", import.meta.url);
  GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", directory).href;
  GlobalWorkerOptions.rendererSrc = new URL("pdf.renderer.mjs", directory).href;
  const task = getDocument({
    data: Uint8Array.from(asset.bytes),
    cMapUrl: new URL("cmaps/", directory).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", directory).href,
    wasmUrl: new URL("wasm/", directory).href,
    useSystemFonts: true,
    stopAtErrors: true,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("O PDF é protegido por senha. Abra uma cópia desbloqueada.");
    }
    throw new Error("Não foi possível abrir este PDF. Confira se o arquivo é válido.", { cause: error });
  }
}

export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  edge = PREVIEW_EDGE,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageIndex + 1);
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: edge / Math.max(original.width, original.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  return canvas;
}

export function assetBlob(asset: BoardAsset): Blob {
  return new Blob([Uint8Array.from(asset.bytes)], { type: asset.mime });
}
