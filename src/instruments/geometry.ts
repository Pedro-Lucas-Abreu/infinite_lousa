import type { Affine, Point } from '../core/types'

export const instrumentKinds = ['ruler', 'set-square-45', 'set-square-30', 'protractor', 'compass'] as const
export type InstrumentKind = (typeof instrumentKinds)[number]

export interface InstrumentEdge {
  readonly start: Point
  readonly end: Point
}

export interface InstrumentPlacement {
  readonly props: { readonly kind: InstrumentKind; readonly width: number; readonly height: number }
  readonly transform: Affine
}

export interface InstrumentPath {
  readonly points: readonly Point[]
  readonly closed?: boolean
  readonly fill?: boolean
  readonly weight?: 'minor' | 'major'
}

export interface InstrumentLabel extends Point {
  readonly text: string
  readonly align: 'left' | 'center' | 'right'
  readonly size: number
}

export interface InstrumentGeometry {
  readonly paths: readonly InstrumentPath[]
  readonly labels: readonly InstrumentLabel[]
  readonly edges: readonly InstrumentEdge[]
}

const pixelsPerCentimeter = 96 / 2.54
const rulerMargin = 10
const rulerCentimeters = 10
const dimensions: Record<InstrumentKind, { width: number; height: number }> = {
  ruler: { width: rulerCentimeters * pixelsPerCentimeter + 2 * rulerMargin, height: 58 },
  'set-square-45': { width: 230, height: 230 },
  'set-square-30': { width: 280, height: 280 / Math.sqrt(3) },
  protractor: { width: 340, height: 177 },
  compass: { width: 144, height: 144 },
}

export function isInstrumentKind(value: unknown): value is InstrumentKind {
  return instrumentKinds.some((kind) => kind === value)
}

export function instrumentDimensions(kind: InstrumentKind): { readonly width: number; readonly height: number } {
  return dimensions[kind]
}

function point(x: number, y: number): Point {
  return { x, y }
}

function outline(points: readonly Point[]): InstrumentPath {
  return { points, closed: true, fill: true, weight: 'major' }
}

function label(text: string, x: number, y: number, size: number, align: InstrumentLabel['align'] = 'center'): InstrumentLabel {
  return { text, x, y, size, align }
}

function outlinePoints(kind: InstrumentKind, width: number, height: number): readonly Point[] {
  if (kind === 'ruler') return [point(0, 0), point(width, 0), point(width, height), point(0, height)]
  if (kind === 'set-square-45' || kind === 'set-square-30') return [point(0, 0), point(width, height), point(0, height)]
  return []
}

function edgesFor(kind: InstrumentKind, width: number, height: number): InstrumentEdge[] {
  const points = outlinePoints(kind, width, height)
  return points.map((start, index) => ({ start, end: points[(index + 1) % points.length]! }))
}

function rulerGeometry(width: number, height: number): InstrumentGeometry {
  const { width: defaultWidth, height: defaultHeight } = dimensions.ruler
  const unitX = width / defaultWidth
  const unitY = height / defaultHeight
  const paths: InstrumentPath[] = [outline(outlinePoints('ruler', width, height))]
  const labels: InstrumentLabel[] = []
  for (let mm = 0; mm <= rulerCentimeters * 10; mm++) {
    const x = (rulerMargin + mm * pixelsPerCentimeter / 10) * unitX
    const major = mm % 10 === 0
    const length = major ? 23 : mm % 5 === 0 ? 17 : 10
    paths.push({ points: [point(x, 0), point(x, length * unitY)], weight: major ? 'major' : 'minor' })
    if (major) labels.push(label(String(mm / 10), x, 40 * unitY, 12 * Math.min(unitX, unitY)))
  }
  labels.push(label('cm', width / 2, 53 * unitY, 10 * Math.min(unitX, unitY)))
  return { paths, labels, edges: edgesFor('ruler', width, height) }
}

function squareGeometry(kind: 'set-square-45' | 'set-square-30', width: number, height: number): InstrumentGeometry {
  const points = outlinePoints(kind, width, height)
  const size = Math.min(width, height) / 16
  const square = 1.7 * size
  const paths = [
    outline(points),
    { points: [point(0, height - square), point(square, height - square), point(square, height)], weight: 'minor' as const },
  ]
  const equalLegs = kind === 'set-square-45'
  const labels = [
    label(equalLegs ? '45°' : '60°', size, height * 0.26, size, 'left'),
    label(equalLegs ? '45°' : '30°', width * (equalLegs ? 0.74 : 0.72), height - size * 0.65, size),
    label('90°', square + size * 0.75, height - square - size * 0.25, size, 'left'),
  ]
  return { paths, labels, edges: edgesFor(kind, width, height) }
}

