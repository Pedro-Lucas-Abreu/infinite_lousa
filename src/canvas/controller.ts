import { panBy, zoomAt } from '../core/camera'
import type { Scene } from '../core/scene'
import { StrokeInput } from '../core/stroke'
import type { Camera, Point, Stroke, StrokePoint, Viewport } from '../core/types'
import { CanvasRenderer, type BackgroundFrameMetrics } from './renderer'

export type { BackgroundFrameMetrics } from './renderer'

export type BoardTool = 'pen' | 'hand'

export interface BrushStyle {
  color: string
  size: number
}

export interface InkFrameMetrics {
  renderMs: number
  eventToRenderMs: number
  timeStamp: number
  committed: boolean
}

export interface BoardControllerOptions {
  scene: Scene
  confirmedCanvas: HTMLCanvasElement
  liveCanvas: HTMLCanvasElement
  onCameraChange?: (camera: Camera) => void
  onBackgroundFrame?: (metrics: BackgroundFrameMetrics) => void
  onInkFrame?: (metrics: InkFrameMetrics) => void
  onStrokeCommit?: (stroke: Stroke) => void
}

interface InkSample {
  point: StrokePoint
  timeStamp: number
  camera: Camera
  viewport: Viewport
}

interface InkGesture {
  kind: 'ink'
  pointerId: number
  input: StrokeInput
  samples: InkSample[]
}

interface PanGesture {
  kind: 'pan'
  pointerId: number
  last: Point
}

