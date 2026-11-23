import { panBy, screenToWorld, zoomAt } from '../core/camera'
import { objectBounds, type Scene } from '../core/scene'
import { StrokeInput } from '../core/stroke'
import type { Affine, BoardChange, BoardObject, Bounds, Camera, FrameObject, Point, Stroke, StrokePoint, Viewport } from '../core/types'
import { boundsFromPoints, expandBounds, fittingFrame, hitInk, hitObject, multiplyTransforms, rectanglePoints,
  regionIntersects, selectionHandles } from './geometry'
import { CanvasRenderer, type BackgroundFrameMetrics, type BoardBackground, type CanvasOverlay, type GetPageRaster } from './renderer'

export type { BackgroundFrameMetrics } from './renderer'
export type { BoardBackground, GetPageRaster } from './renderer'

export type BoardTool = 'pen' | 'hand' | 'highlight' | 'erase' | 'select' | 'lasso' | 'frame'

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
  onChanges?: (changes: readonly BoardChange[]) => void
  onSelectionChange?: (objects: readonly BoardObject[]) => void
  getPageRaster?: GetPageRaster
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
  parentId?: string
}

interface PanGesture {
  kind: 'pan'
  pointerId: number
  last: Point
}

interface EraseGesture {
  kind: 'erase'
  pointerId: number
  last: Point
  affected: Map<string, Stroke>
}

interface RegionGesture {
  kind: 'region'
  pointerId: number
  mode: 'rectangle' | 'lasso' | 'frame'
  start: Point
  last: Point
  points: Point[]
  extend: boolean
}

type TransformMode = { type: 'move' } | { type: 'rotate'; center: Point } |
  { type: 'resize'; corner: Point; origin: Point }

interface TransformGesture {
  kind: 'transform'
  pointerId: number
  start: Point
  mode: TransformMode
  objects: readonly BoardObject[]
  preview?: readonly BoardObject[]
}

type Gesture = InkGesture | PanGesture | EraseGesture | RegionGesture | TransformGesture

const eraserPixels = 9
const translation = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy]

function getParent(object: BoardObject): string | undefined {
  return 'parentId' in object ? object.parentId : undefined
}

function withoutParent(object: BoardObject): BoardObject {
  if (!('parentId' in object)) return object
  const { parentId: _, ...detached } = object
  return detached
}

