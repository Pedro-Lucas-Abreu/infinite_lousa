import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Zip, ZipDeflate, zipSync } from "fflate";
import { Scene, objectBounds } from "../core/scene";
import { shapeArcPoints } from "../core/shapes";
import { createStroke } from "../core/stroke";
import type { Brush, EquationObject, FrameObject, InstrumentObject, PageObject, PlotObject, ShapeObject, SolidObject, Stroke, TextObject } from "../core/types";
import { instrumentDimensions } from "../instruments/geometry";
import { DEFAULT_PLOT_SETTINGS } from "../plot/geometry";
import { alignPlotAxes } from "../plot/object";
import { defaultSolid, projectSolid } from "../solids/geometry";
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

  it("round-trips transformed geometry instruments and open compass arcs in v1", () => {
    const instrument: InstrumentObject = {
      id: "ruler", type: "instrument", zIndex: 3, locked: false, transform: [0, 1, -1, 0, 120, 180],
      props: { kind: "ruler", ...instrumentDimensions("ruler") },
    };
    const arc: ShapeObject = {
      id: "arc", type: "shape", zIndex: 4, locked: false, transform: [1, 0, 0, 1, 0, 0],
      props: { kind: "arc", points: shapeArcPoints({ x: 100, y: 100 }, 40, 0, Math.PI), size: 2, color: "#192038" },
    };
    const board: PortableBoard = { scene: { version: 1, objects: [instrument, arc] }, assets: [] };
    assert.deepEqual(readArchive(writeArchive(board)), board);
    assert.throws(() => writeArchive({
      ...board,
      scene: { version: 1, objects: [instrument, { ...arc, props: { ...arc.props, points: arc.props.points.slice(0, 3) } }] },
    }), /Invalid shape geometry/);
  });

  it("round-trips editable plots in v1 and rejects invalid scales or expressions", () => {
    const plot: PlotObject = {
      id: "graph", type: "plot", locked: false, zIndex: 4, transform: [1, 0, 0, 1, 40, 70],
      props: {
        width: 480, height: 300, size: 2, color: "#192038", settings: DEFAULT_PLOT_SETTINGS,
        functions: [{ expression: "0,5x + 1", color: "#2158ad" }, { expression: "tan(x)", color: "#bd3b47" }],
      },
    };
    const withPlot = (props: PlotObject["props"] = plot.props): PortableBoard => ({
      scene: { version: 1, objects: [...fixture.scene.objects, { ...plot, props }] }, assets: fixture.assets,
    });
    assert.deepEqual(readArchive(writeArchive(withPlot())), withPlot());
    assert.throws(() => writeArchive(withPlot({ ...plot.props, settings: { ...DEFAULT_PLOT_SETTINGS, step: 0 } })), /plot settings/);
    assert.throws(() => writeArchive(withPlot({ ...plot.props, functions: [{ expression: "foo(x)", color: "#2158ad" }] })), /Nome desconhecido/);

    const aligned = alignPlotAxes({ ...plot, transform: [0, 2, -1, 0.5, 40, 70] });
    const [a, b, c, d, x, y] = aligned.transform;
    assert.equal(a * c + b * d, 0);
    assert.equal(Math.hypot(a, b), Math.hypot(c, d));
    assert.deepEqual([x, y], [40, 70]);
    assert.ok(Math.abs(aligned.props.width * Math.hypot(a, b) - plot.props.width * 2) < 1e-10);
    assert.ok(Math.abs(aligned.props.height * Math.hypot(c, d) - plot.props.height * Math.hypot(-1, 0.5)) < 1e-10);
  });

  it("round-trips editable solids and clipped ink alongside older strokes in v1", () => {
    const settings = { ...defaultSolid, kind: "pyramid-frustum" as const, sides: 6, edge: 3.4, azimuth: -40,
      topScale: 0.65, fillFaces: true, showHeight: true };
    const { width, height } = projectSolid(settings, 2);
    const solid: SolidObject = { id: "solid", type: "solid", transform: [1.4, 0, 0, 1.4, 44, 87],
      locked: false, zIndex: 2, props: { ...settings, width, height, color: "#123456", size: 2 } };
    const clipped: Stroke = { ...stroke, id: "clipped", zIndex: 1, props: { ...stroke.props,
      points: [{ x: 0, y: 0 }, { x: 8, y: 10, breakBefore: true }],
      contours: [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }], [{ x: 7, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 11 }]] } };
    const board: PortableBoard = { ...fixture, scene: { version: 1, objects: [stroke, clipped, solid] } };
    assert.deepEqual(readArchive(writeArchive(board)), board);
    assert.throws(() => writeArchive({ ...board, scene: { version: 1, objects: [
      { ...solid, props: { ...solid.props, sides: 7 } },
    ] } }), /Invalid geometric solid/);
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

  it("preserves an editable equation and its vector paths within the same portable format", () => {
    const equation: EquationObject = {
      id: "formula", type: "equation", locked: false, zIndex: 11, parentId: page.id,
      transform: [1, 0, 0, 1, 30, 55],
      props: {
        latex: "\\frac{1}{x}+\\alpha", color: "#192038", fontSize: 18, width: 80, height: 32,
        paths: [{ d: "M0 0H20V8H0Z", transform: [0.08, 0, 0, -0.08, 10, 25] }],
      },
    };
    const board = { ...mixed, scene: new Scene([...mixed.scene.objects, equation]).snapshot() };
    const withEquation = (props: EquationObject["props"]) => ({
      ...mixed, scene: { ...mixed.scene, objects: [...mixed.scene.objects, { ...equation, props }] },
    });
    const encoded = writeArchive(board);
    assert.deepEqual(readArchive(encoded), board);
    assert.deepEqual(objectBounds(equation), { minX: 30, minY: 55, maxX: 110, maxY: 87 });
    const path = equation.props.paths[0];
    for (const invalid of [
      { ...path, d: "M0 0L1e999 2" },
      { ...path, d: "M0 0H10Z\" style=\"fill:url(about:blank)" },
      { ...path, d: "M0 0 " + "H0 ".repeat(70_000) },
      { ...path, transform: [1, 0, 0, 0, 0, 0] as const },
    ]) {
      assert.throws(() => writeArchive(withEquation({ ...equation.props, paths: [invalid] })), /equation path/);
    }
    assert.throws(() => writeArchive(withEquation({ ...equation.props, latex: "x".repeat(16_385) })), /equation object/);
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
