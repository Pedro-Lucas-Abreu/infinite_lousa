import { useId, useLayoutEffect, useRef, useState } from 'react'
import { findShortcut, type Shortcut, type ShortcutCategory } from '../shortcuts'
import { filterShortcuts } from '../shortcuts/filter'

interface ShortcutsPanelProps {
  open: boolean
  onClose: () => void
}

const equationSections = [['tab', 'Palavra + Tab'], ['direct', 'Digite direto']] as const

function ShortcutList({ entries }: { entries: readonly Shortcut[] }) {
  if (!entries.length) return null

  return (
    <ul>
      {entries.map(({ id, action, keys, equation }) => (
        <li key={id}>
          <span className="shortcut-description">
            {equation && <span className="shortcut-preview" aria-hidden="true">{equation.preview}</span>}
            <span>{action}</span>
            {equation && <code>{equation.code}</code>}
          </span>
          <span className="shortcut-keys">
            {keys.map((key) => <kbd key={key}>{key}</kbd>)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function OpenShortcutsPanel({ onClose }: Pick<ShortcutsPanelProps, 'onClose'>) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const groups = new Map<ShortcutCategory, Shortcut[]>()

  for (const shortcut of filterShortcuts(query)) {
    const group = groups.get(shortcut.category)
    if (group) group.push(shortcut)
    else groups.set(shortcut.category, [shortcut])
  }

  useLayoutEffect(() => {
    const panel = dialog.current
    if (!panel) return
    const previousFocus = document.activeElement
    panel.showModal()
    search.current?.focus()
    return () => {
      panel.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="shortcuts-panel"
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (findShortcut(event.nativeEvent, 'panel') !== 'close-shortcuts') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="shortcuts-header">
        <div className="shortcuts-title">
          <h2 id={titleId}>Atalhos</h2>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
        <label className="shortcuts-search">
          Buscar atalhos
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              results.current?.scrollTo(0, 0)
            }}
          />
        </label>
      </header>
      <div ref={results} className="shortcuts-results" role="region" aria-label="Lista de atalhos" tabIndex={0}>
        {Array.from(groups, ([category, entries]) => (
          <section className="shortcut-group" key={category}>
            <h3>{category}</h3>
            <ShortcutList entries={entries.filter(({ equation }) => !equation)} />
            {category === 'Equações' && equationSections.map(([mode, title]) => {
              const matching = entries.filter(({ equation }) => equation?.mode === mode)
              if (!matching.length) return null
              return (
                <section className="shortcut-equation" key={mode}>
                  <h4>{title}</h4>
                  <ShortcutList entries={matching} />
                </section>
              )
            })}
          </section>
        ))}
        <p className="shortcuts-empty" role="status">
          {groups.size === 0 ? 'Nenhum atalho encontrado.' : ''}
        </p>
      </div>
    </dialog>
  )
}

export function ShortcutsPanel({ open, onClose }: ShortcutsPanelProps) {
  return open ? <OpenShortcutsPanel onClose={onClose} /> : null
}
