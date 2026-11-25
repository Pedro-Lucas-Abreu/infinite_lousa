import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StrokeInput } from '../core/stroke'
import type { Affine, Point, StrokePoint } from '../core/types'
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

function checkSegments(points: readonly StrokePoint[], body: readonly Point[], closed = false, label = ''): void {
  const sides = body.map((a, i) => {
    const b = body[(i + 1) % body.length]
    const length = Math.hypot(a.x - b.x, a.y - b.y)
    return ({ x, y }: Point) => ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / length
  })
  points.forEach((start, i) => {
    const end = points[i + 1] ?? (closed ? points[0] : undefined)
    if (!end || end.breakBefore) return
    for (let j = 0; j <= 50; j++) {
      const t = j / 50
      const p = { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) }
      const distances = sides.map((side) => side(p))
      assert.ok(!distances.every((d) => d > 0.5) && !distances.every((d) => d < -0.5),
        `${label}: segment ${i} enters body at ${JSON.stringify(p)}`)
    }
  })
}

function routeStroke(raw: readonly Point[], bodies: readonly (readonly Point[])[]): StrokePoint[] {
  const result: StrokePoint[] = []
  for (const point of raw) result.push(...traceAroundSolids(point, bodies, result.at(-1), false, 4))
  return result
}

test('ruler regression: sparse crossings go around the corner on the boundary', () => {
  const body = solidBoundary({ props: { kind: 'ruler', width: 350, height: 60 }, transform: identity })
  const samples = [{ x: 11, y: -10 }, { x: 15, y: 10 }, { x: 18, y: 45 }, { x: 19, y: 80 }]
  const points = routeStroke(samples, [body])
  assert.ok(points.every(({ breakBefore }) => !breakBefore))
  assert.deepEqual(points.filter(({ x }) => x === 0), [{ x: 0, y: 0 }, { x: 0, y: 60 }])
  checkSegments(points, body)

  const ink = new StrokeInput({ color: '#111111', size: 14, stabilizer: 75, simulatePressure: true, opacity: 0.35 }, [body])
  const viewport = { width: 800, height: 600 }
  const camera = { x: 400, y: 300, zoom: 1 }
  for (const [index, sample] of samples.entries()) {
    ink.add(sample, 15 * index, camera, viewport, (p, previous) => traceAroundSolids(p, [body], previous, false, 4))
  }
  for (const stroke of [ink.preview()!, ink.finish('ink', 0)!]) {
    const [,,,, x, y] = stroke.transform
    assert.ok(stroke.props.contours?.length)
    const toWorld = <T extends Point>(point: T) => ({ ...point, x: point.x + x, y: point.y + y })
    checkSegments(stroke.props.points.map(toWorld), body)
    for (const contour of stroke.props.contours) checkSegments(contour.map(toWorld), body, true)
  }
})

test('keeps the entry edge when exiting on that side and detours when exiting on the opposite side', () => {
  const body = solidBoundary({ props: { kind: 'ruler', width: 100, height: 30 }, transform: identity })
  const start = { x: 30, y: -10 }, inside = { x: 35, y: 16 }
  const sameSide = routeStroke([start, inside, { x: 55, y: -10 }], [body])
  assert.deepEqual(sameSide, [start, { x: 35, y: 0 }, { x: 55, y: -10 }])
  for (const points of [sameSide, routeStroke([start, inside, { x: 55, y: 50 }], [body])]) {
    checkSegments(points, body)
  }
})

test('the same sparse crossing stays outside at extreme world scales', () => {
  const raw = [{ x: 20, y: -18 }, { x: 36, y: 17 }, { x: 40, y: 52 }]
  const props = { kind: 'ruler' as const, width: 100, height: 30 }
  for (const scale of [1e-12, 1e12]) {
    const transform: Affine = [scale, 0, 0, scale, 0, 0]
    const body = solidBoundary({ props, transform })
    const unscale = <T extends Point>(p: T) => ({ ...p, x: p.x / scale, y: p.y / scale })
    let path: StrokePoint[] = []
    for (const point of raw) {
      path = path.concat(traceAroundSolids(instrumentPoint(transform, point), [body], path.at(-1), false, 4 * scale))
    }
    assert.ok(path.length > raw.length && path.every(({ breakBefore }) => !breakBefore))
    checkSegments(path.map(unscale), body.map(unscale))
  }
})

