import { latexExpansionDetails, latexReplacementDetails } from '../equations/shortcuts'

export type ShortcutScope = 'board' | 'controller' | 'text' | 'equation' | 'panel' | 'plot'
export type ShortcutCategory = 'Ferramentas' | 'Lousa' | 'PDF e quadros' | 'Equações' | 'Edição'

export interface KeyBinding {
  key: string
  code?: string
  modifier?: 'command' | 'alt'
  shift?: true | 'either'
  hold?: true
  single?: true
  native?: true
  label?: string
  caseSensitive?: true
  hidden?: true
}

interface PointerBinding {
  gesture: 'pan' | 'zoom' | 'edit' | 'polygon' | 'dock' | 'drop' | 'paste' | 'pinch' | 'constrain' | 'select'
  condition?: 'ctrl' | 'space' | 'hand' | 'shift'
  button?: number
}

export interface Shortcut {
  id: string
  scope: ShortcutScope
  category: ShortcutCategory
  action: string
  keys: readonly string[]
  bindings: readonly KeyBinding[]
  pointerBindings: readonly PointerBinding[]
  equation?: { mode: 'tab' | 'direct'; preview: string; code: string }
}

const visibleKey: Readonly<Record<string, string>> = {
  ' ': 'Espaço', Escape: 'Esc', Delete: 'Delete', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
}

