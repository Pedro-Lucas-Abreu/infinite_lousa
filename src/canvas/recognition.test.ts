import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Point } from '../core/types'
import { recognizeShape } from './recognition'

function jitter(point: Point, step: number): Point {
  return { x: point.x + Math.sin(step * 1.7) * 1.7, y: point.y + Math.cos(step * 1.3) * 2 }
}

function path(vertices: readonly (readonly [number, number])[]): Point[] {
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

function loop(rx: number, ry: number, angle = 0): Point[] {
  return Array.from({ length: 103 }, (_, i) => {
    const theta = i / 102 * 2 * Math.PI
    const x = rx * Math.cos(theta), y = ry * Math.sin(theta)
    return jitter({ x: 150 + x * Math.cos(angle) - y * Math.sin(angle),
      y: 100 + x * Math.sin(angle) + y * Math.cos(angle) }, i)
  })
}

test('recognizes a long noisy line and a single-gesture arrow', () => {
  assert.equal(recognizeShape(path([[10, 20], [170, 90]]))?.kind, 'line')
  assert.equal(recognizeShape(path([[12, 40], [130, 40], [102, 22], [130, 40], [102, 58]]))?.kind, 'arrow')
})

test('recognizes a circle and a rotated ellipse', () => {
  const circle = recognizeShape(loop(55, 53))
  assert.equal(circle?.kind, 'ellipse')
  const [a, b] = circle.points
  assert.ok(Math.abs((b.x - a.x) - (b.y - a.y)) < 1e-9)
  const ellipse = recognizeShape(loop(73, 36, 0.56))
  assert.equal(ellipse?.kind, 'ellipse')
  assert.ok(Math.abs(ellipse.angle! - 0.56) < 0.14)
})

test('recognizes a rectangle, squares its near-equal sides, and fits a triangle', () => {
  assert.equal(recognizeShape(path([[50, 20], [140, 20], [140, 91], [10, 91], [10, 20], [50, 20]]))?.kind, 'rectangle')
  const square = recognizeShape(path([[10, 10], [105, 10], [105, 101], [10, 101], [10, 10]]))
  assert.equal(square?.kind, 'rectangle')
  const [a, b] = square.points
  assert.ok(Math.abs((b.x - a.x) - (b.y - a.y)) < 1e-9)
  const triangle = recognizeShape(path([[10, 35], [71, 115], [137, 26], [10, 35]]))
  assert.equal(triangle?.kind, 'polygon')
  assert.equal(triangle.points.length, 3)
})

test('keeps small letters, short lines, scribbles and open curves as ink', () => {
  for (const ink of [
    loop(9, 13), path([[10, 30], [32, 42]]),
    path([[10, 40], [70, 12], [9, 88], [130, 50], [24, 13], [99, 103], [10, 40]]),
    path([[10, 90], [25, 55], [52, 32], [85, 26], [110, 48]]),
  ]) assert.equal(recognizeShape(ink), undefined)
})
