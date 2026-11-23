import { useState } from 'react'
import type { PointerEvent } from 'react'
import type { BoardTool, BrushStyle } from '../canvas/controller'

export type Dock = 'top' | 'right' | 'bottom' | 'left'
export type Background = 'white' | 'dark' | 'dotted' | 'grid' | 'millimeter'

export const backgrounds: Readonly<Record<Background, string>> = {
  white: 'Branco', dark: 'Escuro', dotted: 'Pontilhado', grid: 'Quadriculado', millimeter: 'Milimetrado',
}

export const tools: ReadonlyArray<{ id: BoardTool; label: string; key: string; icon: string }> = [
  { id: 'pen', label: 'Caneta', key: 'P', icon: '✎' },
  { id: 'highlight', label: 'Marca-texto', key: 'H', icon: '▰' },
  { id: 'erase', label: 'Borracha', key: 'E', icon: '▱' },
  { id: 'select', label: 'Seleção', key: 'V', icon: '⬚' },
  { id: 'lasso', label: 'Laço', key: 'B', icon: '⌁' },
  { id: 'hand', label: 'Mão', key: 'M', icon: '✥' },
]

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
  onFavorite: (index: number) => void
  onEditFavorite: (style: BrushStyle) => void
}

export function Tools({ dock, tool, favorites, favorite, onDock, onTool, onFavorite, onEditFavorite }: Props) {
  const [dragging, setDragging] = useState(false)

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
        title="Arraste até uma borda para mover a barra. Clique ou pressione Enter para alternar."
        onPointerDown={(event) => {
          if (event.button !== 0) return
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
            aria-label={option.label} aria-keyshortcuts={option.key} aria-pressed={tool === option.id}
            onClick={() => onTool(option.id)}>
            <span aria-hidden="true" data-ui-icon>{option.icon}</span><small>{option.label}</small>
          </button>
        ))}
      </div>
      <div className="favorites" role="group" aria-label="Favoritos de cor e espessura">
        {favorites.map(({ color, size }, index) => (
          <button key={index} type="button" aria-label={`Favorito ${index + 1}, ${size} px`}
            aria-pressed={index === favorite} aria-keyshortcuts={String(index + 1)}
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
        </div>
      </details>
    </aside>
  )
}
