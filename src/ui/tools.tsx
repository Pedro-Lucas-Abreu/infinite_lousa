import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { BoardTool, BrushStyle } from '../canvas/controller'
import type { InstrumentKind } from '../instruments/geometry'
import { acceptsPointer, shortcutAction, shortcutAria, shortcutLabel } from '../shortcuts'

export type Dock = 'top' | 'right' | 'bottom' | 'left'
export type Background = 'white' | 'dark' | 'dotted' | 'grid' | 'millimeter'

export const backgrounds: Readonly<Record<Background, string>> = {
  white: 'Branco', dark: 'Escuro', dotted: 'Pontilhado', grid: 'Quadriculado', millimeter: 'Milimetrado',
}

function makeTool(id: BoardTool, icon: string) {
  const shortcut = `tool-${id}`
  return { id, label: shortcutAction(shortcut), key: shortcutLabel(shortcut, true), ariaKey: shortcutAria(shortcut), icon }
}

export const tools = [
  makeTool('pen', '✎'), makeTool('highlight', '▰'), makeTool('erase', '▱'), makeTool('select', '⬚'),
  makeTool('lasso', '⌁'), makeTool('hand', '✥'), makeTool('text', 'T'), makeTool('equation', 'ƒ'),
]

export const shapeTools: typeof tools = [
  makeTool('line', '╱'), makeTool('arrow', '↗'), makeTool('rectangle', '▭'), makeTool('ellipse', '○'), makeTool('polygon', '⬠'),
]

export const compassTools = [makeTool('compass', '◯'), makeTool('compass-arc', '◜')]

const guideTools = [
  ['ruler', '▱'], ['set-square-45', '◿'], ['set-square-30', '◢'], ['protractor', '◠'],
] as const

const docks: Readonly<Record<Dock, string>> = {
  top: 'Acima', right: 'À direita', bottom: 'Abaixo', left: 'À esquerda',
}

export const initialFavorites: readonly BrushStyle[] = [
  { color: '#192038', size: 3.5 },
  { color: '#204dab', size: 3.5 },
  { color: '#ad243c', size: 3.5 },
  { color: '#14704e', size: 3.5 },
  { color: '#812a96', size: 5 },
  { color: '#f4c640', size: 14 },
]

type Props = {
  dock: Dock
  tool: BoardTool
  favorites: readonly BrushStyle[]
  favorite: number
  onDock: (dock: Dock) => void
  onTool: (tool: BoardTool) => void
  onPlot: () => void
  onQuickGraph: () => void
  shapeRecognition: boolean
  onToggleRecognition: () => void
  solidInstruments: boolean
  lockCompassRadius: boolean
  onSolidInstruments: (enabled: boolean) => void
  onLockCompassRadius: (enabled: boolean) => void
  onInstrument: (kind: Exclude<InstrumentKind, 'compass'>) => void
  onFavorite: (index: number) => void
  onEditFavorite: (style: BrushStyle) => void
}

