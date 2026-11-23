import type { PageObject, Point } from "../core/types";
import type { BoardAsset } from "../documents/archive";
import { openPdf } from "./runtime";

const MAX_PDF_SIZE = 64 * 1024 * 1024;
const PAGE_GAP = 32;

export async function importPdf(file: Blob, origin: Point, firstZIndex: number): Promise<{
  asset: BoardAsset;
  pages: PageObject[];
}> {
  if (file.size === 0 || file.size > MAX_PDF_SIZE) {
    throw new Error("Escolha um PDF de até 64 MB.");
  }
  const asset: BoardAsset = {
    id: crypto.randomUUID(),
    mime: "application/pdf",
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
  const pdf = await openPdf(asset);
  try {
    const pages: PageObject[] = [];
    let y = origin.y;
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const page = await pdf.getPage(pageIndex + 1);
      const { width, height } = page.getViewport({ scale: 1 });
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`A página ${pageIndex + 1} tem dimensões inválidas.`);
      }
      pages.push({
        id: crypto.randomUUID(),
        type: "pdfPage",
        transform: [1, 0, 0, 1, origin.x, y],
        zIndex: firstZIndex + pageIndex,
        locked: true,
        props: { width, height, assetId: asset.id, pageIndex },
      });
      y += height + PAGE_GAP;
    }
    return { asset, pages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
