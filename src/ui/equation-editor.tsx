import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { EquationPath, Point } from '../core/types'

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
  const alive = useRef(true)
  const [source, setSource] = useState(initialSource)
  const [preview, setPreview] = useState<{ source: string; vector?: VectorPreview; error?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const latex = source.trim()

  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(initialSource.length, initialSource.length)
    alive.current = true
    return () => { alive.current = false }
  }, [initialSource])

  useEffect(() => {
    if (!latex) return
    let cancelled = false
    void readVector(latex, fontSize).then((vector) => {
      if (!cancelled) setPreview({ source: latex, vector })
    }).catch(() => {
      if (!cancelled) setPreview({ source: latex, error: 'Confira o código LaTeX.' })
    })
    return () => { cancelled = true }
  }, [latex, fontSize])

  const current = preview?.source === latex ? preview : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!latex || submitting || current?.error) return
    if (current?.vector) {
      onInsert(latex, current.vector)
      return
    }
    setSubmitting(true)
    try {
      const vector = await readVector(latex, fontSize)
      if (alive.current) onInsert(latex, vector)
    } catch {
      if (alive.current) setPreview({ source: latex, error: 'Confira o código LaTeX.' })
    } finally {
      if (alive.current) setSubmitting(false)
    }
  }

  return <form className="board-equation-editor" data-board-editor aria-label="Editor de equação"
    style={{ left: position.x, top: position.y }} onSubmit={(event) => { void submit(event) }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter' && event.target === field.current) {
        event.preventDefault()
        event.currentTarget.requestSubmit()
      }
    }}>
    <label htmlFor="equation-source">LaTeX</label>
    <input id="equation-source" ref={field} type="text" maxLength={16_384} spellCheck={false}
      autoComplete="off" placeholder="2x = 10 ou \frac{1}{2}" value={source}
      readOnly={submitting} onChange={(event) => setSource(event.target.value)} />
    <div className="equation-preview" aria-live="polite">
      {current?.vector ? <svg role="img" aria-label={`Prévia de ${latex}`} style={{ color }}
        width={current.vector.width * 24 / fontSize} height={current.vector.height * 24 / fontSize}
        viewBox={`0 0 ${current.vector.width} ${current.vector.height}`}>
        {current.vector.paths.map(({ d, transform }, index) =>
          <path key={index} d={d} transform={`matrix(${transform.join(' ')})`} fill="currentColor" />)}
      </svg> : <span>{current?.error ?? (latex ? 'Preparando prévia…' : 'A prévia aparece aqui.')}</span>}
    </div>
    <div className="equation-actions">
      <button type="button" onClick={onCancel}>Cancelar</button>
      <button disabled={!latex || Boolean(current?.error) || submitting} type="submit">{initialSource ? 'Salvar' : 'Inserir'}</button>
    </div>
  </form>
}