function combinedBounds(objects: readonly BoardObject[]): Bounds | undefined {
  if (!objects.length) return undefined
  return boundsFromPoints(objects.flatMap((object) => {
    const bounds = objectBounds(object)
    return [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]
  }))
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
  private eraserHeld = false
  private gesture: Gesture | undefined
  private eraserPoint: Point | undefined
  private lastPointer: Point | undefined
  private background: BoardBackground = 'white'
  private selection = new Set<string>()
  private clipboard: readonly BoardObject[] = []
  private preview: Stroke | undefined
  private backgroundDirty = true
  private liveDirty = true
  private cameraChanged = false
  private frameRequest: number | undefined

  constructor(private readonly options: BoardControllerOptions) {
    const { confirmedCanvas, liveCanvas } = options
    const { signal } = this.listeners
    this.renderer = new CanvasRenderer(confirmedCanvas, liveCanvas, options.getPageRaster)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(liveCanvas)

    liveCanvas.addEventListener('pointerdown', this.pointerDown, { signal })
    liveCanvas.addEventListener('pointermove', this.pointerMove, { signal })
    liveCanvas.addEventListener('pointerup', this.pointerUp, { signal })
    liveCanvas.addEventListener('pointercancel', this.pointerCancel, { signal })
    liveCanvas.addEventListener('lostpointercapture', this.pointerCancel, { signal })
    liveCanvas.addEventListener('pointerleave', this.pointerLeave, { signal })
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
    if (this.tool === tool) return
    this.tool = tool
    if (tool !== 'select' && tool !== 'lasso') this.clearSelection()
    this.refreshLive()
    this.updateCursor()
  }

  setBackground(background: BoardBackground): void {
    if (this.background === background) return
    this.background = background
    this.invalidateScene()
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

  getViewport(): Viewport {
    return this.renderer.viewport
  }

  getSelection(): readonly BoardObject[] {
    const selected: BoardObject[] = []
    for (const id of this.selection) {
      const object = this.options.scene.get(id)
      if (object && !object.locked) selected.push(object)
    }
    return selected
  }

  clearSelection(): void {
    if (this.selection.size) this.selectObjects([])
  }

  deleteSelection(): void {
    const selected = this.getSelection()
    if (!selected.length) return
    const ids = new Set(selected.map((object) => object.id))
    const detached = this.options.scene.all().filter((object) => {
      const parent = getParent(object)
      return parent !== undefined && ids.has(parent) && !ids.has(object.id)
    })
    this.applyChanges([
      ...selected.map((before) => ({ before })),
      ...detached.map((before) => ({ before, after: withoutParent(before) })),
    ])
    this.clearSelection()
  }

  duplicateSelection(): void {
    this.insertCopies(this.selectedWithChildren())
  }

  copySelection(): boolean {
    const objects = this.selectedWithChildren()
    if (!objects.length) return false
    this.clipboard = objects
    return true
  }

  pasteSelection(): boolean {
    if (!this.clipboard.length) return false
    const { width, height } = this.renderer.viewport
    const bounds = this.options.liveCanvas.getBoundingClientRect()
    const pointer = this.lastPointer && { x: this.lastPointer.x - bounds.left, y: this.lastPointer.y - bounds.top }
    const target = pointer && pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height
      ? pointer : { x: width / 2, y: height / 2 }
    this.insertCopies(this.clipboard, screenToWorld(target, this.camera, this.renderer.viewport))
    return true
  }

  setSelectionLocked(locked: boolean): void {
    this.applyChanges(this.getSelection().map((before) => ({ before, after: { ...before, locked } })))
    if (locked) this.clearSelection()
  }

  transformSelection(transform: Affine): void {
    this.applyChanges(this.selectedWithChildren().map((before) => ({ before,
      after: { ...before, transform: multiplyTransforms(transform, before.transform) } })))
    this.options.onSelectionChange?.(this.getSelection())
  }

  moveSelection(dxCss: number, dyCss: number): void {
    this.transformSelection(translation(dxCss / this.camera.zoom, dyCss / this.camera.zoom))
  }

  rotateSelection(degrees: number): void {
    const selected = this.getSelection()
    const bounds = combinedBounds(selected)
    if (!bounds || selected.some((object) => object.type === 'frame')) return

    const center = midpoint({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY })
    const angle = degrees * Math.PI / 180
    const cosine = Math.cos(angle), sine = Math.sin(angle)
    this.transformSelection(this.around(center, [cosine, sine, -sine, cosine, 0, 0]))
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
    if (this.selection.size) {
      const remaining = this.getSelection()
      if (remaining.length !== this.selection.size) this.selectObjects(remaining)
      this.liveDirty = true
    }
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

  private refreshLive(): void {
    this.liveDirty = true
    this.requestFrame()
  }

  private selectObjects(objects: readonly BoardObject[]): void {
    this.selection = new Set(objects.map((object) => object.id))
    this.options.onSelectionChange?.(objects)
    this.refreshLive()
  }

  private selectedWithChildren(): readonly BoardObject[] {
    if (!this.selection.size) return []
    return this.options.scene.all().filter((object) => {
      const parent = getParent(object)
      return this.selection.has(object.id) && !object.locked || parent !== undefined && this.selection.has(parent)
    })
  }

  private insertCopies(objects: readonly BoardObject[], target?: Point): void {
    if (!objects.length) return
    const ids = new Map(objects.map((object) => [object.id, crypto.randomUUID()]))
    const zIndex = this.options.scene.nextZIndex()
    let frameOrder = this.nextFrameOrder()
    const bounds = target && combinedBounds(objects)
    const offset = target && bounds
      ? translation(target.x - (bounds.minX + (bounds.maxX - bounds.minX) / 2),
        target.y - (bounds.minY + (bounds.maxY - bounds.minY) / 2))
      : translation(24 / this.camera.zoom, 24 / this.camera.zoom)
    const copies = objects.map((object, i): BoardObject => {
      const base = { id: ids.get(object.id)!, zIndex: zIndex + i,
        transform: multiplyTransforms(offset, object.transform) }
      const originalParent = getParent(object)
      const parentId = originalParent && (ids.get(originalParent) ??
        (this.options.scene.get(originalParent)?.type === 'pdfPage' ? originalParent : undefined))
      const parent = parentId ? { parentId } : {}

      if (object.type === 'stroke') return { ...withoutParent(object) as Stroke, ...base, ...parent }
      if (object.type === 'frame') return { ...withoutParent(object) as FrameObject, ...base, ...parent,
        props: { ...object.props, order: frameOrder++ } }
      return { ...object, ...base }
    })
    this.applyChanges(copies.map((after) => ({ after })))
    const copiedIds = new Set(copies.map((object) => object.id))
    this.selectObjects(copies.filter((object) => {
      const parent = getParent(object)
      return parent === undefined || !copiedIds.has(parent)
    }))
  }

  private nextFrameOrder(): number {
    let order = 0
    for (const object of this.options.scene.all()) {
      if (object.type === 'frame') order = Math.max(order, object.props.order + 1)
    }
    return order
  }

  private applyChanges(changes: readonly BoardChange[]): void {
    if (!changes.length) return
    if (this.options.onChanges) this.options.onChanges(changes)
    else this.options.scene.applyChanges(changes)
    this.invalidateScene()
  }

  private drawFrame = (): void => {
    this.frameRequest = undefined
    const start = performance.now()
    const committed: Stroke[] = []
    let earliestSample = Infinity

    for (const gesture of this.completedGestures.splice(0)) {
      earliestSample = Math.min(earliestSample, this.consumeSamples(gesture))
      const drawn = gesture.input.finish(crypto.randomUUID(), this.options.scene.nextZIndex())
      if (drawn) {
        const stroke = gesture.parentId ? { ...drawn, parentId: gesture.parentId } : drawn
        if (this.options.onStrokeCommit || !this.options.onChanges) {
          this.options.scene.add(stroke)
          this.options.onStrokeCommit?.(stroke)
        } else this.options.onChanges([{ after: stroke }])
        committed.push(stroke)
      }
    }

    if (this.gesture?.kind === 'ink' && this.gesture.samples.length > 0) {
      earliestSample = Math.min(earliestSample, this.consumeSamples(this.gesture))
      const drawn = this.gesture.input.preview()
      this.preview = drawn && this.gesture.parentId ? { ...drawn, parentId: this.gesture.parentId } : drawn
      this.liveDirty = true
    }

    let backgroundMetrics: BackgroundFrameMetrics | undefined
    if (this.backgroundDirty) {
      this.backgroundDirty = false
      const hidden = this.gesture?.kind === 'erase' ? this.gesture.affected :
        this.gesture?.kind === 'transform' && this.gesture.preview ? new Set(this.gesture.objects.map((object) => object.id)) : undefined
      backgroundMetrics = this.renderer.drawBackground(this.options.scene, this.camera, this.background, hidden)
    } else {
      for (const stroke of committed) this.renderer.drawConfirmedStroke(stroke, this.camera)
    }

    if (this.liveDirty) {
      this.liveDirty = false
      this.renderer.drawLive(this.preview, this.camera, this.overlay())
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

  private overlay(): CanvasOverlay | undefined {
    const gesture = this.gesture
    const activePreview = gesture?.kind === 'transform' ? gesture.preview : undefined
    const selected = activePreview ? activePreview.filter((object) => this.selection.has(object.id)) : this.getSelection()
    const bounds = combinedBounds(selected)
    const overlay: CanvasOverlay = {}
    if (activePreview) overlay.previewObjects = activePreview
    if (bounds) overlay.selection = { bounds, canRotate: !selected.some((object) => object.type === 'frame') }
    if (gesture?.kind === 'region') overlay.region = this.regionFor(gesture)
    if ((gesture?.kind === 'erase' || this.activeTool() === 'erase') && this.eraserPoint) {
      overlay.eraser = { point: this.eraserPoint, radius: eraserPixels / this.camera.zoom }
    }
    return Object.keys(overlay).length ? overlay : undefined
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
    this.lastPointer = { x: event.clientX, y: event.clientY }
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

    const tool = this.activeTool()
    const world = screenToWorld(point, this.camera, this.renderer.viewport)
    if (event.button === 1 || event.ctrlKey || this.spaceHeld || tool === 'hand') {
      this.gesture = { kind: 'pan', pointerId: event.pointerId, last: point }
    } else if (tool === 'erase') {
      const gesture: EraseGesture = { kind: 'erase', pointerId: event.pointerId, last: world, affected: new Map() }
      this.gesture = gesture
      this.eraseAlong(gesture, world)
    } else if (tool === 'select' || tool === 'lasso' || tool === 'frame') {
      this.beginSelection(tool, event.pointerId, world, event.shiftKey)
    } else {
      const highlighting = tool === 'highlight'
      const input = new StrokeInput({
        color: highlighting ? '#ffcf35' : this.style.color,
        size: (highlighting ? Math.max(14, this.style.size * 3) : this.style.size) / this.camera.zoom,
        stabilizer: this.stabilizer,
        simulatePressure: event.pointerType === 'mouse',
        ...(highlighting ? { opacity: 0.35 } : {}),
      })
      const parentId = this.pdfAt(world)
      const gesture: InkGesture = { kind: 'ink', pointerId: event.pointerId, input, samples: [],
        ...(parentId ? { parentId } : {}) }
      this.enqueueSample(gesture, event, rect)
      this.gesture = gesture
    }
    this.updateCursor()
  }

  private pointerMove = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY }
    const hoverEraser = !this.gesture && this.activeTool() === 'erase' && event.pointerType !== 'touch'
    if (this.gesture?.pointerId !== event.pointerId && !this.touches.has(event.pointerId) && !hoverEraser) return
    const rect = this.options.liveCanvas.getBoundingClientRect()
    const point = eventPoint(event, rect)
    const world = screenToWorld(point, this.camera, this.renderer.viewport)
    if (hoverEraser) {
      this.eraserPoint = world
      this.refreshLive()
    }

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
    } else if (this.gesture.kind === 'ink') {
      const coalesced = event.getCoalescedEvents?.()
      for (const sample of coalesced?.length ? coalesced : [event]) {
        this.enqueueSample(this.gesture, sample, rect)
      }
    } else {
      this.updateEdit(this.gesture, world, event.shiftKey)
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

    const rect = this.options.liveCanvas.getBoundingClientRect()
    if (this.gesture.kind === 'ink') {
      this.enqueueSample(this.gesture, event, rect)
      this.completedGestures.push(this.gesture)
    } else if (this.gesture.kind !== 'pan') {
      const world = screenToWorld(eventPoint(event, rect), this.camera, this.renderer.viewport)
      this.updateEdit(this.gesture, world, event.shiftKey)
      this.commitEdit(this.gesture)
    }
    this.cancelGesture()
  }

  private pointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId)
    if (this.gesture?.pointerId === event.pointerId) this.cancelGesture()
  }

  private cancelGesture(): void {
    if (this.gesture?.kind === 'transform' || this.gesture?.kind === 'erase') this.invalidateScene()
    this.gesture = undefined
    this.preview = undefined
    this.liveDirty = true
    this.updateCursor()
    this.requestFrame()
  }

  private pointerLeave = (): void => {
    this.lastPointer = undefined
    if (this.gesture?.kind !== 'erase' && this.eraserPoint) {
      this.eraserPoint = undefined
      this.refreshLive()
    }
  }

  private wheel = (event: WheelEvent): void => {
    if (this.zoomRequiresCtrl && !event.ctrlKey) return
    event.preventDefault()
    if (this.gesture && this.gesture.kind !== 'pan') return

    const viewport = this.renderer.viewport
    const point = eventPoint(event, this.options.liveCanvas.getBoundingClientRect())
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.height : 1
    const step = Math.max(-1, Math.min(1, -event.deltaY * unit * 0.002))
    this.setCamera(zoomAt(this.camera, point, viewport, Math.exp(step)))
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable ||
      target.closest('input, textarea, select, button, a, [role="button"]'))) return

    if (event.code === 'Space') this.spaceHeld = true
    else if (event.code === 'KeyX') this.eraserHeld = true
    else if (event.code === 'Escape' && (this.gesture || this.selection.size)) {
      this.cancelGesture()
      this.clearSelection()
    } else return

    event.preventDefault()
    this.refreshLive()
    this.updateCursor()
  }

  private keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      this.spaceHeld = false
      this.updateCursor()
    }
    if (event.code === 'KeyX') {
      this.eraserHeld = false
      this.refreshLive()
      this.updateCursor()
    }
  }

  private blur = (): void => {
    this.spaceHeld = false
    this.eraserHeld = false
    this.eraserPoint = undefined
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
      (this.activeTool() === 'hand' || this.spaceHeld) && this.gesture?.kind !== 'ink' ? 'grab' : 'crosshair'
  }

  private activeTool(): BoardTool {
    return this.eraserHeld ? 'erase' : this.tool
  }

  private pdfAt(point: Point): string | undefined {
    const candidates = this.options.scene.search(boundsFromPoints([point]))
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i]!
      if (candidate.type === 'pdfPage' && hitObject(candidate, point, 0)) return candidate.id
    }
    return undefined
  }

  private beginSelection(tool: 'select' | 'lasso' | 'frame', pointerId: number, start: Point, extend: boolean): void {
    if (tool === 'select') {
      const mode = this.handleAt(start)
      if (mode) {
        this.gesture = { kind: 'transform', pointerId, start, mode, objects: this.selectedWithChildren() }
        return
      }

      const radius = 6 / this.camera.zoom
      const candidates = this.options.scene.search(expandBounds(boundsFromPoints([start]), radius))
      let clicked: BoardObject | undefined
      for (let i = candidates.length - 1; i >= 0; i--) {
        const candidate = candidates[i]!
        if (!candidate.locked && hitObject(candidate, start, radius)) {
          clicked = candidate
          break
        }
      }
      if (clicked) {
        const selected = this.getSelection()
        const alreadySelected = this.selection.has(clicked.id)
        if (extend && alreadySelected) {
          this.selectObjects(selected.filter((object) => object.id !== clicked.id))
          return
        }
        if (!alreadySelected) this.selectObjects(extend ? [...selected, clicked] : [clicked])
        this.gesture = { kind: 'transform', pointerId, start, mode: { type: 'move' }, objects: this.selectedWithChildren() }
        return
      }
    }

    if (!extend) this.clearSelection()
    const mode = tool === 'select' ? 'rectangle' : tool
    this.gesture = { kind: 'region', pointerId, mode, start, last: start, points: [start], extend }
    this.refreshLive()
  }

  private handleAt(point: Point): TransformMode | undefined {
    const selection = this.getSelection()
    const bounds = combinedBounds(selection)
    if (!bounds) return undefined

    const handles = selectionHandles(bounds, this.camera.zoom, !selection.some((object) => object.type === 'frame'))
    const index = handles.findIndex((handle) => distance(handle, point) <= 8 / this.camera.zoom)
    if (index < 0) return undefined
    if (index === 4) return { type: 'rotate', center: midpoint(handles[0]!, handles[2]!) }
    return { type: 'resize', corner: handles[index]!, origin: handles[(index + 2) % 4]! }
  }

  private eraseAlong(gesture: EraseGesture, next: Point): void {
    const radius = eraserPixels / this.camera.zoom
    const bounds = expandBounds(boundsFromPoints([gesture.last, next]), radius)
    const candidates = this.options.scene.search(bounds)
    let changed = false
    for (const object of candidates) {
      if (object.type === 'stroke' && !object.locked && !gesture.affected.has(object.id) &&
        hitInk(object, gesture.last, next, radius)) {
        gesture.affected.set(object.id, object)
        changed = true
      }
    }
    if (changed) this.invalidateScene()
    gesture.last = next
    this.eraserPoint = next
    this.refreshLive()
  }

  private updateEdit(gesture: EraseGesture | RegionGesture | TransformGesture, world: Point, constrained: boolean): void {
    if (gesture.kind === 'erase') {
      this.eraseAlong(gesture, world)
      return
    }
    if (gesture.kind === 'region') {
      gesture.last = world
      if (gesture.mode === 'lasso' && distance(world, gesture.points.at(-1)!) >= 2 / this.camera.zoom) {
        gesture.points.push(world)
      }
      this.refreshLive()
      return
    }

    if (distance(world, gesture.start) > 1 / this.camera.zoom) {
      const matrix = this.gestureTransform(gesture, world, constrained)
      const needsHide = gesture.preview === undefined
      gesture.preview = gesture.objects.map((object) => ({ ...object, transform: multiplyTransforms(matrix, object.transform) }))
      if (needsHide) this.invalidateScene()
    } else if (gesture.preview) {
      delete gesture.preview
      this.invalidateScene()
    }
    this.refreshLive()
  }

  private gestureTransform(gesture: TransformGesture, end: Point, constrained: boolean): Affine {
    const { mode, start } = gesture
    if (mode.type === 'move') return translation(end.x - start.x, end.y - start.y)
    if (mode.type === 'rotate') {
      const angleFrom = (point: Point) => Math.atan2(point.y - mode.center.y, point.x - mode.center.x)
      const angle = angleFrom(end) - angleFrom(start)
      const step = Math.PI / 12
      const adjusted = constrained ? Math.round(angle / step) * step : angle
      const cos = Math.cos(adjusted), sin = Math.sin(adjusted)
      return this.around(mode.center, [cos, sin, -sin, cos, 0, 0])
    }

    const width = mode.corner.x - mode.origin.x, height = mode.corner.y - mode.origin.y
    const minSize = 1 / this.camera.zoom
    let xScale = width === 0 ? 1 : Math.max(minSize / Math.abs(width), 1 + (end.x - start.x) / width)
    let yScale = height === 0 ? 1 : Math.max(minSize / Math.abs(height), 1 + (end.y - start.y) / height)
    if (constrained || gesture.objects.some((object) => object.type === 'frame' && this.selection.has(object.id))) {
      xScale = yScale = Math.max(xScale, yScale)
    }
    return this.around(mode.origin, [xScale, 0, 0, yScale, 0, 0])
  }

  private around(origin: Point, matrix: Affine): Affine {
    return multiplyTransforms(translation(origin.x, origin.y),
      multiplyTransforms(matrix, translation(-origin.x, -origin.y)))
  }

  private regionFor(gesture: RegionGesture): readonly Point[] {
    if (gesture.mode === 'lasso') return [...gesture.points, gesture.last]
    return rectanglePoints(gesture.mode === 'frame' ? fittingFrame(gesture.start, gesture.last) :
      boundsFromPoints([gesture.start, gesture.last]))
  }

  private commitEdit(gesture: EraseGesture | RegionGesture | TransformGesture): void {
    const scene = this.options.scene
    if (gesture.kind === 'erase') {
      this.applyChanges([...gesture.affected.values()].filter((before) => scene.get(before.id) === before).map((before) => ({ before })))
      return
    }
    if (gesture.kind === 'transform') {
      if (gesture.preview && gesture.objects.every((before) => scene.get(before.id) === before)) {
        this.applyChanges(gesture.preview.map((after, index) => ({ before: gesture.objects[index]!, after })))
        this.options.onSelectionChange?.(this.getSelection())
      }
      return
    }

    const region = this.regionFor(gesture)
    const bounds = boundsFromPoints(region)
    if (gesture.mode === 'frame') {
      if ((bounds.maxX - bounds.minX) * this.camera.zoom < 9) return
      const order = this.nextFrameOrder()
      const parentId = this.pdfAt(gesture.start)
      const frame: FrameObject = {
        id: crypto.randomUUID(), type: 'frame', locked: false, zIndex: scene.nextZIndex(),
        transform: translation(bounds.minX, bounds.minY),
        props: { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, name: `Quadro ${order + 1}`, order },
        ...(parentId ? { parentId } : {}),
      }
      this.applyChanges([{ after: frame }])
      return
    }

    if (region.length < 3 || Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * this.camera.zoom < 3) return
    const selected = gesture.extend ? this.getSelection().slice() : []
    const alreadySelected = new Set(selected.map((object) => object.id))
    selected.push(...scene.search(bounds).filter((object) => !object.locked && !alreadySelected.has(object.id) && regionIntersects(object, region)))
    this.selectObjects(selected)
  }
}
