import type { Point } from '../core/types'

export const solidKinds = {
  cube: 'Cubo', cuboid: 'Paralelepípedo', prism: 'Prisma', pyramid: 'Pirâmide',
  tetrahedron: 'Tetraedro regular', octahedron: 'Octaedro regular',
  dodecahedron: 'Dodecaedro regular', icosahedron: 'Icosaedro regular',
  cylinder: 'Cilindro', cone: 'Cone', sphere: 'Esfera',
  'pyramid-frustum': 'Tronco de pirâmide', 'cone-frustum': 'Tronco de cone',
} as const

export type SolidKind = keyof typeof solidKinds
export interface SolidSettings {
  readonly kind: SolidKind
  readonly edge: number
  readonly depth: number
  readonly altitude: number
  readonly radius: number
  readonly sides: number
  readonly topScale: number
  readonly azimuth: number
  readonly elevation: number
  readonly fillFaces: boolean
  readonly showHeight: boolean
  readonly showRadius: boolean
}
export interface SolidProps extends SolidSettings {
  readonly width: number
  readonly height: number
  readonly color: string
  readonly size: number
}

export const solidViews = {
  default: { azimuth: 34, elevation: 24 },
  front: { azimuth: 0, elevation: 0 },
  side: { azimuth: 90, elevation: 0 },
  top: { azimuth: 0, elevation: 90 },
} as const

export const defaultSolid: SolidSettings = {
  kind: 'cube', edge: 4, depth: 3, altitude: 4, radius: 2, sides: 3, topScale: 0.55,
  ...solidViews.default, fillFaces: false, showHeight: false, showRadius: false,
}

export function isSolidKind(value: unknown): value is SolidKind {
  return typeof value === 'string' && Object.hasOwn(solidKinds, value)
}

export function hasBaseSides(kind: SolidKind): boolean {
  return kind === 'prism' || kind === 'pyramid' || kind === 'pyramid-frustum'
}

export function isRoundSolid(kind: SolidKind): boolean {
  return kind === 'cylinder' || kind === 'cone' || kind === 'sphere' || kind === 'cone-frustum'
}

export function usesSolidHeight(kind: SolidKind): boolean {
  return hasBaseSides(kind) || kind === 'cuboid' || kind === 'cylinder' || kind === 'cone' || kind === 'cone-frustum'
}

export function hasSolidBaseRadius(kind: SolidKind): boolean {
  return hasBaseSides(kind) || isRoundSolid(kind)
}

export function validSolidSettings(value: Record<string, unknown>): value is Record<string, unknown> & SolidSettings {
  const inRange = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
  return isSolidKind(value.kind) && [value.edge, value.altitude, value.radius, value.depth].every((n) => inRange(n, 0.1, 100)) &&
    inRange(value.sides, 3, 6) && Number.isInteger(value.sides) && inRange(value.topScale, 0.1, 0.95) &&
    inRange(value.azimuth, -180, 180) && inRange(value.elevation, -90, 90) &&
    [value.fillFaces, value.showHeight, value.showRadius].every((flag) => typeof flag === 'boolean')
}

type Vec = readonly [number, number, number]
type Face = readonly number[]
interface Mesh { vertices: readonly Vec[]; faces: readonly Face[] }
interface Segment { end: Point; controls?: [Point, Point] }
export interface SolidPath {
  start: Point
  segments: readonly Segment[]
  role: 'visible' | 'hidden' | 'guide' | 'face'
  closed?: boolean
}

const TAU = 2 * Math.PI
const EPSILON = 1e-9
const UNITS = 55
export const SOLID_FILL_OPACITY = 0.12
export const solidDash = (size: number): [number, number] => [3 * size, 2.3 * size]

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scale = (v: Vec, factor: number): Vec => [v[0] * factor, v[1] * factor, v[2] * factor]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const subtract = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mean = (vertices: readonly Vec[]) => scale(vertices.reduce(add, [0, 0, 0]), 1 / vertices.length)

function ring(sides: number, radius: number, z: number, phase = Math.PI / 2): Vec[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = phase + TAU * i / sides
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  })
}

