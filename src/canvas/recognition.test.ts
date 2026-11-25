import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Point } from '../core/types'
import { recognizeShape } from './recognition'

type Vertex = readonly [number, number]

function jitter(point: Point, step: number): Point {
  return { x: point.x + Math.sin(step * 1.7) * 1.7, y: point.y + Math.cos(step * 1.3) * 2 }
}

function path(vertices: readonly Vertex[]): Point[] {
  const points: Point[] = []
  for (let i = 1; i < vertices.length; i++) {
    const [x, y] = vertices[i - 1]
    const [nextX, nextY] = vertices[i]
    for (let j = 0; j < 16; j++) {
      points.push(jitter({ x: x + (nextX - x) * j / 16, y: y + (nextY - y) * j / 16 }, points.length))
    }
  }
  const [x, y] = vertices.at(-1)!
  points.push(jitter({ x, y }, points.length))
  return points
}

function loop(rx: number, ry: number, angle = 0, gap = 0): Point[] {
  return Array.from({ length: 103 }, (_, i) => {
    const theta = i / 102 * (2 * Math.PI - gap)
    const x = rx * Math.cos(theta), y = ry * Math.sin(theta)
    return jitter({ x: 150 + x * Math.cos(angle) - y * Math.sin(angle),
      y: 100 + x * Math.sin(angle) + y * Math.cos(angle) }, i)
  })
}

function tilted(vertices: readonly Vertex[], degrees: number): Vertex[] {
  const angle = degrees * Math.PI / 180
  return vertices.map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)])
}

function almostClosed(vertices: readonly Vertex[]): Point[] {
  const [first, second] = vertices
  const alongFirst = (fraction: number): Vertex => [
    first[0] + (second[0] - first[0]) * fraction, first[1] + (second[1] - first[1]) * fraction,
  ]
  return path([alongFirst(0.19), ...vertices.slice(1), first, alongFirst(0.04)])
}

function regular(count: number, radius = 72): Vertex[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = 0.43 + i / count * 2 * Math.PI
    return [150 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)]
  })
}

const sides = (points: readonly Point[]): Point[] => points.map((start, i) => {
  const end = points[(i + 1) % points.length]
  return { x: end.x - start.x, y: end.y - start.y }
})
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y

test('recognizes a long noisy line and a single-gesture arrow', () => {
  assert.equal(recognizeShape(path([[10, 20], [170, 90]]))?.kind, 'line')
  const arrow: Vertex[] = [[12, 40], [130, 40], [102, 22], [130, 40], [102, 58]]
  assert.equal(recognizeShape(path(arrow))?.kind, 'arrow')
  assert.equal(recognizeShape(path([...arrow].reverse()))?.kind, 'arrow')
})

test('recognizes a circle and a rotated ellipse', () => {
  const circle = recognizeShape(loop(55, 53, 0, 0.22))
  assert.equal(circle?.kind, 'ellipse')
  const [a, b] = circle.points
  assert.ok(Math.abs((b.x - a.x) - (b.y - a.y)) < 1e-9)
  const ellipse = recognizeShape(loop(73, 36, 0.56, 0.16))
  assert.equal(ellipse?.kind, 'ellipse')
  assert.ok(Math.abs(ellipse.angle! - 0.56) < 0.14)
})

test('recognizes a rectangle, squares its near-equal sides, and fits a triangle', () => {
  const rectangle: Vertex[] = [[10, 20], [140, 20], [140, 91], [10, 91]]
  const straight = recognizeShape(almostClosed(tilted(rectangle, 4)))
  assert.equal(straight?.kind, 'rectangle')
  assert.equal(straight.angle, 0)
  const rotated = recognizeShape(almostClosed(tilted(rectangle, 22)))
  assert.equal(rotated?.kind, 'polygon')
  assert.equal(rotated.points.length, 4)
  const directions = sides(rotated.points)
  assert.ok(Math.abs(dot(directions[0], directions[1])) < 1e-8)
  assert.ok(Math.abs(directions[0].y / directions[0].x - Math.tan(22 * Math.PI / 180)) < 0.09)

  const square = recognizeShape(almostClosed([[10, 10], [105, 10], [105, 101], [10, 101]]))
  assert.equal(square?.kind, 'rectangle')
  const [a, b] = square.points
  assert.ok(Math.abs((b.x - a.x) - (b.y - a.y)) < 1e-9)
  const triangle = recognizeShape(almostClosed([[10, 35], [71, 115], [137, 26]]))
  assert.equal(triangle?.kind, 'polygon')
  assert.equal(triangle.points.length, 3)
})

