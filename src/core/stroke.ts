import { getStroke } from "perfect-freehand";
import { screenToWorld } from "./camera";
import type { Brush, Camera, Point, Stroke, StrokePoint, Viewport } from "./types";

const OUTLINE_BRUSH_SIZE = 8;
const completeOutlines = new WeakMap<Stroke, readonly Point[]>();

function stabilizerFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 0;
}

function smoothingAlpha(cutoffHz: number, seconds: number): number {
  const ratio = 2 * Math.PI * cutoffHz * seconds;
  return ratio / (1 + ratio);
}

function interpolate(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

class OneEuroFilter {
  #previous?: { raw: Point; filtered: Point; velocity: Point; timestampMs: number };

  constructor(private readonly amount: number) {}

  sample(raw: Point, timestampMs: number): Point {
    if (this.amount === 0) return raw;

    const previous = this.#previous;
    const time = Number.isFinite(timestampMs) ? timestampMs : previous?.timestampMs ?? 0;
    if (!previous || time - previous.timestampMs > 200) {
      this.#previous = { raw, filtered: raw, velocity: { x: 0, y: 0 }, timestampMs: time };
      return raw;
    }

    const seconds = Math.max(1, time - previous.timestampMs) / 1_000;
    const derivativeAlpha = smoothingAlpha(1, seconds);
    const velocity = {
      x: interpolate(previous.velocity.x, (raw.x - previous.raw.x) / seconds, derivativeAlpha),
      y: interpolate(previous.velocity.y, (raw.y - previous.raw.y) / seconds, derivativeAlpha),
    };
    const minCutoff = interpolate(12, 2, this.amount);
    const beta = interpolate(0.07, 0.03, this.amount);
    const cutoff = minCutoff + beta * Math.hypot(velocity.x, velocity.y);
    const alpha = smoothingAlpha(cutoff, seconds);
    const filtered = {
      x: interpolate(previous.filtered.x, raw.x, alpha),
      y: interpolate(previous.filtered.y, raw.y, alpha),
    };

    this.#previous = { raw, filtered, velocity, timestampMs: Math.max(time, previous.timestampMs) };
    return filtered;
  }
}

function withPressure(point: Point, pressure: number | undefined): StrokePoint {
  return pressure !== undefined && pressure > 0 && pressure <= 1
    ? { x: point.x, y: point.y, pressure }
    : { x: point.x, y: point.y };
}

export function createStroke(
  id: string,
  points: readonly StrokePoint[],
  brush: Brush,
  zIndex: number,
): Stroke {
  const anchor = points[0];
  if (!anchor) throw new Error("A stroke must contain at least one point.");
  if (!Number.isFinite(brush.size) || brush.size <= 0) {
    throw new RangeError("A brush must have a finite positive size.");
  }

  const simulatePressure = brush.simulatePressure || !points.some(
    ({ pressure }) => pressure !== undefined && pressure > 0 && pressure <= 1 && pressure !== 0.5,
  );
  const localPoints = points.map((point) => withPressure(
    { x: point.x - anchor.x, y: point.y - anchor.y },
    simulatePressure ? undefined : point.pressure,
  ));
  if (localPoints.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new RangeError("Stroke coordinates must be finite.");
  }

  return {
    id,
    type: "stroke",
    transform: [1, 0, 0, 1, anchor.x, anchor.y],
    zIndex,
    locked: false,
    props: {
      points: localPoints,
      brush: { ...brush, stabilizer: stabilizerFraction(brush.stabilizer) * 100, simulatePressure },
      version: 1,
    },
  };
}

export function strokeOutline(stroke: Stroke, complete = true): readonly Point[] {
  const cached = complete ? completeOutlines.get(stroke) : undefined;
  if (cached) return cached;

  const { brush, points } = stroke.props;
  const stabilization = stabilizerFraction(brush.stabilizer);
  // Normalize to the nib size because perfect-freehand uses fixed distance thresholds.
  const scale = brush.size / OUTLINE_BRUSH_SIZE;
  const input = points.map(({ x, y, pressure }) => ({ x: x / scale, y: y / scale, pressure: pressure ?? 0.5 }));
  const [dot] = input;
  if (dot && input.length === 1) {
    // Identical samples keep a click at its center instead of adding an artificial offset.
    input.push(dot, dot);
  }

  const outline = getStroke(input, {
    size: OUTLINE_BRUSH_SIZE,
    simulatePressure: brush.simulatePressure,
    thinning: 0.45,
    streamline: interpolate(0.03, 0.24, stabilization),
    smoothing: interpolate(0.3, 0.55, stabilization),
    last: complete,
  }).map(([x, y]) => ({ x: x * scale, y: y * scale }));
  if (complete) completeOutlines.set(stroke, outline);
  return outline;
}

export type StrokeRoute = (point: Point, previous?: Point) => readonly Point[];

export class StrokeInput {
  #points: StrokePoint[] = [];
  #filter: OneEuroFilter;
  #lastPosition?: Point;
  #lastPressure: number | undefined;
  #lastGroupStart = 0;
  #lastRoute?: StrokeRoute;

  constructor(private readonly brush: Brush) {
    this.#filter = new OneEuroFilter(stabilizerFraction(brush.stabilizer));
  }

  get pointCount(): number {
    return this.#points.length;
  }

  add(screenPoint: StrokePoint, timestampMs: number, camera: Camera, viewport: Viewport, route?: StrokeRoute): void {
    if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return;

    const filtered = this.#filter.sample({ x: screenPoint.x, y: screenPoint.y }, timestampMs);
    const point = screenToWorld(filtered, camera, viewport);
    this.#lastPosition = screenToWorld(screenPoint, camera, viewport);
    this.#lastPressure = withPressure(point, screenPoint.pressure).pressure ?? this.#lastPressure;
    this.#lastRoute = route;

    const groupStart = this.#points.length;
    for (const position of route?.(point, this.#points.at(-1)) ?? [point]) {
      const sample = withPressure(position, screenPoint.pressure);
      const previous = this.#points.at(-1);
      if (previous?.x === sample.x && previous.y === sample.y && previous.pressure === sample.pressure) continue;
      this.#points.push(sample);
    }
    if (this.#points.length !== groupStart) this.#lastGroupStart = groupStart;
  }

  preview(): Stroke | undefined {
    if (this.#points.length === 0) return undefined;
    return createStroke("preview", this.#points, this.brush, 0);
  }

  finish(id: string, zIndex: number): Stroke | undefined {
    if (!this.#lastPosition) return undefined;

    const preceding = this.#points.slice(0, this.#lastGroupStart);
    const last = this.#lastRoute?.(this.#lastPosition, preceding.at(-1)) ?? [this.#lastPosition];
    return createStroke(id, [...preceding, ...last.map((point) => withPressure(point, this.#lastPressure))], this.brush, zIndex);
  }
}
