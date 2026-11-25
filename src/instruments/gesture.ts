import type { Affine, Point } from '../core/types'
import { instrumentPoint, protractorCenter, type InstrumentPlacement } from './geometry'

const fullTurn = 2 * Math.PI

export interface CompassSweep {
  readonly angle: number
  readonly sweep: number
}

export function compassAngle(center: Point, point: Point): number {
  return Math.atan2(point.y - center.y, point.x - center.x)
}

export function compassRadius(distance: number, minimum: number, remembered?: number): number | undefined {
  if (!Number.isFinite(distance) || distance < minimum) return
  return remembered ?? distance
}

export function worldProtractorCenter({ props, transform }: InstrumentPlacement): Point {
  return instrumentPoint(transform, protractorCenter(props.width, props.height))
}

export function measureProtractor(protractor: InstrumentPlacement, target: Point, snap: boolean):
  { center: Point; end: Point; degrees: number } {
  const center = worldProtractorCenter(protractor)
  const [a, b, c, d] = protractor.transform
  const determinant = a * d - b * c
  const x = target.x - center.x, y = target.y - center.y
  const localX = (d * x - c * y) / determinant
  const localY = (-b * x + a * y) / determinant
  const measured = Math.atan2(Math.max(0, -localY), localX) * 180 / Math.PI
  const degrees = snap ? Math.round(measured) : measured
  const angle = degrees * Math.PI / 180
  const dx = a * Math.cos(angle) - c * Math.sin(angle)
  const dy = b * Math.cos(angle) - d * Math.sin(angle)
  const factor = Math.hypot(x, y) / Math.hypot(dx, dy)
  return { center, end: { x: center.x + dx * factor, y: center.y + dy * factor }, degrees }
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