function connectRings(lower: Vec[], upper: Vec[]): Mesh {
  const n = lower.length
  const base = lower.map((_, i) => i)
  if (upper.length === 1) {
    return { vertices: [...lower, upper[0]], faces: [base, ...base.map((i) => [i, (i + 1) % n, n])] }
  }
  return {
    vertices: [...lower, ...upper],
    faces: [base, base.map((i) => i + n), ...base.map((i) => [i, (i + 1) % n, (i + 1) % n + n, i + n])],
  }
}

// For the Platonic solids, collect the coplanar vertices of each supporting plane.
function convexFaces(vertices: readonly Vec[]): Face[] {
  const faces = new Map<string, Face>()
  for (let i = 0; i < vertices.length - 2; i++) {
    for (let j = i + 1; j < vertices.length - 1; j++) {
      for (let k = j + 1; k < vertices.length; k++) {
        const a = vertices[i], b = vertices[j], c = vertices[k]
        const normal = cross(subtract(b, a), subtract(c, a))
        if (Math.hypot(...normal) < EPSILON) continue
        const distances = vertices.map((v) => dot(normal, subtract(v, a)))
        if (distances.some((d) => d < -EPSILON) && distances.some((d) => d > EPSILON)) continue
        const indices = distances.flatMap((d, index) => Math.abs(d) < EPSILON ? [index] : [])
        const key = indices.join(',')
        if (faces.has(key)) continue
        const center = mean(indices.map((index) => vertices[index]))
        const u = subtract(a, center), v = cross(scale(normal, 1 / Math.hypot(...normal)), u)
        const angle = (index: number) => {
          const relative = subtract(vertices[index], center)
          return Math.atan2(dot(v, relative), dot(u, relative))
        }
        faces.set(key, indices.sort((first, second) => angle(first) - angle(second)))
      }
    }
  }
  return [...faces.values()]
}

function regularMesh(kind: 'octahedron' | 'dodecahedron' | 'icosahedron', edge: number): Mesh {
  const phi = (1 + Math.sqrt(5)) / 2
  const signs = [-1, 1]
  let vertices: Vec[]
  if (kind === 'octahedron') vertices = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  else {
    const short = kind === 'dodecahedron' ? 1 / phi : 1
    vertices = signs.flatMap((a) => signs.flatMap((b): Vec[] =>
      [[0, a * short, b * phi], [a * short, b * phi, 0], [b * phi, 0, a * short]]))
    if (kind === 'dodecahedron') vertices.push(...signs.flatMap((x) => signs.flatMap((y) => signs.map((z): Vec => [x, y, z]))))
  }
  const shortest = Math.min(...vertices.flatMap((v, index) => vertices.slice(index + 1).map((w) => Math.hypot(...subtract(v, w)))))
  return { vertices: vertices.map((v) => scale(v, edge / shortest)), faces: convexFaces(vertices) }
}

function solidMesh(s: SolidSettings): Mesh | undefined {
  const { kind, edge, depth, altitude, sides, topScale } = s
  if (kind === 'cube' || kind === 'cuboid') {
    const y = kind === 'cube' ? edge : depth, z = kind === 'cube' ? edge : altitude
    const layer = (level: number): Vec[] => [[-edge / 2, -y / 2, level], [edge / 2, -y / 2, level],
      [edge / 2, y / 2, level], [-edge / 2, y / 2, level]]
    return connectRings(layer(-z / 2), layer(z / 2))
  }
  if (kind === 'prism' || kind === 'pyramid' || kind === 'pyramid-frustum') {
    const radius = edge / (2 * Math.sin(Math.PI / sides)), phase = sides === 4 ? Math.PI / 4 : Math.PI / 2
    const base = ring(sides, radius, -altitude / 2, phase)
    if (kind === 'pyramid') return connectRings(base, [[0, 0, altitude / 2]])
    return connectRings(base, ring(sides, radius * (kind === 'prism' ? 1 : topScale), altitude / 2, phase))
  }
  if (kind === 'tetrahedron') {
    const altitude = edge * Math.sqrt(2 / 3)
    return connectRings(ring(3, edge / Math.sqrt(3), -altitude / 4, 5 * Math.PI / 6), [[0, 0, 3 * altitude / 4]])
  }
  if (kind === 'octahedron' || kind === 'dodecahedron' || kind === 'icosahedron') {
    return regularMesh(kind, edge)
  }
}

