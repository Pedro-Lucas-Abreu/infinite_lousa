import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultSolid, projectSolid, solidKinds, solidViews, tangentLongitudes, type SolidKind, type SolidSettings } from './geometry'

const tolerance = 1e-7
const expected = [
  ['cube', 4, 9, 3], ['prism', 3, 6, 3], ['pyramid', 4, 5, 3],
  ['tetrahedron', 3, 5, 1], ['octahedron', 3, 9, 3],
] as const

for (const [kind, sides, visible, hidden] of expected) {
  test(`classifies visible and hidden ${kind} edges in the default view`, () => {
    const { paths } = projectSolid({ ...defaultSolid, kind, sides }, 2)
    assert.equal(paths.filter(({ role }) => role === 'visible').length, visible)
    assert.equal(paths.filter(({ role }) => role === 'hidden').length, hidden)
    assert.ok(paths.every(({ segments, role }) => segments.length === 1 && role !== 'guide' && role !== 'face'))
    assert.equal(new Set(paths.map(({ start, segments }) => [start, segments[0].end]
      .map(({ x, y }) => `${x.toFixed(5)},${y.toFixed(5)}`).sort().join('/'))).size, visible + hidden)
  })
}

test('constructs all requested base sizes, both frusta, and the regular Platonic meshes', () => {
  const edges = (kind: SolidKind, sides = 4) => projectSolid({ ...defaultSolid, kind, sides }, 2).paths.length
  for (const sides of [3, 4, 5, 6]) {
    assert.equal(edges('prism', sides), 3 * sides)
    assert.equal(edges('pyramid', sides), 2 * sides)
    assert.equal(edges('pyramid-frustum', sides), 3 * sides)
  }
  assert.equal(edges('dodecahedron'), 30)
  assert.equal(edges('icosahedron'), 30)
})

test('projects actual cone and frustum side tangents to the base ellipse in either elevation', () => {
  const azimuth = 0.74, bottom = 2.5, height = 5
  for (const elevation of [-0.51, 0, 0.65]) {
    const view = { azimuth: azimuth * 180 / Math.PI, elevation: elevation * 180 / Math.PI }
    for (const top of [0, 1.1, bottom]) {
      const tangents = tangentLongitudes(azimuth, elevation, bottom, top, height)
      assert.equal(tangents.length, 2)
      for (const longitude of tangents) {
        const normalDotView = Math.cos(elevation) * Math.cos(longitude - azimuth) +
          Math.sin(elevation) * (bottom - top) / height
        assert.ok(Math.abs(normalDotView) < tolerance)
      }
      const settings: SolidSettings = { ...defaultSolid, ...view, kind: top === 0 ? 'cone' : top === bottom ? 'cylinder' : 'cone-frustum',
        radius: bottom, altitude: height, topScale: top / bottom }
      const sides = projectSolid(settings, 2).paths.filter(({ segments, role }) => role === 'visible' && segments.length === 1 && !segments[0].controls)
      assert.equal(sides.length, 2)
      for (const [index, { start, segments }] of sides.entries()) {
        const theta = tangents[index] - azimuth
        const derivative = { x: bottom * Math.cos(theta), y: -bottom * Math.sin(theta) * Math.sin(elevation) }
        const end = segments[0].end
        assert.ok(Math.abs((end.x - start.x) * derivative.y - (end.y - start.y) * derivative.x) < tolerance)
      }
    }
  }
  assert.deepEqual(tangentLongitudes(0, 1.4, 2.5, 0, 2), [])
  assert.deepEqual(tangentLongitudes(0, Math.PI / 2, 2.5, 2.5, 2), [])
})

test('keeps round outlines and optional guides as vector paths in all presets', () => {
  const sphere = projectSolid({ ...defaultSolid, kind: 'sphere', showHeight: true, showRadius: true, fillFaces: true }, 4)
  assert.equal(sphere.paths.filter(({ role }) => role === 'hidden').length, 1)
  assert.equal(sphere.paths.filter(({ role }) => role === 'guide').length, 2)
  assert.equal(sphere.paths.filter(({ role, closed }) => role === 'visible' && closed).length, 1)
  assert.ok(sphere.paths.find(({ role }) => role === 'hidden')?.segments.every(({ controls }) => controls))
  const detailedCube = projectSolid({ ...defaultSolid, fillFaces: true }, 2)
  assert.equal(detailedCube.paths.filter(({ role }) => role === 'face').length, 3)
  for (const kind of Object.keys(solidKinds) as SolidKind[]) {
    for (const view of Object.values(solidViews)) {
      const { width, height, paths } = projectSolid({ ...defaultSolid, ...view, kind }, 2)
      assert.ok(width > 0 && height > 0 && paths.length >= 2)
    }
  }
})
