import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEventHandler, KeyboardEventHandler, ReactNode } from 'react'
import { pointerButtons } from '../shortcuts'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onPaste?: ClipboardEventHandler<HTMLDivElement>
  className?: string
  initialSide?: 'left' | 'right'
}

export function FloatingPanel({ title, onClose, children, onKeyDown, onPaste, className = '', initialSide = 'right' }: Props) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const previousFocus = document.activeElement
    const focusTarget = element.querySelector<HTMLElement>('[data-focus-on-open]') ?? element
    focusTarget.focus({ preventScroll: true })
    return () => {
      if (element.contains(document.activeElement) && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  useLayoutEffect(() => {
    const fit = () => setPosition((position) => {
      if (!position || !panel.current) return position
      const bounds = panel.current.getBoundingClientRect()
      const x = Math.min(position.x, Math.max(8, window.innerWidth - bounds.width - 8))
      const y = Math.min(position.y, Math.max(8, window.innerHeight - bounds.height - 8))
      return x === position.x && y === position.y ? position : { x, y }
    })
    const move = (event: PointerEvent) => {
      const active = drag.current
      const bounds = panel.current?.getBoundingClientRect()
      if (!active || active.pointerId !== event.pointerId || !bounds) return
      const maxX = Math.max(8, window.innerWidth - bounds.width - 8)
      const maxY = Math.max(8, window.innerHeight - bounds.height - 8)
      setPosition({ x: Math.max(8, Math.min(maxX, event.clientX - active.offsetX)),
        y: Math.max(8, Math.min(maxY, event.clientY - active.offsetY)) })
    }
    const stop = () => { drag.current = null }
    const events = new AbortController()
    const options = { signal: events.signal }
    window.addEventListener('resize', fit, options)
    window.addEventListener('pointermove', move, options)
    window.addEventListener('pointerup', stop, options)
    window.addEventListener('pointercancel', stop, options)
    window.addEventListener('blur', stop, options)
    return () => events.abort()
  }, [])

  return (
    <div ref={panel} role="dialog" aria-labelledby={id} tabIndex={-1} data-board-editor
      className={`floating-panel floating-panel-${initialSide} ${className}`}
      style={position ? { left: position.x, top: position.y, right: 'auto',
        maxHeight: `calc(100dvh - ${position.y + 8}px)` } : undefined}
      onKeyDown={onKeyDown} onPaste={onPaste}>
      <header className="floating-panel-header">
        <h2 id={id} className="floating-panel-handle" title="Arraste para mover"
          onPointerDown={(event) => {
            const bounds = panel.current?.getBoundingClientRect()
            if (!bounds || drag.current || event.button !== pointerButtons.primary) return
            event.preventDefault()
            drag.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.x, offsetY: event.clientY - bounds.y }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.pointerId === event.pointerId) drag.current = null
          }}>{title}</h2>
        <button type="button" aria-label={`Fechar ${title}`} title="Fechar" onClick={onClose}>×</button>
      </header>
      <div className="floating-panel-body">{children}</div>
    </div>
  )
}
