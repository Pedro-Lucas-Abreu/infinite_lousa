import { viewportBounds, worldToScreen } from '../core/camera'
import type { Scene } from '../core/scene'
import { strokeOutline } from '../core/stroke'
import type { Affine, BoardObject, Bounds, Camera, InstrumentObject, PageObject, Point, Stroke, Viewport } from '../core/types'
import { drawEquationObject, drawInstrument, drawPlotObject, drawShape, drawTextObject } from './drawings'
import { rectanglePoints, selectionHandles } from './geometry'

export type BoardBackground = 'white' | 'dark' | 'dotted' | 'grid' | 'millimeter'
export type GetPageRaster = (page: PageObject, effectiveScale: number) => CanvasImageSource | undefined
export type PointerEffect = 'laser' | 'spotlight'

export interface CanvasPointer {
  point: Point
  kind: PointerEffect | 'pen' | 'hand' | 'eraser' | 'text' | 'crosshair'
  color: string
  size: number
  parentId?: string
}

export interface CanvasOverlay {
  selection?: { bounds: Bounds; canRotate: boolean }
  region?: readonly Point[]
  previewObjects?: readonly BoardObject[]
  eraser?: { point: Point; radius: number }
  polygon?: { points: readonly Point[]; hover?: Point; color: string; size: number; parentId?: string }
  pointer?: CanvasPointer
  measurement?: { point: Point; text: string }
}

export interface BackgroundFrameMetrics {
  renderMs: number
  visibleStrokes: number
  cacheMisses: number
  timeStamp: number
  instrumentsChanged: boolean
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
  private darkPaper = false
  private instruments: readonly InstrumentObject[] = []
  viewport: Viewport = { width: 1, height: 1 }

