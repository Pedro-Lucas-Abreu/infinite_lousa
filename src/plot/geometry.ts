import type { Point } from '../core/types'
import { parsePlotExpression, type PlotExpression } from './expression'

export interface PlotSettings {
  readonly xmin: number
  readonly xmax: number
  readonly ymin: number
  readonly ymax: number
  readonly step: number
  readonly lockAspect: boolean
}

export interface PlotFunction {
  readonly expression: string
  readonly color: string
}

export type PlotPoint = Point
export interface PlotLine {
  readonly from: PlotPoint
  readonly to: PlotPoint
}

export interface PlotLabel extends PlotPoint {
  readonly text: string
  readonly align: 'left' | 'center' | 'right'
}

interface PlotArea {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

interface PlotCurve {
  readonly color: string
  readonly paths: readonly (readonly PlotPoint[])[]
}

export interface PlotGeometry {
  readonly area: PlotArea
  readonly grid: readonly PlotLine[]
  readonly axes: readonly PlotLine[]
  readonly labels: readonly PlotLabel[]
  readonly curves: readonly PlotCurve[]
  readonly fontSize: number
}

export const MAX_PLOT_FUNCTIONS = 12
const MAX_TICK_INTERVALS = 160
const MAX_ASPECT_RATIO = 1e12
const BASE_INTERVALS = 48
const MAX_SUBDIVISION = 8
const CURVE_TOLERANCE = 0.0015

export const DEFAULT_PLOT_SETTINGS: PlotSettings = {
  xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, lockAspect: true,
}

export function validatePlotSettings(settings: PlotSettings): string | undefined {
  const { xmin, xmax, ymin, ymax, step, lockAspect } = settings
  const xSpan = xmax - xmin
  const ySpan = ymax - ymin
  if (![xmin, xmax, ymin, ymax, xSpan, ySpan].every(Number.isFinite) || xSpan <= 0 || ySpan <= 0) {
    return 'Em cada eixo, informe um mínimo e um máximo finitos, com o mínimo menor que o máximo.'
  }
  if (!Number.isFinite(step) || step <= 0) return 'Informe um passo numérico maior que zero.'
  if (Math.max(xSpan, ySpan) / step > MAX_TICK_INTERVALS) {
    return `Aumente o passo para manter até ${MAX_TICK_INTERVALS} intervalos por eixo.`
  }
  if ([xmin, xmax, ymin, ymax].some((value) => Math.abs(value / step) > Number.MAX_SAFE_INTEGER)) {
    return 'A distância entre as marcas é pequena demais para os valores informados.'
  }
  if (typeof lockAspect !== 'boolean') return 'Confira a opção de proporção 1:1.'
  if (lockAspect && (xSpan / ySpan > MAX_ASPECT_RATIO || ySpan / xSpan > MAX_ASPECT_RATIO)) {
    return 'Os intervalos dos eixos são diferentes demais para usar a proporção 1:1.'
  }
  return undefined
}

function plotArea(settings: PlotSettings, width: number, height: number, fontSize: number,
  labelWidths: { x: number; y: number }): PlotArea {
  const horizontalMargin = Math.max(3, labelWidths.y * 0.6 + 1, labelWidths.x * 0.3 + 0.5) * fontSize
  const maxWidth = width - 2 * horizontalMargin
  const maxHeight = height - 4.5 * fontSize
  const unitsRatio = (settings.xmax - settings.xmin) / (settings.ymax - settings.ymin)
  const plotWidth = settings.lockAspect ? Math.min(maxWidth, maxHeight * unitsRatio) : maxWidth
  const plotHeight = settings.lockAspect ? Math.min(maxHeight, maxWidth / unitsRatio) : maxHeight
  const left = (width - plotWidth) / 2
  const top = (height - plotHeight) / 2
  return { left, right: left + plotWidth, top, bottom: top + plotHeight }
}

function unitFraction(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

interface Tick {
  readonly value: number
  readonly text: string
}

function ticks(min: number, max: number, step: number): Tick[] {
  const first = min / step
  const last = max / step
  const tickTolerance = (index: number) => Math.min(0.25, Math.abs(index) * 2 * Number.EPSILON)
  const lower = Math.max(-Number.MAX_SAFE_INTEGER, Math.ceil(first - tickTolerance(first)))
  const upper = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(last + tickTolerance(last)))
  const count = Math.min(MAX_TICK_INTERVALS + 2, upper - lower + 1)
  const marks: Tick[] = []
  for (let offset = 0; offset < count; offset++) {
    const index = lower + offset
    const value = index === 0 ? 0 : index * step
    if (Number.isFinite(value)) marks.push({ value, text: formatTick(value, step) })
  }
  return marks
}

function formatTick(value: number, step: number): string {
  const magnitude = Math.abs(value)
  const places = Math.ceil(Math.log10(magnitude / step))
  if (magnitude && (magnitude >= 1_000_000 || magnitude < 0.0001)) {
    const [mantissa, exponent] = value.toExponential(Math.max(2, places)).split('e')
    return `${Number(mantissa)}e${exponent}`
  }
  return String(Number(value.toPrecision(Math.max(15, places + 1))))
}

function appendLine(lines: PlotLine[], x1: number, y1: number, x2: number, y2: number) {
  lines.push({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 } })
}

