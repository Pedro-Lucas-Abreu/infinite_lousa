import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PLOT_EXPRESSION_LENGTH, parsePlotExpression } from './expression'
import { DEFAULT_PLOT_SETTINGS, getPlotGeometry, validatePlotSettings, type PlotSettings } from './geometry'

test('interprets classroom expressions with decimal comma, implicit products, and standard precedence', () => {
  const examples: [string, number, number][] = [
    ['2x+1', 3, 7],
    ['2,5x + .5', 2, 5.5],
    ['2(x+1)(x-1)', 3, 16],
    ['3cos(x) + 2sqrt(x+4)', 0, 7],
    ['-x^2 + 2^-2', 2, -3.75],
    ['2^3^2', 0, 512],
    ['log(x)', 100, 2],
    ['ln(e)', 0, 1],
    ['log(0,01)', 0, -2],
    ['sin(pi/2)', 0, 1],
    ['abs(x)', -5, 5],
    ['1/x', -2, -0.5],
    ['2^x', 4, 16],
    ['1,5e-2 x', 4, 0.06],
  ]
  for (const [expression, x, expected] of examples) {
    assert.ok(Math.abs(parsePlotExpression(expression)(x) - expected) < 1e-12, expression)
  }
})

test('limits input to numeric expressions and detects undefined values', () => {
  for (const invalid of ['x.constructor', 'globalThis', 'sqrt x', 'x;alert(1)', '2^', '(3+x', '2 3', '1,2,3', 'sin()', '']) {
    assert.throws(() => parsePlotExpression(invalid), Error, invalid)
  }
  assert.throws(() => parsePlotExpression('x'.repeat(MAX_PLOT_EXPRESSION_LENGTH + 1)), /longa/)
  for (const [expression, x] of [['sqrt(x)', -1], ['log(x)', 0], ['ln(x)', -1], ['1/x', 0], ['tan(x)', Math.PI / 2]] as const) {
    assert.ok(Number.isNaN(parsePlotExpression(expression)(x)), expression)
  }
})

test('plot settings reject reversed, empty, infinite, or excessively dense ranges', () => {
  assert.equal(validatePlotSettings(DEFAULT_PLOT_SETTINGS), undefined)
  assert.match(validatePlotSettings({ ...DEFAULT_PLOT_SETTINGS, xmin: 10 }) ?? '', /mínimo/)
  assert.match(validatePlotSettings({ ...DEFAULT_PLOT_SETTINGS, ymax: Infinity }) ?? '', /finito/)
  assert.match(validatePlotSettings({ ...DEFAULT_PLOT_SETTINGS, step: 0 }) ?? '', /maior que zero/)
  assert.match(validatePlotSettings({ ...DEFAULT_PLOT_SETTINGS, step: 0.001 }) ?? '', /intervalos/)
  assert.match(validatePlotSettings({ ...DEFAULT_PLOT_SETTINGS, xmin: 1e16, xmax: 1e16 + 4 }) ?? '', /distância/)
})

const settings: PlotSettings = { xmin: -4.2, xmax: 5.7, ymin: -3.2, ymax: 4.8, step: 1, lockAspect: false }
const plot = (expressions: readonly string[], options = settings) => getPlotGeometry(options, 520, 320,
  expressions.map((expression, index) => ({ expression, color: index === 0 ? '#123456' : '#654321' })))

test('builds numbered axes, preserves equal units when selected, and keeps labels distinct', () => {
  const locked = plot([], { ...settings, lockAspect: true })
  const dx = (locked.area.right - locked.area.left) / (settings.xmax - settings.xmin)
  const dy = (locked.area.bottom - locked.area.top) / (settings.ymax - settings.ymin)
  assert.ok(Math.abs(dx - dy) < 1e-10)
  const unlocked = plot([])
  const dxUnlocked = (unlocked.area.right - unlocked.area.left) / (settings.xmax - settings.xmin)
  assert.notEqual(dx, dxUnlocked)
  assert.ok(unlocked.axes.length > 7)
  assert.ok(unlocked.grid.length > 7)
  assert.ok(['x', 'y', '0', '2', '-1'].every((text) => unlocked.labels.some((label) => label.text === text)))

  const zoomed = plot([], { xmin: -2, xmax: 2, ymin: 1_000_000, ymax: 1_000_003, step: 1, lockAspect: false })
  assert.ok(zoomed.labels.some(({ text }) => text === '1.000001e+6'))
  assert.ok(zoomed.labels.some(({ text }) => text === '1.000003e+6'))
})

test('plots a bounded number of ticks near both safe integer extremes', () => {
  const near = Number.MAX_SAFE_INTEGER
  for (const bounds of [{ xmin: near - 3, xmax: near }, { xmin: -near, xmax: -near + 3 }]) {
    const commands = plot([], { ...settings, ...bounds })
    const vertical = commands.grid.filter(({ from, to }) => from.x === to.x)
    assert.equal(vertical.length, 4)
    assert.equal(new Set(vertical.map(({ from }) => from.x)).size, 4)
  }
})

test('offers unlocked plotting when an axis would collapse at equal scale', () => {
  const extreme = { ...settings, xmin: 0, xmax: 1e-20, lockAspect: true }
  assert.match(validatePlotSettings(extreme) ?? '', /proporção 1:1/)
  const unlocked = plot(['x'], { ...extreme, lockAspect: false })
  assert.ok(unlocked.area.right > unlocked.area.left)
  assert.equal(unlocked.curves[0].paths.length, 1)
  const tiny = getPlotGeometry(DEFAULT_PLOT_SETTINGS, 1e308, 1e-308, [{ expression: 'x', color: '#123456' }])
  assert.ok([tiny.area.left, tiny.area.right, tiny.area.top, tiny.area.bottom].every(Number.isFinite))
  assert.equal(tiny.curves.length, 0)
})

test('clips function paths and separates reciprocal and tangent branches away from the sampling grid', () => {
  const { curves, area } = plot(['1/x', 'tan(x)'])
  const localX = (x: number) => area.left + (x - settings.xmin) / (settings.xmax - settings.xmin) * (area.right - area.left)
  const poles = [[0], [-Math.PI / 2, Math.PI / 2, 3 * Math.PI / 2]]
  assert.deepEqual(curves.map(({ color }) => color), ['#123456', '#654321'])
  assert.deepEqual(curves.map(({ paths }) => paths.length), [2, 4])
  curves.forEach(({ paths }, index) => {
    for (const path of paths) {
      assert.ok(poles[index].every((pole) => path[0].x >= localX(pole) || path.at(-1)!.x <= localX(pole)))
      for (const { x, y } of path) {
        assert.ok(x >= area.left && x <= area.right && y >= area.top && y <= area.bottom)
      }
    }
  })
})

test('leaves undefined domains empty and subdivides more near steep curves', () => {
  const { area, curves } = plot(['sqrt(x)', 'ln(x)', '1/(x-x)', 'x', 'sqrt(abs(x))'])
  const zero = area.left - settings.xmin * (area.right - area.left) / (settings.xmax - settings.xmin)
  for (const { paths } of curves.slice(0, 2)) {
    assert.equal(paths.length, 1)
    assert.ok(paths[0][0].x >= zero - 1e-8)
  }
  assert.equal(curves[2].paths.length, 0)
  assert.ok(curves[4].paths[0].length > curves[3].paths[0].length)
})
