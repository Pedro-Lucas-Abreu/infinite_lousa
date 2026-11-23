import assert from 'node:assert/strict'
import test from 'node:test'
import { createStroke } from '../core/stroke'
import type { Affine, FrameObject, PageObject } from '../core/types'
import { fittingFrame, hitInk, hitObject, multiplyTransforms, rectanglePoints, regionIntersects, transformPoint } from './geometry'

test('an eraser sweep hits the transformed ink between pointer samples', () => {
  const ink = createStroke('ink', [{ x: 0, y: 0 }, { x: 30, y: 0 }], {
    color: '#192038', size: 4, stabilizer: 0, simulatePressure: true,
  }, 0)
  const moved = { ...ink, transform: [0, 1, -1, 0, 40, 50] as const }
  assert.equal(hitInk(moved, { x: 10, y: 65 }, { x: 90, y: 65 }, 0), true)
  assert.equal(hitInk(moved, { x: 10, y: 15 }, { x: 90, y: 15 }, 6), false)
})

test('selection uses rotated page geometry and frame guides leave their interior pass-through', () => {
  const page: PageObject = {
    id: 'page', type: 'pdfPage', zIndex: 0, locked: false,
    transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0],
    props: { width: 100, height: 100, assetId: 'asset', pageIndex: 0 },
  }
  assert.equal(hitObject(page, { x: 0, y: 50 }, 0), true)
  assert.equal(hitObject(page, { x: 60, y: 2 }, 0), false)

  const frame: FrameObject = {
    id: 'frame', type: 'frame', zIndex: 1, locked: false, transform: [1, 0, 0, 1, 0, 0],
    props: { width: 160, height: 90, name: 'Quadro', order: 1 },
  }
  assert.equal(hitObject(frame, { x: 0, y: 45 }, 1), true)
  assert.equal(hitObject(frame, { x: 80, y: 45 }, 5), false)
  assert.equal(regionIntersects(frame, rectanglePoints({ minX: 70, minY: 30, maxX: 90, maxY: 60 })), false)
  assert.equal(regionIntersects(frame, rectanglePoints({ minX: -5, minY: 30, maxX: 10, maxY: 60 })), true)
})

test('world transforms retain the location of ink relative to its page', () => {
  const page: Affine = [1, 0, 0, 1, 10, 15]
  const ink: Affine = [1, 0, 0, 1, 12, 25]
  const change: Affine = [0, 2, -2, 0, 3, 7]
  assert.deepEqual(transformPoint(multiplyTransforms(change, page), { x: 2, y: 10 }),
    transformPoint(multiplyTransforms(change, ink), { x: 0, y: 0 }))
})

test('frames retain 16:9 when dragged by height towards the left', () => {
  const frame = fittingFrame({ x: 10, y: 20 }, { x: -40, y: 110 })
  assert.deepEqual(frame, { minX: -150, minY: 20, maxX: 10, maxY: 110 })
})
