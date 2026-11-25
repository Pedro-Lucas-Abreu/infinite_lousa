export const MAX_PLOT_EXPRESSION_LENGTH = 256

export type PlotExpression = (x: number, branches?: number[]) => number
export type AngleUnit = 'degrees' | 'radians'

type Operator = '+' | '-' | '*' | '/' | '^' | '(' | ')' | '!' | '%'
type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; text: string }
  | { kind: Operator | 'end' }

const functions = {
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  cbrt: Math.cbrt,
  exp: Math.exp,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const lexeme = /\s+|(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?|log2(?![a-z0-9])|[a-z]+|[+*/^()!%-]/iy
  for (let offset = 0; offset < source.length;) {
    lexeme.lastIndex = offset
    const match = lexeme.exec(source)
    if (!match) throw new Error(`Caractere inválido: «${source[offset]}».`)
    const text = match[0].toLowerCase()
    offset = lexeme.lastIndex
    if (/^\s/.test(text)) continue
    if (/^[a-z]/.test(text)) {
      tokens.push({ kind: 'name', text })
    } else if (/^[\d.,]/.test(text)) {
      const value = Number(text.replace(',', '.'))
      if (!Number.isFinite(value)) throw new Error('O número está fora do intervalo aceito.')
      tokens.push({ kind: 'number', value })
    } else {
      tokens.push({ kind: text as Operator })
    }
  }
  tokens.push({ kind: 'end' })
  return tokens
}

interface CalculatorOptions {
  readonly angleUnit: AngleUnit
  readonly answer?: number
}

function calculatorValue(value: number): number {
  if (Number.isNaN(value)) throw new Error('Domínio inválido.')
  if (!Number.isFinite(value)) throw new Error('Resultado fora do intervalo.')
  return value
}

function factorial(value: number): number {
  if (value < 0 || !Number.isInteger(value)) throw new Error('Domínio inválido.')
  if (value > 170) throw new Error('Resultado fora do intervalo.')
  let product = 1
  for (let factor = 2; factor <= value; factor++) product *= factor
  return product
}

function parseExpression(source: string, calculator?: CalculatorOptions): PlotExpression {
  if (!source.trim()) throw new Error('Digite uma expressão.')
  if (source.length > MAX_PLOT_EXPRESSION_LENGTH) throw new Error('A expressão é longa demais.')
  const tokens = tokenize(source)
  let index = 0
  const accept = calculator ? calculatorValue : (value: number) => value

  function match(kind: Token['kind']): boolean {
    if (tokens[index].kind !== kind) return false
    index++
    return true
  }

  function group(): PlotExpression {
    const result = addition()
    if (!match(')')) throw new Error('Feche o parêntese com ).')
    return result
  }

  function primary(): PlotExpression {
    const token = tokens[index]
    if (match('(')) return group()
    if (token.kind === 'number') {
      index++
      return () => token.value
    }
    if (token.kind !== 'name') throw new Error('Use um número, x, uma função ou uma expressão entre parênteses.')
    index++
    if (token.text === 'x' && !calculator) return (x) => x
    if (token.text === 'ans' && calculator?.answer !== undefined) return () => calculator.answer!
    if (token.text === 'pi') return () => Math.PI
    if (token.text === 'e') return () => Math.E
    if (!Object.hasOwn(functions, token.text)) throw new Error(`Nome desconhecido: «${token.text}».`)
    if (!match('(')) throw new Error(`Use parênteses depois de ${token.text}.`)
    const argument = group()
    const evaluate = functions[token.text as keyof typeof functions]
    if (token.text === 'sin' || token.text === 'cos' || token.text === 'tan') {
      const angleFactor = calculator?.angleUnit === 'degrees' ? Math.PI / 180 : 1
      return (x, branches) => {
        const angle = argument(x, branches) * angleFactor
        if (token.text === 'tan') {
          // Each interval between consecutive tangent poles is a separate branch.
          branches?.push(Math.floor((angle + Math.PI / 2) / Math.PI))
          if (Math.abs(Math.cos(angle)) <= Number.EPSILON * 4) return accept(NaN)
        }
        return accept(evaluate(angle))
      }
    }
    return (x, branches) => {
      const input = argument(x, branches)
      if (calculator && input <= 0 && (token.text === 'log' || token.text === 'ln' || token.text === 'log2')) {
        throw new Error('Domínio inválido.')
      }
      return accept(evaluate(input))
    }
  }

  function postfix(): PlotExpression {
    let result = primary()
    while (calculator && match('!')) {
      const operand = result
      result = (x, branches) => factorial(operand(x, branches))
    }
    return result
  }

  function power(): PlotExpression {
    const base = postfix()
    if (!match('^')) return base
    const exponent = unary()
    return (x, branches) => {
      const value = base(x, branches)
      const exp = exponent(x, branches)
      if (calculator && value === 0 && exp < 0) throw new Error('Divisão por zero.')
      return accept(value ** exp)
    }
  }

  function unary(): PlotExpression {
    if (match('+')) return unary()
    if (!match('-')) return power()
    const operand = unary()
    return (x, branches) => -operand(x, branches)
  }

  function multiplication(): PlotExpression {
    let result = unary()
    for (;;) {
      const token = tokens[index]
      const operator = token.kind
      const divide = operator === '/'
      const modulus = calculator && (operator === '%' || (token.kind === 'name' && token.text === 'mod'))
      if (operator === '*' || divide || modulus) index++
      else if (operator !== '(' && operator !== 'name') return result
      const left = result
      const right = unary()
      result = (x, branches) => {
        const numerator = left(x, branches)
        const denominator = right(x, branches)
        if (!divide && !modulus) return accept(numerator * denominator)
        if (calculator && denominator === 0) throw new Error('Divisão por zero.')
        if (divide) {
          // Opposite signs of a continuous denominator imply a pole or a hole.
          branches?.push(Math.sign(denominator))
          return accept(numerator / denominator)
        }
        const remainder = numerator % denominator
        return remainder !== 0 && Math.sign(remainder) !== Math.sign(denominator) ? remainder + denominator : remainder
      }
    }
  }

  function addition(): PlotExpression {
    let result = multiplication()
    for (;;) {
      const operator = tokens[index].kind
      if (operator !== '+' && operator !== '-') return result
      index++
      const left = result
      const right = multiplication()
      result = operator === '+' ? (x, branches) => accept(left(x, branches) + right(x, branches))
        : (x, branches) => accept(left(x, branches) - right(x, branches))
    }
  }

  const evaluate = addition()
  if (tokens[index].kind !== 'end') throw new Error('Confira os operadores e parênteses da expressão.')
  return evaluate
}

export function parsePlotExpression(source: string): PlotExpression {
  const evaluate = parseExpression(source)
  return (x, branches) => {
    const value = evaluate(x, branches)
    return Number.isFinite(value) ? value : NaN
  }
}

export function evaluateCalculatorExpression(source: string, options: CalculatorOptions): number {
  const normalized = source.replace(/π/g, 'pi').replace(/[−×÷]/g, (operator) =>
    operator === '−' ? '-' : operator === '×' ? '*' : '/')
  if (/\dE(?![+-]?\d)/.test(normalized)) throw new Error('Informe o expoente.')
  return calculatorValue(parseExpression(normalized, options)(NaN))
}
