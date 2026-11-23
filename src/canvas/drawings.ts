import { shapeArrowHead } from "../core/shapes";
import type { ShapeObject, TextObject } from "../core/types";

export const TEXT_LINE_HEIGHT = 1.25;

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
