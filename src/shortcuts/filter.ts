import { shortcuts, type Shortcut } from './index'

function searchable(value: string): string {
  return value.normalize('NFD').replace(/(\p{L})\p{M}+/gu, '$1').toLocaleLowerCase('pt-BR')
}

export function filterShortcuts(query: string): readonly Shortcut[] {
  const words = searchable(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return shortcuts

  return shortcuts.filter(({ action, keys, category, equation }) => {
    const text = searchable([action, category, ...keys, equation?.preview, equation?.code].join(' '))
    return words.every((word) => text.includes(word))
  })
}
