import {
  add, divide, maxCoefficientDigits, multiply, negate, parseCoefficient, rational, rationalLatex, rationalNumber,
  rationalRadical, rationalText, unsignedDecimal, type Rational,
} from './rational'

export interface QuadraticFields {
  readonly a: string
  readonly b: string
  readonly c: string
}

export interface QuadraticRoot {
  readonly exact: string
  readonly decimal: string
}

export interface QuadraticSolution {
  readonly kind: 'two-real' | 'double' | 'no-real' | 'linear' | 'none' | 'identity'
  readonly delta?: string
  readonly roots: readonly QuadraticRoot[]
  readonly steps: readonly string[]
}

const fraction = unsignedDecimal + '(?:/' + unsignedDecimal + ')?'
const scalar = '(?:\\([+-]?' + unsignedDecimal + '(?:/[+-]?' + unsignedDecimal + ')?\\)|' + fraction + ')'
const monomial = new RegExp('(?:(?<coefficient>' + scalar + ')\\*?)?x(?:\\^(?<power>[012]))?', 'y')
const constant = new RegExp('(?<coefficient>' + scalar + ')', 'y')
const zero = rational(0n)
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 12, useGrouping: false })
const scientificFormatter = new Intl.NumberFormat('pt-BR', {
  maximumSignificantDigits: 12, useGrouping: false, notation: 'scientific',
})

function bounded(value: Rational): Rational {
  if ([value.numerator, value.denominator].some((part) => String(part < 0n ? -part : part).length > maxCoefficientDigits)) {
    throw new Error('O coeficiente tem dígitos demais.')
  }
  return value
}

function readPolynomial(source: string): [Rational, Rational, Rational] {
  const coefficients: [Rational, Rational, Rational] = [zero, zero, zero]
  for (let offset = 0; offset < source.length;) {
    const sign = source[offset] === '+' || source[offset] === '-' ? source[offset++] : undefined
    if (offset > 0 && sign === undefined) throw new Error('Separe os termos da equação com + ou −.')

    monomial.lastIndex = constant.lastIndex = offset
    const variable = monomial.exec(source)
    const term = variable ?? constant.exec(source)
    if (!term) throw new Error('Use termos como x², 3x ou 2/5.')

    const coefficientText = term.groups?.coefficient?.replace(/^\(|\)$/g, '') ?? '1'
    const coefficient = parseCoefficient(coefficientText)
    const power = (variable ? Number(term.groups?.power ?? '1') : 0) as 0 | 1 | 2
    coefficients[power] = add(coefficients[power], sign === '-' ? negate(coefficient) : coefficient)
    offset += term[0].length
  }
  return coefficients
}

export function parseQuadraticEquation(source: string): QuadraticFields {
  if (source.length > 512) throw new Error('A equação está longa demais.')
  const normalized = source.toLowerCase().replace(/\s+/g, '').replace(/−/g, '-')
    .replace(/²/g, '^2').replace(/¹/g, '^1').replace(/×/g, '*')
  const [left, right = '0', ...rest] = normalized.split('=')
  if (!left || !right || rest.length) throw new Error('Use uma equação como x² − 5x + 6 = 0.')
  const [lc, lb, la] = readPolynomial(left)
  const [rc, rb, ra] = readPolynomial(right)
  return {
    a: rationalText(bounded(add(la, negate(ra)))),
    b: rationalText(bounded(add(lb, negate(rb)))),
    c: rationalText(bounded(add(lc, negate(rc)))),
  }
}

function decimalText(value: number): string {
  const magnitude = Math.abs(value)
  if (!magnitude) return '0'
  const formatter = magnitude >= 1e12 || magnitude < 1e-6 ? scientificFormatter : numberFormatter
  return formatter.format(value)
}

function decimalLatex(value: string): string {
  const [digits, exponent] = value.toLowerCase().split('e')
  const coefficient = digits.replace(',', '{,}')
  return exponent === undefined ? coefficient : coefficient + '\\cdot10^{' + exponent + '}'
}

function rationalRoot(value: Rational): QuadraticRoot {
  return { exact: rationalText(value), decimal: decimalText(rationalNumber(value)) }
}

function approximateRationalRoot(label: string, value: Rational, root: QuadraticRoot): string {
  const exact = rationalLatex(value)
  if (root.exact === root.decimal) return label + '=' + exact
  const approximate = root.decimal.toLowerCase().includes('e') ? undefined : rationalText(parseCoefficient(root.decimal))
  return label + '=' + exact + (approximate === root.exact ? '=' : '\\approx') + decimalLatex(root.decimal)
}

