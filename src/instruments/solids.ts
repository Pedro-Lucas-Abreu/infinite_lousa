import type { Point, StrokePoint } from '../core/types'
import { instrumentOutline, instrumentPoint, projectToInstrumentEdge, type InstrumentPlacement } from './geometry'

export type SolidBoundary = readonly Point[]

const angularEpsilon = 1e-12
const fractionEpsilon = 1e-9
const delta = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function solidBoundary({ props, transform }: InstrumentPlacement): SolidBoundary {
  return instrumentOutline(props.kind, props.width, props.height).map((point) => instrumentPoint(transform, point))
}

function winding(boundary: SolidBoundary): number {
  return Math.sign(cross(delta(boundary[1], boundary[0]), delta(boundary[2], boundary[0])))
}

function boundaryTolerance(boundary: SolidBoundary): number {
  const a = boundary[0], b = boundary[Math.floor(boundary.length / 2)]
  return distance(a, b) * 1e-11 + 8 * Number.EPSILON * Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y))
}

function sideOf(a: Point, b: Point, sign: number): (point: Point) => number {
  const edge = delta(b, a)
  const factor = sign / distance(a, b)
  return (point) => cross(edge, delta(point, a)) * factor
}

function strictlyInside(point: Point, boundary: SolidBoundary): boolean {
  if (boundary.length < 3) return false
  const sign = winding(boundary), tolerance = boundaryTolerance(boundary)
  return boundary.every((a, edge) => sideOf(a, boundary[(edge + 1) % boundary.length], sign)(point) > tolerance)
}

function intersectionFraction(start: Point, end: Point, a: Point, b: Point): number | undefined {
  const direction = delta(end, start), tangent = delta(b, a)
  const divisor = cross(direction, tangent)
  if (Math.abs(divisor) <= angularEpsilon * Math.hypot(direction.x, direction.y) * Math.hypot(tangent.x, tangent.y)) return
  const diff = delta(a, start)
  const t = cross(diff, tangent) / divisor
  const alongEdge = cross(diff, direction) / divisor
  if (t < -fractionEpsilon || t > 1 + fractionEpsilon || alongEdge < -fractionEpsilon || alongEdge > 1 + fractionEpsilon) return
  return Math.max(0, Math.min(1, t))
}

export function projectSolidPoint(point: Point, boundaries: readonly SolidBoundary[], bypass = false): Point {
  if (bypass || !boundaries.some((boundary) => strictlyInside(point, boundary))) return point
  let best = point, bestDistance = Infinity
  function consider(candidate: Point) {
    const gap = distance(point, candidate)
    if (gap >= bestDistance || boundaries.some((other) => strictlyInside(candidate, other))) return
    best = candidate
    bestDistance = gap
  }
  boundaries.forEach((boundary, boundaryIndex) => {
    boundary.forEach((start, i) => {
      const end = boundary[(i + 1) % boundary.length]
      const nearest = projectToInstrumentEdge(point, { start, end })
      consider(nearest)
      if (boundaries.length <= 1 || distance(point, nearest) >= bestDistance) return
      consider(start)
      for (const other of boundaries.slice(boundaryIndex + 1)) {
        other.forEach((a, edge) => {
          const fraction = intersectionFraction(start, end, a, other[(edge + 1) % other.length])
          if (fraction !== undefined) consider(at(start, end, fraction))
        })
      }
    })
  })
  return best
}

interface Crossing { edge: number; point: Point }

function betweenCrossings(boundary: SolidBoundary, entry: Crossing, exit: Crossing): Point[] {
  const points = [entry.point]
  for (let edge = entry.edge; edge !== exit.edge; edge = (edge + 1) % boundary.length) {
    points.push(boundary[(edge + 1) % boundary.length])
  }
  points.push(exit.point)
  return points
}

function pathLength(points: readonly Point[]): number {
  return points.reduce((sum, point, i) => i ? sum + distance(points[i - 1], point) : sum, 0)
}

function crossingInterval(start: Point, end: Point, boundary: SolidBoundary): [Crossing, Crossing] | undefined {
  if (boundary.length < 3) return
  let entering = 0, leaving = 1, entryEdge = -1, exitEdge = -1
  const sign = winding(boundary), tolerance = boundaryTolerance(boundary)
  for (let edge = 0; edge < boundary.length; edge++) {
    const side = sideOf(boundary[edge], boundary[(edge + 1) % boundary.length], sign)
    const from = side(start), to = side(end)
    if (from <= tolerance && to <= tolerance) return
    if (from > tolerance && to > tolerance) continue
    const t = Math.max(0, Math.min(1, from / (from - to)))
    if (from <= tolerance && t >= entering) { entering = t; entryEdge = edge }
    if (to <= tolerance && t <= leaving) { leaving = t; exitEdge = edge }
    if (entering >= leaving) return
  }
  if (!strictlyInside(at(start, end, (entering + leaving) / 2), boundary)) return
  return [{ edge: entryEdge, point: at(start, end, entering) }, { edge: exitEdge, point: at(start, end, leaving) }]
}

