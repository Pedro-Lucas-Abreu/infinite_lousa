import { useLayoutEffect, useRef, useState } from 'react'
import type { AngleUnit } from '../plot/expression'
import {
  appendCalculatorInput, applyCalculatorUnary, backspaceCalculator, calculate, clearCalculator,
  displayCalculatorExpression, emptyCalculator, formatCalculatorNumber, pasteCalculatorNumber,
  type CalculatorState,
} from '../calculator/calculator'
import { findShortcut, shortcutAria } from '../shortcuts'
import { FloatingPanel } from './floating-panel'
import './calculator.css'

interface CalculatorProps {
  open: boolean
  onClose: () => void
}

interface CalculatorKey {
  label: string
  name: string
  run: (state: CalculatorState) => CalculatorState
  kind?: 'operator' | 'accent'
}

function inputKey(label: string, token: string, name = label, kind?: CalculatorKey['kind']): CalculatorKey {
  return { label, name, kind, run: (state) => appendCalculatorInput(state, token) }
}

function unaryKey(label: string, name: string, action: Parameters<typeof applyCalculatorUnary>[1]): CalculatorKey {
  return { label, name, run: (state) => applyCalculatorUnary(state, action) }
}

const typedTokens: Readonly<Record<string, string>> = { '.': ',', '%': ' mod ', 'π': 'pi', '−': '-', '×': '*', '÷': '/' }

