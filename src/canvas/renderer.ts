import { viewportBounds } from '../core/camera'
import type { Scene } from '../core/scene'
import { strokeOutline } from '../core/stroke'
import type { Camera, Point, Stroke, Viewport } from '../core/types'

export interface BackgroundFrameMetrics {
  renderMs: number
  visibleStrokes: number
  cacheMisses: number
  timeStamp: number
}

function createPath(points: readonly Point[]): Path2D {
  const path = new Path2D()
  const start = points[0]
  if (!start) return path

  path.moveTo(start.x, start.y)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!
    path.lineTo(point.x, point.y)
  }
  path.closePath()
  return path
}

export class CanvasRenderer {
  private readonly confirmedContext: CanvasRenderingContext2D
  private readonly liveContext: CanvasRenderingContext2D
  private readonly paths = new WeakMap<Stroke, Path2D>()
  private scaleX = 1
  private scaleY = 1
  private liveHasInk = false
  viewport: Viewport = { width: 1, height: 1 }

  constructor(confirmedCanvas: HTMLCanvasElement, liveCanvas: HTMLCanvasElement) {
    const confirmedContext = confirmedCanvas.getContext('2d')
    const liveContext = liveCanvas.getContext('2d')
    if (!confirmedContext || !liveContext) throw new Error('Canvas 2D unavailable')

    this.confirmedContext = confirmedContext
    this.liveContext = liveContext
  }

  resize(width: number, height: number, devicePixelRatio: number): boolean {
    const physicalWidth = Math.max(1, Math.round(width * devicePixelRatio))
    const physicalHeight = Math.max(1, Math.round(height * devicePixelRatio))
    const confirmedCanvas = this.confirmedContext.canvas
    if (this.viewport.width === width && this.viewport.height === height &&
      confirmedCanvas.width === physicalWidth && confirmedCanvas.height === physicalHeight) {
      return false
    }

    this.viewport = { width, height }
    this.scaleX = physicalWidth / width
    this.scaleY = physicalHeight / height
    for (const canvas of [confirmedCanvas, this.liveContext.canvas]) {
      canvas.width = physicalWidth
      canvas.height = physicalHeight
    }
    this.liveHasInk = false
    return true
  }

  drawBackground(scene: Scene, camera: Camera): BackgroundFrameMetrics {
    const start = performance.now()
    const visible = scene.search(viewportBounds(camera, this.viewport))
    let cacheMisses = 0

    this.clear(this.confirmedContext)
    for (const stroke of visible) {
      cacheMisses += Number(this.drawConfirmedStroke(stroke, camera))
    }

    const timeStamp = performance.now()
    return { renderMs: timeStamp - start, visibleStrokes: visible.length, cacheMisses, timeStamp }
  }

  drawConfirmedStroke(stroke: Stroke, camera: Camera): boolean {
    const cached = this.paths.get(stroke)
    const path = cached ?? createPath(strokeOutline(stroke))
    if (!cached) this.paths.set(stroke, path)

    this.paint(this.confirmedContext, stroke, path, camera)
    return !cached
  }

  drawLive(stroke: Stroke | undefined, camera: Camera): void {
    if (this.liveHasInk) this.clear(this.liveContext)
    if (stroke) this.paint(this.liveContext, stroke, createPath(strokeOutline(stroke, false)), camera)
    this.liveHasInk = Boolean(stroke)
  }

  private clear(context: CanvasRenderingContext2D): void {
    context.resetTransform()
    context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  }

  private paint(context: CanvasRenderingContext2D, stroke: Stroke, path: Path2D, camera: Camera): void {
    const [a, b, c, d, e, f] = stroke.transform
    const zoomX = camera.zoom * this.scaleX
    const zoomY = camera.zoom * this.scaleY
    context.setTransform(
      a * zoomX, b * zoomY, c * zoomX, d * zoomY,
      (e - camera.x) * zoomX + context.canvas.width / 2,
      (f - camera.y) * zoomY + context.canvas.height / 2,
    )
    context.fillStyle = stroke.props.brush.color
    context.fill(path)
  }
}
