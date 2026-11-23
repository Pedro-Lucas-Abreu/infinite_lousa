import { strokeOutline } from '../core/stroke'
import type { Affine, BoardObject, Bounds, Point, ShapeObject, Stroke } from '../core/types'
import { hitContours, type ShapeContour } from './shapes'

const outlines = new WeakMap<BoardObject, readonly Point[]>()
const shapeOutlines = new WeakMap<ShapeObject, readonly ShapeContour[]>()

export function transformPoint([a, b, c, d, e, f]: Affine, point: Point): Point {
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

export function multiplyTransforms([a, b, c, d, e, f]: Affine, [g, h, i, j, k, l]: Affine): Affine {
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]
}

function outline(object: Exclude<BoardObject, ShapeObject>): readonly Point[] {
  const cached = outlines.get(object)
  if (cached) return cached

  let local: readonly Point[]
  if (object.type === 'stroke') local = strokeOutline(object)
  else {
    const { width, height } = object.props
    local = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  }
  const result = local.map((point) => transformPoint(object.transform, point))
  outlines.set(object, result)
  return result
}

export function boundsFromPoints(points: readonly Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

export function rectanglePoints({ minX, minY, maxX, maxY }: Bounds): readonly Point[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }]
}

export function expandBounds(bounds: Bounds, amount: number): Bounds {
  return { minX: bounds.minX - amount, minY: bounds.minY - amount,
    maxX: bounds.maxX + amount, maxY: bounds.maxY + amount }
}

export function pointInside(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x - a.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside
  }
  return inside
}

function orientation(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.min(a.x, b.x) > Math.max(c.x, d.x) || Math.min(c.x, d.x) > Math.max(a.x, b.x) ||
    Math.min(a.y, b.y) > Math.max(c.y, d.y) || Math.min(c.y, d.y) > Math.max(a.y, b.y)) return false

  return orientation(a, b, c) * orientation(a, b, d) <= 0 && orientation(c, d, a) * orientation(c, d, b) <= 0
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - start.x - along * dx, point.y - start.y - along * dy)
}

function nearSegment(start: Point, end: Point, a: Point, b: Point, radius: number): boolean {
  return segmentsIntersect(start, end, a, b) || distanceToSegment(start, a, b) <= radius ||
    distanceToSegment(end, a, b) <= radius || distanceToSegment(a, start, end) <= radius ||
    distanceToSegment(b, start, end) <= radius
}

function touchesOutline(start: Point, end: Point, polygon: readonly Point[], radius: number): boolean {
  return polygon.some((a, i) => nearSegment(start, end, a, polygon[(i + 1) % polygon.length]!, radius))
}

function worldShapeContours(object: ShapeObject): readonly ShapeContour[] {
  const cached = shapeOutlines.get(object)
  if (cached) return cached

  const contours = hitContours(object).map(({ closed, points }) => ({ closed,
    points: points.map((point) => transformPoint(object.transform, point)) }))
  shapeOutlines.set(object, contours)
  return contours
}

function shapeRadius(object: ShapeObject): number {
  const [a, b, c, d] = object.transform
  return object.props.size * Math.max(Math.hypot(a, b), Math.hypot(c, d)) / 2
}

function touchesContour(start: Point, end: Point, contour: ShapeContour, radius: number): boolean {
  if (contour.closed) return touchesOutline(start, end, contour.points, radius)
  return contour.points.some((point, index, points) => index > 0 && nearSegment(start, end, points[index - 1]!, point, radius))
}

export function hitObject(object: BoardObject, point: Point, radius: number): boolean {
  if (object.type === 'shape') {
    return worldShapeContours(object).some((contour) => touchesContour(point, point, contour, radius + shapeRadius(object)))
  }
  const polygon = outline(object)
  return (object.type !== 'frame' && pointInside(point, polygon)) || touchesOutline(point, point, polygon, radius)
}

export function hitInk(stroke: Stroke, start: Point, end: Point, radius: number): boolean {
  const polygon = outline(stroke)
  return pointInside(start, polygon) || pointInside(end, polygon) || touchesOutline(start, end, polygon, radius)
}

export function regionIntersects(object: BoardObject, region: readonly Point[]): boolean {
  if (object.type === 'shape') {
    const radius = shapeRadius(object)
    return worldShapeContours(object).some((contour) => contour.points.some((point) => pointInside(point, region)) ||
      region.some((a, index) => touchesContour(a, region[(index + 1) % region.length]!, contour, radius)))
  }
  const polygon = outline(object)
  const start = polygon[0], regionStart = region[0]
  if (!start || !regionStart) return false
  return pointInside(start, region) || (object.type !== 'frame' && pointInside(regionStart, polygon)) ||
    region.some((a, i) => touchesOutline(a, region[(i + 1) % region.length]!, polygon, 0))
}

export function fittingFrame(start: Point, end: Point): Bounds {
  const dx = end.x - start.x, dy = end.y - start.y
  const width = Math.max(Math.abs(dx), Math.abs(dy) * 16 / 9)
  const height = width * 9 / 16
  return boundsFromPoints([start, { x: start.x + (dx < 0 ? -width : width), y: start.y + (dy < 0 ? -height : height) }])
}

export function selectionHandles(bounds: Bounds, zoom: number, rotate: boolean): readonly Point[] {
  const corners = rectanglePoints(bounds)
  if (!rotate) return corners
  return [...corners, { x: bounds.minX + (bounds.maxX - bounds.minX) / 2, y: bounds.minY - 25 / zoom }]
}
