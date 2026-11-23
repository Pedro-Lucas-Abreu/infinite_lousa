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
