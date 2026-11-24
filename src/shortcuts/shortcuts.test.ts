import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { latexExpansions, latexReplacements } from '../equations/editing'
import { acceptsPointer, findShortcut, keyMatches, pointerButtons, pointerConstrained, shortcutAria, shortcutLabel, shortcuts,
  shouldExtendSelection, shouldStartPan, shouldZoomWithWheel, type KeyBinding, type ShortcutEvent, type ShortcutScope } from './index'

const event = (key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...overrides,
})

function example(binding: KeyBinding, command: 'ctrlKey' | 'metaKey' = 'ctrlKey'): ShortcutEvent {
  return event(binding.key, {
    code: binding.code ?? '', altKey: binding.modifier === 'alt', shiftKey: binding.shift === true,
    [command]: binding.modifier === 'command',
  })
}

test('every keyboard binding dispatches its registered action in its own context', () => {
  for (const shortcut of shortcuts) {
    for (const binding of shortcut.bindings) {
      const expected = binding.native ? undefined : shortcut.id
      assert.equal(findShortcut(example(binding), shortcut.scope), expected, shortcut.id)
      if (binding.modifier === 'command') assert.equal(findShortcut(example(binding, 'metaKey'), shortcut.scope), expected)
      if (binding.single) assert.equal(findShortcut({ ...example(binding), repeat: true }, shortcut.scope), undefined)
      if (binding.hold) {
        assert.equal(findShortcut({ ...example(binding), ctrlKey: true }, shortcut.scope, 'keyup'), expected)
      }
    }
  }
})

test('shortcuts have unique IDs and unambiguous key combinations within each context', () => {
  assert.equal(new Set(shortcuts.map(({ id }) => id)).size, shortcuts.length)
  assert.deepEqual(new Set(shortcuts.map(({ category }) => category)),
    new Set(['Ferramentas', 'Lousa', 'PDF e quadros', 'Equações', 'Edição']))

  const scopes: ShortcutScope[] = ['board', 'controller', 'text', 'equation', 'panel']
  const probes = shortcuts.flatMap(({ bindings }) => bindings.map((binding) => example(binding)))
  for (const sample of probes) {
    for (const ctrlKey of [false, true]) for (const metaKey of [false, true]) {
      for (const altKey of [false, true]) for (const shiftKey of [false, true]) {
        const probe = { ...sample, ctrlKey, metaKey, altKey, shiftKey }
        for (const scope of scopes) {
          const matches = shortcuts.filter((shortcut) => shortcut.scope === scope &&
            shortcut.bindings.some((binding) => keyMatches(binding, probe)))
          assert.ok(matches.length <= 1, `${scope}: ${matches.map(({ id }) => id).join(', ')}`)
        }
        const board = findShortcut(probe, 'board')
        const controller = findShortcut(probe, 'controller')
        if (board && controller) {
          assert.ok((board === 'fit-frame' && controller === 'finish-polygon') ||
            (board === 'escape' && controller === 'cancel-gesture'), `${board} / ${controller}`)
        }
      }
    }
  }
})

test('native paste and multiline typing are left to the browser, and composed keys are ignored', () => {
  assert.equal(findShortcut(event('v', { ctrlKey: true }), 'board'), undefined)
  assert.equal(findShortcut(event('Enter', { shiftKey: true }), 'text'), undefined)
  assert.equal(findShortcut(event('Enter', { isComposing: true }), 'equation'), undefined)
  assert.equal(findShortcut(event('?', { defaultPrevented: true, shiftKey: true }), 'board'), undefined)
  assert.equal(findShortcut(event('x', { code: 'KeyX', ctrlKey: true, altKey: true }), 'controller'), undefined)
  assert.equal(findShortcut(event('F', { shiftKey: true }), 'equation'), undefined)
  assert.equal(shortcutLabel('copy'), 'Ctrl+C')
  assert.equal(shortcutAria('copy'), 'Control+C Meta+C')
  assert.equal(shortcutLabel('open-shortcuts'), '? / Shift+/')
})

test('the equation panel lists every implemented template and automatic symbol', () => {
  for (const [token, latex] of Object.entries(latexExpansions)) {
    const row = shortcuts.find(({ id }) => id === `equation-template-${token}`)
    assert.equal(row?.action, latex)
    assert.deepEqual(row.keys, [`${token} + Tab`])
  }
  for (const [symbol, latex] of Object.entries(latexReplacements)) {
    const row = shortcuts.find(({ id }) => id === `equation-symbol-${symbol}`)
    assert.equal(row?.action, latex)
    assert.deepEqual(row.keys, [symbol])
    assert.equal(findShortcut(event(symbol.at(-1)!), 'equation'), 'equation-typing')
  }
  assert.deepEqual(shortcuts.find(({ id }) => id === 'equation-typing')?.keys, ['^', '_', '{', '}'])
})

test('pointer dispatch follows the documented controls', () => {
  assert.equal(shouldStartPan(pointerButtons.secondary, false, false, false), true)
  assert.equal(shouldStartPan(pointerButtons.primary, false, false, false), false)
  assert.equal(shouldStartPan(pointerButtons.middle, true, true, true), false)
  assert.equal(shouldZoomWithWheel(true, { ctrlKey: false }), false)
  assert.equal(shouldZoomWithWheel(true, { ctrlKey: true }), true)
  assert.equal(shouldZoomWithWheel(false, { ctrlKey: false }), true)
  assert.equal(pointerConstrained({ shiftKey: true }), true)
  assert.equal(shouldExtendSelection({ button: pointerButtons.primary, shiftKey: true }), true)
  assert.equal(acceptsPointer('finish-polygon', pointerButtons.primary), true)
  assert.equal(acceptsPointer('edit-equation', pointerButtons.secondary), false)
})

test('keyboard handlers dispatch registry actions instead of comparing raw keys', () => {
  const handlers = ['src/main.tsx', 'src/canvas/controller.ts', 'src/ui/text-editor.tsx',
    'src/ui/equation-editor.tsx', 'src/ui/shortcuts-panel.tsx']
  const rawDispatch = /\b(?:event|nativeEvent)\.(?:key|code)(?:\.toLowerCase\(\)|\s*[!=]==?)|\bswitch\s*\(\s*(?:event|nativeEvent)\.(?:key|code)\s*\)/
  for (const file of handlers) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /\bfindShortcut\(/, file)
    assert.doesNotMatch(source, rawDispatch, file)
  }
})