  constructor(confirmedCanvas: HTMLCanvasElement, liveCanvas: HTMLCanvasElement,
    private readonly getPageRaster?: GetPageRaster) {
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

  drawBackground(scene: Scene, camera: Camera, background: BoardBackground = 'white',
    hidden?: Pick<ReadonlySet<string>, 'has'>): BackgroundFrameMetrics {
    const start = performance.now()
    const visible = scene.search(viewportBounds(camera, this.viewport))
    let cacheMisses = 0
    let visibleStrokes = 0
    const previousDarkPaper = this.darkPaper
    const instruments: InstrumentObject[] = []

    this.clear(this.confirmedContext)
    this.darkPaper = background === 'dark'
    this.drawPaper(background, camera)
    for (const object of visible) {
      if (hidden?.has(object.id)) continue
      if (object.type === 'instrument') {
        instruments.push(object)
      } else if (object.type === 'stroke') {
        visibleStrokes++
        cacheMisses += Number(this.drawConfirmedStroke(object, camera))
      } else {
        this.drawObject(this.confirmedContext, object, camera)
      }
    }

    const instrumentsChanged = this.instruments.length !== instruments.length ||
      instruments.some((object, index) => object !== this.instruments[index]) ||
      (instruments.length > 0 && previousDarkPaper !== this.darkPaper)
    this.instruments = instruments
    const timeStamp = performance.now()
    return { renderMs: timeStamp - start, visibleStrokes, cacheMisses, timeStamp, instrumentsChanged }
  }

  drawConfirmedStroke(stroke: Stroke, camera: Camera): boolean {
    const cached = this.paths.get(stroke)
    const path = cached ?? createPath(strokeOutline(stroke))
    if (!cached) this.paths.set(stroke, path)

    this.paint(this.confirmedContext, stroke, path, camera)
    return !cached
  }

  drawLive(stroke: Stroke | undefined, camera: Camera, overlay?: CanvasOverlay): void {
    if (this.liveHasInk) this.clear(this.liveContext)
    const context = this.liveContext
    for (const object of this.instruments) this.drawObject(context, object, camera)
    if (stroke) this.paint(context, stroke, createPath(strokeOutline(stroke, false)), camera)
    if (overlay) {
      for (const object of overlay.previewObjects ?? []) this.drawObject(context, object, camera)
      this.drawOverlay(overlay, camera)
    }
    this.liveHasInk = Boolean(stroke || overlay || this.instruments.length)
  }

  private clear(context: CanvasRenderingContext2D): void {
    context.resetTransform()
    context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  }

  private paint(context: CanvasRenderingContext2D, stroke: Stroke, path: Path2D, camera: Camera): void {
    this.setObjectTransform(context, stroke.transform, camera)
    const { color, opacity = 1 } = stroke.props.brush
    context.fillStyle = this.boardColor(color, stroke.parentId)
    if (opacity !== 1) context.globalAlpha = opacity
    context.fill(path)
    if (opacity !== 1) context.globalAlpha = 1
  }

  private boardColor(color: string, parentId?: string): string {
    const defaultInk = color === '#192038' || color === '#1a2433'
    return this.darkPaper && !parentId && defaultInk ? '#ecf2ff' : color
  }

  private setObjectTransform(context: CanvasRenderingContext2D, [a, b, c, d, e, f]: Affine, camera: Camera): void {
    const zoomX = camera.zoom * this.scaleX
    const zoomY = camera.zoom * this.scaleY
    context.setTransform(
      a * zoomX, b * zoomY, c * zoomX, d * zoomY,
      (e - camera.x) * zoomX + context.canvas.width / 2,
      (f - camera.y) * zoomY + context.canvas.height / 2,
    )
  }

  private drawObject(context: CanvasRenderingContext2D, object: BoardObject, camera: Camera): void {
    if (object.type === 'stroke') {
      const path = this.paths.get(object) ?? createPath(strokeOutline(object))
      this.paint(context, object, path, camera)
      return
    }

    this.setObjectTransform(context, object.transform, camera)
    if (object.type === 'instrument') {
      drawInstrument(context, object, this.darkPaper)
      return
    }
    if (object.type === 'shape') {
      drawShape(context, object, this.boardColor(object.props.color, object.parentId))
      return
    }
    if (object.type === 'text') {
      drawTextObject(context, object, this.boardColor(object.props.color, object.parentId))
      return
    }
    if (object.type === 'equation') {
      drawEquationObject(context, object, this.boardColor(object.props.color, object.parentId))
      return
    }
    if (object.type === 'plot') {
      drawPlotObject(context, object, (color) => this.boardColor(color, object.parentId))
      return
    }
    const [a, b, c, d] = object.transform
    const effectiveScale = camera.zoom * Math.max(Math.hypot(a * this.scaleX, b * this.scaleY), Math.hypot(c * this.scaleX, d * this.scaleY))
    const { width, height } = object.props
    if (object.type === 'frame') {
      context.strokeStyle = '#7191da'
      context.lineWidth = 1.5 / effectiveScale
      context.setLineDash([7 / effectiveScale, 4 / effectiveScale])
      context.strokeRect(0, 0, width, height)
      context.setLineDash([])
      return
    }

    const raster = this.getPageRaster?.(object, effectiveScale)
    if (object.type === 'pdfPage' || !raster) {
      context.fillStyle = raster ? '#ffffff' : '#eef1f7'
      context.fillRect(0, 0, width, height)
    }
    if (raster) context.drawImage(raster, 0, 0, width, height)
  }

  private drawPaper(background: BoardBackground, camera: Camera): void {
    if (background === 'white') return
    const context = this.confirmedContext
    if (background === 'dark') {
      context.fillStyle = '#121826'
      context.fillRect(0, 0, context.canvas.width, context.canvas.height)
      return
    }

    const { width, height } = this.viewport
    const unit = background === 'millimeter' ? 96 / 25.4 : 32
    let step = unit * camera.zoom
    if (!Number.isFinite(step) || step <= 0) return
    while (step < 8) step *= 5
    while (step > 120) step /= 5
    const worldStep = step / camera.zoom
    const phase = (coordinate: number, size: number) => ((size / 2 - (coordinate % worldStep) * camera.zoom) % step + step) % step
    const left = phase(camera.x, width), top = phase(camera.y, height)
    context.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0)
    if (background === 'dotted') {
      context.fillStyle = '#aebbd0'
      for (let x = left; x < width; x += step) {
        for (let y = top; y < height; y += step) context.fillRect(x, y, 1.5, 1.5)
      }
      return
    }

    context.strokeStyle = background === 'millimeter' ? '#e3e9f2' : '#dbe3ef'
    context.lineWidth = 1
    context.beginPath()
    for (let x = left; x < width; x += step) { context.moveTo(x, 0); context.lineTo(x, height) }
    for (let y = top; y < height; y += step) { context.moveTo(0, y); context.lineTo(width, y) }
    context.stroke()
  }

  private drawOverlay(overlay: CanvasOverlay, camera: Camera): void {
    const context = this.liveContext
    context.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0)
    context.strokeStyle = '#5885e9'
    context.lineWidth = 1.5

