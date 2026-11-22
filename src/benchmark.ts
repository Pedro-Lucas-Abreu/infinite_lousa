import type { BoardController, BackgroundFrameMetrics, InkFrameMetrics } from './canvas/controller'
import type { Scene } from './core/scene'
import { createStroke } from './core/stroke'
import type { Brush, Point, Stroke } from './core/types'

type Fixture = 'dense' | 'distributed'
type Motion = 'pan' | 'zoom'

interface Options {
  board: BoardController
  scene: Scene
  canvas: HTMLCanvasElement
}

const seed = 0x5eed
const pointsPerStroke = 12
const strokeCount = 10_000
const measureFrames = 120
const warmupFrames = 24
const origin = { x: 0, y: 0, zoom: 1 }

function makeFixture(fixture: Fixture, surface: DOMRect): Stroke[] {
  let randomState = seed
  function random() {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0
    return randomState / 2 ** 32
  }

  const width = fixture === 'dense' ? surface.width * 0.66 : 3800
  const height = fixture === 'dense' ? surface.height * 0.66 : 3800
  const brush: Brush = { color: '#192038', size: 2, stabilizer: 35, simulatePressure: true }

  return Array.from({ length: strokeCount }, (_, index) => {
    const x = (index % 100 + 0.5) * width / 100 - width / 2
    const y = (Math.floor(index / 100) + 0.5) * height / 100 - height / 2
    const phase = random() * Math.PI * 2
    const points: Point[] = Array.from({ length: pointsPerStroke }, (_, pointIndex) => ({
      x: x + (pointIndex - 5.5) * 1.1,
      y: y + Math.sin(pointIndex * 0.32 + phase) * 2 + random() * 0.6,
    }))
    return createStroke(`fixture-${index}`, points, brush, index)
  })
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

export function setupBenchmark({ board, scene, canvas }: Options) {
  let background: BackgroundFrameMetrics[] = []
  let ink: InkFrameMetrics[] = []
  let recordBackground = false
  let recordInk = false

  const harness: BenchmarkHarness = {
    configuration: { seed, pointsPerStroke, strokeCount, measureFrames, warmupFrames },
    async load(fixture: Fixture) {
      board.setCamera(origin)
      await nextFrame()
      const start = performance.now()
      scene.replace(makeFixture(fixture, canvas.getBoundingClientRect()))
      const preparationMs = performance.now() - start
      background = []
      recordBackground = true
      board.invalidateScene()
      await nextFrame()
      await nextFrame()
      recordBackground = false
      return { preparationMs, cold: background[0] }
    },
    async move(motion: Motion) {
      background = []
      const frameIntervals: number[] = []
      let previousTime = await nextFrame()

      for (let index = 0; index < warmupFrames + measureFrames; index += 1) {
        const phase = index / 12
        recordBackground = index >= warmupFrames
        const camera = motion === 'pan'
          ? { x: Math.sin(phase) * 72, y: Math.sin(phase * 1.4) * 48, zoom: 1 }
          : { x: 0, y: 0, zoom: 1 + 0.16 * Math.sin(phase) }
        board.setCamera(camera)
        const time = await nextFrame()
        if (recordBackground) frameIntervals.push(time - previousTime)
        previousTime = time
      }

      recordBackground = false
      board.setCamera(origin)
      await nextFrame()
      return { frameIntervals, rendering: background }
    },
    beginInk() {
      ink = []
      recordInk = true
    },
    endInk() {
      recordInk = false
      return ink
    },
    objectCount() {
      return scene.all().length
    },
    camera() {
      return board.getCamera()
    },
  }

  window.whiteboardBenchmark = harness

  return {
    recordBackground(metrics: BackgroundFrameMetrics) {
      if (recordBackground) background.push(metrics)
    },
    recordInk(metrics: InkFrameMetrics) {
      if (recordInk) ink.push(metrics)
    },
    destroy() {
      delete window.whiteboardBenchmark
    },
  }
}

interface BenchmarkHarness {
  configuration: { seed: number; pointsPerStroke: number; strokeCount: number; measureFrames: number; warmupFrames: number }
  load(fixture: Fixture): Promise<{ preparationMs: number; cold?: BackgroundFrameMetrics }>
  move(motion: Motion): Promise<{ frameIntervals: number[]; rendering: BackgroundFrameMetrics[] }>
  beginInk(): void
  endInk(): InkFrameMetrics[]
  objectCount(): number
  camera(): ReturnType<BoardController['getCamera']>
}

declare global {
  interface Window {
    whiteboardBenchmark?: BenchmarkHarness
  }
}

export type BenchmarkControls = ReturnType<typeof setupBenchmark>
