import type { Bounds, Camera, Point, Viewport } from "./types";

const MIN_ZOOM = 1e-12;
const MAX_ZOOM = 1e12;

export function worldToScreen(point: Point, camera: Camera, viewport: Viewport): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (point.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function screenToWorld(point: Point, camera: Camera, viewport: Viewport): Point {
  return {
    x: camera.x + (point.x - viewport.width / 2) / camera.zoom,
    y: camera.y + (point.y - viewport.height / 2) / camera.zoom,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  const x = camera.x - dx / camera.zoom;
  const y = camera.y - dy / camera.zoom;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, zoom: camera.zoom } : camera;
}

export function zoomAt(camera: Camera, point: Point, viewport: Viewport, factor: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;

  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
  if (zoom === camera.zoom) return camera;

  const change = 1 / camera.zoom - 1 / zoom;
  const x = camera.x + (point.x - viewport.width / 2) * change;
  const y = camera.y + (point.y - viewport.height / 2) * change;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, zoom } : camera;
}

export function viewportBounds(camera: Camera, viewport: Viewport): Bounds {
  const halfWidth = viewport.width / (2 * camera.zoom);
  const halfHeight = viewport.height / (2 * camera.zoom);
  return {
    minX: camera.x - halfWidth,
    minY: camera.y - halfHeight,
    maxX: camera.x + halfWidth,
    maxY: camera.y + halfHeight,
  };
}