function formatKey(binding: KeyBinding): string {
  if (binding.label) return binding.label
  const modifier = binding.modifier === 'command' ? 'Ctrl+' : binding.modifier === 'alt' ? 'Alt+' : ''
  const shift = binding.shift === true ? 'Shift+' : ''
  const base = visibleKey[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return `${modifier}${shift}${base}`
}

function entry<Id extends string>(id: Id, scope: ShortcutScope, category: ShortcutCategory, action: string,
  bindings: readonly KeyBinding[] = [], extraKeys: readonly string[] = [], pointerBindings: readonly PointerBinding[] = []): Shortcut & { id: Id } {
  return { id, scope, category, action, bindings, pointerBindings,
    keys: [...bindings.filter(({ hidden }) => !hidden).map(formatKey), ...extraKeys] }
}

function board<Id extends string>(id: Id, category: ShortcutCategory, action: string, ...bindings: readonly KeyBinding[]) {
  return entry(id, 'board', category, action, bindings)
}

function equationHelp<Id extends string>(id: Id, trigger: string, details: { name: string; preview: string; code: string },
  mode: 'tab' | 'direct') {
  const keys = mode === 'tab' ? [`${trigger} + Tab`] : [trigger]
  return {
    ...entry(id, 'equation', 'Equações', details.name, [], keys),
    equation: { mode, code: details.code, preview: details.preview },
  }
}

const plain = (key: string, single?: true): KeyBinding => single ? { key, shift: 'either', single } : { key, shift: 'either' }
const command = (key: string, shift?: true): KeyBinding => shift ? { key, modifier: 'command', shift } : { key, modifier: 'command' }
const alt = (key: string): KeyBinding => ({ key, modifier: 'alt', shift: 'either' })

const toolKeys = [
  ['pen', 'Caneta', 'p'], ['highlight', 'Marca-texto', 'h'], ['erase', 'Borracha', 'e'],
  ['select', 'Seleção', 'v'], ['lasso', 'Laço', 'b'], ['hand', 'Mão', 'm'], ['text', 'Texto', 't'],
  ['equation', 'Equação', 'q'], ['line', 'Linha', 'l'], ['arrow', 'Seta', 'a'],
  ['rectangle', 'Retângulo', 'w'], ['ellipse', 'Elipse', 'o'], ['polygon', 'Polígono', 'c'],
] as const

const favorites = [1, 2, 3, 4, 5, 6] as const
const groupKeys = ['^', '_', '{', '}']
const equationTypingKeys: KeyBinding[] = [
  ...groupKeys.map((key): KeyBinding => ({ key, shift: 'either', label: key, caseSensitive: true })),
  ...[...new Set([...Object.keys(latexReplacementDetails).map((sequence) => sequence.at(-1)!), 't'])]
    .map((key): KeyBinding => ({ key, shift: 'either', caseSensitive: true, hidden: true })),
]

export const pointerButtons = { primary: 0, middle: 1, secondary: 2 } as const
export const secondaryButtonMask = 2
const { primary, secondary } = pointerButtons

export const shortcuts = [
  board('open-shortcuts', 'Lousa', 'Abrir painel de atalhos', plain('?', true), { key: '/', shift: true, single: true }),
  entry('close-shortcuts', 'panel', 'Lousa', 'Fechar painel de atalhos', [plain('Escape')]),
  ...toolKeys.map(([tool, action, key]) => board(`tool-${tool}` as const, 'Ferramentas', action, plain(key, tool === 'equation' ? true : undefined))),
  ...favorites.map((number) => board(`favorite-${number}` as const, 'Ferramentas', `Favorito ${number}`, plain(String(number)))),
  entry('dock-bar', 'controller', 'Ferramentas', 'Reposicionar barra de ferramentas', [], ['Arraste pelo puxador', 'Enter ou Espaço no puxador'],
    [{ gesture: 'dock', button: primary }]),
  entry('hold-pan', 'controller', 'Lousa', 'Mover a lousa',
    [{ key: ' ', code: 'Space', hold: true, label: 'Espaço + arraste' }],
    ['Arraste com botão direito', 'Ctrl + arraste', 'Arraste com a ferramenta Mão'], [
      { gesture: 'pan', button: secondary }, { gesture: 'pan', button: primary, condition: 'ctrl' },
      { gesture: 'pan', button: primary, condition: 'space' }, { gesture: 'pan', button: primary, condition: 'hand' },
    ]),
  entry('zoom-wheel', 'controller', 'Lousa', 'Zoom focado no ponteiro', [], ['Roda do mouse', 'Ctrl + roda se ativado'],
    [{ gesture: 'zoom' }, { gesture: 'zoom', condition: 'ctrl' }]),
  entry('touch-pinch', 'controller', 'Lousa', 'Mover e ampliar no toque', [], ['Dois dedos'], [{ gesture: 'pinch' }]),
  board('zoom-in', 'Lousa', 'Aumentar zoom', plain('+'), plain('=')),
  board('zoom-out', 'Lousa', 'Diminuir zoom', plain('-')),
  board('zoom-reset', 'Lousa', 'Voltar à origem e ao zoom de 100%', plain('0')),
  entry('hold-eraser', 'controller', 'Ferramentas', 'Borracha temporária',
    [{ key: 'x', code: 'KeyX', hold: true, label: 'Segure X' }]),
  entry('constrain-shape', 'controller', 'Ferramentas', 'Encaixar ângulo ou manter proporção',
    [{ key: 'Shift', shift: 'either', hold: true, label: 'Shift + arraste' }], [], [{ gesture: 'constrain', condition: 'shift' }]),
  entry('finish-polygon', 'controller', 'Ferramentas', 'Concluir polígono', [plain('Enter')], ['Duplo clique', 'Clique no 1º vértice'],
    [{ gesture: 'polygon', button: primary }]),
  entry('cancel-gesture', 'controller', 'Ferramentas', 'Cancelar gesto ou rascunho de polígono', [plain('Escape')]),
  board('select-all', 'Edição', 'Selecionar todos os objetos destravados', command('a')),
  entry('extend-selection', 'controller', 'Edição', 'Acrescentar à seleção ou retirar dela', [], ['Shift + clique ou arraste'],
    [{ gesture: 'select', button: primary, condition: 'shift' }]),
  board('delete', 'Edição', 'Apagar seleção', plain('Delete')),
  board('duplicate', 'Edição', 'Duplicar seleção', command('d')),
  board('copy', 'Edição', 'Copiar seleção', command('c')),
  board('cut', 'Edição', 'Recortar seleção', command('x')),
  entry('paste', 'board', 'Edição', 'Colar seleção ou importar arquivo da área de transferência',
    [{ key: 'v', modifier: 'command', native: true }], [], [{ gesture: 'paste' }]),
  board('nudge-left', 'Edição', 'Mover seleção à esquerda', alt('ArrowLeft')),
  board('nudge-right', 'Edição', 'Mover seleção à direita', alt('ArrowRight')),
  board('nudge-up', 'Edição', 'Mover seleção para cima', alt('ArrowUp')),
  board('nudge-down', 'Edição', 'Mover seleção para baixo', alt('ArrowDown')),
  board('scale-up', 'Edição', 'Aumentar seleção', alt('+'), alt('=')),
  board('scale-down', 'Edição', 'Diminuir seleção', alt('-')),
  board('rotate-right', 'Edição', 'Girar seleção 15° à direita', { key: 'r' }),
  board('rotate-left', 'Edição', 'Girar seleção 15° à esquerda', { key: 'r', shift: true }),
  board('undo', 'Edição', 'Desfazer', command('z')),
  board('redo', 'Edição', 'Refazer', command('y'), command('z', true)),
  board('save', 'Lousa', 'Salvar lousa', command('s')),
  board('save-as', 'Lousa', 'Salvar uma cópia', command('s', true)),
  board('open-board', 'Lousa', 'Abrir lousa', command('o')),
  board('open-image', 'Lousa', 'Importar imagem', plain('i', true)),
  board('open-pdf', 'PDF e quadros', 'Importar PDF', plain('d', true)),
  entry('drop-assets', 'board', 'Lousa', 'Importar imagem ou PDF por arraste', [], ['Arraste o arquivo até a lousa'],
    [{ gesture: 'drop' }]),
  board('png', 'Lousa', 'Exportar PNG', plain('j')),
  board('pdf-frames', 'PDF e quadros', 'Exportar quadros em PDF', { key: 'y', single: true }),
  board('pdf-all', 'PDF e quadros', 'Exportar toda a lousa em PDF', { key: 'y', shift: true, single: true }),
  board('new-frame', 'PDF e quadros', 'Criar quadro 16:9', plain('n', true)),
  board('background', 'Lousa', 'Alternar fundo da lousa', plain('g')),
  board('lock-page', 'PDF e quadros', 'Travar ou destravar PDF selecionado', plain('u')),
  board('frame-prev', 'PDF e quadros', 'Quadro anterior', plain('ArrowLeft'), plain('ArrowUp')),
  board('frame-next', 'PDF e quadros', 'Próximo quadro', plain('ArrowRight'), plain('ArrowDown')),
  board('fit-frame', 'PDF e quadros', 'Enquadrar quadro atual', plain('Enter')),
  board('presentation', 'Lousa', 'Entrar ou sair da apresentação', plain('f', true)),
  board('laser', 'Lousa', 'Ligar ou desligar laser', plain('k', true)),
  board('spotlight', 'Lousa', 'Ligar ou desligar spotlight', plain('s', true)),
  board('new-plot', 'Ferramentas', 'Inserir plano cartesiano', plain('F2', true)),
  board('escape', 'Lousa', 'Limpar seleção, cancelar quadro ou sair de modo temporário', plain('Escape')),
  entry('edit-text', 'controller', 'Edição', 'Editar texto com seleção ou laço', [], ['Duplo clique'],
    [{ gesture: 'edit', button: primary }]),
  entry('text-save', 'text', 'Edição', 'Salvar texto', [{ key: 'Enter' }]),
  entry('text-newline', 'text', 'Edição', 'Nova linha no texto', [{ key: 'Enter', shift: true, native: true }]),
  entry('text-cancel', 'text', 'Edição', 'Cancelar edição de texto', [plain('Escape')]),
  entry('edit-plot', 'controller', 'Edição', 'Editar plano cartesiano com Seleção ou Laço', [], ['Duplo clique'],
    [{ gesture: 'edit', button: primary }]),
  entry('plot-save', 'plot', 'Edição', 'Inserir ou salvar plano cartesiano', [{ key: 'Enter' }]),
  entry('plot-cancel', 'plot', 'Edição', 'Cancelar edição do plano cartesiano', [plain('Escape')]),
  entry('edit-equation', 'controller', 'Equações', 'Editar equação com seleção ou laço', [], ['Duplo clique'],
    [{ gesture: 'edit', button: primary }]),
  entry('equation-save', 'equation', 'Equações', 'Inserir ou salvar equação', [plain('Enter')]),
  entry('equation-cancel', 'equation', 'Equações', 'Cancelar edição de equação', [plain('Escape')]),
  entry('equation-expand', 'equation', 'Equações', 'Expandir modelo LaTeX ou avançar pelo próximo campo', [{ key: 'Tab' }]),
  entry('equation-typing', 'equation', 'Equações', 'Inserir agrupamentos ou avançar pelo fechamento de chave', equationTypingKeys),
  ...Object.entries(latexExpansionDetails).map(([token, details]) =>
    equationHelp(`equation-template-${token}` as const, token, details, 'tab')),
  ...Object.entries(latexReplacementDetails).map(([symbol, details]) =>
    equationHelp(`equation-symbol-${symbol}` as const, symbol, details, 'direct')),
] as const satisfies readonly Shortcut[]

export type ShortcutId = typeof shortcuts[number]['id']

const byId = new Map<string, Shortcut>(shortcuts.map((shortcut) => [shortcut.id, shortcut]))

export function shortcutLabel(id: string): string {
  return byId.get(id)?.keys.join(' / ') ?? ''
}

export function shortcutAction(id: string): string {
  return byId.get(id)?.action ?? ''
}

export function shortcutAria(id: string): string | undefined {
  const bindings = byId.get(id)?.bindings
  if (!bindings?.length) return undefined
  return bindings.flatMap(({ key, modifier, shift }) => {
    const base = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
    const shifted = shift === true ? `Shift+${base}` : base
    return modifier === 'command' ? [`Control+${shifted}`, `Meta+${shifted}`] :
      modifier === 'alt' ? [`Alt+${shifted}`] : [shifted]
  }).join(' ')
}

export type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'> &
  { readonly isComposing?: boolean; readonly defaultPrevented?: boolean }

export function keyMatches(binding: KeyBinding, event: ShortcutEvent, phase: 'keydown' | 'keyup' = 'keydown'): boolean {
  const key = binding.caseSensitive ? event.key : event.key.toLowerCase()
  const expected = binding.caseSensitive ? binding.key : binding.key.toLowerCase()
  if (binding.native || (binding.code ? event.code !== binding.code : key !== expected)) return false
  if (phase === 'keyup') return binding.hold === true

  const commandHeld = event.ctrlKey || event.metaKey
  return commandHeld === (binding.modifier === 'command') && event.altKey === (binding.modifier === 'alt') &&
    (binding.shift === 'either' || event.shiftKey === (binding.shift === true)) && !(binding.single && event.repeat)
}

export function findShortcut(event: ShortcutEvent, scope: ShortcutScope, phase: 'keydown' | 'keyup' = 'keydown'): ShortcutId | undefined {
  if (phase === 'keydown' && (event.isComposing || event.defaultPrevented)) return undefined
  const shortcut = shortcuts.find((entry) => entry.scope === scope && entry.bindings.some((bind) => keyMatches(bind, event, phase)))
  return shortcut?.id
}

export function shouldStartPan(button: number, ctrl: boolean, space: boolean, hand: boolean): boolean {
  const held = { ctrl, space, hand, shift: false }
  return byId.get('hold-pan')!.pointerBindings.some((binding) =>
    binding.button === button && (binding.condition === undefined || held[binding.condition]))
}

export function shouldZoomWithWheel(requiresControl: boolean, event: Pick<WheelEvent, 'ctrlKey'>): boolean {
  const condition = requiresControl ? 'ctrl' : undefined
  return byId.get('zoom-wheel')!.pointerBindings.some((binding) =>
    binding.condition === condition && (binding.condition === undefined || event.ctrlKey))
}

export function pointerConstrained(event: Pick<PointerEvent, 'shiftKey'>): boolean {
  return byId.get('constrain-shape')!.pointerBindings.some((binding) => binding.condition === 'shift' && event.shiftKey)
}

export function shouldExtendSelection(event: Pick<PointerEvent, 'button' | 'shiftKey'>): boolean {
  return byId.get('extend-selection')!.pointerBindings.some((binding) =>
    binding.button === event.button && binding.condition === 'shift' && event.shiftKey)
}

export function acceptsPointer(id: 'edit-text' | 'edit-equation' | 'edit-plot' | 'finish-polygon' | 'dock-bar', button: number): boolean {
  return byId.get(id)!.pointerBindings.some((binding) => binding.button === button)
}
