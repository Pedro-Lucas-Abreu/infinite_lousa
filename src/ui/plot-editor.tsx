import { useId, useLayoutEffect, useRef, useState } from 'react'
import { PLOT_GRID_OPACITY, PLOT_GRID_WIDTH_RATIO } from '../canvas/drawings'
import type { PlotObject } from '../core/types'
import { MAX_PLOT_EXPRESSION_LENGTH, parsePlotExpression } from '../plot/expression'
import { getPlotGeometry, MAX_PLOT_FUNCTIONS, validatePlotSettings } from '../plot/geometry'
import type { PlotFunction, PlotLine, PlotSettings } from '../plot/geometry'
import { findShortcut, shortcutAria } from '../shortcuts'

interface Props {
  initial: PlotObject['props']
  editing: boolean
  onSave: (props: PlotObject['props']) => void
  onCancel: () => void
}

type FunctionDraft = PlotFunction & { id: string }
const rangeFields = [
  ['xmin', 'X mínimo'], ['xmax', 'X máximo'], ['ymin', 'Y mínimo'], ['ymax', 'Y máximo'], ['step', 'Passo'],
] as const
const curveColors = ['#2158ad', '#bd3b47', '#177345', '#864997', '#ac5a21', '#247784']
const textAnchor = { left: 'start', center: 'middle', right: 'end' } as const

function readDecimal(value: string): number {
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return NaN
  return Number(trimmed.replace(',', '.'))
}

function checkExpression(expression: string): string | undefined {
  if (!expression.trim()) return
  try { parsePlotExpression(expression) }
  catch (error) { return error instanceof Error ? error.message : 'Confira a expressão.' }
}

function segmentsPath(segments: readonly PlotLine[]): string {
  return segments.map(({ from, to }) => `M${from.x},${from.y}L${to.x},${to.y}`).join(' ')
}

function PlotPreview({ settings, width, height, size, color, functions }: PlotObject['props']) {
  const { axes, grid, labels, curves, fontSize } = getPlotGeometry(settings, width, height, functions)
  return (
    <svg role="img" aria-label="Prévia do plano cartesiano" viewBox={`0 0 ${width} ${height}`}>
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path d={segmentsPath(grid)} stroke={color} opacity={PLOT_GRID_OPACITY} strokeWidth={size * PLOT_GRID_WIDTH_RATIO} />
        <path d={segmentsPath(axes)} stroke={color} strokeWidth={size} />
        {curves.map(({ color: stroke, paths }, index) => (
          <path key={index} stroke={stroke} strokeWidth={size}
            d={paths.map((points) => `M${points.map(({ x, y }) => `${x},${y}`).join('L')}`).join(' ')} />
        ))}
      </g>
      <g fill={color} fontFamily="Arial, sans-serif" fontSize={fontSize}>
        {labels.map(({ text, x, y, align }, index) => (
          <text key={index} x={x} y={y} textAnchor={textAnchor[align]}>{text}</text>
        ))}
      </g>
    </svg>
  )
}