function gridGeometry(settings: PlotSettings, area: PlotArea, fontSize: number,
  xTicks: readonly Tick[], yTicks: readonly Tick[], maxXLabelLength: number) {
  const { xmin, xmax, ymin, ymax, step } = settings
  const { left, top, right, bottom } = area
  const width = right - left
  const height = bottom - top
  const xAt = (value: number) => left + width * unitFraction(value, xmin, xmax)
  const yAt = (value: number) => top + height * unitFraction(value, ymax, ymin)
  const hasHorizontalAxis = ymin <= 0 && ymax >= 0
  const hasVerticalAxis = xmin <= 0 && xmax >= 0
  const horizontalY = hasHorizontalAxis ? yAt(0) : bottom
  const verticalX = hasVerticalAxis ? xAt(0) : left
  const tick = fontSize * 0.23
  const grid: PlotLine[] = []
  const axes: PlotLine[] = []
  const labels: PlotLabel[] = []

  if (hasHorizontalAxis) {
    appendLine(axes, left, horizontalY, right, horizontalY)
    appendLine(axes, right - 3 * tick, horizontalY - tick * 1.5, right, horizontalY)
    appendLine(axes, right - 3 * tick, horizontalY + tick * 1.5, right, horizontalY)
    labels.push({ x: right + fontSize * 0.45, y: horizontalY + tick, text: 'x', align: 'left' })
  }
  if (hasVerticalAxis) {
    appendLine(axes, verticalX, bottom, verticalX, top)
    appendLine(axes, verticalX - tick * 1.5, top + 3 * tick, verticalX, top)
    appendLine(axes, verticalX + tick * 1.5, top + 3 * tick, verticalX, top)
    labels.push({ x: verticalX, y: top - fontSize * 0.7, text: 'y', align: 'center' })
  }

  const xLabelStride = Math.max(1, Math.ceil((maxXLabelLength * 0.58 + 0.6) * fontSize / (width * (step / (xmax - xmin)))))
  const yLabelStride = Math.max(1, Math.ceil(1.45 * fontSize / (height * (step / (ymax - ymin)))))

  for (const [index, { value, text }] of xTicks.entries()) {
    const x = xAt(value)
    if (value !== 0 || !hasVerticalAxis) appendLine(grid, x, top, x, bottom)
    appendLine(axes, x, horizontalY - tick, x, horizontalY + tick)
    if (value === 0 || index % xLabelStride === 0) {
      labels.push({ x: x + (value === 0 && hasVerticalAxis ? fontSize * 0.55 : 0),
        y: horizontalY + fontSize * 1.23, text, align: 'center' })
    }
  }
  for (const [index, { value, text }] of yTicks.entries()) {
    const y = yAt(value)
    if (value !== 0 || !hasHorizontalAxis) appendLine(grid, left, y, right, y)
    appendLine(axes, verticalX - tick, y, verticalX + tick, y)
    if ((value !== 0 || !hasVerticalAxis) && index % yLabelStride === 0) {
      labels.push({ x: verticalX - fontSize * 0.5, y: y + tick, text, align: 'right' })
    }
  }
  return { grid, axes, labels }
}

interface Sample {
  readonly t: number
  readonly v: number
  readonly branch: string
}

