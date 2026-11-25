import type { Point } from "./types";

export function shapeArrowHead(start: Point, end: Point, size: number): readonly Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];

  const headLength = Math.min(length * 0.35, size * 5);
  const ux = dx / length * headLength;
  const uy = dy / length * headLength;
  const baseX = end.x - ux;
  const baseY = end.y - uy;
  return [
    { x: baseX - uy * 0.5, y: baseY + ux * 0.5 },
    end,
    { x: baseX + uy * 0.5, y: baseY - ux * 0.5 },
  ];
}

export function shapeArcPoints(center: Point, radius: number, startAngle: number, sweep: number): readonly Point[] {
  if (!(radius > 0) || !Number.isFinite(radius) || !Number.isFinite(startAngle) || !Number.isFinite(sweep) || sweep === 0) return [];
  const angle = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, sweep));
  const pieces = Math.ceil(Math.abs(angle) / (Math.PI / 2));
  const step = angle / pieces;
  const controlLength = radius * ((4 / 3) * Math.tan(step / 4));
  const pointAt = (angle: number): Point => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  });
  let start = pointAt(startAngle);
  const points = [start];
  for (let part = 0; part < pieces; part++) {
    const from = startAngle + part * step;
    const to = from + step;
    const end = pointAt(to);
    points.push(
      { x: start.x - Math.sin(from) * controlLength, y: start.y + Math.cos(from) * controlLength },
      { x: end.x + Math.sin(to) * controlLength, y: end.y - Math.cos(to) * controlLength },
      end,
    );
    start = end;
  }
  return points;
}

export function* shapeArcSegments(points: readonly Point[]): Generator<readonly [Point, Point, Point, Point]> {
  for (let index = 3; index < points.length; index += 3) {
    yield [points[index - 3]!, points[index - 2]!, points[index - 1]!, points[index]!];
  }
}
