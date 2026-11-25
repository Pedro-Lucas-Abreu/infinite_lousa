import type { Point } from '../core/types'
import { instrumentOutline, instrumentPoint, projectToInstrumentEdge, type InstrumentPlacement } from './geometry'

export type SolidBoundary = readonly Point[]

const epsilon = 1e-8
const delta = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function solidBoundary({ props, transform }: InstrumentPlacement): SolidBoundary {
  return instrumentOutline(props.kind, props.width, props.height).map((point) => instrumentPoint(transform, point))
}

function strictlyInside(point: Point, boundary: SolidBoundary): boolean {
  if (!boundary.length) return false
  let side = 0
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length]
    const signedDistance = cross(delta(b, a), delta(point, a)) / distance(a, b)
    if (Math.abs(signedDistance) < epsilon || side && side !== Math.sign(signedDistance)) return false
    side = Math.sign(signedDistance)
  }
  return Boolean(side)
}

function intersectionFraction(start: Point, end: Point, a: Point, b: Point): number | undefined {
  const direction = delta(end, start), tangent = delta(b, a)
  const divisor = cross(direction, tangent)
  if (Math.abs(divisor) < epsilon) return undefined
  const diff = delta(a, start)
  const t = cross(diff, tangent) / divisor
  const alongEdge = cross(diff, direction) / divisor
  if (t < -epsilon || t > 1 + epsilon || alongEdge < -epsilon || alongEdge > 1 + epsilon) return undefined
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

interface Crossing { edge: number; t: number; point: Point }

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

function avoidBody(start: Point, end: Point, boundary: SolidBoundary): Point[] {
  if (strictlyInside(start, boundary)) return [end]
  const crossings: Crossing[] = []
  boundary.forEach((a, edge) => {
    const t = intersectionFraction(start, end, a, boundary[(edge + 1) % boundary.length])
    if (t !== undefined) crossings.push({ edge, t, point: at(start, end, t) })
  })
  if (crossings.length < 2) return [end]
  crossings.sort((a, b) => a.t - b.t)
  const entry = crossings[0], exit = crossings.at(-1)!
  if (!strictlyInside(at(start, end, (entry.t + exit.t) / 2), boundary)) return [end]
  const forward = betweenCrossings(boundary, entry, exit)
  const backward = betweenCrossings(boundary, exit, entry).reverse()
  return [...(pathLength(forward) <= pathLength(backward) ? forward : backward), end]
}

export function traceAroundSolids(point: Point, boundaries: readonly SolidBoundary[], previous?: Point, bypass = false): Point[] {
  const end = projectSolidPoint(point, boundaries, bypass)
  if (bypass || !previous) return [end]
  let path = [end]
  for (const boundary of boundaries) {
    path = path.flatMap((next, i, rest) => avoidBody(i ? rest[i - 1] : previous, next, boundary))
  }
  return path
}
