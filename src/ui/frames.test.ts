import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageObject } from '../core/types'
import { fitCamera, framesForPages } from './frames'

test('fits the whole frame within the visible area and centers it', () => {
  const camera = fitCamera({ minX: 100, minY: 80, maxX: 1700, maxY: 980 }, { width: 848, height: 500 })
  assert.deepEqual(camera, { x: 900, y: 530, zoom: 0.5 })
})

test('maps PDF pages to ordered frames linked to their source page', () => {
  const first: PageObject = {
    id: 'page-one', type: 'pdfPage', locked: false, zIndex: 0,
    transform: [1, 0, 0, 1, 0, 50], props: { assetId: 'file', pageIndex: 0, width: 400, height: 650 },
  }
  const second: PageObject = { ...first, id: 'page-two', props: { ...first.props, pageIndex: 1 } }
  const frames = framesForPages([first, second], 7)
  assert.deepEqual(frames.map(({ parentId, props }) => [parentId, props.order, props.name]), [
    ['page-one', 7, 'Página 1'], ['page-two', 8, 'Página 2'],
  ])
  assert.deepEqual(frames[0].transform, first.transform)
})
