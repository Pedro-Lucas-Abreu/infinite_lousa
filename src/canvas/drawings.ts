import { shapeArrowHead } from "../core/shapes";
import type { EquationObject, PlotObject, ShapeObject, TextObject } from "../core/types";
import { getPlotGeometry, type PlotLine } from "../plot/geometry";

export const TEXT_LINE_HEIGHT = 1.25;
export const PLOT_GRID_OPACITY = 0.28;
export const PLOT_GRID_WIDTH_RATIO = 0.55;
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
