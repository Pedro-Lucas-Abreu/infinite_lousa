import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StrokeInput } from '../core/stroke'
import type { Affine, Point } from '../core/types'
import { ignoresSolidInstruments } from '../shortcuts'
import { instrumentDimensions, instrumentPoint, type InstrumentKind } from './geometry'
import { projectSolidPoint, solidBoundary, traceAroundSolids } from './solids'

const identity: Affine = [1, 0, 0, 1, 0, 0]
const angle = 0.7
const cos = Math.cos(angle), sin = Math.sin(angle)
const turned: Affine = [2.4 * cos, 2.4 * sin, -2.4 * sin, 2.4 * cos, -42, 130]
const placement = (kind: InstrumentKind, transform: Affine) => ({ props: { kind, ...instrumentDimensions(kind) }, transform })

function compare(actual: Point, expected: Point, epsilon = 1e-8): void {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < epsilon,
    `Expected ${JSON.stringify(actual)} to be at ${JSON.stringify(expected)}`)
}

for (const kind of ['ruler', 'set-square-45', 'set-square-30', 'protractor'] as const) {
  test(`projects only interior points of the ${kind} after rotation, scaling and translation`, () => {
    const { width, height } = instrumentDimensions(kind)
    const triangle = kind.startsWith('set-square')
    const inside = triangle ? { x: 3, y: height * 0.66 } : { x: width / 2, y: 3 }
    const edge = triangle ? { x: 0, y: inside.y } : { x: inside.x, y: 0 }
    for (const transform of [identity, turned]) {
      const bodies = [solidBoundary(placement(kind, transform))]
      const outside = instrumentPoint(transform, { x: -1, y: 1 })
      const border = instrumentPoint(transform, edge)
      const value = instrumentPoint(transform, inside)
      assert.equal(projectSolidPoint(outside, bodies), outside)
      compare(projectSolidPoint(border, bodies), border)
      // The vector body has short chords along the protractor's arc.
      compare(projectSolidPoint(value, bodies), border, kind === 'protractor' ? 0.16 : 1e-8)
      assert.equal(projectSolidPoint(value, bodies, ignoresSolidInstruments({ altKey: true })), value)
      assert.notDeepEqual(projectSolidPoint(value, bodies, ignoresSolidInstruments({ altKey: false })), value)
    }
  })
}

test('routes sparse samples around a solid body rather than cutting through it', () => {
  const body = solidBoundary({ props: { kind: 'ruler', width: 100, height: 30 }, transform: identity })
  const start = { x: 15, y: -6 }, end = { x: 15, y: 38 }
  const path = traceAroundSolids(end, [body], start)
  assert.deepEqual(path.slice(1, 3), [{ x: 0, y: 0 }, { x: 0, y: 30 }])
  assert.deepEqual(path.at(-1), end)
  assert.deepEqual(traceAroundSolids(end, [body], start, true), [end])
})

test('projects onto the exposed boundary where two guides overlap', () => {
  const props = { kind: 'ruler' as const, width: 100, height: 30 }
  const horizontal = solidBoundary({ props, transform: identity })
  const vertical = solidBoundary({ props, transform: [0, 1, -1, 0, 65, -35] })
  assert.deepEqual(projectSolidPoint({ x: 55, y: 20 }, [horizontal, vertical]), { x: 65, y: 30 })
})

test('applies the guide to smoothed samples and the final raw point', () => {
  const body = solidBoundary({ props: { kind: 'ruler', width: 100, height: 30 }, transform: identity })
  const viewport = { width: 200, height: 100 }
  const camera = { x: 100, y: 50, zoom: 1 }
  const route = (point: Point, previous?: Point) => traceAroundSolids(point, [body], previous)
  const ink = new StrokeInput({ color: '#111111', size: 4, stabilizer: 80, simulatePressure: true })
  ink.add({ x: 15, y: 4 }, 10, camera, viewport, route)
  ink.add({ x: 65, y: 8 }, 40, camera, viewport, route)
  const stroke = ink.finish('stroke', 0)!
  assert.equal(stroke.transform[5], 0)
  assert.ok(stroke.props.points.every(({ y }) => y === 0))
  assert.equal(stroke.props.points.at(-1)?.x, 50)
})
