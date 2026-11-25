import type { Point, ShapeKind } from '../core/types'

export const shapeHoldMs = 700
export const shapeHoldRadius = 3

export interface RecognizedShape {
  readonly kind: Exclude<ShapeKind, 'arc'>
  readonly points: readonly Point[]
  readonly angle?: number
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const length = ({ x, y }: Point): number => Math.hypot(x, y)
const distance = (a: Point, b: Point): number => length(subtract(a, b))
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const unit = (point: Point): Point => {
  const size = length(point)
  return { x: point.x / size, y: point.y / size }
}
const rotate = ({ x, y }: Point, angle: number): Point => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
})

function bounds(points: readonly Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(x, minX); minY = Math.min(y, minY)
    maxX = Math.max(x, maxX); maxY = Math.max(y, maxY)
  }
  return { minX, minY, maxX, maxY }
}

function segmentDistance(point: Point, start: Point, end: Point): number {
  const edge = subtract(end, start)
  const delta = subtract(point, start)
  const size = dot(edge, edge)
  if (size === 0) return length(delta)
  const fraction = Math.max(0, Math.min(1, dot(delta, edge) / size))
  return Math.hypot(delta.x - fraction * edge.x, delta.y - fraction * edge.y)
}

function resample(points: readonly Point[], total: number): Point[] {
  const samples = [points[0]]
  let index = 1, travelled = 0
  for (let slot = 1; slot < 64; slot++) {
    const target = total * slot / 64
    while (index < points.length - 1 && travelled + distance(points[index - 1], points[index]) < target) {
      travelled += distance(points[index - 1], points[index])
      index++
    }
    const start = points[index - 1]
    const segment = subtract(points[index], start)
    const ratio = (target - travelled) / length(segment)
    samples.push({ x: start.x + ratio * segment.x, y: start.y + ratio * segment.y })
  }
  samples.push(points.at(-1)!)
  return samples
}

function simplify(points: readonly Point[], tolerance: number): Point[] {
  const start = points[0], end = points.at(-1)!
  let index = 0, error = tolerance
  for (let i = 1; i < points.length - 1; i++) {
    const candidate = segmentDistance(points[i], start, end)
    if (candidate > error) {
      index = i
      error = candidate
    }
  }
  return index ? [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance)] : [start, end]
}

function closedCorners(samples: readonly Point[], tolerance: number): Point[] {
  const closed = [...samples, samples[0]]
  const corners = simplify(closed, tolerance).slice(0, -1)
  for (let i = corners.length - 1; i >= 0 && corners.length > 3; i--) {
    if (segmentDistance(corners[i], corners[(i + corners.length - 1) % corners.length],
      corners[(i + 1) % corners.length]) <= tolerance) corners.splice(i, 1)
  }
  return corners
}

function boxShape(kind: 'ellipse' | 'rectangle', points: readonly Point[], angle: number, square: boolean): RecognizedShape {
  const { minX, minY, maxX, maxY } = bounds(points.map((p) => rotate(p, -angle)))
  const center = rotate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, angle)
  const x = square ? (maxX - minX + maxY - minY) / 4 : (maxX - minX) / 2
  const y = square ? x : (maxY - minY) / 2
  return { kind, angle, points: [{ x: center.x - x, y: center.y - y }, { x: center.x + x, y: center.y + y }] }
}

function recognizePolygon(samples: readonly Point[], tolerance: number, span: number): RecognizedShape | undefined {
  const corners = closedCorners(samples, tolerance)
  if (corners.length !== 3 && corners.length !== 4) return
  const edges = corners.map((point, i) => subtract(corners[(i + 1) % corners.length], point))
  const sizes = edges.map(length)
  if (Math.min(...sizes) < Math.max(14, span * 0.16)) return
  const directions = edges.map(unit)
  const turns = directions.map((dir, i) => cross(dir, directions[(i + 1) % corners.length]))
  if (!turns.every((turn) => Math.abs(turn) >= 0.42 && Math.sign(turn) === Math.sign(turns[0]))) return

  const errors = samples.map((point) => Math.min(...corners.map((start, i) =>
    segmentDistance(point, start, corners[(i + 1) % corners.length]))))
  if (Math.max(...errors) > tolerance * 1.6 ||
    errors.reduce((sum, error) => sum + error, 0) / errors.length > tolerance * 0.6) return
  if (corners.length === 3) return { kind: 'polygon', points: corners }
  if (directions.some((dir, i) => Math.abs(dot(dir, directions[(i + 1) % 4])) > 0.25) ||
    Math.abs(sizes[0] / sizes[2] - 1) > 0.23 || Math.abs(sizes[1] / sizes[3] - 1) > 0.23) return
  const axis = subtract(directions[0], directions[2])
  const angle = Math.atan2(axis.y, axis.x)
  const ratio = (sizes[0] + sizes[2]) / (sizes[1] + sizes[3])
  return boxShape('rectangle', corners, angle, ratio > 0.89 && ratio < 1.12)
}