function camera(s: SolidSettings) {
  const azimuth = s.azimuth * Math.PI / 180, elevation = s.elevation * Math.PI / 180
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth), ce = Math.cos(elevation), se = Math.sin(elevation)
  const toward: Vec = [ca * ce, sa * ce, se]
  const right: Vec = [-sa, ca, 0]
  const down: Vec = [ca * se, sa * se, -ce]
  return { azimuth, elevation, toward, project: (point: Vec): Point => ({ x: dot(right, point) * UNITS, y: dot(down, point) * UNITS }) }
}

type Project = ReturnType<typeof camera>['project']
function line(project: Project, a: Vec, b: Vec, role: SolidPath['role']): SolidPath {
  return { start: project(a), segments: [{ end: project(b) }], role }
}

function projectMesh(mesh: Mesh, view: ReturnType<typeof camera>, fillFaces: boolean): SolidPath[] {
  const center = mean(mesh.vertices)
  const faces: SolidPath[] = [], hidden: SolidPath[] = [], visible: SolidPath[] = []
  const edges = new Map<string, { a: number; b: number; back: boolean }>()
  for (const face of mesh.faces) {
    const vertices = face.map((i) => mesh.vertices[i])
    const [a, b, c] = vertices
    let normal = cross(subtract(b, a), subtract(c, a))
    if (dot(normal, subtract(mean(vertices), center)) < 0) normal = scale(normal, -1)
    const facing = dot(normal, view.toward) / Math.hypot(...normal)
    if (fillFaces && facing > EPSILON) {
      faces.push({ start: view.project(a), segments: vertices.slice(1).map((vertex) => ({ end: view.project(vertex) })),
        role: 'face', closed: true })
    }
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const edge = edges.get(key)
      if (edge) edge.back &&= facing < -EPSILON
      else edges.set(key, { a, b, back: facing < -EPSILON })
    })
  }
  for (const { a, b, back } of edges.values()) {
    (back ? hidden : visible).push(line(view.project, mesh.vertices[a], mesh.vertices[b], back ? 'hidden' : 'visible'))
  }
  return [...faces, ...hidden, ...visible]
}

function arc(center: Point, u: Point, v: Point, from: number, to: number, role: SolidPath['role']): SolidPath {
  const point = (a: number) => ({ x: center.x + u.x * Math.cos(a) + v.x * Math.sin(a),
    y: center.y + u.y * Math.cos(a) + v.y * Math.sin(a) })
  const tangent = (a: number) => ({ x: -u.x * Math.sin(a) + v.x * Math.cos(a), y: -u.y * Math.sin(a) + v.y * Math.cos(a) })
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)))
  const step = (to - from) / steps
  const factor = 4 / 3 * Math.tan(step / 4)
  const segments = Array.from({ length: steps }, (_, i): Segment => {
    const first = from + i * step, last = from + (i + 1) * step
    const a = point(first), b = point(last), da = tangent(first), db = tangent(last)
    return {
      controls: [{ x: a.x + factor * da.x, y: a.y + factor * da.y }, { x: b.x - factor * db.x, y: b.y - factor * db.y }],
      end: b,
    }
  })
  return { start: point(from), segments, role, ...(Math.abs(to - from) === TAU ? { closed: true } : {}) }
}

export function tangentLongitudes(azimuth: number, elevation: number, lowerRadius: number, upperRadius: number, altitude: number):
readonly number[] {
  // A revolution surface has outward normal proportional to (cos λ, sin λ, (r₀ - r₁)/h).
  const slope = (lowerRadius - upperRadius) / altitude
  const horizontal = Math.cos(elevation)
  if (Math.abs(horizontal) < EPSILON) return []
  const ratio = -slope * Math.sin(elevation) / horizontal
  if (ratio <= -1 || ratio >= 1) return []
  const relative = Math.acos(ratio)
  return [azimuth - relative, azimuth + relative]
}

