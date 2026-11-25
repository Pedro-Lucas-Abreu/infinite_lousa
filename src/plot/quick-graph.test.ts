import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPlotGeometry } from './geometry'
import { nextPlotColor, readGraphExpression } from './quick-graph'

test('quick graph accepts a function with or without y=', () => {
  assert.equal(readGraphExpression('x^2 - 4'), 'x^2 - 4')
  assert.equal(readGraphExpression('  Y = x^2 - 4  '), 'x^2 - 4')
  assert.equal(readGraphExpression('y=2x^-2 + 1,5x'), '2x^-2 + 1,5x')
})

test('quick graph rejects invalid functions with a message that preserves the input', () => {
  for (const source of ['2x++1', '2x+ +1', 'x = y', 'y = desconhecida(x)', 'alert(1)', 'x^']) {
    assert.throws(() => readGraphExpression(source), { message: `Não entendi ${source}.` })
  }
  assert.throws(() => readGraphExpression('y = '), { message: 'Digite uma função de x.' })
})

test('the plot geometry distinguishes visible curves from those outside the scale', () => {
  const settings = { xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, lockAspect: true }
  const first = { expression: readGraphExpression('x^2 - 4'), color: nextPlotColor([]) }
  const outside = { expression: readGraphExpression('y = x^2 + 100'), color: nextPlotColor([first]) }
  const { curves } = getPlotGeometry(settings, 400, 400, [first, outside])
  assert.ok(curves[0].paths.length > 0)
  assert.equal(curves[1].paths.length, 0)
  assert.notEqual(first.color, outside.color)
})
