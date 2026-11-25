import assert from 'node:assert/strict'
import test from 'node:test'
import { renderEquation } from '../equations/render'
import { parseQuadraticEquation, solveQuadratic } from './solve'

const solve = (equation: string) => solveQuadratic(parseQuadraticEquation(equation))

test('reads reordered terms on both sides, spaces, superscripts, fractions, and decimal comma exactly', () => {
  assert.deepEqual(parseQuadraticEquation('X ²  −  5x + 6 = 0'), { a: '1', b: '-5', c: '6' })
  assert.deepEqual(parseQuadraticEquation('2x^2 + 3x = 5'), { a: '2', b: '3', c: '-5' })
  assert.deepEqual(parseQuadraticEquation('2 + (3/2) × x ^ 2 = 0,5 x - 1/3'), {
    a: '3/2', b: '-1/2', c: '7/3',
  })
  assert.deepEqual(parseQuadraticEquation('x² + 3x = 2x² + x + 3'), { a: '-1', b: '2', c: '-3' })
  assert.deepEqual(parseQuadraticEquation('x² - 4'), { a: '1', b: '0', c: '-4' })
})

test('rejects malformed polynomial terms and zero denominators', () => {
  for (const expression of ['', 'x^3=0', 'x²=3=1', 'x² ++ 2x=0', '2/x=0', '(x+1)^2=0']) {
    assert.throws(() => parseQuadraticEquation(expression), /equação|termos/i, expression)
  }
  assert.throws(() => parseQuadraticEquation('1/0x²=0'), /denominador/)
  assert.throws(() => solveQuadratic({ a: '0', b: '1/0', c: '1' }), /denominador/)
  assert.throws(() => solveQuadratic({ a: '1..2', b: '1', c: '1' }), /decimal/)
})

test('solves the rational classroom examples and keeps exact fractions', () => {
  const examples = [
    ['x²-5x+6=0', '1', ['3', '2']],
    ['x²-4=0', '16', ['2', '-2']],
    ['2x²+3x-5=0', '49', ['1', '-5/2']],
    ['1/2x² + (3/4)x = 0', '9/16', ['0', '-3/2']],
  ] as const
  for (const [input, delta, expected] of examples) {
    const result = solve(input)
    assert.equal(result.kind, 'two-real')
    assert.equal(result.delta, delta)
    assert.deepEqual(result.roots.map((root) => root.exact), expected)
    assert.equal(result.steps.length, 5)
  }
  assert.deepEqual(solve('2x²+3x=5').roots[1], { exact: '-5/2', decimal: '-2,5' })
  assert.match(solve('2x²+3x=5').steps[4], /\\frac\{5\}\{2\}=-2\{,\}5/)
})

test('classifies duplicate and absent real roots without floating-point discriminant errors', () => {
  const double = solve('x²+2x+1=0')
  assert.equal(double.kind, 'double')
  assert.equal(double.delta, '0')
  assert.deepEqual(double.roots, [{ exact: '-1', decimal: '-1' }])
  assert.match(double.steps.at(-1)!, /x_1=x_2=-1/)
  assert.equal(solve('0,1x²+0,2x+0,1=0').kind, 'double')
  const noReal = solve('x²+1=0')
  assert.equal(noReal.kind, 'no-real')
  assert.equal(noReal.delta, '-4')
  assert.deepEqual(noReal.roots, [])
  assert.match(noReal.steps.at(-1)!, /Sem raízes reais/)
})

test('simplifies integer and rational radicals and avoids cancellation in the decimal answer', () => {
  assert.deepEqual(solve('x²-2=0').roots, [
    { exact: '√2', decimal: '1,41421356237' }, { exact: '-√2', decimal: '-1,41421356237' },
  ])
  assert.deepEqual(solve('x²-12=0').roots.map((root) => root.exact), ['2√3', '-2√3'])
  assert.deepEqual(solve('x²-1/8=0').roots.map((root) => root.exact), ['√2/4', '-√2/4'])
  assert.equal(solve('x²+1000000000000000x+1=0').roots[0].decimal, '-1E-15')
})

test('solves first-degree, constant and identity equations', () => {
  const linear = solveQuadratic({ a: '0', b: '3/2', c: '-0,5' })
  assert.equal(linear.kind, 'linear')
  assert.equal(linear.delta, undefined)
  assert.deepEqual(linear.roots, [{ exact: '1/3', decimal: '0,333333333333' }])
  assert.equal(solve('x²=x²+1').kind, 'none')
  assert.equal(solve('2x=2x').kind, 'identity')
})

test('renders the resolution as separate editable vector equations for each outcome', async () => {
  for (const expression of ['x²-2=0', 'x²+1=0', '3/2x=1/2', '0=1', 'x=x']) {
    const result = solve(expression)
    for (const latex of result.steps) {
      const vector = await renderEquation(latex, 24).catch((cause) => { throw new Error(latex, { cause }) })
      assert.ok(vector.width > 0 && vector.height > 0 && vector.paths.length > 0, latex)
    }
  }
})
