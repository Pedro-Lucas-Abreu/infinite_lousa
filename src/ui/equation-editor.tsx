import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { EquationPath, Point } from '../core/types'
import { editLatex, type LatexEdit } from '../equations/editing'
import { findShortcut } from '../shortcuts'

interface VectorPreview {
  width: number
  height: number
  paths: readonly EquationPath[]
}

interface Props {
  initialSource: string
  position: Point
  color: string
  fontSize: number
  onInsert: (source: string, vector: VectorPreview) => void
  onCancel: () => void
}

async function readVector(source: string, fontSize: number): Promise<VectorPreview> {
  const { renderEquation } = await import('../equations/render')
  return renderEquation(source, fontSize)
}

export function EquationEditor({ initialSource, position, color, fontSize, onInsert, onCancel }: Props) {
  const field = useRef<HTMLInputElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const infinityReplacement = useRef<LatexEdit | undefined>(undefined)
  const alive = useRef(true)
  const [source, setSource] = useState(initialSource)
  const [preview, setPreview] = useState<{ source: string; vector?: VectorPreview; error?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const hasSource = Boolean(source.trim())

  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(initialSource.length, initialSource.length)
    alive.current = true
    return () => { alive.current = false }
  }, [initialSource])

  useEffect(() => {
    if (!hasSource) return
    let cancelled = false
    void readVector(source, fontSize).then((vector) => {
      if (!cancelled) setPreview({ source, vector })
    }).catch(() => {
      if (!cancelled) setPreview({ source, error: 'Confira o código LaTeX.' })
    })
    return () => { cancelled = true }
  }, [source, hasSource, fontSize])

  useLayoutEffect(() => {
    const selection = pendingSelection.current
    if (selection) field.current?.setSelectionRange(selection.start, selection.end)
    pendingSelection.current = null
  }, [source])

  const current = preview?.source === source ? preview : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!hasSource || submitting || current?.error) return
    if (current?.vector) {
      onInsert(source, current.vector)
      return
    }
    setSubmitting(true)
    try {
      const vector = await readVector(source, fontSize)
      if (alive.current) onInsert(source, vector)
    } catch {
      if (alive.current) setPreview({ source, error: 'Confira o código LaTeX.' })
    } finally {
      if (alive.current) setSubmitting(false)
    }
  }

  return <form className="board-equation-editor" data-board-editor aria-label="Editor de equação"
    style={{ left: position.x, top: position.y }} onSubmit={(event) => { void submit(event) }}
    onKeyDown={(event) => {
      const previous = infinityReplacement.current
      infinityReplacement.current = undefined
      if (event.nativeEvent.isComposing) return
      const action = findShortcut(event, 'equation')
      if (action === 'equation-cancel') {
        event.preventDefault()
        onCancel()
        return
      }
      const input = field.current
      if (!input || event.target !== input) return
      if (action === 'equation-save') {
        event.preventDefault()
        event.currentTarget.requestSubmit()
      }
      if (submitting || (action !== 'equation-expand' && action !== 'equation-typing')) return
      const edit = editLatex(source, input.selectionStart ?? source.length, input.selectionEnd ?? source.length, event.key, previous)
      if (!edit || edit.value.length > input.maxLength) return
      event.preventDefault()
      if (edit.infinityContinuation) infinityReplacement.current = edit
      if (edit.value === source) {
        input.setSelectionRange(edit.start, edit.end)
      } else {
        pendingSelection.current = { start: edit.start, end: edit.end }
        setSource(edit.value)
      }
    }}>
    <label htmlFor="equation-source">LaTeX</label>
    <input id="equation-source" ref={field} type="text" maxLength={16_384} spellCheck={false}
      autoComplete="off" placeholder="2x = 10 ou \frac{1}{2}" value={source}
      readOnly={submitting}
      onPointerDown={() => { infinityReplacement.current = undefined }}
      onBlur={() => { infinityReplacement.current = undefined }}
      onChange={(event) => {
        infinityReplacement.current = undefined
        setSource(event.target.value)
      }} />
    <div className="equation-preview" aria-live="polite">
      {current?.vector ? <svg role="img" aria-label={`Prévia de ${source}`} style={{ color }}
        width={current.vector.width * 24 / fontSize} height={current.vector.height * 24 / fontSize}
        viewBox={`0 0 ${current.vector.width} ${current.vector.height}`}>
        {current.vector.paths.map(({ d, transform }, index) =>
          <path key={index} d={d} transform={`matrix(${transform.join(' ')})`} fill="currentColor" />)}
      </svg> : <span>{current?.error ?? (hasSource ? 'Preparando prévia…' : 'A prévia aparece aqui.')}</span>}
    </div>
    <div className="equation-actions">
      <button type="button" onClick={onCancel}>Cancelar</button>
      <button disabled={!hasSource || Boolean(current?.error) || submitting} type="submit">{initialSource ? 'Salvar' : 'Inserir'}</button>
    </div>
  </form>
}
