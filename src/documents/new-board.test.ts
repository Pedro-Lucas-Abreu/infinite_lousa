import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scene } from '../core/scene'
import type { FrameObject, PageObject } from '../core/types'
import { beginNewBoard, emptyBoard, NEW_BOARD_UNDO_MS, NewBoardUndo, newBoardCamera,
  newBoardFile, newBoardNeedsConfirmation, newBoardPdfScope } from './new-board'
import { BoardDocument } from './store'
import { saveBoardFile } from './files'

const page: PageObject = {
  id: 'page', type: 'pdfPage', locked: true, transform: [1, 0, 0, 1, 30, 40], zIndex: 0,
  props: { width: 100, height: 120, assetId: 'pdf', pageIndex: 0 },
}
const frame: FrameObject = { id: 'frame', type: 'frame', locked: false,
  transform: page.transform, zIndex: 1, props: { name: 'Quadro', width: 100, height: 120, order: 0 } }
const asset = { id: 'pdf', mime: 'application/pdf', bytes: Uint8Array.of(1, 2) }

test('asks only if the current scene has objects and uses frames when present', () => {
  const justAssets = { ...emptyBoard, assets: [asset] }
  const drawing = { ...justAssets, scene: new Scene([page]).snapshot() }
  assert.equal(newBoardNeedsConfirmation(emptyBoard), false)
  assert.equal(newBoardNeedsConfirmation(justAssets), false)
  assert.equal(newBoardNeedsConfirmation(drawing), true)
  assert.equal(newBoardPdfScope(drawing), 'all')
  assert.equal(newBoardPdfScope({ ...drawing, scene: new Scene([page, frame]).snapshot() }), 'frames')
})

test('does not clear after a cancelled, failed or unverified file operation', async () => {
  for (const action of ['save', 'pdf'] as const) {
    const clear = async () => assert.fail('cleared without a verified backup')
    assert.equal(await beginNewBoard(action, async () => ({ kind: 'cancelled' }), clear), 'cancelled')
    assert.equal(await beginNewBoard(action, async () => ({ kind: 'downloaded', filename: 'copia' }), clear), 'unverified')
    await assert.rejects(beginNewBoard(action, async () => { throw new Error('Disk error') }, clear), /Disk error/)
  }
})

test('waits until the verified write finishes and skips backup when discarding', async () => {
  let complete = false
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const operation = beginNewBoard('save', async () => {
    await pending
    return { kind: 'saved', file: { name: 'a.board' } }
  }, async () => { complete = true })
  assert.equal(complete, false)
  finish()
  assert.equal(await operation, 'cleared')
  assert.equal(complete, true)
  assert.equal(await beginNewBoard('discard', async () => assert.fail('unexpected backup'), async () => {}), 'cleared')
})

test('undo restores board objects, assets, history, camera and file association without changing preferences', async () => {
  const doc = await BoardDocument.open(new Scene())
  doc.applyChanges([{ after: page }, { after: frame }], [asset])
  const preferences = { background: 'dark', dock: 'left', favorite: 4, tool: 'hand' }
  const file = { name: 'aulas.board' }
  const previous = { checkpoint: doc.checkpoint(), camera: { x: 13, y: 5, zoom: 2 }, file, frameId: frame.id }
  const undo = new NewBoardUndo()
  await doc.replace(emptyBoard)
  let linkedFile: typeof file | null = newBoardFile
  assert.equal(linkedFile, null)
  assert.deepEqual(newBoardCamera, { x: 0, y: 0, zoom: 1 })
  assert.deepEqual(doc.portable(), emptyBoard)
  assert.equal(doc.canUndo, false)
  undo.remember(previous, 100)
  const snapshot = undo.snapshot(101)!
  await doc.restore(snapshot.checkpoint)
  linkedFile = snapshot.file as typeof linkedFile
  assert.equal(linkedFile, file)
  assert.deepEqual(snapshot.camera, previous.camera)
  assert.deepEqual(doc.portable(), previous.checkpoint.board)
  assert.equal(doc.canUndo, true)
  assert.deepEqual(preferences, { background: 'dark', dock: 'left', favorite: 4, tool: 'hand' })
  doc.close()
})

test('releases the remembered board on an edit or at the deadline', async () => {
  const doc = await BoardDocument.open(new Scene())
  const undo = new NewBoardUndo()
  const snapshot = { checkpoint: doc.checkpoint(), camera: newBoardCamera, file: null, frameId: null }
  undo.remember(snapshot, 0)
  assert.equal(undo.snapshot(NEW_BOARD_UNDO_MS - 1), snapshot)
  assert.equal(undo.snapshot(NEW_BOARD_UNDO_MS), undefined)
  undo.remember(snapshot, 100)
  doc.applyChanges([{ after: page }], [asset])
  undo.discard()
  assert.equal(undo.snapshot(101), undefined)
  doc.close()
})

test('a new document invokes Save As while a restored link reuses the previous handle', async (context) => {
  const calls: string[] = []
  const cancelled = () => new DOMException('User cancelled', 'AbortError')
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    showSaveFilePicker: async ({ suggestedName }: { suggestedName: string }) => {
      calls.push(suggestedName)
      throw cancelled()
    },
  } })
  context.after(() => {
    if (existing) Object.defineProperty(globalThis, 'window', existing)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const previousFile = { name: 'aula.board', handle: {
    name: 'aula.board', createWritable: async () => { calls.push('aula.board'); throw cancelled() },
  } }
  assert.deepEqual(await saveBoardFile(emptyBoard, newBoardFile), { kind: 'cancelled' })
  assert.deepEqual(calls, ['lousa.board'])
  assert.deepEqual(await saveBoardFile(emptyBoard, previousFile), { kind: 'cancelled' })
  assert.deepEqual(calls, ['lousa.board', 'aula.board'])
})
