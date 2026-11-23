import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Zip, ZipDeflate, zipSync } from "fflate";
import { Scene, objectBounds } from "../core/scene";
import { createStroke } from "../core/stroke";
import type { Brush, FrameObject, PageObject, ShapeObject, Stroke, TextObject } from "../core/types";
import { type PortableBoard, readArchive, writeArchive } from "./archive";
import { BoardDocument } from "./store";

const brush: Brush = { color: "#123456", size: 4, stabilizer: 35, simulatePressure: true };
const stroke = createStroke("first", [{ x: 8, y: 13 }, { x: 10, y: 14 }], brush, 0);
const fixture: PortableBoard = {
  scene: new Scene([stroke]).snapshot(),
  assets: [{ id: "asset-1", mime: "application/pdf", bytes: Uint8Array.of(1, 2, 3, 255) }],
};
const page: PageObject = {
  id: "page-1", type: "pdfPage", locked: true, transform: [0, 1, -1, 0, 200, 0], zIndex: -1,
  props: { width: 160, height: 120, assetId: "asset-1", pageIndex: 0 },
};
const frame: FrameObject = {
  id: "frame-1", type: "frame", locked: false, transform: page.transform, zIndex: 5,
  parentId: page.id, props: { width: 160, height: 120, name: "Página 1", order: 0 },
};
const ink: Stroke = {
  ...stroke, parentId: page.id, props: { ...stroke.props, brush: { ...brush, opacity: 0.35 } },
};
const mixed: PortableBoard = { ...fixture, scene: new Scene([page, frame, ink]).snapshot() };
const utf8 = new TextEncoder();

function entries(version = 1): Record<string, Uint8Array> {
  const { id, mime, bytes } = fixture.assets[0];
  return {
    "manifest.json": utf8.encode(JSON.stringify({
      format: "board", version, scenePath: "scene.json",
      assets: [{ id, mime, path: "assets/" + id, size: bytes.length }],
    })),
    "scene.json": utf8.encode(JSON.stringify(fixture.scene)),
    ["assets/" + id]: bytes,
  };
}

function view(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("portable .board", () => {
  it("round-trips local geometry and original asset bytes", () => {
    assert.deepEqual(readArchive(writeArchive(fixture)), fixture);
    assert.deepEqual(readArchive(zipSync(entries(), { level: 0 })), fixture);
  });

  it("accepts a ZIP written with streamed DEFLATE entries and data descriptors", () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    for (const [name, bytes] of Object.entries(entries())) {
      const file = new ZipDeflate(name);
      zip.add(file);
      file.push(bytes, true);
    }
    zip.end();
    assert.deepEqual(readArchive(Buffer.concat(chunks)), {
      scene: fixture.scene,
      assets: fixture.assets,
    });
  });

  it("rejects a missing directory, unsafe entry and unknown archive version", () => {
    const archive = writeArchive(fixture);
    assert.throws(() => readArchive(archive.subarray(0, archive.length - 1)));
    assert.throws(() => readArchive(zipSync({ ...entries(), "../scene.json": Uint8Array.of(0) })));
    assert.throws(() => readArchive(zipSync(entries(2))), /manifest/);
  });

  it("rejects a mismatched checksum and impossible size before installing the board", () => {
    const damaged = zipSync(entries(), { level: 0 });
    const header = view(damaged);
    const firstBody = 30 + header.getUint16(26, true) + header.getUint16(28, true);
    damaged[firstBody] ^= 0x01;
    assert.throws(() => readArchive(damaged), /corrupt/);

    const oversized = writeArchive(fixture);
    const directory = view(oversized);
    const firstCentralHeader = directory.getUint32(oversized.length - 6, true);
    directory.setUint32(firstCentralHeader + 24, 1024 * 1024 * 1024, true);
    assert.throws(() => readArchive(oversized), /limit/);
  });

  it("rejects missing assets, duplicate objects and non-finite geometry", () => {
    const missing = entries();
    delete missing["assets/asset-1"];
    assert.throws(() => readArchive(zipSync(missing)), /asset/);
    assert.throws(() => writeArchive({
      ...fixture, scene: { version: 1, objects: [stroke, stroke] },
    }), /scene object/);
    assert.throws(() => writeArchive({
      ...fixture, scene: { version: 1, objects: [{ ...stroke, zIndex: Infinity }] },
    }), /scene object/);
  });

  it("keeps v1 ink and assets backward-compatible while carrying page and frame attachments", () => {
    assert.deepEqual(readArchive(zipSync(entries(), { level: 0 })), fixture);
    assert.deepEqual(readArchive(writeArchive(mixed)), mixed);
    assert.deepEqual(objectBounds(page), { minX: 80, minY: 0, maxX: 200, maxY: 160 });
    assert.throws(() => writeArchive({ ...mixed, assets: [] }), /page asset/);
    assert.throws(() => writeArchive({
      ...mixed, scene: { version: 1, objects: [frame, ink] },
    }), /attachment parent/);
  });

  it("round-trips shapes and laid-out text in v1 while rejecting invalid geometry", () => {
    const shape: ShapeObject = {
      id: "triangle", type: "shape", locked: false, zIndex: 10, parentId: page.id,
      transform: [1, 0, 0, 1, 20, 30],
      props: {
        kind: "polygon", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 16, y: 15 }],
        color: "#192038", size: 2,
      },
    };
    const text: TextObject = {
      id: "explanation", type: "text", locked: false, zIndex: 11, parentId: page.id,
      transform: [1, 0, 0, 1, 30, 55],
      props: { text: "Ângulo α\n85°", color: "#192038", fontSize: 16, width: 80, height: 38 },
    };
    const board = { ...mixed, scene: new Scene([...mixed.scene.objects, shape, text]).snapshot() };
    const withInvalid = (object: ShapeObject | TextObject) => ({
      ...mixed, scene: { ...mixed.scene, objects: [...mixed.scene.objects, object] },
    });
    assert.deepEqual(readArchive(writeArchive(board)), board);
    assert.throws(() => writeArchive(withInvalid({
      ...shape, props: { ...shape.props, points: shape.props.points.slice(0, 2) },
    })), /shape/);
    assert.throws(() => writeArchive(withInvalid({
      ...text, props: { ...text.props, fontSize: 0 },
    })), /text/);
  });
});

