import { shapeArcSegments, shapeArrowHead } from "../core/shapes";
import type { EquationObject, InstrumentObject, PlotObject, ShapeObject, SolidObject, TextObject } from "../core/types";
import { getInstrumentGeometry } from "../instruments/geometry";
import { getPlotGeometry, type PlotLine } from "../plot/geometry";
import { projectSolid, solidDash, SOLID_FILL_OPACITY } from "../solids/geometry";

export const TEXT_LINE_HEIGHT = 1.25;
export const PLOT_GRID_OPACITY = 0.28;
export const PLOT_GRID_WIDTH_RATIO = 0.55;
export const INSTRUMENT_BODY_OPACITY = 0.55;
export const instrumentPaint = (dark: boolean) => dark
  ? { ink: "#b7d8ff", body: "#244975" } : { ink: "#244a76", body: "#bcd9fd" };
export const instrumentLineWidth = (weight: "minor" | "major" | undefined) => weight === "minor" ? 0.75 : 1.35;
const equationPaths = new WeakMap<EquationObject["props"]["paths"], readonly Path2D[]>();

function shapePath(shape: ShapeObject): Path2D {
  const path = new Path2D();
  const { points, kind, size } = shape.props;
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) return path;

  if (kind === "rectangle") {
    path.rect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else if (kind === "ellipse") {
    path.ellipse(
      (start.x + end.x) / 2, (start.y + end.y) / 2,
      Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2,
      0, 0, 2 * Math.PI,
    );
  } else {
    path.moveTo(start.x, start.y);
    if (kind === "polygon") {
      for (const point of points.slice(1)) path.lineTo(point.x, point.y);
      path.closePath();
    } else if (kind === "arc") {
      for (const [, a, b, end] of shapeArcSegments(points)) path.bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y);
    } else {
      path.lineTo(end.x, end.y);
    }
    if (kind === "arrow") {
      const [left, tip, right] = shapeArrowHead(start, end, size);
      if (left && tip && right) {
        path.moveTo(left.x, left.y);
        path.lineTo(tip.x, tip.y);
        path.lineTo(right.x, right.y);
      }
    }
  }
  return path;
}

export function drawShape(context: CanvasRenderingContext2D, shape: ShapeObject, color: string): void {
  context.strokeStyle = color;
  context.lineWidth = shape.props.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(shapePath(shape));
}

export function drawTextObject(context: CanvasRenderingContext2D, object: TextObject, color: string): void {
  const { text, fontSize } = object.props;
  context.fillStyle = color;
  context.font = `${fontSize}px Arial, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  text.split("\n").forEach((line, index) => {
    context.fillText(line, 0, fontSize * (1 + TEXT_LINE_HEIGHT * index));
  });
}

export function drawEquationObject(context: CanvasRenderingContext2D, object: EquationObject, color: string): void {
  const { paths } = object.props;
  let geometry = equationPaths.get(paths);
  if (!geometry) {
    geometry = paths.map(({ d }) => new Path2D(d));
    equationPaths.set(paths, geometry);
  }

  context.fillStyle = color;
  for (const [index, path] of geometry.entries()) {
    context.save();
    context.transform(...paths[index]!.transform);
    context.fill(path);
    context.restore();
  }
}

function plotLinePath(lines: readonly PlotLine[]): Path2D {
  const path = new Path2D();
  for (const { from, to } of lines) {
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }
  return path;
}

export function drawPlotObject(context: CanvasRenderingContext2D, object: PlotObject, resolveColor: (color: string) => string): void {
  const { width, height, color, size, settings, functions } = object.props;
  const { grid, axes, labels, curves, fontSize } = getPlotGeometry(settings, width, height, functions);
  const ink = resolveColor(color);

  context.save();
  context.strokeStyle = ink;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = size * PLOT_GRID_WIDTH_RATIO;
  context.globalAlpha = PLOT_GRID_OPACITY;
  context.stroke(plotLinePath(grid));

  context.globalAlpha = 1;
  context.lineWidth = size;
  context.stroke(plotLinePath(axes));
  for (const curve of curves) {
    const path = new Path2D();
    for (const [first, ...points] of curve.paths) {
      if (!first) continue;
      path.moveTo(first.x, first.y);
      for (const point of points) path.lineTo(point.x, point.y);
    }
    context.strokeStyle = resolveColor(curve.color);
    context.stroke(path);
  }

  context.fillStyle = ink;
  context.font = `${fontSize}px Arial, sans-serif`;
  context.textBaseline = "alphabetic";
  for (const { text, x, y, align } of labels) {
    context.textAlign = align;
    context.fillText(text, x, y);
  }
  context.restore();
}

export function drawInstrument(context: CanvasRenderingContext2D, object: InstrumentObject, dark: boolean): void {
  const { kind, width, height } = object.props;
  const { paths, labels } = getInstrumentGeometry(kind, width, height);
  const { ink, body } = instrumentPaint(dark);
  context.save();
  context.strokeStyle = ink;
  context.fillStyle = body;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const { points, closed, fill, weight } of paths) {
    const [first, ...rest] = points;
    if (!first) continue;
    const path = new Path2D();
    path.moveTo(first.x, first.y);
    for (const point of rest) path.lineTo(point.x, point.y);
    if (closed) path.closePath();
    if (fill) {
      context.globalAlpha = INSTRUMENT_BODY_OPACITY;
      context.fill(path);
      context.globalAlpha = 1;
    }
    context.lineWidth = instrumentLineWidth(weight);
    context.stroke(path);
  }
  context.fillStyle = ink;
  context.textBaseline = "alphabetic";
  for (const { text, x, y, align, size } of labels) {
    context.font = `${size}px Arial, sans-serif`;
    context.textAlign = align;
    context.fillText(text, x, y);
  }
  context.restore();
}

export function drawSolid(context: CanvasRenderingContext2D, object: SolidObject, color: string): void {
  const { size } = object.props;
  context.save();
  context.strokeStyle = context.fillStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = size;
  for (const { start, segments, role, closed } of projectSolid(object.props, size).paths) {
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const { end, controls } of segments) {
      if (controls) context.bezierCurveTo(controls[0].x, controls[0].y, controls[1].x, controls[1].y, end.x, end.y);
      else context.lineTo(end.x, end.y);
    }
    if (closed) context.closePath();
    if (role === "face") {
      context.globalAlpha = SOLID_FILL_OPACITY;
      context.fill();
      context.globalAlpha = 1;
    } else {
      context.setLineDash(role === "visible" ? [] : solidDash(size));
      context.stroke();
    }
  }
  context.restore();
}