export function PlotEditor({ initial, editing, onSave, onCancel }: Props) {
  const titleId = useId()
  const scaleErrorId = useId()
  const sizeId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const lastFunction = useRef<HTMLInputElement>(null)
  const focusNewFunction = useRef(false)
  const [ranges, setRanges] = useState(() => ({
    xmin: String(initial.settings.xmin), xmax: String(initial.settings.xmax),
    ymin: String(initial.settings.ymin), ymax: String(initial.settings.ymax), step: String(initial.settings.step),
  }))
  const [lockAspect, setLockAspect] = useState(initial.settings.lockAspect)
  const [size, setSize] = useState(initial.size)
  const [color, setColor] = useState(initial.color)
  const [functions, setFunctions] = useState<FunctionDraft[]>(() => initial.functions.map((item) => ({
    ...item, id: crypto.randomUUID(),
  })))

  const settings: PlotSettings = {
    xmin: readDecimal(ranges.xmin), xmax: readDecimal(ranges.xmax),
    ymin: readDecimal(ranges.ymin), ymax: readDecimal(ranges.ymax), step: readDecimal(ranges.step), lockAspect,
  }
  const minSize = Math.min(0.5, initial.size)
  const maxSize = Math.max(12, initial.size)
  const scaleError = validatePlotSettings(settings)
  const functionErrors = functions.map(({ expression }) => checkExpression(expression))
  const validFunctions = functions.flatMap(({ expression, color }, index) =>
    !functionErrors[index] && expression.trim() ? [{ expression: expression.trim(), color }] : [])
  const props = { width: initial.width, height: initial.height, color, size, settings, functions: validFunctions }
  const canSave = !scaleError && !functionErrors.some(Boolean)

  useLayoutEffect(() => {
    const panel = dialog.current
    if (!panel) return
    const previousFocus = document.activeElement
    panel.showModal()
    firstField.current?.focus()
    return () => {
      panel.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    if (!focusNewFunction.current) return
    focusNewFunction.current = false
    lastFunction.current?.focus()
  }, [functions.length])

  function updateFunction(id: string, changes: Partial<PlotFunction>) {
    setFunctions((current) => current.map((entry) => entry.id === id ? { ...entry, ...changes } : entry))
  }

  function addFunction() {
    if (functions.length >= MAX_PLOT_FUNCTIONS) return
    focusNewFunction.current = true
    setFunctions((current) => [...current, {
      id: crypto.randomUUID(), expression: '', color: curveColors[current.length % curveColors.length],
    }])
  }

  return (
    <dialog ref={dialog} className="plot-editor" aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const action = findShortcut(event.nativeEvent, 'plot')
        if (action === 'plot-cancel') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else if (action === 'plot-save' && event.target instanceof HTMLInputElement && event.target.type === 'text') {
          event.preventDefault()
          form.current?.requestSubmit()
        }
      }}>
      <form ref={form} onSubmit={(event) => { event.preventDefault(); if (canSave) onSave(props) }}>
        <header className="plot-editor-header">
          <h2 id={titleId}>{editing ? 'Editar plano cartesiano' : 'Inserir plano cartesiano'}</h2>
        </header>
        <div className="plot-editor-body">
          <div className="plot-editor-fields">
            <fieldset>
              <legend>Eixos e escala</legend>
              <div className="plot-range-fields">
                {rangeFields.map(([key, label], index) => (
                  <label key={key}>{label}
                    <input ref={index === 0 ? firstField : undefined} type="text" inputMode="decimal" maxLength={32}
                      value={ranges[key]} aria-describedby={scaleError ? scaleErrorId : undefined}
                      onChange={(event) => setRanges({ ...ranges, [key]: event.target.value })} />
                  </label>
                ))}
              </div>
              {scaleError && <p className="plot-error" id={scaleErrorId} role="status">{scaleError}</p>}
              <label className="plot-aspect">
                <input type="checkbox" checked={lockAspect} onChange={(event) => setLockAspect(event.target.checked)} />
                Travar proporção 1:1
              </label>
              <div className="plot-appearance">
                <label>Cor dos eixos
                  <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
                </label>
                <label>
                  <span>Espessura <output htmlFor={sizeId}>{size.toLocaleString('pt-BR')} px</output></span>
                  <input id={sizeId} type="range" min={minSize} max={maxSize} step={0.5} value={size}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber
                      if (Number.isFinite(value) && value >= minSize && value <= maxSize) setSize(value)
                    }} />
                </label>
              </div>
            </fieldset>
            <fieldset className="plot-functions">
              <legend>Funções</legend>
              {functions.map(({ id, expression, color }, index) => (
                <div className="plot-function" key={id}>
                  <label>Função {index + 1}
                    <input type="text" placeholder="2x + 1" value={expression} spellCheck={false} autoComplete="off"
                      ref={index === functions.length - 1 ? lastFunction : undefined} maxLength={MAX_PLOT_EXPRESSION_LENGTH}
                      aria-invalid={Boolean(functionErrors[index])}
                      aria-describedby={functionErrors[index] ? `plot-error-${id}` : undefined}
                      onChange={(event) => updateFunction(id, { expression: event.target.value })} />
                  </label>
                  <label>Cor
                    <input type="color" value={color} aria-label={`Cor da função ${index + 1}`}
                      onChange={(event) => updateFunction(id, { color: event.target.value })} />
                  </label>
                  <button type="button" aria-label={`Remover função ${index + 1}`}
                    onClick={() => setFunctions((current) => current.filter((item) => item.id !== id))}>Remover</button>
                  {functionErrors[index] && <p className="plot-error" id={`plot-error-${id}`} role="status">{functionErrors[index]}</p>}
                </div>
              ))}
              <button type="button" onClick={addFunction} disabled={functions.length >= MAX_PLOT_FUNCTIONS}>
                Adicionar função
              </button>
              <details className="plot-syntax">
                <summary>Ajuda de sintaxe</summary>
                <ul>
                  <li>Use <code>x</code> como variável, <code>2x</code> para multiplicar e <code>x^2</code> para elevar à potência.</li>
                  <li>Use vírgula ou ponto nos decimais, como <code>0,5x</code> ou <code>0.5x</code>.</li>
                  <li><code>log(x)</code> usa base 10 e <code>ln(x)</code> usa base natural.</li>
                  <li><code>sqrt(x)</code> calcula a raiz quadrada e <code>abs(x)</code> calcula o valor absoluto.</li>
                  <li><code>sin(x)</code>, <code>cos(x)</code> e <code>tan(x)</code> usam radianos. As constantes são <code>pi</code> e <code>e</code>.</li>
                </ul>
              </details>
            </fieldset>
          </div>
          <section className="plot-editor-preview" aria-label="Prévia">
            <h3>Prévia</h3>
            {scaleError
              ? <p>Confira a escala para ver o plano.</p>
              : <PlotPreview {...props} />}
          </section>
        </div>
        <footer className="plot-editor-actions">
          <button type="button" aria-keyshortcuts={shortcutAria('plot-cancel')} onClick={onCancel}>Cancelar</button>
          <button type="submit" aria-keyshortcuts={shortcutAria('plot-save')} disabled={!canSave}>
            {editing ? 'Salvar' : 'Inserir plano'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