function recognizeEllipse(samples: readonly Point[]): RecognizedShape | undefined {
  const center = samples.reduce((sum, point) => ({ x: sum.x + point.x / samples.length, y: sum.y + point.y / samples.length }),
    { x: 0, y: 0 })
  let xx = 0, yy = 0, xy = 0
  for (const point of samples) {
    const { x, y } = subtract(point, center)
    xx += x * x; yy += y * y; xy += x * y
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2
  const positions = samples.map((point) => rotate(point, -angle))
  const { minX, minY, maxX, maxY } = bounds(positions)
  const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2
  if (Math.min(rx, ry) < 15 || Math.min(rx, ry) / Math.max(rx, ry) < 0.27) return
  const furthest = positions.map(({ x, y }) => ({ x: (x - minX) / rx - 1, y: (y - minY) / ry - 1 }))
  const deviations = furthest.map((point) => Math.abs(length(point) - 1))
  if (Math.max(...deviations) > 0.24 ||
    deviations.reduce((sum, error) => sum + error * error, 0) / deviations.length > 0.009) return
  let sweep = 0, travel = 0
  for (let i = 1; i < furthest.length; i++) {
    const part = Math.atan2(cross(furthest[i - 1], furthest[i]), dot(furthest[i - 1], furthest[i]))
    sweep += part
    travel += Math.abs(part)
  }
  if (Math.abs(sweep) < 5.4 || Math.abs(sweep) > 7 || travel > Math.abs(sweep) * 1.14) return
  return boxShape('ellipse', samples, angle, Math.min(rx, ry) / Math.max(rx, ry) > 0.9)
}

function recognizeArrow(samples: readonly Point[], tolerance: number): RecognizedShape | undefined {
  const corners = simplify(samples, tolerance)
  if (corners.length !== 5) return
  const [start, tip, wingA, returnTip, wingB] = corners
  const shaft = subtract(tip, start)
  const span = length(shaft)
  if (span < 40 || distance(tip, returnTip) > tolerance * 1.8) return
  const axis = unit(shaft)
  const wings = [subtract(wingA, tip), subtract(wingB, tip)]
  const sides = wings.map((wing) => cross(axis, wing))
  if (sides[0] * sides[1] >= 0 || wings.some((wing, i) => {
    const back = -dot(axis, wing)
    return back < 0.08 * span || back > 0.48 * span || Math.abs(sides[i]) < back * 0.28 ||
      Math.abs(sides[i]) > back * 1.5
  })) return
  return { kind: 'arrow', points: [start, tip] }
}

export function recognizeShape(raw: readonly Point[]): RecognizedShape | undefined {
  const points = raw.filter((point, index) => !index || distance(point, raw[index - 1]) > 0.01)
  if (points.length < 2) return
  const { minX, minY, maxX, maxY } = bounds(points)
  const span = Math.hypot(maxX - minX, maxY - minY)
  if (!Number.isFinite(span) || span < 40) return
  const total = points.reduce((sum, point, index) => index ? sum + distance(point, points[index - 1]) : 0, 0)
  const samples = resample(points, total)
  const start = samples[0], end = samples.at(-1)!
  const gap = distance(start, end)
  const tolerance = Math.max(3, Math.min(12, span * 0.045))
  if (gap <= Math.min(24, span * 0.2) && total >= span * 2.1 && total <= span * 3.55) {
    return recognizePolygon(samples, tolerance, span) ?? recognizeEllipse(samples)
  }
  if (gap >= 40 && total <= gap * 1.32 &&
    samples.every((point) => segmentDistance(point, start, end) <= tolerance)) return { kind: 'line', points: [start, end] }
  return recognizeArrow(samples, tolerance)
}