function roundPaths(s: SolidSettings, view: ReturnType<typeof camera>): SolidPath[] {
  const { radius, altitude, kind, fillFaces, topScale } = s
  const { azimuth, elevation, project } = view
  const near = azimuth - Math.PI / 2, far = azimuth + Math.PI / 2
  const rim = (r: number, z: number, start: number, end: number, role: SolidPath['role']) =>
    arc(project([0, 0, z]), project([r, 0, 0]), project([0, r, 0]), start, end, role)
  const outline = (role: SolidPath['role']) => arc({ x: 0, y: 0 }, { x: radius * UNITS, y: 0 },
    { x: 0, y: radius * UNITS }, 0, TAU, role)
  if (kind === 'sphere') return [
    ...(fillFaces ? [outline('face')] : []),
    ...(Math.abs(Math.sin(elevation)) > EPSILON ? [rim(radius, 0, far, near + TAU, 'hidden')] : []),
    rim(radius, 0, near, far, 'visible'), outline('visible'),
  ]

  const low = -altitude / 2, high = altitude / 2
  const top = kind === 'cylinder' ? radius : kind === 'cone-frustum' ? radius * topScale : 0
  const rings = [{ r: radius, z: low }, ...(top > 0 ? [{ r: top, z: high }] : [])]
  const sides = tangentLongitudes(azimuth, elevation, radius, top, altitude)
  const tangent = (r: number, z: number, angle: number): Vec => [r * Math.cos(angle), r * Math.sin(angle), z]
  const faces: SolidPath[] = []
  if (fillFaces) {
    const face = elevation < 0 ? rings[0] : rings.at(-1)!
    if (Math.abs(elevation) > EPSILON && (elevation < 0 || top > 0)) faces.push(rim(face.r, face.z, 0, TAU, 'face'))
    if (sides.length === 2) {
      const [first, last] = sides
      const bottom = rim(radius, low, first, last, 'face')
      const upper = rim(top, high, last, first, 'face')
      faces.push({ ...bottom, segments: [...bottom.segments, { end: upper.start }, ...upper.segments], closed: true })
    }
  }
  return [
    ...faces,
    ...rings.flatMap(({ r, z }) => Math.abs(Math.sin(elevation)) > EPSILON
      ? [rim(r, z, far, near + TAU, 'hidden')] : []),
    ...rings.map(({ r, z }) => rim(r, z, near, far, 'visible')),
    ...sides.map((angle) => line(project, tangent(radius, low, angle), tangent(top, high, angle), 'visible')),
  ]
}

function rawPaths(s: SolidSettings): SolidPath[] {
  const view = camera(s)
  const mesh = solidMesh(s)
  const paths = mesh ? projectMesh(mesh, view, s.fillFaces) : roundPaths(s, view)
  const halfHeight = s.kind === 'sphere' ? s.radius : s.kind === 'cube' ? s.edge / 2 : s.altitude / 2
  if (s.showHeight) {
    const z = mesh && !usesSolidHeight(s.kind) && s.kind !== 'cube' ? Math.min(...mesh.vertices.map((p) => p[2])) : -halfHeight
    const top = mesh && !usesSolidHeight(s.kind) && s.kind !== 'cube' ? Math.max(...mesh.vertices.map((p) => p[2])) : halfHeight
    paths.push(line(view.project, [0, 0, z], [0, 0, top], 'guide'))
  }
  if (s.showRadius && hasSolidBaseRadius(s.kind)) {
    const angle = hasBaseSides(s.kind) ? (s.sides === 4 ? Math.PI / 4 : Math.PI / 2) : view.azimuth + Math.PI / 2
    const radius = isRoundSolid(s.kind) ? s.radius : s.edge / (2 * Math.sin(Math.PI / s.sides))
    const z = s.kind === 'sphere' ? 0 : -halfHeight
    paths.push(line(view.project, [0, 0, z], [radius * Math.cos(angle), radius * Math.sin(angle), z], 'guide'))
  }
  return paths
}

export function projectSolid(s: SolidSettings, size: number): { width: number; height: number; paths: readonly SolidPath[] } {
  const paths = rawPaths(s)
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const { start, segments } of paths) {
    for (const { x, y } of [start, ...segments.flatMap(({ end, controls }) => controls ? [...controls, end] : [end])]) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  const pad = Math.max(3, size)
  const offset = ({ x, y }: Point) => ({ x: x - left + pad, y: y - top + pad })
  return { width: right - left + 2 * pad, height: bottom - top + 2 * pad,
    paths: paths.map(({ start, segments, ...style }) => ({
      ...style, start: offset(start), segments: segments.map(({ end, controls }) => ({
        end: offset(end), ...(controls ? { controls: [offset(controls[0]), offset(controls[1])] } : {}),
      })),
    })) }
}