test('straightens the parallel sides of upright and rotated trapezoids and equalizes a rhombus', () => {
  const trapezoid: Vertex[] = [[45, 22], [135, 26], [173, 100], [8, 97]]
  for (const angle of [0, 27]) {
    const fitted = recognizeShape(almostClosed(tilted(trapezoid, angle)))
    assert.equal(fitted?.kind, 'polygon', 'trapezoid at ' + angle)
    assert.equal(fitted.points.length, 4)
    const edges = sides(fitted.points)
    const crosses = [Math.abs(cross(edges[0], edges[2])), Math.abs(cross(edges[1], edges[3]))]
    assert.ok(Math.min(...crosses) < 1e-8)
    assert.ok(Math.max(...crosses) > 400)
  }
  const rhombus = recognizeShape(almostClosed([[90, 15], [158, 62], [91, 110], [22, 62]]))
  assert.equal(rhombus?.kind, 'polygon')
  assert.equal(rhombus.points.length, 4)
  const edges = sides(rhombus.points)
  const lengths = edges.map(({ x, y }) => Math.hypot(x, y))
  assert.ok(Math.max(...lengths) - Math.min(...lengths) < 1e-8)
  assert.ok(Math.abs(dot(edges[0], edges[1])) > 500)
})

test('fits every vertex of a noisy open-seam pentagon and hexagon to a regular polygon', () => {
  for (const count of [5, 6]) {
    const fitted = recognizeShape(almostClosed(regular(count)))
    assert.equal(fitted?.kind, 'polygon', 'regular ' + count)
    assert.equal(fitted.points.length, count)
    const edges = sides(fitted.points)
    const lengths = edges.map(({ x, y }) => Math.hypot(x, y))
    assert.ok(Math.max(...lengths) - Math.min(...lengths) < 1e-8)
    for (let i = 0; i < count; i++) {
      const a = edges[i], b = edges[(i + 1) % count]
      assert.ok(Math.abs(Math.abs(Math.atan2(cross(a, b), dot(a, b))) - 2 * Math.PI / count) < 1e-8)
    }
    const center = fitted.points.reduce((acc, point) => ({ x: acc.x + point.x / count, y: acc.y + point.y / count }), { x: 0, y: 0 })
    assert.ok(Math.hypot(center.x - 150, center.y - 100) < 5)
  }
})

test('keeps small letters, short lines, scribbles and open curves as ink', () => {
  for (const ink of [
    loop(9, 13), path([[10, 30], [32, 42]]),
    path([[10, 40], [70, 12], [9, 88], [130, 50], [24, 13], [99, 103], [10, 40]]),
    path([[10, 90], [25, 55], [52, 32], [85, 26], [110, 48]]),
  ]) assert.equal(recognizeShape(ink), undefined)
})

test('does not fall back to an ellipse for more than six corners or unsupported polygons', () => {
  const unevenHexagon = regular(6)
  unevenHexagon[2] = [64, 146]
  for (const vertices of [
    regular(7), regular(8), regular(9), regular(10), [[20, 20], [145, 27], [114, 110], [41, 136]],
    [[20, 20], [154, 20], [201, 100], [68, 100]], unevenHexagon,
  ] satisfies Vertex[][]) assert.equal(recognizeShape(almostClosed(vertices)), undefined, JSON.stringify(vertices))
})

test('does not convert small loops and writing-like digits', () => {
  for (const ink of [
    loop(9, 8), loop(7, 12), path([[11, 3], [4, 10], [3, 24], [13, 25], [16, 17], [6, 13], [3, 17]]),
    path([[12, 2], [4, 6], [7, 12], [17, 20], [11, 30], [3, 24], [11, 13], [17, 6], [12, 2]]),
    path([[13, 15], [4, 13], [4, 5], [12, 3], [17, 10], [11, 28], [6, 32]]),
  ]) assert.equal(recognizeShape(ink), undefined)
})