export function segmentEntersSolid(start: Point, end: Point, boundary: SolidBoundary): boolean {
  return crossingInterval(start, end, boundary) !== undefined ||
    strictlyInside(start, boundary) || strictlyInside(end, boundary)
}

function avoidBody(start: Point, end: Point, boundary: SolidBoundary): Point[] {
  const interval = crossingInterval(start, end, boundary)
  if (!interval) return [end]
  const [entry, exit] = interval
  if (entry.edge < 0 || exit.edge < 0) return [end]
  const forward = betweenCrossings(boundary, entry, exit)
  const backward = betweenCrossings(boundary, exit, entry).reverse()
  return [...(pathLength(forward) <= pathLength(backward) ? forward : backward), end]
}

export function traceAroundSolids(
  point: Point, boundaries: readonly SolidBoundary[], previous?: Point, bypass = false, hysteresis = 0,
): StrokePoint[] {
  const end = projectSolidPoint(point, boundaries, bypass)
  if (bypass || !previous) return [end]
  let target = end
  if (end !== point && hysteresis > 0) {
    let closest = distance(point, end) + hysteresis
    for (const boundary of boundaries) {
      if (boundary.length < 3) continue
      const tolerance = boundaryTolerance(boundary)
      const entered = strictlyInside(point, boundary) ? crossingInterval(previous, point, boundary)?.[0] : undefined
      if (entered && entered.edge >= 0 && distance(previous, entered.point) > tolerance) {
        const candidate = projectToInstrumentEdge(point, { start: boundary[entered.edge], end: boundary[(entered.edge + 1) % boundary.length] })
        if (!boundaries.some((body) => strictlyInside(candidate, body))) {
          target = candidate
          break
        }
      }
      boundary.forEach((start, index) => {
        const edge = { start, end: boundary[(index + 1) % boundary.length] }
        if (distance(projectToInstrumentEdge(previous, edge), previous) > tolerance) return
        const candidate = projectToInstrumentEdge(point, edge)
        const gap = distance(point, candidate)
        if (gap < closest && !boundaries.some((body) => strictlyInside(candidate, body))) {
          closest = gap
          target = candidate
        }
      })
    }
  }
  let path = [target]
  for (const boundary of boundaries) {
    path = path.flatMap((next, i, rest) => avoidBody(i ? rest[i - 1] : previous, next, boundary))
  }
  // A detour around overlapping bodies can intersect an earlier body. Keep the two
  // pieces in one stroke, with a new subpath wherever there is no safe connection.
  return path.filter((next) => !boundaries.some((body) => strictlyInside(next, body)))
    .map((next, index, outside) => boundaries.some((body) => segmentEntersSolid(index ? outside[index - 1] : previous, next, body))
      ? { ...next, breakBefore: true } : next)
}

// Split each ink contour at the instrument's supporting lines. The outside pieces
// are disjoint in area and can be rendered with one nonzero fill, including PDF.
export function clipInkToExterior(contours: readonly SolidBoundary[], body: SolidBoundary): readonly SolidBoundary[] {
  if (body.length < 3) return contours
  const sign = winding(body)
  return contours.flatMap((contour) => {
    let inside = contour
    const outside: SolidBoundary[] = []
    for (let i = 0; i < body.length && inside.length >= 3; i++) {
      const side = sideOf(body[i], body[(i + 1) % body.length], sign)
      const distances = inside.map(side)
      if (distances.every((value) => value <= 0)) { outside.push(inside); break }
      if (distances.every((value) => value >= 0)) continue
      const front: Point[] = [], back: Point[] = []
      inside.forEach((a, j) => {
        const k = (j + 1) % inside.length
        const u = distances[j], v = distances[k]
        if (u >= 0) front.push(a)
        if (u <= 0) back.push(a)
        if (u * v < 0) {
          const intersection = at(a, inside[k], u / (u - v))
          front.push(intersection)
          back.push(intersection)
        }
      })
      if (back.length >= 3) outside.push(back)
      inside = front
    }
    return outside
  })
}
