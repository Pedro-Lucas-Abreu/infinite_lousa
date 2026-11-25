import { shapeArcSegments, shapeArrowHead } from '../core/shapes'
import type { Point, ShapeObject } from '../core/types'

export type DragShape = Exclude<ShapeObject['props']['kind'], 'polygon' | 'arc'>

export interface ShapeContour {
  readonly points: readonly Point[]
  readonly closed: boolean
}

export function snapAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x, dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length }
}

export function dragShapePoints(kind: DragShape, start: Point, endpoint: Point, constrained: boolean): readonly Point[] {
  if (kind === 'line' || kind === 'arrow') return [start, constrained ? snapAngle(start, endpoint) : endpoint]

  let dx = endpoint.x - start.x, dy = endpoint.y - start.y
  if (constrained) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * size
    dy = (dy < 0 ? -1 : 1) * size
  }
  return [
    { x: start.x + Math.min(0, dx), y: start.y + Math.min(0, dy) },
    { x: start.x + Math.max(0, dx), y: start.y + Math.max(0, dy) },
  ]
}

export function isDrawableShape(kind: DragShape, points: readonly Point[], minimumSize: number): boolean {
  const first = points[0]!, last = points[1]!
  const width = Math.abs(last.x - first.x), height = Math.abs(last.y - first.y)
  return kind === 'line' || kind === 'arrow' ? Math.hypot(width, height) >= minimumSize :
    width >= minimumSize && height >= minimumSize
}

export function appendVertex(points: readonly Point[], next: Point, minimumDistance: number): readonly Point[] {
  const previous = points.at(-1)
  if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < minimumDistance) return points
  return [...points, next]
}

export function hitContours(shape: ShapeObject): readonly ShapeContour[] {
  const { kind, points, size } = shape.props
  if (kind === 'polygon' || kind === 'line') return [{ points, closed: kind === 'polygon' }]
  if (kind === 'arc') {
    const outline = points.slice(0, 1)
    for (const [start, control1, control2, end] of shapeArcSegments(points)) {
      for (let sample = 1; sample <= 16; sample++) {
        const t = sample / 16
        const u = 1 - t
        const a = u ** 3, b = 3 * u ** 2 * t, c = 3 * u * t ** 2, d = t ** 3
        outline.push({
          x: a * start.x + b * control1.x + c * control2.x + d * end.x,
          y: a * start.y + b * control1.y + c * control2.y + d * end.y,
        })
      }
    }
    return [{ points: outline, closed: false }]
  }
  const first = points[0]!, last = points[1]!
  if (kind === 'arrow') {
    return [{ points, closed: false }, { points: shapeArrowHead(first, last, size), closed: false }]
  }
  if (kind === 'rectangle') {
    return [{ points: [first, { x: last.x, y: first.y }, last, { x: first.x, y: last.y }], closed: true }]
  }

  const radiusX = (last.x - first.x) / 2, radiusY = (last.y - first.y) / 2
  const centerX = first.x + radiusX, centerY = first.y + radiusY
  const samples = 64
  const ellipse = Array.from({ length: samples }, (_value, index) => {
    const angle = index * 2 * Math.PI / samples
    return { x: centerX + radiusX * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) }
  })
  return [{ points: ellipse, closed: true }]
}
