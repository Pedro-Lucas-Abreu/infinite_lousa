import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber,
  PDFRawStream, rgb, StandardFonts,
} from "@cantoo/pdf-lib";
import { createStroke } from "../core/stroke";
import type { FrameObject, PageObject } from "../core/types";
import type { BoardAsset, PortableBoard } from "../documents/archive";
import { exportPdf } from "./export";
import { sourceGeometry } from "./source";

const decoder = new TextDecoder("latin1");
const unchanged = [1, 0, 0, 1, 0, 0] as const;

function streamText(stream: PDFRawStream): string {
  return decoder.decode(decodePDFRawStream(stream).decode());
}

function pageStreams(document: PDFDocument, index: number): string {
  const contents = document.getPage(index).node.Contents();
  return contents instanceof PDFArray
    ? contents.asArray().map((reference) => {
      const stream = document.context.lookup(reference);
      assert.ok(stream instanceof PDFRawStream);
      return streamText(stream);
    }).join("\n")
    : contents instanceof PDFRawStream ? streamText(contents) : "";
}

test("exports five annotated PDF pages in frame order with the original background and vector ink", async () => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const pages: PageObject[] = [];
  const frames: FrameObject[] = [];
  const ink = [];
  const expectedBackgrounds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const original = source.addPage([180, 260]);
    original.setCropBox(8, 16, 140, 210);
    original.setRotation(degrees((index % 4) * 90));
    if (index === 4) original.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    const red = (index + 1) / 8;
    original.drawRectangle({ x: 24, y: 40, width: 33, height: 24, color: rgb(red, 0.25, 0.75) });
    const label = `Page ${index + 1}`;
    original.drawText(label, { x: 26, y: 73, size: 12, font });
    expectedBackgrounds.push(`${red} 0.25 0.75 rg`);
    const expectedWidth = (index % 2 ? 210 : 140) * (index === 4 ? 2 : 1);
    const expectedHeight = (index % 2 ? 140 : 210) * (index === 4 ? 2 : 1);
    const geometry = sourceGeometry(original);
    assert.equal(geometry.width, expectedWidth);
    assert.equal(geometry.height, expectedHeight);
    assert.deepEqual(geometry.transform, [
      [1, 0, 0, -1, -8, 226],
      [0, 1, 1, 0, -16, -8],
      [-1, 0, 0, 1, 148, -16],
      [0, -1, -1, 0, 226, 148],
      [2, 0, 0, -2, -16, 452],
    ][index]);
    const page: PageObject = {
      id: `page-${index}`, type: "pdfPage", locked: true, zIndex: index,
      transform: [1, 0, 0, 1, index * 400, 0],
      props: { width: expectedWidth, height: expectedHeight, assetId: "source", pageIndex: index },
    };
    pages.push(page);
    frames.push({
      id: `frame-${index}`, type: "frame", parentId: page.id, locked: false, zIndex: 20 + index,
      transform: page.transform, props: { width: expectedWidth, height: expectedHeight, name: label, order: 4 - index },
    });
    ink.push({
      ...createStroke(`ink-${index}`, [
        { x: index * 400 + 10, y: 15 }, { x: index * 400 + 70, y: 37 },
      ], { color: "#ff0000", size: 5, stabilizer: 0, simulatePressure: true, opacity: 0.5 }, 10 + index),
      parentId: page.id,
    });
  }
  const asset: BoardAsset = { id: "source", mime: "application/pdf", bytes: await source.save() };
  const board: PortableBoard = { scene: { version: 1, objects: [...pages, ...ink, ...frames] }, assets: [asset] };
  const result = await exportPdf(board, { scope: "frames", background: "#131619" });
  if (process.env.WHITEBOARD_PDF_FIXTURES === "1") {
    await mkdir("test-results/pdf", { recursive: true });
    await Promise.all([
      writeFile("test-results/pdf/original.pdf", asset.bytes),
      writeFile("test-results/pdf/annotated.pdf", result.bytes),
    ]);
  }
  assert.equal(result.fallbackPages, 0);
  const reopened = await PDFDocument.load(result.bytes);
  assert.equal(reopened.getPageCount(), 5);

  for (let index = 0; index < 5; index++) {
    const sourceIndex = 4 - index;
    const page = reopened.getPage(index);
    const { width, height } = pages[sourceIndex].props;
    assert.deepEqual(page.getSize(), { width, height });
    const content = pageStreams(reopened, index);
    assert.match(content, new RegExp(`0 0 ${width} ${height} re\\s+W\\s+n`));
    const pdfDraw = content.search(/\/EmbeddedPdfPage[^\s]+ Do/);
    const redInk = content.indexOf("1 0 0 rg");
    assert.ok(pdfDraw !== -1 && redInk > pdfDraw, "the original background is painted before the annotation");
    assert.match(content.slice(redInk), /rg\s+[-\d.]+ [-\d.]+ m\s+[\s\S]+ l\s+[\s\S]*h\s+f/);
    assert.match(content, /\/InkOpacity[^\s]+ gs/);
    const resources = page.node.Resources()!;
    const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict);
    assert.equal(xobjects.keys().length, 1);
    const embedded = reopened.context.lookup(xobjects.get(xobjects.keys()[0]));
    assert.ok(embedded instanceof PDFRawStream);
    assert.equal(embedded.dict.get(PDFName.of("Subtype")), PDFName.of("Form"));
    assert.ok(streamText(embedded).includes(expectedBackgrounds[sourceIndex]));
    assert.match(streamText(embedded), new RegExp(`<${Buffer.from(`Page ${sourceIndex + 1}`).toString("hex")}> Tj`, "i"));
  }
});

test("exports the default ink with the board's light or dark contrast", async () => {
  const stroke = createStroke("ink", [{ x: 2, y: 3 }, { x: 40, y: 10 }], {
    color: "#192038", size: 5, stabilizer: 40, simulatePressure: true,
  }, 0);
  const board: PortableBoard = { scene: { version: 1, objects: [stroke] }, assets: [] };
  for (const [background, expectedInk] of [["#ffffff", "#192038"], ["#171e2d", "#ecf2ff"]]) {
    const { bytes } = await exportPdf(board, { background });
    const colorOperator = [1, 3, 5].map((start) => Number.parseInt(expectedInk.slice(start, start + 2), 16) / 255).join(" ");
    assert.ok(pageStreams(await PDFDocument.load(bytes), 0).includes(`${colorOperator} rg`));
  }
});

test("keeps ink as a filled path in an export with no image or PDF background", async () => {
  const stroke = createStroke("ink", [{ x: 2, y: 3 }, { x: 40, y: 10 }], {
    color: "#112233", size: 5, stabilizer: 40, simulatePressure: true,
  }, 0);
  const frame: FrameObject = {
    id: "frame", type: "frame", transform: unchanged, locked: false, zIndex: 1,
    props: { width: 120, height: 100, name: "Lousa", order: 0 },
  };
  const { bytes } = await exportPdf({ scene: { version: 1, objects: [stroke, frame] }, assets: [] }, { scope: "frames" });
  const result = await PDFDocument.load(bytes);
  assert.match(pageStreams(result, 0), / m\s+[\s\S]+ l\s+[\s\S]*h\s+f/);
  assert.ok(result.context.enumerateIndirectObjects().every(([, object]) =>
    !(object instanceof PDFRawStream) || object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")));
});
