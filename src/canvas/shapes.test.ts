import assert from 'node:assert/strict'
import test from 'node:test'
import { objectBounds } from '../core/scene'
import { shapeArcPoints, shapeArcSegments } from '../core/shapes'
import type { ShapeObject } from '../core/types'
import { appendVertex, dragShapePoints, hitContours, isDrawableShape } from './shapes'

test('Shift snaps line directions and preserves start-to-pointer distance', () => {
  const [, result] = dragShapePoints('line', { x: 10, y: 15 }, { x: 20, y: 22 }, true)
  assert.ok(Math.abs(result!.x - 10 - (result!.y - 15)) < 1e-9)
  assert.ok(Math.abs(Math.hypot(result!.x - 10, result!.y - 15) - Math.hypot(10, 7)) < 1e-9)
  const [, horizontal] = dragShapePoints('arrow', { x: 5, y: 10 }, { x: 20, y: 13 }, true)
  assert.equal(horizontal!.y, 10)
})

test('Shift constrains rectangles and ellipses dragging towards negative coordinates', () => {
  for (const kind of ['rectangle', 'ellipse'] as const) {
    assert.deepEqual(dragShapePoints(kind, { x: 20, y: 20 }, { x: 0, y: 12 }, true),
      [{ x: 0, y: 0 }, { x: 20, y: 20 }])
    assert.equal(isDrawableShape(kind, [{ x: 0, y: 0 }, { x: 12, y: 0 }], 1), false)
  }
})

test('near-identical polygon clicks do not create duplicate consecutive vertices', () => {
  const first = { x: 2, y: 3 }, second = { x: 4, y: 8 }
  const points = appendVertex([first], second, 3)
  assert.deepEqual(points, [first, second])
  assert.equal(appendVertex(points, { x: 5, y: 9 }, 3), points)
})

test('arrow hit contour keeps the head open and separate from the shaft', () => {
  const shape: ShapeObject = {
    id: 'arrow', type: 'shape', transform: [1, 0, 0, 1, 0, 0], zIndex: 0, locked: false,
    props: { kind: 'arrow', color: '#192038', size: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
  }
  const [shaft, head] = hitContours(shape)
  assert.deepEqual(shaft, { points: shape.props.points, closed: false })
  assert.equal(head!.closed, false)
  assert.deepEqual(head!.points, [{ x: 80, y: 10 }, { x: 100, y: 0 }, { x: 80, y: -10 }])
})

test('compass arcs share cubic controls and have an open hit contour along the curve', () => {
  const points = shapeArcPoints({ x: 10, y: 20 }, 40, 0, -Math.PI)
  assert.equal([...shapeArcSegments(points)].length, 2)
  assert.deepEqual(points[0], { x: 50, y: 20 })
  assert.ok(Math.abs(points.at(-1)!.x + 30) < 1e-9)
  assert.ok(Math.abs(points.at(-1)!.y - 20) < 1e-9)
  const shape: ShapeObject = {
    id: 'arc', type: 'shape', transform: [1, 0, 0, 1, 100, 0], zIndex: 0, locked: false,
    props: { kind: 'arc', color: '#192038', size: 2, points },
  }
  const [contour] = hitContours(shape)
  assert.equal(contour!.closed, false)
  assert.ok(contour!.points.some(({ x, y }) => Math.abs(x - 10) < 1e-9 && Math.abs(y + 20) < 1e-9))
  assert.ok(objectBounds(shape).minY <= -21)
  assert.deepEqual(shapeArcPoints({ x: 0, y: 0 }, 40, 0, 0), [])
})
