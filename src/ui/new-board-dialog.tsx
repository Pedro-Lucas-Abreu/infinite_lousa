import { useId, useLayoutEffect, useRef } from 'react'
import type { NewBoardAction } from '../documents/new-board'
import { findShortcut, shortcutAria } from '../shortcuts'

interface Props {
  busy: boolean
  error: string
  onChoose: (action: NewBoardAction) => void
  onCancel: () => void
}

export function NewBoardDialog({ busy, error, onChoose, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const title = useId()
  const description = useId()

  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    cancel.current?.focus()
    return () => element?.close()
  }, [])

  return (
    <dialog ref={dialog} className="quick-graph new-board-dialog" aria-labelledby={title} aria-describedby={description}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (findShortcut(event.nativeEvent, 'new-board') !== 'cancel-new-board') return
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onCancel()
      }}>
      <h2 id={title}>Nova lousa</h2>
      <p id={description}>Isto apaga tudo da lousa atual</p>
      <div className="new-board-actions">
        <button type="button" disabled={busy} onClick={() => onChoose('pdf')}>Exportar PDF e começar nova</button>
        <button type="button" disabled={busy} onClick={() => onChoose('save')}>Salvar .board e começar nova</button>
        <button type="button" disabled={busy} className="destructive" onClick={() => onChoose('discard')}>Apagar sem salvar</button>
        <button ref={cancel} type="button" disabled={busy} aria-keyshortcuts={shortcutAria('cancel-new-board')}
          onClick={onCancel}>Cancelar</button>
      </div>
      {busy && <p role="status">Aguarde…</p>}
      {error && <p role="alert" className="quick-graph-error">{error}</p>}
    </dialog>
  )
}