function clipSegment(a: Sample, b: Sample, area: PlotArea): [PlotPoint, PlotPoint] | undefined {
  const delta = b.v - a.v
  let start = 0
  let end = 1
  if (delta === 0) {
    if (a.v < 0 || a.v > 1) return undefined
  } else {
    const atTop = -a.v / delta
    const atBottom = (1 - a.v) / delta
    start = Math.max(0, Math.min(atTop, atBottom))
    end = Math.min(1, Math.max(atTop, atBottom))
    if (start >= end) return undefined
  }
  const pointAt = (part: number): PlotPoint => {
    const t = part === 1 ? b.t : a.t + (b.t - a.t) * part
    const v = part === 1 ? b.v : a.v + delta * part
    return {
      x: area.left + (area.right - area.left) * t,
      y: area.top + (area.bottom - area.top) * Math.min(1, Math.max(0, v)),
    }
  }
  return [pointAt(start), pointAt(end)]
}

function sampleCurve(evaluate: PlotExpression, settings: PlotSettings, area: PlotArea): PlotCurve['paths'] {
  const { xmin, xmax, ymin, ymax } = settings
  const paths: PlotPoint[][] = []
  let active: PlotPoint[] | undefined

  function at(t: number): Sample {
    const branches: number[] = []
    const y = evaluate(t === 1 ? xmax : xmin + t * (xmax - xmin), branches)
    const v = (ymax - y) / (ymax - ymin)
    return { t, v: Math.max(-1e6, Math.min(1e6, v)), branch: branches.join() }
  }

  function append(a: Sample, b: Sample) {
    const segment = clipSegment(a, b, area)
    if (!segment) {
      active = undefined
      return
    }
    const [start, end] = segment
    const tail = active?.at(-1)
    if (active && tail?.x === start.x && tail.y === start.y) active.push(end)
    else {
      active = [start, end]
      paths.push(active)
    }
  }

  function trace(a: Sample, m: Sample, b: Sample, depth: number) {
    const q1 = at((a.t + m.t) / 2)
    const q3 = at((m.t + b.t) / 2)
    const samples = [a, q1, m, q3, b]
    if (samples.every(({ v }) => Number.isNaN(v))) {
      active = undefined
      return
    }
    const oneBranch = samples.every(({ v, branch }) => Number.isFinite(v) && branch === a.branch)
    if (oneBranch) {
      const deviation = Math.max(...samples.slice(1, -1).map(({ v }, index) =>
        Math.abs(v - (a.v + (b.v - a.v) * (index + 1) / 4))))
      if (deviation <= CURVE_TOLERANCE) {
        append(a, b)
        return
      }
    }
    if (depth < MAX_SUBDIVISION) {
      trace(a, q1, m, depth + 1)
      trace(m, q3, b, depth + 1)
    } else if (oneBranch) {
      for (let index = 1; index < samples.length; index++) append(samples[index - 1], samples[index])
    } else {
      active = undefined
    }
  }

  let previous = at(0)
  for (let index = 1; index <= BASE_INTERVALS; index++) {
    const next = at(index / BASE_INTERVALS)
    trace(previous, at((previous.t + next.t) / 2), next, 0)
    previous = next
  }
  return paths
}

export function getPlotGeometry(settings: PlotSettings, width: number, height: number,
  functions: readonly PlotFunction[]): PlotGeometry {
  const error = validatePlotSettings(settings)
  if (error) throw new Error(error)
  const { xmin, xmax, ymin, ymax, step } = settings
  const xTicks = ticks(xmin, xmax, step)
  const yTicks = ticks(ymin, ymax, step)
  const labelWidths = {
    x: Math.max(1, ...xTicks.map(({ text }) => text.length)),
    y: Math.max(1, ...yTicks.map(({ text }) => text.length)),
  }
  const fontSize = Math.min(width / Math.max(36, 1.8 * labelWidths.y), height / 23)
  const area = plotArea(settings, width, height, fontSize, labelWidths)
  if (!(fontSize > 0 && area.right > area.left && area.bottom > area.top)) {
    return { area, fontSize, grid: [], axes: [], labels: [], curves: [] }
  }
  const curves = functions.map(({ expression, color }) => ({
    color, paths: sampleCurve(parsePlotExpression(expression), settings, area),
  }))
  return { area, fontSize, ...gridGeometry(settings, area, fontSize, xTicks, yTicks, labelWidths.x), curves }
}
