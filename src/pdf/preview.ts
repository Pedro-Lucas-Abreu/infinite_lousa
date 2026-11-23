import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageObject } from "../core/types";
import type { BoardAsset } from "../documents/archive";
import { openPdf, renderPdfPage } from "./runtime";

const MAX_PREVIEW_BYTES = 160 * 1024 * 1024;
const MAX_OPEN_PDFS = 4;

function release(raster: HTMLCanvasElement): void {
  raster.width = raster.height = 0;
}

export class PdfPagePreviews {
  #documents = new Map<string, Promise<PDFDocumentProxy>>();
  #rasters = new Map<string, HTMLCanvasElement>();
  #pending = new Map<string, { asset: BoardAsset; pageIndex: number }>();
  #failed = new Set<string>();
  #bytes = 0;
  #drawing = false;
  #disposed = false;

  constructor(
    private readonly onRedraw: () => void,
    private readonly onError?: (error: Error) => void,
  ) {}

  get(page: PageObject, asset: BoardAsset): CanvasImageSource | undefined {
    if (this.#disposed || page.type !== "pdfPage") return undefined;
    const pageIndex = page.props.pageIndex ?? 0;
    const key = `${asset.id}/${pageIndex}`;
    const raster = this.#rasters.get(key);
    if (raster) {
      this.#rasters.delete(key);
      this.#rasters.set(key, raster);
      return raster;
    }
    if (!this.#failed.has(key) && !this.#pending.has(key)) {
      this.#pending.set(key, { asset, pageIndex });
      if (!this.#drawing) void this.drawNext();
    }
    return undefined;
  }

  private getDocument(asset: BoardAsset): Promise<PDFDocumentProxy> {
    const promise = this.#documents.get(asset.id) ?? openPdf(asset);
    this.#documents.delete(asset.id);
    this.#documents.set(asset.id, promise);
    const oldest = this.#documents.entries().next().value;
    if (oldest && this.#documents.size > MAX_OPEN_PDFS) {
      this.#documents.delete(oldest[0]);
      this.closeDocument(oldest[1]);
    }
    return promise;
  }

  private closeDocument(promise: Promise<PDFDocumentProxy>): void {
    void promise.then((pdf) => pdf.loadingTask.destroy()).catch(() => {});
  }

  private async drawNext(): Promise<void> {
    const next = this.#pending.entries().next().value;
    if (!next || this.#disposed) return;
    this.#drawing = true;
    const [key, { asset, pageIndex }] = next;
    try {
      const raster = await renderPdfPage(await this.getDocument(asset), pageIndex);
      if (this.#disposed) release(raster);
      else {
        this.#rasters.set(key, raster);
        this.#bytes += raster.width * raster.height * 4;
        while (this.#bytes > MAX_PREVIEW_BYTES && this.#rasters.size > 1) {
          const oldest = this.#rasters.entries().next().value!;
          this.#rasters.delete(oldest[0]);
          this.#bytes -= oldest[1].width * oldest[1].height * 4;
          release(oldest[1]);
        }
        this.onRedraw();
      }
    } catch (cause) {
      if (!this.#disposed) {
        this.#failed.add(key);
        this.onError?.(new Error("Não foi possível gerar a prévia de uma página.", { cause }));
      }
    } finally {
      this.#pending.delete(key);
      this.#drawing = false;
      void this.drawNext();
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const raster of this.#rasters.values()) release(raster);
    for (const promise of this.#documents.values()) this.closeDocument(promise);
    this.#pending.clear();
    this.#rasters.clear();
    this.#documents.clear();
  }
}