export function Calculator({ open, onClose }: CalculatorProps) {
  const display = useRef<HTMLInputElement>(null)
  const [state, setState] = useState(emptyCalculator)
  const [secondary, setSecondary] = useState(false)
  const [angleUnit, setAngleUnit] = useState<AngleUnit>('degrees')
  const [clipboardStatus, setClipboardStatus] = useState('')

  useLayoutEffect(() => {
    if (open) display.current?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  const evaluate = (current: CalculatorState) => calculate(current, angleUnit)
  const output = state.result === undefined ? '' : formatCalculatorNumber(state.result)
  const expression = displayCalculatorExpression(state)
  const keys: readonly CalculatorKey[] = [
    inputKey('π', 'pi', 'Pi'), inputKey('e', 'e', 'Número de Euler'),
    { label: 'C', name: 'Limpar', run: clearCalculator },
    { label: '⌫', name: 'Apagar último caractere', run: backspaceCalculator },
    secondary ? unaryKey('x³', 'Cubo', 'cube') : unaryKey('x²', 'Quadrado', 'square'),
    unaryKey('1/x', 'Inverso', 'inverse'), unaryKey('|x|', 'Valor absoluto', 'abs'),
    inputKey('exp', 'E', 'Notação científica'), inputKey('mod', ' mod ', 'Resto da divisão'),
    secondary ? unaryKey('∛x', 'Raiz cúbica', 'cbrt') : unaryKey('√x', 'Raiz quadrada', 'sqrt'),
    inputKey('(', '(', 'Abrir parêntese'), inputKey(')', ')', 'Fechar parêntese'),
    unaryKey('n!', 'Fatorial', 'factorial'), inputKey('÷', '/', 'Dividir', 'operator'),
    inputKey('xʸ', '^', 'Potência'), inputKey('7', '7'), inputKey('8', '8'), inputKey('9', '9'),
    inputKey('×', '*', 'Multiplicar', 'operator'),
    secondary ? unaryKey('2ˣ', 'Potência de 2', 'two') : unaryKey('10ˣ', 'Potência de 10', 'ten'),
    inputKey('4', '4'), inputKey('5', '5'), inputKey('6', '6'), inputKey('−', '-', 'Subtrair', 'operator'),
    secondary ? unaryKey('log₂', 'Logaritmo de base 2', 'log2') : unaryKey('log', 'Logaritmo de base 10', 'log'),
    inputKey('1', '1'), inputKey('2', '2'), inputKey('3', '3'), inputKey('+', '+', 'Somar', 'operator'),
    secondary ? unaryKey('eˣ', 'Exponencial natural', 'exp') : unaryKey('ln', 'Logaritmo natural', 'ln'),
    unaryKey('±', 'Trocar sinal', 'negate'), inputKey('0', '0'), inputKey(',', ',', 'Vírgula decimal'),
    { label: '=', name: 'Calcular', run: evaluate, kind: 'accent' },
  ]

  function perform(run: (state: CalculatorState) => CalculatorState) {
    setClipboardStatus('')
    setState(run)
    display.current?.focus({ preventScroll: true })
  }

  async function copyResult() {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setClipboardStatus('Resultado copiado.')
    } catch {
      setClipboardStatus('Não foi possível copiar.')
    }
  }

  return <FloatingPanel title="Calculadora" onClose={onClose} className="calculator-panel" initialSide="right"
    onKeyDown={(event) => {
      const shortcut = findShortcut(event.nativeEvent, 'calculator')
      if (shortcut === 'calculator-evaluate' && event.target instanceof HTMLButtonElement && event.key.length > 1) return
      if (shortcut === 'calculator-input') {
        perform((current) => appendCalculatorInput(current, typedTokens[event.key] ?? event.key))
      } else if (shortcut === 'calculator-evaluate') perform(evaluate)
      else if (shortcut === 'calculator-backspace') perform(backspaceCalculator)
      else if (shortcut === 'calculator-escape') {
        if (state.source || state.error) perform(clearCalculator)
        else onClose()
      } else return
      event.preventDefault()
      event.stopPropagation()
    }}
    onPaste={(event) => {
      event.preventDefault()
      event.stopPropagation()
      const text = event.clipboardData.getData('text')
      perform((current) => pasteCalculatorNumber(current, text))
    }}>
    <div className="calculator-display">
      <input ref={display} type="text" inputMode="none" aria-label="Expressão da calculadora"
        value={expression} onChange={() => {}} />
      <output aria-label="Resultado" className={state.error ? 'calculator-error' : ''} aria-live="polite">
        {state.error ?? (output || '0')}
      </output>
    </div>
    <div className="calculator-trigonometry" role="group" aria-label="Trigonometria">
      <button type="button" title="Alternar unidade do ângulo" onClick={() => {
        setAngleUnit(angleUnit === 'degrees' ? 'radians' : 'degrees')
        display.current?.focus({ preventScroll: true })
      }}>{angleUnit === 'degrees' ? 'Graus' : 'Rad'}</button>
      {(['sin', 'cos', 'tan'] as const).map((fn) => <button key={fn} type="button"
        onClick={() => perform((current) => applyCalculatorUnary(current, fn))}>{fn === 'sin' ? 'sen' : fn}</button>)}
    </div>
    <div className="calculator-keys" role="group" aria-label="Teclado da calculadora">
      <button type="button" aria-label="Segunda função" aria-pressed={secondary} onClick={() => {
        setSecondary(!secondary)
        display.current?.focus({ preventScroll: true })
      }}>2nd</button>
      {keys.map(({ label, name, run, kind }) => <button key={label} type="button" title={name} aria-label={name}
        data-kind={kind} onClick={() => perform(run)}>{label}</button>)}
    </div>
    <div className="calculator-actions">
      <button type="button" disabled={!output || Boolean(state.error)} onClick={() => { void copyResult() }}>
        Copiar resultado
      </button>
      {clipboardStatus && <span role="status">{clipboardStatus}</span>}
    </div>
    <details className="calculator-history">
      <summary>Histórico</summary>
      {state.history.length > 0 ? <ol>
        {state.history.map(({ expression: previous, result }, index) => <li key={index}>
          <span>{previous}</span><strong>{formatCalculatorNumber(result)}</strong>
        </li>)}
      </ol> : <p>Nenhum cálculo ainda.</p>}
    </details>
    <p className="calculator-hint" aria-keyshortcuts={shortcutAria('calculator-escape')}>Esc limpa a conta. Com a conta vazia, Esc fecha a calculadora.</p>
  </FloatingPanel>
}
