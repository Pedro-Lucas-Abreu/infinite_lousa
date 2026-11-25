import assert from 'node:assert/strict'
import test from 'node:test'
import type { Point } from '../core/types'
import {
  compassFeet, getInstrumentGeometry, instrumentDimensions, instrumentKinds, isInstrumentKind,
} from './geometry'

function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, 'Expected ' + actual + ' to be close to ' + expected)
}

test('ruler marks millimeters and numbers ten centimeters at CSS physical scale', () => {
  const { width, height } = instrumentDimensions('ruler')
  const { paths, labels, edges } = getInstrumentGeometry('ruler', width, height)
  assert.equal(paths.length, 102)
  assert.equal(edges.length, 4)
  assert.deepEqual(labels.map(({ text }) => text), [...Array.from({ length: 11 }, (_, index) => String(index)), 'cm'])
  near(labels[1]!.x - labels[0]!.x, 96 / 2.54)
  near(paths[2]!.points[0]!.x - paths[1]!.points[0]!.x, 96 / 25.4)
  assert.equal(paths[1]!.weight, 'major')
  assert.equal(paths[2]!.weight, 'minor')
})

test('set squares have one right angle and the supplied acute angles', () => {
  for (const [kind, acute] of [['set-square-45', 45], ['set-square-30', 30]] as const) {
    const { width, height } = instrumentDimensions(kind)
    const { paths, labels, edges } = getInstrumentGeometry(kind, width, height)
    near(Math.atan2(height, width) * 180 / Math.PI, acute)
    assert.deepEqual(labels.map(({ text }) => text).sort(), [acute + '°', (90 - acute) + '°', '90°'])
    assert.equal(edges.length, 3)
    assert.equal(paths[0]!.closed, true)
    assert.equal(paths[0]!.fill, true)
    near((edges[1]!.end.x - edges[1]!.start.x) * (edges[2]!.end.x - edges[2]!.start.x) +
      (edges[1]!.end.y - edges[1]!.start.y) * (edges[2]!.end.y - edges[2]!.start.y), 0)
  }
})

test('protractor marks each degree from zero through 180', () => {
  const { width, height } = instrumentDimensions('protractor')
  const { labels, paths, edges } = getInstrumentGeometry('protractor', width, height)
  assert.deepEqual(labels.map(({ text }) => text), Array.from({ length: 13 }, (_, index) => index * 15 + '°'))
  assert.deepEqual(edges, [])
  const ticks = paths.slice(1, 182)
  assert.equal(ticks.length, 181)
  assert.ok(ticks.every(({ points }) => points.length === 2))
  const zero = ticks[0]!.points[0]!
  const ninety = ticks[90]!.points[0]!
  const straight = ticks[180]!.points[0]!
  near(zero.x, width)
  near(ninety.x, width / 2)
  near(ninety.y, 0)
  near(straight.x, 0)
  near(straight.y, zero.y)
})

test('compass geometry includes both tips at the same height and recognizes valid instrument kinds', () => {
  assert.ok(instrumentKinds.every(isInstrumentKind))
  assert.equal(isInstrumentKind('ellipse'), false)
  assert.equal(isInstrumentKind(null), false)
  const { width, height } = instrumentDimensions('compass')
  const { pivot, tip } = compassFeet(width, height)
  const contains = (target: Point, points: readonly Point[]) => points.some(({ x, y }) => x === target.x && y === target.y)
  const { paths, edges } = getInstrumentGeometry('compass', width, height)
  assert.ok(paths.some(({ points }) => contains(pivot, points)))
  assert.ok(paths.some(({ points }) => contains(tip, points)))
  near(tip.x - pivot.x, width * 2 / 3)
  assert.equal(tip.y, pivot.y)
  assert.deepEqual(edges, [])
})
