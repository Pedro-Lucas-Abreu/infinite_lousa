import type { Camera } from '../core/types'
import type { PortableBoard } from './archive'
import type { BoardFileLink, SaveFileResult } from './files'
import type { BoardCheckpoint } from './store'

export type NewBoardAction = 'pdf' | 'save' | 'discard'
export const NEW_BOARD_UNDO_MS = 30_000
export const emptyBoard: PortableBoard = { scene: { version: 1, objects: [] }, assets: [] }
export const newBoardCamera: Camera = { x: 0, y: 0, zoom: 1 }
export const newBoardFile = null

export interface ClearedBoard {
  readonly checkpoint: BoardCheckpoint
  readonly camera: Camera
  readonly file: BoardFileLink | null
  readonly frameId: string | null
}

export function newBoardNeedsConfirmation(board: PortableBoard): boolean {
  return board.scene.objects.length > 0
}

export function newBoardPdfScope(board: PortableBoard): 'frames' | 'all' {
  return board.scene.objects.some(({ type }) => type === 'frame') ? 'frames' : 'all'
}

export async function beginNewBoard(action: NewBoardAction, backup: () => Promise<SaveFileResult>,
  clear: () => Promise<void>): Promise<'cleared' | 'cancelled' | 'unverified'> {
  if (action !== 'discard') {
    const result = await backup()
    if (result.kind === 'cancelled') return 'cancelled'
    if (result.kind === 'downloaded') return 'unverified'
  }
  await clear()
  return 'cleared'
}

export class NewBoardUndo {
  #entry?: { snapshot: ClearedBoard; expires: number }

  remember(snapshot: ClearedBoard, now: number): void {
    this.#entry = { snapshot, expires: now + NEW_BOARD_UNDO_MS }
  }

  snapshot(now: number): ClearedBoard | undefined {
    if (this.#entry && now >= this.#entry.expires) this.discard()
    return this.#entry?.snapshot
  }

  discard(): void {
    this.#entry = undefined
  }
}
