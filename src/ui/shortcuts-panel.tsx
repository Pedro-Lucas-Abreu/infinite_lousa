import { useId, useLayoutEffect, useRef, useState } from 'react'
import { findShortcut, shortcuts, type ShortcutCategory } from '../shortcuts'

interface ShortcutsPanelProps {
  open: boolean
  onClose: () => void
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
}

function OpenShortcutsPanel({ onClose }: Pick<ShortcutsPanelProps, 'onClose'>) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const words = searchText(query).trim().split(/\s+/).filter(Boolean)
  const groups = new Map<ShortcutCategory, Array<(typeof shortcuts)[number]>>()

  for (const shortcut of shortcuts) {
    const text = searchText([shortcut.action, shortcut.category, ...shortcut.keys].join(' '))
    if (!words.every((word) => text.includes(word))) continue
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
            <ul>
              {entries.map((shortcut) => (
                <li key={`${shortcut.scope}-${shortcut.id}`}>
                  <span>{shortcut.action}</span>
                  <span className="shortcut-keys">
                    {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                  </span>
                </li>
              ))}
            </ul>
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