function protractorGeometry(width: number, height: number): InstrumentGeometry {
  const defaultHeight = dimensions.protractor.height
  const origin = point(width / 2, height * 170 / defaultHeight)
  const rx = width / 2
  const ry = origin.y
  const size = Math.min(rx, ry) * 0.06
  const at = (degrees: number, radius: number) => {
    const radians = degrees * Math.PI / 180
    return point(origin.x + rx * radius * Math.cos(radians), origin.y - ry * radius * Math.sin(radians))
  }
  const body = Array.from({ length: 91 }, (_, index) => at(index * 2, 1))
  const paths: InstrumentPath[] = [outline(body)]
  const labels: InstrumentLabel[] = []
  for (let angle = 0; angle <= 180; angle++) {
    const major = angle % 15 === 0
    const len = major ? 0.13 : angle % 5 === 0 ? 0.09 : 0.05
    paths.push({ points: [at(angle, 1), at(angle, 1 - len)], weight: major ? 'major' : 'minor' })
    if (major) {
      const pos = at(angle, 0.77)
      labels.push(label(angle + '°', pos.x, Math.min(pos.y + size / 3, origin.y - size * 0.25), size))
    }
  }
  paths.push({ points: Array.from({ length: 19 }, (_, index) => at(index * 10, 0.125)), weight: 'minor' })
  paths.push({ points: [point(origin.x, origin.y - size), point(origin.x, origin.y + size / 2)], weight: 'major' })
  return { paths, labels, edges: [] }
}

export function compassFeet(width: number, height: number): { pivot: Point; tip: Point } {
  return { pivot: point(width / 6, height * 0.9), tip: point(width * 5 / 6, height * 0.9) }
}

function compassGeometry(width: number, height: number): InstrumentGeometry {
  const { pivot, tip } = compassFeet(width, height)
  const at = (x: number, y: number) => point(x * width, y * height)
  const left = [at(0.47, 0.15), at(0.51, 0.23), at(0.23, 0.77), pivot, at(0.16, 0.77), at(0.4, 0.22)]
  const right = [at(0.53, 0.15), at(0.49, 0.23), at(0.76, 0.77), tip, at(0.85, 0.77), at(0.6, 0.22)]
  const knob = Array.from({ length: 24 }, (_, index) => {
    const angle = index * Math.PI / 12
    return at(0.5 + 0.081 * Math.cos(angle), 0.18 + 0.081 * Math.sin(angle))
  })
  return {
    paths: [
      outline(left), outline(right),
      outline([at(0.47, 0.04), at(0.53, 0.04), at(0.53, 0.12), at(0.47, 0.12)]),
      outline(knob),
      { points: [at(0.73, 0.73), at(0.83, 0.68)], weight: 'major' },
      { points: [at(0.48, 0.18), at(0.52, 0.18)], weight: 'major' },
    ],
    labels: [],
    edges: [],
  }
}

export function getInstrumentGeometry(kind: InstrumentKind, width: number, height: number): InstrumentGeometry {
  if (kind === 'ruler') return rulerGeometry(width, height)
  if (kind === 'protractor') return protractorGeometry(width, height)
  if (kind === 'compass') return compassGeometry(width, height)
  return squareGeometry(kind, width, height)
}

export function instrumentEdges({ props, transform: [a, b, c, d, e, f] }: InstrumentPlacement): InstrumentEdge[] {
  const world = ({ x, y }: Point) => point(a * x + c * y + e, b * x + d * y + f)
  return edgesFor(props.kind, props.width, props.height).map(({ start, end }) => ({ start: world(start), end: world(end) }))
}

export function projectToInstrumentEdge(value: Point, { start, end }: InstrumentEdge): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return start
  const ux = dx / length
  const uy = dy / length
  const position = (value.x - start.x) * ux + (value.y - start.y) * uy
  if (position <= 0) return start
  if (position >= length) return end
  return point(start.x + ux * position, start.y + uy * position)
}

export function nearestInstrumentEdge(value: Point, instruments: readonly InstrumentPlacement[], maxDistance: number):
  { edge: InstrumentEdge; point: Point } | undefined {
  if (!(maxDistance >= 0)) return undefined
  let nearest: { edge: InstrumentEdge; point: Point } | undefined
  let distance = maxDistance
  for (const instrument of instruments) {
    for (const edge of instrumentEdges(instrument)) {
      const projected = projectToInstrumentEdge(value, edge)
      const candidate = Math.hypot(projected.x - value.x, projected.y - value.y)
      if (candidate > distance || !Number.isFinite(candidate)) continue
      distance = candidate
      nearest = { edge, point: projected }
    }
  }
  return nearest
}
