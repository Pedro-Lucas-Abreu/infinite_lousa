import type { Point, ShapeKind } from '../core/types'

export const shapeHoldMs = 700
export const shapeHoldRadius = 3

export interface RecognizedShape {
  readonly kind: Exclude<ShapeKind, 'arc'>
  readonly points: readonly Point[]
  readonly angle?: number
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const scale = ({ x, y }: Point, amount: number): Point => ({ x: x * amount, y: y * amount })
const midpoint = (a: Point, b: Point): Point => scale(add(a, b), 0.5)
const length = ({ x, y }: Point): number => Math.hypot(x, y)
const distance = (a: Point, b: Point): number => length(subtract(a, b))
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const unit = (point: Point): Point => {
  const size = length(point)
  return { x: point.x / size, y: point.y / size }
}
const rotate = ({ x, y }: Point, angle: number): Point => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
})

function bounds(points: readonly Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(x, minX); minY = Math.min(y, minY)
    maxX = Math.max(x, maxX); maxY = Math.max(y, maxY)
  }
  return { minX, minY, maxX, maxY }
}

function segmentDistance(point: Point, start: Point, end: Point): number {
  const edge = subtract(end, start)
  const delta = subtract(point, start)
  const size = dot(edge, edge)
  if (size === 0) return length(delta)
  const fraction = Math.max(0, Math.min(1, dot(delta, edge) / size))
  return Math.hypot(delta.x - fraction * edge.x, delta.y - fraction * edge.y)
}

function resample(points: readonly Point[], total: number): Point[] {
  const samples = [points[0]]
  let index = 1, travelled = 0
  for (let slot = 1; slot < 64; slot++) {
    const target = total * slot / 64
    while (index < points.length - 1 && travelled + distance(points[index - 1], points[index]) < target) {
      travelled += distance(points[index - 1], points[index])
      index++
    }
    const start = points[index - 1]
    const segment = subtract(points[index], start)
    const ratio = (target - travelled) / length(segment)
    samples.push({ x: start.x + ratio * segment.x, y: start.y + ratio * segment.y })
  }
  samples.push(points.at(-1)!)
  return samples
}

function simplify(points: readonly Point[], tolerance: number): Point[] {
  const start = points[0], end = points.at(-1)!
  let index = 0, error = tolerance
  for (let i = 1; i < points.length - 1; i++) {
    const candidate = segmentDistance(points[i], start, end)
    if (candidate > error) {
      index = i
      error = candidate
    }
  }
  return index ? [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance)] : [start, end]
}

function average(points: readonly Point[]): Point {
  return scale(points.reduce(add, { x: 0, y: 0 }), 1 / points.length)
}

function closedCorners(samples: readonly Point[], tolerance: number): { sharp: Point[]; shallow: Point[] } {
  const ring = samples.slice(0, -1)
  const at = (index: number) => ring[(index + ring.length) % ring.length]
  const smoothed = ring.map((point, i) => scale(add(
    add(scale(point, 6), scale(add(at(i - 1), at(i + 1)), 4)), add(at(i - 2), at(i + 2)),
  ), 1 / 16))
  const sample = (index: number) => smoothed[(index + smoothed.length) % smoothed.length]
  const turn = (index: number, width: number) => {
    const incoming = subtract(sample(index), sample(index - width))
    const outgoing = subtract(sample(index + width), sample(index))
    return Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing))
  }
  const candidates = simplify([...smoothed, smoothed[0]], tolerance).slice(0, -1)
  const angles = smoothed.map((_, index) => {
    const wide = turn(index, 5)
    const narrow = turn(index, 3)
    // Rounded outlines distribute their turn along an arc. A corner turns
    // almost as much in a short window as it does across the adjacent sides.
    return Math.sign(wide) === Math.sign(narrow) ? { narrow: Math.abs(narrow), wide: Math.abs(wide) } : { narrow: 0, wide: 0 }
  })
  function peaksAbove(minAngle: number, concentration: number): Point[] {
    const scores = angles.map(({ narrow, wide }) => narrow >= minAngle && narrow >= wide * concentration ? narrow : 0)
    const peaks = new Set<number>()
    for (const corner of candidates) {
      const index = smoothed.indexOf(corner)
      let peak = index
      for (let offset = -2; offset <= 2; offset++) {
        const next = (index + offset + ring.length) % ring.length
        if (scores[next] > scores[peak]) peak = next
      }
      if (scores[peak]) peaks.add(peak)
    }
    const spacing = (a: number, b: number) => Math.min(Math.abs(a - b), ring.length - Math.abs(a - b))
    const strongestFirst = [...peaks].sort((a, b) => scores[b] - scores[a])
    const separated: number[] = []
    for (const peak of strongestFirst) {
      if (separated.every((other) => spacing(peak, other) > 3)) separated.push(peak)
    }
    return separated.sort((a, b) => a - b).map((index) => smoothed[index])
  }
  return { sharp: peaksAbove(0.49, 0.75), shallow: peaksAbove(0.34, 0.64) }
}