test('does not connect through an overlapping guide or reconnect across ink made with Alt', () => {
  const props = { kind: 'ruler' as const, width: 100, height: 30 }
  const a = solidBoundary({ props, transform: identity })
  const b = solidBoundary({ props, transform: [0, 1, -1, 0, 52, -50] })
  const path = routeStroke([{ x: 5, y: -30 }, { x: 53, y: -20 }, { x: 35, y: 57 }, { x: 80, y: 45 }], [a, b])
  checkSegments(path, a)
  checkSegments(path, b)
  const inside = { x: 18, y: 14 }
  assert.deepEqual(traceAroundSolids(inside, [a], undefined, true), [inside])
  const resumed = traceAroundSolids({ x: 20, y: 12 }, [a], inside)
  assert.deepEqual(resumed, [{ x: 20, y: 0, breakBefore: true }])
})

for (const kind of ['ruler', 'set-square-45', 'set-square-30', 'protractor'] as const) {
  test(`property: sparse and dense paths stay outside rotated and scaled ${kind}`, () => {
    let seed = 0x3ed5b627
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    for (let trial = 0; trial < 20; trial++) {
      const angle = random() * 2 * Math.PI
      const scaleX = 0.4 + random() * 4, scaleY = 0.4 + random() * 4
      const transform: Affine = [scaleX * Math.cos(angle), scaleX * Math.sin(angle),
        -scaleY * Math.sin(angle), scaleY * Math.cos(angle), random() * 200 - 100, random() * 200 - 100]
      const body = solidBoundary(placement(kind, transform))
      const center = body.reduce((sum, p) => ({ x: sum.x + p.x / body.length, y: sum.y + p.y / body.length }), { x: 0, y: 0 })
      const extent = Math.max(...body.map((p) => Math.hypot(p.x - center.x, p.y - center.y)))
      const direction = random() * 2 * Math.PI
      const dx = Math.cos(direction) * extent * 1.6, dy = Math.sin(direction) * extent * 1.6
      for (const count of [2, 3 + Math.floor(random() * 3), 47]) {
        const raw = Array.from({ length: count }, (_, i) => {
          const t = 2 * i / (count - 1) - 1
          const jitter = (random() - 0.5) * 0.13 * (1 - Math.abs(t))
          return { x: center.x + t * dx - jitter * dy, y: center.y + t * dy + jitter * dx }
        })
        const label = `${kind} trial ${trial} with ${count} samples`
        const path = routeStroke(raw, [body])
        assert.ok(path.every(({ breakBefore }) => !breakBefore), label)
        checkSegments(path, body, false, label)

        const highlight = trial % 2 === 0
        const input = new StrokeInput({ color: '#123456', size: highlight ? 14 : 4, stabilizer: 60,
          simulatePressure: true, ...(highlight ? { opacity: 0.35 } : {}) }, [body])
        const viewport = { width: 800, height: 600 }, camera = { x: 400, y: 300, zoom: 1 }
        for (const [index, p] of raw.entries()) {
          input.add(p, index * 13, camera, viewport, (point, previous) => traceAroundSolids(point, [body], previous, false, 4))
        }
        const stroke = input.finish('test', 0)!
        const [,,,, x, y] = stroke.transform
        const toWorld = <T extends Point>(p: T) => ({ ...p, x: p.x + x, y: p.y + y })
        checkSegments(stroke.props.points.map(toWorld), body, false, label)
        for (const contour of stroke.props.contours ?? []) checkSegments(contour.map(toWorld), body, true, label)
      }
    }
  })
}
