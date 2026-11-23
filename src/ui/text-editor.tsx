import { useLayoutEffect, useRef, useState } from 'react'
import type { Point } from '../core/types'

interface Props {
  initialText: string
  position: Point
  onCommit: (text: string) => void
  onCancel: () => void
}

export function TextEditor({ initialText, position, onCommit, onCancel }: Props) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initialText)

  useLayoutEffect(() => {
    const input = field.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  return <textarea ref={field} className="board-text-editor" data-board-editor aria-label="Texto da lousa"
    placeholder="Digite o texto" title="Enter para salvar · Shift+Enter para nova linha · Esc para cancelar"
    style={{ left: position.x, top: position.y }} value={text} maxLength={8_192}
    rows={Math.max(2, Math.min(7, text.split('\n').length + 1))}
    onChange={(event) => setText(event.target.value)} onBlur={() => onCommit(text)}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        onCommit(text)
      }
    }} />
}