describe("document edits when local storage is unavailable", () => {
  it("retains the scene in memory, supports redo, and drops the redo branch on a new edit", async () => {
    const scene = new Scene();
    const doc = await BoardDocument.open(scene);
    assert.equal(doc.status, "error");
    scene.add(stroke);
    doc.recordStroke(stroke);
    assert.equal(doc.canUndo, true);
    assert.ok(doc.undo());
    assert.deepEqual(doc.portable().scene.objects, []);
    assert.ok(doc.redo());
    assert.deepEqual(doc.portable().scene.objects, [stroke]);
    assert.ok(doc.undo());

    const newStroke = { ...stroke, id: "second" };
    scene.add(newStroke);
    doc.recordStroke(newStroke);
    assert.equal(doc.canRedo, false);
    assert.deepEqual(doc.portable().scene.objects, [newStroke]);
    await assert.rejects(doc.flush());
    doc.close();
  });

  it("keeps active objects when a replacement cannot be indexed", async () => {
    const scene = new Scene();
    const doc = await BoardDocument.open(scene);
    await doc.replace(fixture);
    await assert.rejects(doc.replace({ ...fixture, scene: { version: 1, objects: [stroke, stroke] } }));
    assert.deepEqual(doc.portable(), fixture);
    doc.close();
  });

  it("keeps page edits, attached ink, frame and assets consistent across undo and redo", async () => {
    const scene = new Scene();
    const doc = await BoardDocument.open(scene);
    const attach = [{ after: page }, { after: frame }, { after: ink }];
    assert.throws(() => doc.applyChanges(attach), /asset/);
    assert.deepEqual(scene.all(), []);
    doc.applyChanges(attach, fixture.assets);
    assert.deepEqual(doc.portable(), mixed);
    assert.deepEqual(doc.asset(page.props.assetId), fixture.assets[0]);
    assert.ok(doc.undo());
    assert.deepEqual(scene.all(), []);
    assert.deepEqual(doc.asset(page.props.assetId), fixture.assets[0]);
    assert.ok(doc.redo());
    assert.deepEqual(doc.portable(), mixed);

    assert.throws(() => doc.applyChanges([{ before: page }]), /Detach/);
    const detached = { ...ink, parentId: undefined };
    const detachedFrame = { ...frame, parentId: undefined };
    doc.applyChanges([
      { before: page },
      { before: ink, after: detached },
      { before: frame, after: detachedFrame },
    ]);
    assert.deepEqual(scene.all(), [detached, detachedFrame]);
    assert.ok(doc.undo());
    assert.deepEqual(doc.portable(), mixed);
    doc.close();
  });
});
