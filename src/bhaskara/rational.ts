export interface Rational {
  readonly numerator: bigint
  readonly denominator: bigint
}

export const maxCoefficientDigits = 48
export const unsignedDecimal = String.raw`(?:\d+(?:[.,]\d*)?|[.,]\d+)`
const signedDecimal = new RegExp(`^[+-]?${unsignedDecimal}$`)

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new Error('O denominador deve ser diferente de zero.')
  const divisor = gcd(absolute(numerator), absolute(denominator))
  return {
    numerator: numerator / (denominator < 0n ? -divisor : divisor),
    denominator: absolute(denominator) / divisor,
  }
}

export function add(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator)
}

export function negate(value: Rational): Rational {
  return { ...value, numerator: -value.numerator }
}

export function multiply(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator)
}

export function divide(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator)
}

function parseDecimal(source: string): Rational {
  if (!signedDecimal.test(source)) throw new Error('Use um número decimal ou uma fração.')
  const [whole, fractional = ''] = source.replace(/^[+-]/, '').split(/[.,]/)
  const digits = whole + fractional
  if (digits.length > maxCoefficientDigits) throw new Error('O coeficiente tem dígitos demais.')
  const sign = source.startsWith('-') ? -1n : 1n
  return rational(sign * BigInt(digits), 10n ** BigInt(fractional.length))
}

export function parseCoefficient(source: string): Rational {
  const [numerator, denominator, ...rest] = source.trim().replace(/−/g, '-').split('/').map((part) => part.trim())
  if (rest.length) throw new Error('Use uma fração com um único denominador.')
  const value = parseDecimal(numerator)
  return denominator === undefined ? value : divide(value, parseDecimal(denominator))
}

export function rationalText({ numerator, denominator }: Rational): string {
  return denominator === 1n ? String(numerator) : `${numerator}/${denominator}`
}

export function rationalLatex({ numerator, denominator }: Rational): string {
  if (denominator === 1n) return String(numerator)
  return `${numerator < 0n ? '-' : ''}\\frac{${absolute(numerator)}}{${denominator}}`
}

export function rationalNumber({ numerator, denominator }: Rational): number {
  return Number(numerator) / Number(denominator)
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2))
  for (;;) {
    const next = (root + value / root) / 2n
    if (next >= root) return root
    root = next
  }
}

function extractSquareFactors(value: bigint): { factor: bigint; radicand: bigint } {
  let factor = 1n
  let radicand = 1n
  let remaining = value
  // Remove classroom-sized prime factors and any remaining perfect square. If
  // a large composite stays inside the radical, the result is still exact.
  for (let prime = 2n; prime <= 10_000n && prime * prime <= remaining; prime += prime === 2n ? 1n : 2n) {
    let exponent = 0
    while (remaining % prime === 0n) {
      remaining /= prime
      exponent++
    }
    if (exponent % 2) radicand *= prime
    factor *= prime ** BigInt(Math.floor(exponent / 2))
  }
  const squareRoot = integerSquareRoot(remaining)
  if (squareRoot * squareRoot === remaining) factor *= squareRoot
  else radicand *= remaining
  return { factor, radicand }
}

export function rationalRadical(value: Rational): { factor: Rational; radicand: bigint } {
  const numeratorRoot = integerSquareRoot(value.numerator)
  const denominatorRoot = integerSquareRoot(value.denominator)
  if (numeratorRoot * numeratorRoot === value.numerator && denominatorRoot * denominatorRoot === value.denominator) {
    return { factor: rational(numeratorRoot, denominatorRoot), radicand: 1n }
  }
  const numerator = extractSquareFactors(value.numerator)
  const denominator = extractSquareFactors(value.denominator)
  return {
    factor: rational(numerator.factor, denominator.factor * denominator.radicand),
    radicand: numerator.radicand * denominator.radicand,
  }
}