function radicalRoot(offset: Rational, factor: Rational, radicand: bigint, approx: number): QuadraticRoot & { latex: string } {
  const coefficient = factor.numerator < 0n ? -factor.numerator : factor.numerator
  const radical = (coefficient === 1n ? '' : String(coefficient)) + '√' + radicand
  const radicalLatex = (coefficient === 1n ? '' : String(coefficient)) + '\\sqrt{' + radicand + '}'
  const term = factor.denominator === 1n ? radical : radical + '/' + factor.denominator
  const termLatex = factor.denominator === 1n ? radicalLatex : '\\frac{' + radicalLatex + '}{' + factor.denominator + '}'
  const minus = factor.numerator < 0n
  const prefix = offset.numerator === 0n ? (minus ? '-' : '') : rationalText(offset) + (minus ? ' − ' : ' + ')
  const prefixLatex = offset.numerator === 0n ? (minus ? '-' : '') : rationalLatex(offset) + (minus ? '-' : '+')
  return { exact: prefix + term, decimal: decimalText(approx), latex: prefixLatex + termLatex }
}

export function solveQuadratic(fields: QuadraticFields): QuadraticSolution {
  const a = bounded(parseCoefficient(fields.a))
  const b = bounded(parseCoefficient(fields.b))
  const c = bounded(parseCoefficient(fields.c))
  const la = rationalLatex(a), lb = rationalLatex(b), lc = rationalLatex(c)
  const steps = ['a=' + la + ',\\quad b=' + lb + ',\\quad c=' + lc]

  if (a.numerator === 0n) {
    if (b.numerator === 0n) {
      if (c.numerator === 0n) return { kind: 'identity', roots: [], steps: [...steps, '0=0\\quad\\text{para todo }x\\in\\mathbb{R}'] }
      return { kind: 'none', roots: [], steps: [...steps, lc + '\\ne 0\\quad\\text{Sem solução}'] }
    }
    const value = divide(negate(c), b)
    const root = rationalRoot(value)
    steps.push(
      '\\text{Equação do primeiro grau}\\quad (' + lb + ')x+(' + lc + ')=0',
      'x=\\frac{-c}{b}=\\frac{\\left(' + rationalLatex(negate(c)) + '\\right)}{\\left(' + lb + '\\right)}',
      approximateRationalRoot('x', value, root),
    )
    return { kind: 'linear', roots: [root], steps }
  }

  const delta = add(multiply(b, b), negate(multiply(rational(4n), multiply(a, c))))
  const deltaText = rationalText(delta)
  const ld = rationalLatex(delta)
  steps.push('\\Delta=b^{2}-4ac=\\left(' + lb + '\\right)^{2}-4\\cdot\\left(' + la + '\\right)\\cdot\\left(' + lc + '\\right)=' + ld)
  if (delta.numerator < 0n) {
    return { kind: 'no-real', delta: deltaText, roots: [], steps: [...steps, '\\text{Sem raízes reais}'] }
  }

  const twiceA = multiply(rational(2n), a)
  const offset = divide(negate(b), twiceA)
  const denominator = '2\\cdot\\left(' + la + '\\right)'
  if (delta.numerator === 0n) {
    const root = rationalRoot(offset)
    steps.push(
      'x=\\frac{-b}{2a}=\\frac{' + rationalLatex(negate(b)) + '}{' + denominator + '}',
      approximateRationalRoot('x_1=x_2', offset, root),
    )
    return { kind: 'double', delta: deltaText, roots: [root], steps }
  }

  const { factor, radicand } = rationalRadical(delta)
  const term = divide(factor, twiceA)
  steps.push('x=\\frac{-b\\pm\\sqrt{\\Delta}}{2a}=\\frac{' + rationalLatex(negate(b)) + '\\pm\\sqrt{' + ld + '}}{' + denominator + '}')
  if (radicand === 1n) {
    const values = [add(offset, term), add(offset, negate(term))]
    const roots = values.map(rationalRoot)
    values.forEach((value, index) => steps.push(approximateRationalRoot('x_' + (index + 1), value, roots[index])))
    return { kind: 'two-real', delta: deltaText, roots, steps }
  }

  // Compute the two approximations without subtracting nearly equal numbers.
  const approxB = rationalNumber(b)
  const approxSqrt = Math.sqrt(rationalNumber(delta))
  const stable = -(approxB + (b.numerator < 0n ? -approxSqrt : approxSqrt)) / 2
  const firstApprox = stable / rationalNumber(a)
  const secondApprox = rationalNumber(c) / stable
  const [plusApprox, minusApprox] = b.numerator < 0n ? [firstApprox, secondApprox] : [secondApprox, firstApprox]
  const positive = radicalRoot(offset, term, radicand, plusApprox)
  const negative = radicalRoot(offset, negate(term), radicand, minusApprox)
  const roots = [positive, negative].map(({ exact, decimal, latex }, index) => {
    steps.push('x_' + (index + 1) + '=' + latex + '\\approx' + decimalLatex(decimal))
    return { exact, decimal }
  })
  return { kind: 'two-real', delta: deltaText, roots, steps }
}
