import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { panBy, screenToWorld, viewportBounds, worldToScreen, zoomAt } from "./camera";
import { type SceneSnapshot, Scene, objectBounds } from "./scene";
import { shapeArrowHead } from "./shapes";
import { hasValidSvgPathData } from "./svgPath";
import { createStroke, StrokeInput, strokeOutline } from "./stroke";
import type { Brush, Camera, ShapeObject } from "./types";

const viewport = { width: 960, height: 540 };
const camera: Camera = { x: 0, y: 0, zoom: 1 };
const brush: Brush = { color: "#102030", size: 4, stabilizer: 45, simulatePressure: true };

describe("SVG path data", () => {
  it("accepts compact coordinates, implicit commands and arc flags", () => {
    assert.ok(hasValidSvgPathData("M0.6.5 4-3 H+5e1v4c1 2 3 4 5 6Q3,4,5,6t7 8z"));
    assert.ok(hasValidSvgPathData(" m 0,0 A4 7 30 0112-5 a6 3 0,1,0,4,3 Z "));
  });

  it("requires complete numeric commands and rejects markup and non-finite values", () => {
    for (const path of ["L0 0", "M0", "M0,,0", "M0 0L1e500 1", "M0 0A2 2 0 2 0 1 2",
      "M0 0z 1 2", "M0 0Q1 2", "M0 0 L1 1,", "M0 0ſ1 2 3 4", "M0 0'><path d='M0 0"]) {
      assert.equal(hasValidSvgPathData(path), false, path);
    }
  });
});

describe("camera", () => {
  it("holds the world point under the cursor when zooming a distant scene", () => {
    const distant = { x: 1e12, y: -1e12, zoom: 8 };
    const cursor = { x: 580, y: 210 };
    const world = screenToWorld(cursor, distant, viewport);
    const zoomed = zoomAt(distant, cursor, viewport, 4);

    assert.deepEqual(worldToScreen(world, zoomed, viewport), cursor);
    assert.deepEqual(zoomAt(zoomed, cursor, viewport, 1 / 4), distant);
  });

  it("pans by screen pixels at the current zoom and guards extreme zoom factors", () => {
    const initial = { x: 0, y: 0, zoom: 2 };
    const shifted = panBy(initial, 120, -80);

    assert.deepEqual(worldToScreen(initial, shifted, viewport), { x: 600, y: 190 });
    assert.deepEqual(viewportBounds(shifted, viewport), {
      minX: -300,
      minY: -95,
      maxX: 180,
      maxY: 175,
    });
    assert.equal(zoomAt(initial, { x: 0, y: 0 }, viewport, Infinity), initial);
    assert.ok(zoomAt(initial, { x: 0, y: 0 }, viewport, Number.MIN_VALUE).zoom > 0);
  });
});

describe("stroke", () => {
  it("commits clicks as centered dots with a memoized outline", () => {
    const dot = createStroke("dot", [{ x: 12, y: 34 }], brush, 0);
    const outline = strokeOutline(dot);
    const radii = outline.map(({ x, y }) => Math.hypot(x, y));

    assert.deepEqual(dot.transform, [1, 0, 0, 1, 12, 34]);
    assert.ok(outline.length > 10);
    assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-4);
    assert.equal(strokeOutline(dot), outline);
  });

  it("filters in screen pixels but ends a stroke at the released tip", () => {
    const input = new StrokeInput({ ...brush, stabilizer: 100 });
    input.add({ x: 480, y: 270 }, 0, camera, viewport);
    input.add({ x: 500, y: 276 }, 8, camera, viewport);

    const tip = input.preview()?.props.points.at(-1);
    assert.ok(tip && tip.x < 20);
    assert.deepEqual(input.finish("drawn", 2)?.props.points.at(-1), { x: 20, y: 6 });
  });

  it("retains measured pressure and falls back for default pointer pressure", () => {
    const input = new StrokeInput({ ...brush, simulatePressure: false, stabilizer: 0 });
    input.add({ x: 480, y: 270, pressure: 0.35 }, 0, camera, viewport);
    input.add({ x: 500, y: 270, pressure: 0.82 }, 10, camera, viewport);
    input.add({ x: 505, y: 270, pressure: 0 }, 12, camera, viewport);
    const measured = input.finish("pen", 0);
    const fallback = createStroke("touch", [{ x: 0, y: 0, pressure: 0.5 }], {
      ...brush,
      simulatePressure: false,
    }, 1);

    assert.equal(measured?.props.brush.simulatePressure, false);
    assert.equal(measured?.props.points.at(-1)?.pressure, 0.82);
    assert.equal(fallback.props.brush.simulatePressure, true);
    assert.equal(Object.hasOwn(fallback.props.points[0], "pressure"), false);
  });

  it("preserves relative stroke shape for the same brush width at different zooms", () => {
    const points = [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 9, y: 2 }, { x: 15, y: -1 }];
    const scale = 2 ** -16;
    const normal = strokeOutline(createStroke("normal", points, brush, 0));
    const zoomed = strokeOutline(createStroke(
      "zoomed",
      points.map(({ x, y }) => ({ x: x * scale, y: y * scale })),
      { ...brush, size: brush.size * scale },
      0,
    ));

    assert.deepEqual(zoomed.map(({ x, y }) => ({ x: x / scale, y: y / scale })), normal);
  });
});

