import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Affine, Point } from '../core/types'
import { compassAngle, compassTransform, sweepCompass } from './gesture'

function project([a, b, c, d, e, f]: Affine, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`)
}

it('positions the needle at the center and the tip on the desired radius', () => {
  const center = { x: 35, y: -17 }
  const pivot = { x: 2, y: 5 }
  const tip = { x: 8, y: 12 }
  for (const angle of [0, Math.PI / 2, Math.PI, -1]) {
    const transform = compassTransform(center, 48, angle, pivot, tip)
    const actualCenter = project(transform, pivot)
    const actualTip = project(transform, tip)
    near(actualCenter.x, center.x)
    near(actualCenter.y, center.y)
    near(Math.hypot(actualTip.x - center.x, actualTip.y - center.y), 48)
    near(Math.sin(compassAngle(center, actualTip) - angle), 0)
  }
})

it('tracks the direction across the angle wrap and limits arcs to one revolution', () => {
  const from = { angle: 3, sweep: 0 }
  const clockwise = sweepCompass(from, -3)
  near(clockwise.sweep, 2 * Math.PI - 6)
  const counterclockwise = sweepCompass({ angle: -3, sweep: 0 }, 3)
  near(counterclockwise.sweep, 6 - 2 * Math.PI)
  near(sweepCompass({ angle: -1, sweep: 6 }, 1).sweep, 2 * Math.PI)
  near(sweepCompass({ angle: 1, sweep: -6 }, -1).sweep, -2 * Math.PI)
})
