import { useId, useLayoutEffect, useRef, useState } from 'react'
import { findShortcut, shortcutAria } from '../shortcuts'
import { hasBaseSides, hasSolidBaseRadius, isRoundSolid, isSolidKind, projectSolid, solidDash, solidKinds, solidViews,
  SOLID_FILL_OPACITY, usesSolidHeight, validSolidSettings, type SolidKind, type SolidProps } from '../solids/geometry'

type Props = {
  initial: SolidProps
  editing: boolean
  onSave: (props: SolidProps) => void
  onCancel: () => void
}

const dimensions = [
  ['edge', 'Aresta da base', (kind: SolidKind) => !isRoundSolid(kind)],
  ['depth', 'Profundidade', (kind: SolidKind) => kind === 'cuboid'],
  ['altitude', 'Altura', usesSolidHeight],
  ['radius', 'Raio', isRoundSolid],
] as const

const views = [['default', 'Oblíqua'], ['front', 'Frente'], ['side', 'Lado'], ['top', 'De cima']] as const

export function SolidEditor({ initial, editing, onSave, onCancel }: Props) {
  const title = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const selector = useRef<HTMLSelectElement>(null)
  const [draft, setDraft] = useState(initial)
  const [values, setValues] = useState({
    edge: String(initial.edge), depth: String(initial.depth), altitude: String(initial.altitude), radius: String(initial.radius),
  })
  const settings = { ...draft, edge: Number(values.edge), depth: Number(values.depth),
    altitude: Number(values.altitude), radius: Number(values.radius) }
  const valid = validSolidSettings(settings)
  const geometry = valid ? projectSolid(settings, settings.size) : undefined

  useLayoutEffect(() => {
    const panel = dialog.current
    if (!panel) return
    const previous = document.activeElement
    panel.showModal()
    selector.current?.focus()
    return () => {
      panel.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  function patch(changes: Partial<SolidProps>) {
    setDraft((current) => ({ ...current, ...changes }))
  }

  function setKind(kind: string) {
    if (!isSolidKind(kind)) return
    patch({ kind, sides: kind === 'prism' ? 3 : 4, showRadius: draft.showRadius && hasSolidBaseRadius(kind) })
    setValues((current) => {
      const next = { ...current }
      for (const [key, , visible] of dimensions) {
        const value = Number(current[key])
        if (!visible(kind) && !(value >= 0.1 && value <= 100)) next[key] = String(initial[key])
      }
      return next
    })
  }

  return (
    <dialog ref={dialog} className="plot-editor solid-editor" aria-labelledby={title}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const action = findShortcut(event.nativeEvent, 'solid')
        if (action === 'solid-cancel') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else if (action === 'solid-save' && event.target instanceof HTMLInputElement && event.target.type === 'number') {
          event.preventDefault()
          form.current?.requestSubmit()
        }
      }}>
      <form ref={form} onSubmit={(event) => {
        event.preventDefault()
        if (geometry) onSave({ ...settings, width: geometry.width, height: geometry.height })
      }}>
        <header className="plot-editor-header"><h2 id={title}>{editing ? 'Editar sólido' : 'Inserir sólido'}</h2></header>
        <div className="plot-editor-body">
          <div className="plot-editor-fields">
            <fieldset>
              <legend>Sólido e dimensões</legend>
              <label>Tipo
                <select ref={selector} value={draft.kind} onChange={(event) => setKind(event.target.value)}>
                  {Object.entries(solidKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                </select>
              </label>
              <div className="plot-range-fields">
                {dimensions.filter(([, , visible]) => visible(draft.kind)).map(([key, label]) => (
                  <label key={key}>{key === 'edge' && !hasBaseSides(draft.kind) ? 'Aresta' : label}
                    <input type="number" min={0.1} max={100} step="any" required value={values[key]}
                      onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
                  </label>
                ))}
                {hasBaseSides(draft.kind) && <label>Lados da base
                  <select value={draft.sides} onChange={(event) => patch({ sides: Number(event.target.value) })}>
                    <option value={3}>Triangular</option>
                    <option value={4}>Quadrangular</option>
                    <option value={5}>Pentagonal</option>
                    <option value={6}>Hexagonal</option>
                  </select>
                </label>}
              </div>
              {(draft.kind === 'pyramid-frustum' || draft.kind === 'cone-frustum') && (
                <label>Tamanho da base superior <output>{Math.round(draft.topScale * 100)}%</output>
                  <input type="range" min={10} max={95} value={Math.round(draft.topScale * 100)}
                    onChange={(event) => patch({ topScale: event.target.valueAsNumber / 100 })} />
                </label>
              )}
              {!valid && <p role="status" className="plot-error">Use dimensões entre 0,1 e 100.</p>}
            </fieldset>
            <fieldset>
              <legend>Vista</legend>
              <label>Elevação <output>{draft.elevation}°</output>
                <input type="range" min={-90} max={90} value={draft.elevation}
                  onChange={(event) => patch({ elevation: event.target.valueAsNumber })} />
              </label>
              <label>Azimute <output>{draft.azimuth}°</output>
                <input type="range" min={-180} max={180} value={draft.azimuth}
                  onChange={(event) => patch({ azimuth: event.target.valueAsNumber })} />
              </label>
              <div className="solid-views">
                {views.map(([name, label]) => (
                  <button type="button" key={name} onClick={() => patch(solidViews[name])}>{label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Aparência</legend>
              <div className="plot-appearance">
                <label>Cor<input type="color" value={draft.color} onChange={(event) => patch({ color: event.target.value })} /></label>
                <label>Espessura <output>{draft.size.toLocaleString('pt-BR')} px</output>
                  <input type="range" min={0.5} max={24} step={0.5} value={draft.size}
                    onChange={(event) => patch({ size: event.target.valueAsNumber })} />
                </label>
              </div>
              <label className="plot-aspect"><input type="checkbox" checked={draft.fillFaces}
                onChange={(event) => patch({ fillFaces: event.target.checked })} />Preenchimento leve</label>
              <label className="plot-aspect"><input type="checkbox" checked={draft.showHeight}
                onChange={(event) => patch({ showHeight: event.target.checked })} />Mostrar altura</label>
              {hasSolidBaseRadius(draft.kind) && <label className="plot-aspect"><input type="checkbox" checked={draft.showRadius}
                onChange={(event) => patch({ showRadius: event.target.checked })} />Mostrar raio</label>}
            </fieldset>
          </div>
          <section className="plot-editor-preview" aria-label="Prévia">
            <h3>Prévia</h3>
            {geometry && (
              <svg role="img" aria-label={`Projeção de ${solidKinds[draft.kind].toLowerCase()}`}
                viewBox={`0 0 ${geometry.width} ${geometry.height}`} strokeLinecap="round" strokeLinejoin="round">
                {geometry.paths.map(({ start, segments, role, closed }, index) => {
                  const data = [`M${start.x},${start.y}`, ...segments.map(({ controls, end }) =>
                    controls ? `C${controls[0].x},${controls[0].y} ${controls[1].x},${controls[1].y} ${end.x},${end.y}`
                      : `L${end.x},${end.y}`), closed ? 'Z' : ''].join(' ')
                  return role === 'face' ? <path key={index} d={data} fill={draft.color} opacity={SOLID_FILL_OPACITY} /> :
                    <path key={index} d={data} fill="none" stroke={draft.color} strokeWidth={draft.size}
                      strokeDasharray={role === 'visible' ? undefined : solidDash(draft.size).join(' ')} />
                })}
              </svg>
            )}
          </section>
        </div>
        <footer className="plot-editor-actions">
          <button type="button" aria-keyshortcuts={shortcutAria('solid-cancel')} onClick={onCancel}>Cancelar</button>
          <button type="submit" aria-keyshortcuts={shortcutAria('solid-save')} disabled={!geometry}>
            {editing ? 'Salvar' : 'Inserir sólido'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