describe("scene", () => {
  it("indexes an arrow past its shaft using a rotated and scaled arrowhead", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const arrow: ShapeObject = {
      id: "arrow", type: "shape", locked: false, zIndex: 1,
      transform: [0, 2, -3, 0, 100, 200],
      props: { kind: "arrow", points: [start, end], color: "#192038", size: 4 },
    };
    const scene = new Scene([arrow]);
    assert.deepEqual(shapeArrowHead(start, end, 4), [
      { x: 80, y: 10 }, end, { x: 80, y: -10 },
    ]);
    assert.deepEqual(objectBounds(arrow), { minX: 64, minY: 196, maxX: 136, maxY: 404 });
    assert.deepEqual(scene.search({ minX: 68, minY: 358, maxX: 72, maxY: 362 }), [arrow]);
    assert.deepEqual(shapeArrowHead(start, start, 4), []);
  });

  it("queries transformed stroke bounds and returns stable z-order", () => {
    const rotated = {
      ...createStroke("a", [{ x: 0, y: 0 }, { x: 10, y: 0 }], brush, 2),
      transform: [0, 1, -1, 0, 50, 10] as const,
    };
    const foreground = createStroke("b", [{ x: 50, y: 19 }], brush, 2);
    const other = createStroke("outside", [{ x: -1000, y: -1000 }], brush, 0);
    const scene = new Scene([foreground, other]);
    scene.add(rotated);

    assert.deepEqual(
      scene.search({ minX: 49, minY: 17, maxX: 51, maxY: 21 }).map(({ id }) => id),
      ["a", "b"],
    );
    assert.equal(scene.nextZIndex(), 3);
    assert.deepEqual(scene.search({ minX: 800, minY: 800, maxX: 900, maxY: 900 }), []);
  });

  it("rebuilds the spatial index from a JSON snapshot and keeps failed replacement atomic", () => {
    const stroke = createStroke("sample", [{ x: 12, y: 34 }, { x: 18, y: 36 }], brush, 4);
    const original = new Scene([stroke]);
    const snapshot = JSON.parse(JSON.stringify(original.snapshot())) as SceneSnapshot;
    const recovered = new Scene(snapshot.objects);

    assert.deepEqual(recovered.snapshot(), original.snapshot());
    assert.deepEqual(recovered.bounds(), original.bounds());
    assert.throws(() => recovered.replace([stroke, stroke]));
    assert.deepEqual(recovered.snapshot(), snapshot);
  });

  it("removes strokes and shrinks the spatial bounds incrementally", () => {
    const near = createStroke("near", [{ x: 12, y: 34 }], brush, 0);
    const far = createStroke("far", [{ x: 500, y: 600 }], brush, 1);
    const scene = new Scene([near, far]);
    assert.ok(scene.remove("far"));
    assert.deepEqual(scene.bounds(), new Scene([near]).bounds());
    assert.deepEqual(scene.search({ minX: 490, minY: 590, maxX: 510, maxY: 610 }), []);
    assert.equal(scene.remove("far"), false);
    assert.ok(scene.remove("near"));
    assert.equal(scene.bounds(), undefined);
  });
});
