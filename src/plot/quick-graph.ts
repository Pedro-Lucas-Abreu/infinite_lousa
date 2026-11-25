import { parsePlotExpression } from './expression'
import type { PlotFunction } from './geometry'

export const PLOT_NOT_VISIBLE = 'A função não aparece nesta escala. Ajuste os limites dos eixos.'

const curveColors = ['#2158ad', '#bd3b47', '#177345', '#864997', '#ac5a21', '#247784']

export function nextPlotColor(functions: readonly Pick<PlotFunction, 'color'>[]): string {
  return curveColors.find((color) => functions.every((entry) => entry.color.toLowerCase() !== color))
    ?? curveColors[functions.length % curveColors.length]
}

export function readGraphExpression(value: string): string {
  const source = value.trim()
  const expression = source.replace(/^y\s*=\s*/i, '')
  if (!expression) throw new Error('Digite uma função de x.')
  try {
    if (/\+\s*\+/.test(expression)) throw new Error()
    parsePlotExpression(expression)
  } catch {
    const example = source.length > 40 ? `${source.slice(0, 39)}…` : source
    throw new Error(`Não entendi ${example}.`)
  }
  return expression
}
