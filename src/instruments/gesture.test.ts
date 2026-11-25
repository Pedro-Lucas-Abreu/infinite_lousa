import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Affine, Point } from '../core/types'
import { compassAngle, compassRadius, compassTransform, measureProtractor, sweepCompass, worldProtractorCenter } from './gesture'
import { instrumentDimensions } from './geometry'

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

it('measures and snaps degrees relative to a rotated and scaled protractor, with an option for fractional angles', () => {
  const heading = 0.64
  const magnification = 2.3
  const a = Math.cos(heading) * magnification, b = Math.sin(heading) * magnification
  const transform: Affine = [a, b, -b, a, 30, 63]
  const instrument = { props: { kind: 'protractor' as const, ...instrumentDimensions('protractor') }, transform }
  const center = worldProtractorCenter(instrument)
  const targetAt = (degrees: number) => ({
    x: center.x + 80 * Math.cos(heading - degrees * Math.PI / 180),
    y: center.y + 80 * Math.sin(heading - degrees * Math.PI / 180),
  })
  for (const angle of [0, 31.7, 88.25, 141.8, 180]) {
    const snapped = measureProtractor(instrument, targetAt(angle), true)
    assert.equal(snapped.degrees, Math.round(angle))
    near(snapped.end.x, targetAt(Math.round(angle)).x)
    near(snapped.end.y, targetAt(Math.round(angle)).y)
    near(measureProtractor(instrument, targetAt(angle), false).degrees, angle)
  }
  assert.equal(measureProtractor(instrument, targetAt(-40), true).degrees, 0)
  assert.equal(measureProtractor(instrument, targetAt(207), true).degrees, 180)
})

it('uses the previous world radius on a second locked gesture and learns a new radius when unlocked', () => {
  const first = compassRadius(58.5, 4)
  assert.equal(first, 58.5)
  assert.equal(compassRadius(104, 4, first), 58.5)
  assert.equal(compassRadius(104, 4), 104)
  assert.equal(compassRadius(0, 4, first), undefined)
})
