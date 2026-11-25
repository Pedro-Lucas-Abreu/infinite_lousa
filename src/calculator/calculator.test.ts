import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCalculatorExpression } from '../plot/expression'
import {
  appendCalculatorInput, applyCalculatorUnary, backspaceCalculator, calculate, clearCalculator, displayCalculatorExpression,
  emptyCalculator, formatCalculatorNumber, parsePastedNumber, pasteCalculatorNumber,
} from './calculator'

const degrees = { angleUnit: 'degrees' } as const
const evaluate = (source: string) => evaluateCalculatorExpression(source, degrees)

test('calculates scientific operations and keeps operator precedence', () => {
  const expressions: [string, number][] = [
    ['2^3^2', 512], ['2^3!', 64], ['-3!', -6], ['0!', 1], ['5!', 120],
    ['11 mod 4 + 1', 4], ['7mod3', 1], ['-5 % 3', 1],
    ['cbrt(-27)', -3], ['sqrt(49)', 7], ['log(100)', 2], ['log2(8)', 3],
    ['ln(e)', 1], ['exp(2)', Math.exp(2)], ['2E3 ÷ 4', 500], ['|x|', NaN],
    ['-2,2 + abs(-3) × 2', 3.8], ['sin(30)', 0.5], ['cos(60)', 0.5], ['tan(45)', 1],
  ]
  for (const [source, result] of expressions) {
    if (Number.isNaN(result)) assert.throws(() => evaluate(source))
    else assert.ok(Math.abs(evaluate(source) - result) < 1e-12, source)
  }
  assert.equal(evaluateCalculatorExpression('sin(π/2)', { angleUnit: 'radians' }), 1)
})

test('explains errors from arithmetic and rejects unsupported expressions', () => {
  for (const source of ['1/0', '5 mod 0', '0^(-2)']) assert.throws(() => evaluate(source), /Divisão por zero/)
  for (const source of ['sqrt(-1)', 'log(0)', 'ln(-1)', 'log2(0)', 'tan(90)', '(-1)!', '1.5!', 'sqrt(-1)^0']) {
    assert.throws(() => evaluate(source), /Domínio inválido/)
  }
  assert.throws(() => evaluate('171!'), /intervalo/)
  assert.throws(() => evaluate('2E'), /expoente/)
  assert.throws(() => evaluate('x'), /Nome desconhecido/)
  assert.throws(() => evaluate('constructor(0)'), /Nome desconhecido/)
})

test('formats the answer in Portuguese while continuing calculations at full precision', () => {
  assert.equal(formatCalculatorNumber(evaluate('0,1+0.2')), '0,3')
  assert.equal(formatCalculatorNumber(1 / 3), '0,333333333333')
  const fraction = calculate(appendCalculatorInput(emptyCalculator, '1/3'), 'degrees')
  const next = appendCalculatorInput(appendCalculatorInput(fraction, '*'), '3')
  assert.equal(displayCalculatorExpression(next), '(0,333333333333)×3')
  assert.equal(calculate(next, 'degrees').result, 1)
  const negative = calculate(appendCalculatorInput(emptyCalculator, '-2'), 'degrees')
  const power = appendCalculatorInput(appendCalculatorInput(negative, '^'), '2')
  assert.equal(calculate(power, 'degrees').result, 4)
})

test('applies scientific buttons to the active operand', () => {
  const number = appendCalculatorInput(emptyCalculator, '6/3')
  assert.equal(calculate(applyCalculatorUnary(number, 'inverse'), 'degrees').result, 18)
  const square = applyCalculatorUnary(appendCalculatorInput(emptyCalculator, '2+3'), 'square')
  assert.equal(calculate(square, 'degrees').result, 11)
  const signed = applyCalculatorUnary(applyCalculatorUnary(number, 'negate'), 'negate')
  assert.equal(calculate(signed, 'degrees').result, 2)
  const root = applyCalculatorUnary(emptyCalculator, 'sqrt')
  assert.equal(calculate(appendCalculatorInput(root, '9)'), 'degrees').result, 3)
})

test('pastes a number and preserves the original expression on an error', () => {
  assert.equal(parsePastedNumber(' −0.5e2 '), '-0,5e2')
  assert.equal(parsePastedNumber('1+2'), undefined)
  assert.equal(parsePastedNumber('1e999'), undefined)
  const started = appendCalculatorInput(emptyCalculator, '7+4')
  const pasted = pasteCalculatorNumber(started, '3,25')
  assert.equal(pasted.source, '7+3,25')
  assert.equal(calculate(pasted, 'degrees').result, 10.25)
  const invalid = pasteCalculatorNumber(pasted, 'alert(1)')
  assert.equal(invalid.source, pasted.source)
  assert.match(invalid.error ?? '', /número válido/)
  assert.equal(backspaceCalculator(pasted).source, '7+3,2')
})

test('limits history to ten successful operations and keeps it when cleared', () => {
  let state = emptyCalculator
  for (let i = 0; i < 14; i++) state = calculate(appendCalculatorInput(state, String(i)), 'degrees')
  assert.deepEqual(state.history.map(({ result }) => result), [13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
  assert.equal(calculate(state, 'degrees'), state)
  state = calculate(appendCalculatorInput(clearCalculator(state), '1/0'), 'degrees')
  assert.equal(state.history.length, 10)
  assert.match(state.error ?? '', /Divisão por zero/)
  assert.equal(clearCalculator(state).source, '')
})
