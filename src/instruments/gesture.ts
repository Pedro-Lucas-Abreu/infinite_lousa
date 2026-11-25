import type { Affine, Point } from '../core/types'

const fullTurn = 2 * Math.PI

export interface CompassSweep {
  readonly angle: number
  readonly sweep: number
}

export function compassAngle(center: Point, point: Point): number {
  return Math.atan2(point.y - center.y, point.x - center.x)
}

export function sweepCompass(previous: CompassSweep, angle: number): CompassSweep {
  const delta = angle - previous.angle
  const shortest = Math.atan2(Math.sin(delta), Math.cos(delta))
  return { angle, sweep: Math.min(fullTurn, Math.max(-fullTurn, previous.sweep + shortest)) }
}

export function compassTransform(center: Point, radius: number, angle: number, pivot: Point, tip: Point): Affine {
  const scale = radius / Math.hypot(tip.x - pivot.x, tip.y - pivot.y)
  const rotation = angle - compassAngle(pivot, tip)
  const a = Math.cos(rotation) * scale
  const b = Math.sin(rotation) * scale
  return [a, b, -b, a, center.x - a * pivot.x + b * pivot.y, center.y - b * pivot.x - a * pivot.y]
}