function eventPoint(event: PointerEvent | WheelEvent, rect: DOMRect): Point {
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

export class BoardController {
  private readonly renderer: CanvasRenderer
  private readonly listeners = new AbortController()
  private readonly resizeObserver: ResizeObserver
  private readonly touches = new Map<number, Point>()
  private readonly completedGestures: InkGesture[] = []
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private style: BrushStyle = { color: '#1a2433', size: 4 }
  private tool: BoardTool = 'pen'
  private stabilizer = 35
  private zoomRequiresCtrl = false
  private spaceHeld = false
  private gesture: InkGesture | PanGesture | undefined
  private preview: Stroke | undefined
  private backgroundDirty = true
  private liveDirty = true
  private cameraChanged = false
  private frameRequest: number | undefined

  constructor(private readonly options: BoardControllerOptions) {
    const { confirmedCanvas, liveCanvas } = options
    const { signal } = this.listeners
    this.renderer = new CanvasRenderer(confirmedCanvas, liveCanvas)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(liveCanvas)

    liveCanvas.addEventListener('pointerdown', this.pointerDown, { signal })
    liveCanvas.addEventListener('pointermove', this.pointerMove, { signal })
    liveCanvas.addEventListener('pointerup', this.pointerUp, { signal })
    liveCanvas.addEventListener('pointercancel', this.pointerCancel, { signal })
    liveCanvas.addEventListener('lostpointercapture', this.pointerCancel, { signal })
    liveCanvas.addEventListener('wheel', this.wheel, { passive: false, signal })
    window.addEventListener('keydown', this.keyDown, { signal })
    window.addEventListener('keyup', this.keyUp, { signal })
    window.addEventListener('blur', this.blur, { signal })
    window.addEventListener('resize', this.resize, { signal })

    this.resize()
    this.updateCursor()
    this.requestFrame()
  }

  setTool(tool: BoardTool): void {
    this.tool = tool
    this.updateCursor()
  }

  setStyle(style: BrushStyle): void {
    this.style = { ...style }
  }

  setStabilizer(value: number): void {
    this.stabilizer = Math.max(0, Math.min(100, value))
  }

  setZoomRequiresCtrl(value: boolean): void {
    this.zoomRequiresCtrl = value
  }

  zoomBy(factor: number): void {
    const { width, height } = this.renderer.viewport
    this.setCamera(zoomAt(this.camera, { x: width / 2, y: height / 2 }, this.renderer.viewport, factor))
  }

  getCamera(): Camera {
    return { ...this.camera }
  }

  setCamera(camera: Camera): void {
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) ||
      !Number.isFinite(camera.zoom) || camera.zoom <= 0) return
    if (camera.x === this.camera.x && camera.y === this.camera.y && camera.zoom === this.camera.zoom) return

    this.camera = { ...camera }
    this.cameraChanged = true
    this.liveDirty = true
    this.invalidateScene()
  }

  invalidateScene(): void {
    this.backgroundDirty = true
    this.requestFrame()
  }

  destroy(): void {
    this.listeners.abort()
    this.resizeObserver.disconnect()
    if (this.frameRequest !== undefined) cancelAnimationFrame(this.frameRequest)
    this.releasePointers()
  }

  private requestFrame(): void {
    this.frameRequest ??= requestAnimationFrame(this.drawFrame)
  }

  private drawFrame = (): void => {
    this.frameRequest = undefined
    const start = performance.now()
    const committed: Stroke[] = []
    let earliestSample = Infinity

    for (const gesture of this.completedGestures.splice(0)) {
      earliestSample = Math.min(earliestSample, this.consumeSamples(gesture))
      const stroke = gesture.input.finish(crypto.randomUUID(), this.options.scene.nextZIndex())
      if (stroke) {
        this.options.scene.add(stroke)
        committed.push(stroke)
        this.options.onStrokeCommit?.(stroke)
      }
    }

    if (this.gesture?.kind === 'ink' && this.gesture.samples.length > 0) {
      earliestSample = Math.min(earliestSample, this.consumeSamples(this.gesture))
      this.preview = this.gesture.input.preview()
      this.liveDirty = true
    }

    let backgroundMetrics: BackgroundFrameMetrics | undefined
    if (this.backgroundDirty) {
      this.backgroundDirty = false
      backgroundMetrics = this.renderer.drawBackground(this.options.scene, this.camera)
    } else {
      for (const stroke of committed) this.renderer.drawConfirmedStroke(stroke, this.camera)
    }

    if (this.liveDirty) {
      this.liveDirty = false
      this.renderer.drawLive(this.preview, this.camera)
    }
    const timeStamp = performance.now()

    if (earliestSample !== Infinity) {
      this.options.onInkFrame?.({
        renderMs: timeStamp - start,
        eventToRenderMs: Math.max(0, timeStamp - earliestSample),
        timeStamp,
        committed: committed.length > 0,
      })
    }
    if (backgroundMetrics) this.options.onBackgroundFrame?.(backgroundMetrics)
    if (this.cameraChanged) {
      this.cameraChanged = false
      this.options.onCameraChange?.(this.getCamera())
    }
  }

  private consumeSamples(gesture: InkGesture): number {
    const earliestSample = gesture.samples[0]?.timeStamp ?? Infinity
    for (const sample of gesture.samples) {
      gesture.input.add(sample.point, sample.timeStamp, sample.camera, sample.viewport)
    }
    gesture.samples.length = 0
    return earliestSample
  }

  private resize = (): void => {
    const rect = this.options.liveCanvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    if (this.renderer.resize(rect.width, rect.height, window.devicePixelRatio)) {
      this.liveDirty = true
      this.invalidateScene()
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    const isTouch = event.pointerType === 'touch'
    if (this.gesture && (!isTouch || !this.touches.has(this.gesture.pointerId))) return

    const canvas = this.options.liveCanvas
    const rect = canvas.getBoundingClientRect()
    const point = eventPoint(event, rect)
    event.preventDefault()
    if (!isTouch && document.activeElement !== canvas) canvas.focus({ preventScroll: true })
    canvas.setPointerCapture(event.pointerId)

    if (isTouch) {
      this.touches.set(event.pointerId, point)
      if (this.touches.size > 1) {
        this.cancelGesture()
        return
      }
    }

    if (event.button === 1 || event.ctrlKey || this.spaceHeld || this.tool === 'hand') {
      this.gesture = { kind: 'pan', pointerId: event.pointerId, last: point }
    } else {
      const input = new StrokeInput({
        color: this.style.color,
        size: this.style.size / this.camera.zoom,
        stabilizer: this.stabilizer,
        simulatePressure: event.pointerType === 'mouse',
      })
      const gesture: InkGesture = { kind: 'ink', pointerId: event.pointerId, input, samples: [] }
      this.enqueueSample(gesture, event, rect)
      this.gesture = gesture
    }
    this.updateCursor()
  }

  private pointerMove = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId && !this.touches.has(event.pointerId)) return
    const rect = this.options.liveCanvas.getBoundingClientRect()
    const point = eventPoint(event, rect)

    if (this.touches.has(event.pointerId)) {
      if (this.touches.size > 1) {
        this.pinch(event.pointerId, point)
        return
      }
      this.touches.set(event.pointerId, point)
    }

    if (this.gesture?.pointerId !== event.pointerId) return
    if (this.gesture.kind === 'pan') {
      const previous = this.gesture.last
      this.gesture.last = point
      this.setCamera(panBy(this.camera, point.x - previous.x, point.y - previous.y))
    } else {
      const coalesced = event.getCoalescedEvents?.()
      for (const sample of coalesced?.length ? coalesced : [event]) {
        this.enqueueSample(this.gesture, sample, rect)
      }
    }
  }

  private enqueueSample(gesture: InkGesture, event: PointerEvent, rect: DOMRect): void {
    const point: StrokePoint = eventPoint(event, rect)
    const pressure = event.pressure > 0 && event.pointerType !== 'mouse' ? event.pressure : undefined
    gesture.samples.push({
      point: pressure === undefined ? point : { ...point, pressure },
      timeStamp: event.timeStamp,
      camera: this.camera,
      viewport: this.renderer.viewport,
    })
    this.requestFrame()
  }

  private pinch(pointerId: number, point: Point): void {
    const [first, second] = this.touches.values()
    this.touches.set(pointerId, point)
    const [nextFirst, nextSecond] = this.touches.values()
    if (!first || !second || !nextFirst || !nextSecond) return

    const before = midpoint(first, second)
    const after = midpoint(nextFirst, nextSecond)
    const oldDistance = distance(first, second)
    const zoom = oldDistance > 0 ? distance(nextFirst, nextSecond) / oldDistance : 1
    const zoomed = zoomAt(this.camera, before, this.renderer.viewport, zoom)
    this.setCamera(panBy(zoomed, after.x - before.x, after.y - before.y))
  }

  private pointerUp = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId)
    if (this.gesture?.pointerId !== event.pointerId) return

    if (this.gesture.kind === 'ink') {
      this.enqueueSample(this.gesture, event, this.options.liveCanvas.getBoundingClientRect())
      this.completedGestures.push(this.gesture)
    }
    this.cancelGesture()
  }

  private pointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId)
    if (this.gesture?.pointerId === event.pointerId) this.cancelGesture()
  }

  private cancelGesture(): void {
    this.gesture = undefined
    this.preview = undefined
    this.liveDirty = true
    this.updateCursor()
    this.requestFrame()
  }

  private wheel = (event: WheelEvent): void => {
    if (this.zoomRequiresCtrl && !event.ctrlKey) return
    event.preventDefault()
    if (this.gesture?.kind === 'ink') return

    const viewport = this.renderer.viewport
    const point = eventPoint(event, this.options.liveCanvas.getBoundingClientRect())
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.height : 1
    const step = Math.max(-1, Math.min(1, -event.deltaY * unit * 0.002))
    this.setCamera(zoomAt(this.camera, point, viewport, Math.exp(step)))
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable ||
      target.closest('input, textarea, select, button, a, [role="button"]'))) return

    event.preventDefault()
    this.spaceHeld = true
    this.updateCursor()
  }

  private keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.spaceHeld = false
      this.updateCursor()
    }
  }

  private blur = (): void => {
    this.spaceHeld = false
    this.releasePointers()
    this.cancelGesture()
  }

  private releasePointers(): void {
    const ids = new Set(this.touches.keys())
    if (this.gesture) ids.add(this.gesture.pointerId)
    for (const id of ids) {
      if (this.options.liveCanvas.hasPointerCapture(id)) this.options.liveCanvas.releasePointerCapture(id)
    }
    this.touches.clear()
  }

  private updateCursor(): void {
    this.options.liveCanvas.style.cursor = this.gesture?.kind === 'pan' ? 'grabbing' :
      (this.tool === 'hand' || this.spaceHeld) && this.gesture?.kind !== 'ink' ? 'grab' : 'crosshair'
  }
}
