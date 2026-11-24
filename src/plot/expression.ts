export const MAX_PLOT_EXPRESSION_LENGTH = 256

export type PlotExpression = (x: number, branches?: number[]) => number

type Operator = '+' | '-' | '*' | '/' | '^' | '(' | ')'
type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; text: string }
  | { kind: Operator | 'end' }

const functions = {
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const lexeme = /\s+|(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?|[a-z]+|[+*/^()-]/iy
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

export function parsePlotExpression(source: string): PlotExpression {
  if (!source.trim()) throw new Error('Digite uma expressão.')
  if (source.length > MAX_PLOT_EXPRESSION_LENGTH) throw new Error('A expressão é longa demais.')
  const tokens = tokenize(source)
  let index = 0

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
    if (token.text === 'x') return (x) => x
    if (token.text === 'pi') return () => Math.PI
    if (token.text === 'e') return () => Math.E
    if (!Object.hasOwn(functions, token.text)) throw new Error(`Nome desconhecido: «${token.text}».`)
    if (!match('(')) throw new Error(`Use parênteses depois de ${token.text}.`)
    const argument = group()
    const evaluate = functions[token.text as keyof typeof functions]
    if (token.text !== 'tan') return (x, branches) => evaluate(argument(x, branches))
    return (x, branches) => {
      const angle = argument(x, branches)
      // Each interval between consecutive tangent poles is a separate branch.
      branches?.push(Math.floor((angle + Math.PI / 2) / Math.PI))
      return Math.abs(Math.cos(angle)) <= Number.EPSILON * 4 ? NaN : Math.tan(angle)
    }
  }

  function power(): PlotExpression {
    const base = primary()
    if (!match('^')) return base
    const exponent = unary()
    return (x, branches) => base(x, branches) ** exponent(x, branches)
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
      const operator = tokens[index].kind
      const divide = operator === '/'
      if (operator === '*' || divide) index++
      else if (operator !== '(' && operator !== 'name') return result
      const left = result
      const right = unary()
      result = divide ? (x, branches) => {
        const numerator = left(x, branches)
        const denominator = right(x, branches)
        // Opposite signs of a continuous denominator imply a pole or a hole.
        branches?.push(Math.sign(denominator))
        return numerator / denominator
      } : (x, branches) => left(x, branches) * right(x, branches)
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
      result = operator === '+' ? (x, branches) => left(x, branches) + right(x, branches)
        : (x, branches) => left(x, branches) - right(x, branches)
    }
  }

  const evaluate = addition()
  if (tokens[index].kind !== 'end') throw new Error('Confira os operadores e parênteses da expressão.')
  return (x, branches) => {
    const value = evaluate(x, branches)
    return Number.isFinite(value) ? value : NaN
  }
}
