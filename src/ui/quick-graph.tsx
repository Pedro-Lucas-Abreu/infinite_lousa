import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { readGraphExpression } from '../plot/quick-graph'
import { findShortcut, shortcutAria } from '../shortcuts'

interface Props {
  selected: boolean
  onSubmit: (expression: string) => string | undefined
  onCancel: () => void
}

export function QuickGraph({ selected, onSubmit, onCancel }: Props) {
  const titleId = useId()
  const errorId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string>()

  useLayoutEffect(() => {
    const panel = dialog.current
    if (!panel) return
    const previousFocus = document.activeElement
    panel.showModal()
    field.current?.focus()
    return () => {
      panel.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let expression: string
    try {
      expression = readGraphExpression(source)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Confira a função.')
      field.current?.focus()
      return
    }
    const failure = onSubmit(expression)
    if (failure) {
      setError(failure)
      field.current?.focus()
    }
  }

  return (
    <dialog ref={dialog} className="quick-graph" aria-labelledby={titleId} data-board-editor
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const action = findShortcut(event.nativeEvent, 'quick-graph')
        if (action === 'quick-graph-cancel') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else if (action === 'quick-graph-save' && event.target === field.current) {
          event.preventDefault()
          field.current?.form?.requestSubmit()
        }
      }}>
      <form onSubmit={submit}>
        <header>
          <h2 id={titleId}>{selected ? 'Adicionar função ao plano' : 'Gráfico'}</h2>
        </header>
        <label className="quick-graph-input">Função de x
          <input ref={field} type="text" value={source} spellCheck={false} autoComplete="off"
            placeholder="y = x^2 - 4" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setSource(event.target.value)
              setError(undefined)
            }} />
        </label>
        {error && <p id={errorId} className="quick-graph-error" role="alert">{error}</p>}
        <footer className="quick-graph-actions">
          <button type="button" aria-keyshortcuts={shortcutAria('quick-graph-cancel')} onClick={onCancel}>Cancelar</button>
          <button type="submit" aria-keyshortcuts={shortcutAria('quick-graph-save')}>{selected ? 'Adicionar' : 'Criar gráfico'}</button>
        </footer>
      </form>
    </dialog>
  )
}