function boxShape(kind: 'ellipse' | 'rectangle', points: readonly Point[], angle: number, square: boolean): RecognizedShape {
  const { minX, minY, maxX, maxY } = bounds(points.map((p) => rotate(p, -angle)))
  const center = rotate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, angle)
  const x = square ? (maxX - minX + maxY - minY) / 4 : (maxX - minX) / 2
  const y = square ? x : (maxY - minY) / 2
  return { kind, angle, points: [{ x: center.x - x, y: center.y - y }, { x: center.x + x, y: center.y + y }] }
}

function polygonEdges(points: readonly Point[]): Point[] {
  return points.map((point, i) => subtract(points[(i + 1) % points.length], point))
}

function polygonErrors(samples: readonly Point[], corners: readonly Point[]) {
  const errors = samples.map((point) => Math.min(...corners.map((start, i) =>
    segmentDistance(point, start, corners[(i + 1) % corners.length]))))
  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length
  return { max: Math.max(...errors), mean }
}

function polygonFits(samples: readonly Point[], corners: readonly Point[], tolerance: number): boolean {
  const { max, mean } = polygonErrors(samples, corners)
  return max <= tolerance * 1.65 && mean <= tolerance * 0.72
}

function asPolygon(points: readonly Point[]): RecognizedShape {
  return { kind: 'polygon', points }
}

function fitRectangle(corners: readonly Point[], directions: readonly Point[], winding: number, square: boolean): RecognizedShape {
  const axis = average(directions.map((direction, i) => rotate(direction, -winding * i * Math.PI / 2)))
  const angle = Math.atan2(axis.y, axis.x)
  const tilt = angle - Math.round(angle / (Math.PI / 2)) * Math.PI / 2
  const rectangle = boxShape('rectangle', corners, tilt, square)
  if (Math.abs(tilt) <= 5 * Math.PI / 180) return { ...rectangle, angle: 0 }

  const [a, b] = rectangle.points
  const center = midpoint(a, b)
  return asPolygon([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]
    .map((point) => add(center, rotate(subtract(point, center), tilt))))
}

function fitRhombus(corners: readonly Point[], winding: number): Point[] {
  const center = average(corners)
  const diagonalA = subtract(corners[0], corners[2])
  const diagonalB = subtract(corners[1], corners[3])
  const axis = unit(add(unit(diagonalA), rotate(unit(diagonalB), -winding * Math.PI / 2)))
  const a = scale(axis, length(diagonalA) / 2)
  const b = scale(rotate(axis, winding * Math.PI / 2), length(diagonalB) / 2)
  return [add(center, a), add(center, b), subtract(center, a), subtract(center, b)]
}

function lineMeeting(base: Point, axis: Point, start: Point, end: Point): Point {
  const leg = subtract(end, start)
  return add(start, scale(leg, cross(subtract(base, start), axis) / cross(leg, axis)))
}

function fitTrapezoid(corners: readonly Point[], pair: number): Point[] {
  const [a, b, c, d] = corners.map((_, i) => corners[(i + pair) % 4])
  const axis = unit(add(unit(subtract(b, a)), unit(subtract(c, d))))
  const top = midpoint(a, b), bottom = midpoint(c, d)
  const fitted = [lineMeeting(top, axis, a, d), lineMeeting(top, axis, b, c),
    lineMeeting(bottom, axis, b, c), lineMeeting(bottom, axis, a, d)]
  return corners.map((_, i) => fitted[(i - pair + 4) % 4])
}