    if (overlay.region?.length) this.drawRegion(overlay.region, camera, true)
    if (overlay.selection) {
      const { bounds, canRotate } = overlay.selection
      this.drawRegion(rectanglePoints(bounds), camera, false)
      context.fillStyle = '#fafbff'
      for (const [index, point] of selectionHandles(bounds, camera.zoom, canRotate).entries()) {
        const { x, y } = worldToScreen(point, camera, this.viewport)
        context.beginPath()
        if (index === 4) {
          context.moveTo(x, y + 5)
          context.lineTo(x, y + 25)
          context.stroke()
          context.beginPath()
          context.arc(x, y, 5, 0, 2 * Math.PI)
        } else {
          context.rect(x - 4, y - 4, 8, 8)
        }
        context.fill()
        context.stroke()
      }
    }
    if (overlay.eraser) {
      const { x, y } = worldToScreen(overlay.eraser.point, camera, this.viewport)
      context.beginPath()
      context.arc(x, y, overlay.eraser.radius * camera.zoom, 0, 2 * Math.PI)
      context.stroke()
    }
    if (overlay.polygon) this.drawPolygonDraft(overlay.polygon, camera)
    if (overlay.pointer) this.drawPointer(overlay.pointer)
    if (overlay.measurement) {
      const { point, text } = overlay.measurement
      context.save()
      context.font = '600 13px system-ui, sans-serif'
      context.textBaseline = 'middle'
      context.textAlign = 'left'
      const width = context.measureText(text).width + 16
      const x = Math.max(4, Math.min(point.x + 14, this.viewport.width - width - 4))
      const y = Math.max(4, Math.min(point.y + 14, this.viewport.height - 28))
      context.fillStyle = '#192038'
      context.fillRect(x, y, width, 24)
      context.fillStyle = '#fff'
      context.fillText(text, x + 8, y + 12)
      context.restore()
    }
  }

  private drawPointer({ point: { x, y }, kind, color, size, parentId }: CanvasPointer): void {
    const context = this.liveContext
    context.save()
    context.lineCap = 'round'
    context.setLineDash([])
    if (kind === 'spotlight') {
      const radius = Math.min(130, Math.max(65, Math.min(this.viewport.width, this.viewport.height) * 0.17))
      const dim = new Path2D()
      dim.rect(0, 0, this.viewport.width, this.viewport.height)
      dim.moveTo(x + radius, y)
      dim.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = 'rgba(12, 18, 32, 0.62)'
      context.fill(dim, 'evenodd')
      context.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      context.lineWidth = 1.5
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.stroke()
    } else if (kind === 'laser' || kind === 'pen' || kind === 'eraser') {
      const radius = kind === 'laser' ? 6 : kind === 'eraser' ? size : Math.max(2.5, size / 2)
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(12, 18, 32, 0.7)'
      context.lineWidth = 3.5
      context.stroke()
      context.strokeStyle = '#fff'
      context.lineWidth = 1.5
      context.stroke()
      if (kind !== 'eraser') {
        context.beginPath()
        context.arc(x, y, Math.max(1.5, radius - 0.75), 0, Math.PI * 2)
        context.fillStyle = kind === 'laser' ? '#ff414d' : this.boardColor(color, parentId)
        context.fill()
      }
    } else {
      context.beginPath()
      if (kind === 'text') {
        context.moveTo(x - 4, y - 8); context.lineTo(x + 4, y - 8)
        context.moveTo(x, y - 8); context.lineTo(x, y + 8)
        context.moveTo(x - 4, y + 8); context.lineTo(x + 4, y + 8)
      } else {
        const radius = kind === 'hand' ? 8 : 10
        context.moveTo(x - radius, y); context.lineTo(x + radius, y)
        context.moveTo(x, y - radius); context.lineTo(x, y + radius)
      }
      context.strokeStyle = '#fff'
      context.lineWidth = 4
      context.stroke()
      context.strokeStyle = this.boardColor(color, parentId)
      context.lineWidth = kind === 'crosshair' ? Math.max(1.5, Math.min(3, size / 2)) : 2
      context.stroke()
    }
    context.restore()
  }

  private drawPolygonDraft(polygon: NonNullable<CanvasOverlay['polygon']>, camera: Camera): void {
    const context = this.liveContext
    const color = this.boardColor(polygon.color, polygon.parentId)
    const points = polygon.points.map((point) => worldToScreen(point, camera, this.viewport))
    const first = points[0]!
    context.fillStyle = color
    context.strokeStyle = color
    context.lineWidth = polygon.size * camera.zoom
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(first.x, first.y)
    for (const point of points.slice(1)) context.lineTo(point.x, point.y)
    context.stroke()

    if (polygon.hover) {
      const last = points.at(-1)!
      const hover = worldToScreen(polygon.hover, camera, this.viewport)
      context.beginPath()
      context.moveTo(last.x, last.y)
      context.lineTo(hover.x, hover.y)
      context.setLineDash([5, 4])
      context.stroke()
      context.setLineDash([])
    }
    context.beginPath()
    context.arc(first.x, first.y, 3, 0, 2 * Math.PI)
    context.fill()
  }

  private drawRegion(points: readonly Point[], camera: Camera, dotted: boolean): void {
    const context = this.liveContext
    const start = worldToScreen(points[0]!, camera, this.viewport)
    context.beginPath()
    context.moveTo(start.x, start.y)
    for (const point of points.slice(1)) {
      const { x, y } = worldToScreen(point, camera, this.viewport)
      context.lineTo(x, y)
    }
    context.closePath()
    if (dotted) context.setLineDash([5, 4])
    context.stroke()
    context.setLineDash([])
  }
}
