import { PDFDict, PDFName, PDFNumber, PDFObjectCopier, PDFStream } from "@cantoo/pdf-lib";
import type { PDFDocument, PDFEmbeddedPage, PDFPage } from "@cantoo/pdf-lib";
import type { Affine } from "../core/types";

const groupKey = PDFName.of("Group");
const subtypeKey = PDFName.of("Subtype");
const appearanceKey = PDFName.of("AP");

export function sourceGeometry(page: PDFPage) {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const left = Math.max(crop.x, media.x);
  const bottom = Math.max(crop.y, media.y);
  const right = Math.min(crop.x + crop.width, media.x + media.width);
  const top = Math.min(crop.y + crop.height, media.y + media.height);
  const box = right > left && top > bottom
    ? { left, bottom, right, top }
    : { left: media.x, bottom: media.y, right: media.x + media.width, top: media.y + media.height };
  const userUnit = page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() ?? 1;
  const s = userUnit > 0 ? userUnit : 1;
  const { left: x0, bottom: y0, right: x1, top: y1 } = box;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const width = (x1 - x0) * s;
  const height = (y1 - y0) * s;
  const transforms: Record<number, Affine> = {
    0: [s, 0, 0, -s, -x0 * s, y1 * s],
    90: [0, s, s, 0, -y0 * s, -x0 * s],
    180: [-s, 0, 0, s, x1 * s, -y0 * s],
    270: [0, -s, -s, 0, y1 * s, x1 * s],
  };
  const turned = rotation === 90 || rotation === 270;
  return { box, transform: transforms[rotation] ?? transforms[0], width: turned ? height : width, height: turned ? width : height };
}

function hasVisibleAnnotations(page: PDFPage): boolean {
  const annotations = page.node.Annots();
  if (!annotations) return false;
  for (let index = 0; index < annotations.size(); index++) {
    const annotation = annotations.lookupMaybe(index, PDFDict);
    if (annotation && (annotation.get(subtypeKey) !== PDFName.of("Link") || annotation.has(appearanceKey))) {
      return true;
    }
  }
  return false;
}

export interface OriginalPage {
  readonly geometry: ReturnType<typeof sourceGeometry>;
  readonly embedded?: PDFEmbeddedPage;
}

export async function embedOriginalPage(source: PDFDocument, output: PDFDocument, index: number): Promise<OriginalPage> {
  const page = source.getPage(index);
  const geometry = sourceGeometry(page);
  if (hasVisibleAnnotations(page) || source.catalog.has(PDFName.of("OCProperties"))) {
    throw new Error("The source page contains appearances outside its page content.");
  }
  if (!page.node.Contents()) return { geometry };
  const embedded = await output.embedPage(page, geometry.box, [1, 0, 0, 1, 0, 0]);
  await embedded.embed();
  const group = page.node.get(groupKey);
  if (group) {
    const stream = output.context.lookup(embedded.ref, PDFStream);
    stream.dict.set(groupKey, PDFObjectCopier.for(source.context, output.context).copy(group));
  }
  return { geometry, embedded };
}