function quadrilateral(corners: readonly Point[], directions: readonly Point[], sizes: readonly number[],
  winding: number, tolerance: number): RecognizedShape | undefined {
  const rightAngles = directions.every((dir, i) => Math.abs(dot(dir, directions[(i + 1) % 4])) <= 0.23)
  const equalSides = Math.min(...sizes) >= Math.max(...sizes) * 0.87
  const closeOpposite = [0, 1].every((i) => Math.abs(sizes[i] - sizes[i + 2]) <= Math.max(sizes[i], sizes[i + 2]) * 0.19)
  if (rightAngles && closeOpposite) return fitRectangle(corners, directions, winding, equalSides)

  const parallelError = [0, 1].map((i) => Math.abs(cross(directions[i], directions[i + 2])))
  const pairs = parallelError.map((error) => error <= 0.19)
  const confidentlyOblique = directions.every((dir, i) => Math.abs(dot(dir, directions[(i + 1) % 4])) >= 0.29)
  const parallelPair = pairs[0] ? 0 : 1
  const fitted = pairs[0] && pairs[1] && equalSides && confidentlyOblique ? fitRhombus(corners, winding)
    : pairs[0] !== pairs[1] && parallelError[1 - parallelPair] >= 0.27 ? fitTrapezoid(corners, parallelPair) : undefined
  if (fitted?.every((point, i) => distance(point, corners[i]) <= tolerance * 1.5)) return asPolygon(fitted)
}

function regularPolygon(corners: readonly Point[], winding: number, tolerance: number): RecognizedShape | undefined {
  const center = average(corners)
  const step = winding * 2 * Math.PI / corners.length
  const radius = average(corners.map((point, i) => rotate(subtract(point, center), -i * step)))
  const fitted = corners.map((_, i) => add(center, rotate(radius, i * step)))
  if (fitted.every((point, i) => distance(point, corners[i]) <= tolerance * 1.35)) return asPolygon(fitted)
}

function recognizePolygon(samples: readonly Point[], corners: readonly Point[], tolerance: number, span: number): RecognizedShape | undefined {
  if (corners.length < 3 || corners.length > 6) return
  const edges = polygonEdges(corners)
  const sizes = edges.map(length)
  if (Math.min(...sizes) < Math.max(12, span * 0.15)) return
  const directions = edges.map(unit)
  const turns = directions.map((dir, i) => cross(dir, directions[(i + 1) % corners.length]))
  const winding = Math.sign(turns[0])
  if (!turns.every((turn) => Math.abs(turn) >= 0.4 && Math.sign(turn) === winding) ||
    !polygonFits(samples, corners, tolerance)) return

  if (corners.length === 3) return asPolygon(corners)
  const result = corners.length === 4 ? quadrilateral(corners, directions, sizes, winding, tolerance)
    : regularPolygon(corners, winding, tolerance)
  if (!result) return
  if (result.kind === 'rectangle') {
    const [a, b] = result.points
    if (polygonFits(samples, [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], tolerance)) return result
  } else if (polygonFits(samples, result.points, tolerance)) return result
}

function hasManyRegularSides(points: readonly Point[]): boolean {
  const turn = 2 * Math.PI
  const polar = points.map((point) => ({
    angle: (Math.atan2(point.y, point.x) + turn) % turn, radius: length(point),
  })).sort((a, b) => a.angle - b.angle)
  const first = polar[0], last = polar.at(-1)!
  const closed = [{ ...last, angle: last.angle - turn }, ...polar, { ...first, angle: first.angle + turn }]
  let segment = 1
  const radii = Array.from({ length: 64 }, (_, i) => {
    const angle = i / 64 * turn
    while (closed[segment].angle <= angle) segment++
    const a = closed[segment - 1], b = closed[segment]
    return a.radius + (b.radius - a.radius) * (angle - a.angle) / (b.angle - a.angle)
  })
  const mean = radii.reduce((sum, radius) => sum + radius, 0) / radii.length
  const deviations = radii.map((radius) => radius - mean)
  const variance = deviations.reduce((sum, deviation) => sum + deviation * deviation, 0) / radii.length
  // Many short sides can look round. Their vertices still cause a repeated
  // radial deviation that is absent from a smooth ellipse.
  let highFrequencyVariance = variance
  for (let sides = 1; sides <= 16; sides++) {
    const frequency = deviations.reduce((sum, deviation, i) => {
      const phase = i / radii.length * turn * sides
      return add(sum, { x: deviation * Math.cos(phase), y: deviation * Math.sin(phase) })
    }, { x: 0, y: 0 })
    const amplitude = length(frequency) * 2 / radii.length
    if (sides < 7) highFrequencyVariance -= amplitude * amplitude / 2
    else if (amplitude >= 0.008 && amplitude * amplitude >= (sides <= 12 ? 0.54 : 0.9) * highFrequencyVariance) return true
  }
  return false
}