export function Tools({ dock, tool, favorites, favorite, onDock, onTool, onPlot, onQuickGraph, shapeRecognition,
  onToggleRecognition, solidInstruments, lockCompassRadius, onSolidInstruments, onLockCompassRadius,
  onInstrument, onFavorite, onEditFavorite }: Props) {
  const [dragging, setDragging] = useState(false)
  const shape = shapeTools.find((entry) => entry.id === tool)
  const compass = compassTools.find((entry) => entry.id === tool)

  function endDockDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return
    setDragging(false)
    const distances: [Dock, number][] = [
      ['top', event.clientY / innerHeight], ['bottom', 1 - event.clientY / innerHeight],
      ['left', event.clientX / innerWidth], ['right', 1 - event.clientX / innerWidth],
    ]
    distances.sort((first, second) => first[1] - second[1])
    onDock(distances[0][0])
  }

  const active = favorites[favorite]
  return (
    <aside className={`drawing-tools${dragging ? ' docking' : ''}`} aria-label="Ferramentas de desenho">
      <button type="button" className="dock-handle" aria-label="Arrastar a barra até uma borda ou pressionar para mudar sua posição"
        title={`Reposicionar barra (${shortcutLabel('dock-bar')})`}
        onPointerDown={(event) => {
          if (!acceptsPointer('dock-bar', event.button)) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }} onPointerUp={endDockDrag} onPointerCancel={() => setDragging(false)}
        onClick={(event) => {
          if (event.detail === 0) {
            const choices = Object.keys(docks) as Dock[]
            onDock(choices[(choices.indexOf(dock) + 1) % choices.length])
          }
        }}>
        <span aria-hidden="true" data-ui-icon>⠿</span>
      </button>
      <div className="drawing-tool-list" role="group" aria-label="Ferramentas">
        {tools.map((option) => (
          <button key={option.id} type="button" title={`${option.label} (${option.key})`}
            aria-label={option.label} aria-keyshortcuts={option.ariaKey} aria-pressed={tool === option.id}
            onClick={() => onTool(option.id)}>
            <span aria-hidden="true" data-ui-icon>{option.icon}</span><small>{option.label}</small>
          </button>
        ))}
      </div>
      <button type="button" className="quick-graph-tool" aria-haspopup="dialog" aria-keyshortcuts={shortcutAria('open-quick-graph')}
        title={`Gráfico (${shortcutLabel('open-quick-graph')})`} onClick={onQuickGraph}>
        <span aria-hidden="true" data-ui-icon>↗</span><small>Gráfico</small>
      </button>
      <details className="tool-settings shapes-menu">
        <summary title="Escolher uma forma" aria-label="Formas">{shape?.label ?? 'Formas'}</summary>
        <div className="tool-settings-body shape-choices">
          {shapeTools.map(({ id, label, key, ariaKey, icon }) => <button key={id} type="button" aria-pressed={tool === id}
            aria-keyshortcuts={ariaKey} title={`${label} (${key})`} onClick={(event) => {
              onTool(id)
              const menu = event.currentTarget.closest('details')
              if (menu) menu.open = false
            }}>
            <span aria-hidden="true" data-ui-icon>{icon}</span>{label}<small>{key}</small>
          </button>)}
          <button type="button" aria-haspopup="dialog" aria-keyshortcuts={shortcutAria('new-plot')}
            title={`Plano cartesiano (${shortcutLabel('new-plot')})`} onClick={(event) => {
              const menu = event.currentTarget.closest('details')
              if (menu) menu.open = false
              onPlot()
            }}>
            <span aria-hidden="true" data-ui-icon>⊞</span>Plano cartesiano<small>{shortcutLabel('new-plot')}</small>
          </button>
        </div>
      </details>
      <button type="button" aria-label="Reconhecimento de formas" aria-pressed={shapeRecognition}
        aria-keyshortcuts={shortcutAria('toggle-shape-recognition')}
        title={`Reconhecimento de formas (${shortcutLabel('toggle-shape-recognition')})`}
        onClick={onToggleRecognition}>
        <span aria-hidden="true" data-ui-icon>◇</span><small>Reconhecer</small>
      </button>
      <details className="tool-settings instruments-menu">
        <summary aria-label="Instrumentos de geometria" title="Instrumentos de geometria">
          {compass ? 'Compasso' : 'Instrumentos'}
        </summary>
        <div className="tool-settings-body shape-choices">
          {guideTools.map(([kind, icon]) => {
            const shortcut = `insert-${kind}`
            return <button key={kind} type="button" aria-keyshortcuts={shortcutAria(shortcut)} onClick={(event) => {
              const menu = event.currentTarget.closest('details')
              if (menu) menu.open = false
              onInstrument(kind)
            }}>
              <span aria-hidden="true" data-ui-icon>{icon}</span>{shortcutAction(shortcut)}<small>{shortcutLabel(shortcut)}</small>
            </button>
          })}
          {compassTools.map(({ id, icon, label, key, ariaKey }) => <button key={id} type="button" aria-pressed={tool === id}
            aria-keyshortcuts={ariaKey} onClick={(event) => {
              const menu = event.currentTarget.closest('details')
              if (menu) menu.open = false
              onTool(id)
            }}>
            <span aria-hidden="true" data-ui-icon>{icon}</span>{label}<small>{key}</small>
          </button>)}
          <label className="tool-switch" title={shortcutLabel('lock-compass-radius')}>
            <input type="checkbox" checked={lockCompassRadius} aria-keyshortcuts={shortcutAria('lock-compass-radius')}
              onChange={(event) => onLockCompassRadius(event.target.checked)} />Travar raio
          </label>
        </div>
      </details>
      <div className="favorites" role="group" aria-label="Favoritos de cor e espessura">
        {favorites.map(({ color, size }, index) => (
          <button key={index} type="button" aria-label={`Favorito ${index + 1}, ${size} px`}
            aria-pressed={index === favorite} aria-keyshortcuts={shortcutAria(`favorite-${index + 1}`)}
            title={`Favorito ${index + 1} · ${size} px`} onClick={() => onFavorite(index)}>
            <span aria-hidden="true" style={{ backgroundColor: color, width: Math.max(9, Math.min(20, size + 7)) }} />
            <small>{index + 1}</small>
          </button>
        ))}
      </div>
      <details className="tool-settings">
        <summary title="Configurar favoritos e posição da barra">Ajustes</summary>
        <div className="tool-settings-body">
          <label>Cor {favorite + 1}<input aria-label={`Cor do favorito ${favorite + 1}`} type="color" value={active.color}
            onChange={(event) => onEditFavorite({ ...active, color: event.target.value })} /></label>
          <label>Espessura<input aria-label={`Espessura do favorito ${favorite + 1}`} type="number" min="1" max="64" step="0.5"
            value={active.size} onChange={(event) => {
              const size = event.target.valueAsNumber
              if (Number.isFinite(size)) onEditFavorite({ ...active, size: Math.min(64, Math.max(1, size)) })
            }} /></label>
          <label>Barra<select value={dock} onChange={(event) => onDock(event.target.value as Dock)}>
            {(Object.keys(docks) as Dock[]).map((position) => <option key={position} value={position}>{docks[position]}</option>)}
          </select></label>
          <label className="tool-switch" title={shortcutLabel('toggle-solid-instruments')}>
            <input type="checkbox" checked={solidInstruments} aria-keyshortcuts={shortcutAria('toggle-solid-instruments')}
              onChange={(event) => onSolidInstruments(event.target.checked)} />Instrumentos sólidos
          </label>
        </div>
      </details>
    </aside>
  )
}
