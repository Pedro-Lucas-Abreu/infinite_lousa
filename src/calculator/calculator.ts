import { evaluateCalculatorExpression, MAX_PLOT_EXPRESSION_LENGTH, type AngleUnit } from '../plot/expression'

interface Calculation {
  readonly expression: string
  readonly result: number
}

export interface CalculatorState {
  readonly source: string
  readonly result?: number
  readonly answer?: number
  readonly error?: string
  readonly history: readonly Calculation[]
}

export const emptyCalculator: CalculatorState = { source: '', history: [] }

const binaryOperators = new Set(['+', '-', '*', '/', '^', ' mod '])
const numericTail = /(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i

export function formatCalculatorNumber(value: number): string {
  return String(Number(value.toPrecision(12))).replace('.', ',')
}

export function displayCalculatorExpression({ source, answer }: Pick<CalculatorState, 'source' | 'answer'>): string {
  return source.replace(/\b(ans|pi)\b|[.*\/\-]/g, (token) => {
    if (token === 'ans') return answer === undefined ? token : formatCalculatorNumber(answer)
    if (token === 'pi') return 'π'
    if (token === '*') return '×'
    if (token === '/') return '÷'
    if (token === '-') return '−'
    return ','
  })
}

function replaceCalculatorSource(state: CalculatorState, source: string, answer?: number): CalculatorState {
  if (source.length > MAX_PLOT_EXPRESSION_LENGTH) return { ...state, error: 'A expressão é longa demais.' }
  return { source, answer, history: state.history }
}

export function appendCalculatorInput(state: CalculatorState, token: string): CalculatorState {
  if (state.result !== undefined) {
    if (binaryOperators.has(token)) return replaceCalculatorSource(state, `(ans)${token}`, state.result)
    if (token === 'E') return replaceCalculatorSource(state, '(ans)*10^', state.result)
    return replaceCalculatorSource(state, token)
  }
  return replaceCalculatorSource(state, state.source + token, state.answer)
}

export function clearCalculator(state: CalculatorState): CalculatorState {
  return { source: '', history: state.history }
}

export function backspaceCalculator(state: CalculatorState): CalculatorState {
  if (state.result !== undefined) return clearCalculator(state)
  const tail = /(?: mod |ans|pi|.)$/s.exec(state.source)
  return replaceCalculatorSource(state, tail ? state.source.slice(0, -tail[0].length) : '', state.answer)
}

type UnaryCalculatorAction = 'square' | 'cube' | 'inverse' | 'abs' | 'sqrt' | 'cbrt' | 'factorial' |
  'ten' | 'two' | 'log' | 'log2' | 'ln' | 'exp' | 'negate' | 'sin' | 'cos' | 'tan'

const unary = {
  square: (x: string) => `(${x})^2`,
  cube: (x: string) => `(${x})^3`,
  inverse: (x: string) => `(1/(${x}))`,
  abs: (x: string) => `abs(${x})`,
  sqrt: (x: string) => `sqrt(${x})`,
  cbrt: (x: string) => `cbrt(${x})`,
  factorial: (x: string) => `(${x})!`,
  ten: (x: string) => `(10^(${x}))`,
  two: (x: string) => `(2^(${x}))`,
  log: (x: string) => `log(${x})`,
  log2: (x: string) => `log2(${x})`,
  ln: (x: string) => `ln(${x})`,
  exp: (x: string) => `exp(${x})`,
  negate: (x: string) => /^\(-\((.*)\)\)$/s.exec(x)?.[1] ?? `(-(${x}))`,
  sin: (x: string) => `sin(${x})`,
  cos: (x: string) => `cos(${x})`,
  tan: (x: string) => `tan(${x})`,
} satisfies Record<UnaryCalculatorAction, (input: string) => string>

const namedFunctions = new Set<UnaryCalculatorAction>(['abs', 'sqrt', 'cbrt', 'log', 'log2', 'ln', 'exp', 'sin', 'cos', 'tan'])

function operandStart(source: string): number | undefined {
  const base = source.replace(/!+$/, '').trimEnd()
  let start: number
  if (base.endsWith(')')) {
    let depth = 1
    start = base.length - 1
    while (start > 0 && depth > 0) {
      const token = base[--start]
      if (token === ')') depth++
      else if (token === '(') depth--
    }
    if (depth !== 0) return undefined
    const fn = /[a-z][a-z0-9]*$/i.exec(base.slice(0, start))
    if (fn) start = fn.index
  } else {
    const operand = /\b(?:ans|pi|e)$/i.exec(base) ?? numericTail.exec(base)
    if (!operand) return undefined
    start = operand.index
  }

  const prefix = base.slice(0, start)
  if (/(?:(?:^|[+\-*/^(])|\bmod)\s*-$/.test(prefix)) return start - 1
  return start
}

export function applyCalculatorUnary(state: CalculatorState, action: UnaryCalculatorAction): CalculatorState {
  const transform = unary[action]
  if (state.result !== undefined) return replaceCalculatorSource(state, transform('ans'), state.result)
  const source = state.source.trimEnd()
  const start = operandStart(source)
  if (start !== undefined) return replaceCalculatorSource(state, source.slice(0, start) + transform(source.slice(start)), state.answer)
  if (action === 'negate') return appendCalculatorInput(state, '-')
  if (namedFunctions.has(action)) return appendCalculatorInput(state, action + '(')
  return state
}

export function parsePastedNumber(text: string): string | undefined {
  const cleaned = text.trim().replace('−', '-').replace(',', '.')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned) || !Number.isFinite(Number(cleaned))) return undefined
  return cleaned.replace('.', ',')
}

export function pasteCalculatorNumber(state: CalculatorState, text: string): CalculatorState {
  const input = parsePastedNumber(text)
  if (input === undefined) return { ...state, error: 'Cole um número válido.' }
  if (state.result === undefined) {
    const start = operandStart(state.source)
    if (start !== undefined) return replaceCalculatorSource(state, state.source.slice(0, start) + input, state.answer)
  }
  return appendCalculatorInput(state, input)
}

export function calculate(state: CalculatorState, angleUnit: AngleUnit): CalculatorState {
  if (!state.source || state.result !== undefined) return state
  try {
    const result = evaluateCalculatorExpression(state.source, { angleUnit, answer: state.answer })
    return {
      ...state, result, error: undefined,
      history: [{ expression: displayCalculatorExpression(state), result }, ...state.history].slice(0, 10),
    }
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : 'Confira a expressão.' }
  }
}
