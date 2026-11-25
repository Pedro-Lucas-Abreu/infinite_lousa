import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { parseQuadraticEquation, solveQuadratic } from '../bhaskara/solve'
import type { QuadraticFields, QuadraticSolution } from '../bhaskara/solve'
import type { RenderedEquation } from '../equations/render'
import { findShortcut, shortcutAria } from '../shortcuts'
import { FloatingPanel } from './floating-panel'
import './bhaskara.css'

interface Props {
  onClose: () => void
  onInsert: (steps: readonly string[]) => Promise<void>
}

const fields: readonly (keyof QuadraticFields)[] = ['a', 'b', 'c']

function EquationSteps({ steps }: { steps: readonly string[] }) {
  const [vectors, setVectors] = useState<readonly (RenderedEquation | undefined)[]>([])

  useEffect(() => {
    let active = true
    void import('../equations/render').then(async ({ renderEquation }) => {
      const rendered = await Promise.all(steps.map((step) => renderEquation(step, 16).catch(() => undefined)))
      if (active) setVectors(rendered)
    }).catch(() => {
      if (active) setVectors(steps.map(() => undefined))
    })
    return () => { active = false }
  }, [steps])

  return (
    <ol className="bhaskara-steps" aria-label="Passos da resolução">
      {steps.map((step, index) => {
        const vector = vectors[index]
        return (
          <li key={index}>
            {vector
              ? <svg role="img" aria-label={step} width={vector.width} height={vector.height}
                viewBox={`0 0 ${vector.width} ${vector.height}`}>
                {vector.paths.map(({ d, transform }, index) =>
                  <path key={index} d={d} transform={`matrix(${transform.join(' ')})`} fill="currentColor" />)}
              </svg>
              : <code>{step}</code>}
          </li>
        )
      })}
    </ol>
  )
}

export function Bhaskara({ onClose, onInsert }: Props) {
  const form = useRef<HTMLFormElement>(null)
  const inserting = useRef(false)
  const [equation, setEquation] = useState('')
  const [coefficients, setCoefficients] = useState<QuadraticFields>({ a: '', b: '', c: '' })
  const [solution, setSolution] = useState<QuadraticSolution>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  function updateEquation(source: string) {
    setEquation(source)
    setSolution(undefined)
    setError(undefined)
    if (!source.trim()) return
    try { setCoefficients(parseQuadraticEquation(source)) } catch { /* Keep the previous fields while typing. */ }
  }

  function updateCoefficient(field: keyof QuadraticFields, value: string) {
    setCoefficients((current) => ({ ...current, [field]: value }))
    setEquation('')
    setSolution(undefined)
    setError(undefined)
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inserting.current) return
    setError(undefined)
    try {
      const values = equation.trim() ? parseQuadraticEquation(equation) : coefficients
      setCoefficients(values)
      setSolution(solveQuadratic(values))
    } catch (error) {
      setSolution(undefined)
      setError(error instanceof Error ? error.message : 'Confira os coeficientes.')
    }
  }

  async function insert(steps: readonly string[]) {
    if (inserting.current) return
    inserting.current = true
    setPending(true)
    setError(undefined)
    try { await onInsert(steps) } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível inserir a resolução.')
    } finally {
      inserting.current = false
      setPending(false)
    }
  }

  return (
    <FloatingPanel title="Bhaskara" onClose={onClose} className="bhaskara-panel" initialSide="left"
      onKeyDown={(event) => {
        const action = findShortcut(event.nativeEvent, 'bhaskara')
        if (action === 'bhaskara-cancel') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (action === 'bhaskara-solve' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          form.current?.requestSubmit()
        }
      }}>
      <form ref={form} className="bhaskara-form" onSubmit={calculate}>
        <label>
          Equação
          <input data-focus-on-open autoComplete="off" spellCheck={false} type="text" maxLength={512}
            placeholder="x² − 5x + 6 = 0" value={equation} disabled={pending}
            onChange={(event) => updateEquation(event.target.value)} />
        </label>
        <fieldset>
          <legend>Ou preencha os coeficientes</legend>
          <div className="bhaskara-coefficients">
            {fields.map((field) => (
              <label key={field}>{field}
                <input autoComplete="off" spellCheck={false} type="text" maxLength={100} value={coefficients[field]}
                  disabled={pending} onChange={(event) => updateCoefficient(field, event.target.value)} />
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" aria-keyshortcuts={shortcutAria('bhaskara-solve')} disabled={pending}>Calcular</button>
      </form>
      {error && <p className="bhaskara-error" role="alert">{error}</p>}
      {solution && (
        <section className="bhaskara-result" aria-label="Resolução">
          <h3>Resolução</h3>
          {solution.roots.length > 0 && (
            <ul className="bhaskara-roots" aria-label="Raízes">
              {solution.roots.map(({ exact, decimal }, index) => {
                const variable = solution.kind === 'linear' ? 'x' : solution.kind === 'double' ? 'x₁ = x₂' : index ? 'x₂' : 'x₁'
                return <li key={index}>
                  <span>{variable} = <strong>{exact}</strong></span>
                  {exact !== decimal && <small>Decimal {decimal}</small>}
                </li>
              })}
            </ul>
          )}
          <EquationSteps key={solution.steps.join('\n')} steps={solution.steps} />
          <button type="button" disabled={pending} onClick={() => { void insert(solution.steps) }}>
            {pending ? 'Inserindo…' : 'Inserir na lousa'}
          </button>
        </section>
      )}
    </FloatingPanel>
  )
}