function recognizeEllipse(samples: readonly Point[]): { shape: RecognizedShape; meanError: number } | undefined {
  const center = average(samples)
  let xx = 0, yy = 0, xy = 0
  for (const point of samples) {
    const { x, y } = subtract(point, center)
    xx += x * x; yy += y * y; xy += x * y
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2
  const positions = samples.map((point) => rotate(point, -angle))
  const { minX, minY, maxX, maxY } = bounds(positions)
  const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2
  if (Math.min(rx, ry) < 15 || Math.min(rx, ry) / Math.max(rx, ry) < 0.27) return
  const furthest = positions.map(({ x, y }) => ({ x: (x - minX) / rx - 1, y: (y - minY) / ry - 1 }))
  const deviations = furthest.map((point) => Math.abs(length(point) - 1))
  if (Math.max(...deviations) > 0.24 ||
    deviations.reduce((sum, error) => sum + error * error, 0) / deviations.length > 0.009) return
  let sweep = 0, travel = 0
  for (let i = 1; i < furthest.length; i++) {
    const part = Math.atan2(cross(furthest[i - 1], furthest[i]), dot(furthest[i - 1], furthest[i]))
    sweep += part
    travel += Math.abs(part)
  }
  if (Math.abs(sweep) < 5.4 || Math.abs(sweep) > 7 || travel > Math.abs(sweep) * 1.14 ||
    hasManyRegularSides(furthest)) return
  const meanError = furthest.reduce((sum, point) => {
    const radial = length(point)
    return sum + Math.abs(1 - 1 / radial) * Math.hypot(rx * point.x, ry * point.y)
  }, 0) / furthest.length
  return { shape: boxShape('ellipse', samples, angle, Math.min(rx, ry) / Math.max(rx, ry) > 0.9), meanError }
}

function fitArrow(corners: readonly Point[], tolerance: number): RecognizedShape | undefined {
  if (corners.length !== 5) return
  const [start, tip, wingA, returnTip, wingB] = corners
  const shaft = subtract(tip, start)
  const span = length(shaft)
  if (span < 40 || distance(tip, returnTip) > tolerance * 1.8) return
  const axis = unit(shaft)
  const wings = [subtract(wingA, tip), subtract(wingB, tip)]
  const sides = wings.map((wing) => cross(axis, wing))
  if (sides[0] * sides[1] >= 0 || wings.some((wing, i) => {
    const back = -dot(axis, wing)
    return back < 0.08 * span || back > 0.48 * span || Math.abs(sides[i]) < back * 0.28 ||
      Math.abs(sides[i]) > back * 1.5
  })) return
  return { kind: 'arrow', points: [start, tip] }
}

export function recognizeShape(raw: readonly Point[]): RecognizedShape | undefined {
  const points = raw.filter((point, index) => !index || distance(point, raw[index - 1]) > 0.01)
  if (points.length < 2) return
  const { minX, minY, maxX, maxY } = bounds(points)
  const span = Math.hypot(maxX - minX, maxY - minY)
  if (!Number.isFinite(span) || span < 40) return
  const total = points.reduce((sum, point, index) => index ? sum + distance(point, points[index - 1]) : 0, 0)
  const samples = resample(points, total)
  const start = samples[0], end = samples.at(-1)!
  const gap = distance(start, end)
  const tolerance = Math.max(3, Math.min(12, span * 0.045))
  if (gap <= span * 0.15) {
    if (total + gap < span * 1.85 || total + gap > span * 3.55) return
    const closed = gap > 0.01 ? resample([...points, start], total + gap) : samples
    const { sharp, shallow } = closedCorners(closed, Math.max(2.5, Math.min(8, span * 0.024)))
    if (sharp.length >= 3 && polygonFits(samples, sharp, tolerance)) return recognizePolygon(samples, sharp, tolerance, span)
    if (sharp.length > 6) return
    const ellipse = recognizeEllipse(samples)
    if (!ellipse) return
    if (shallow.length > 6) {
      const polygon = polygonErrors(samples, shallow)
      if (polygon.max <= tolerance && polygon.mean <= ellipse.meanError * 1.1) return
    }
    return ellipse.shape
  }
  if (gap >= 40 && total <= gap * 1.32 &&
    samples.every((point) => segmentDistance(point, start, end) <= tolerance)) return { kind: 'line', points: [start, end] }
  const corners = simplify(samples, tolerance)
  return fitArrow(corners, tolerance) ?? fitArrow(corners.reverse(), tolerance)
}
