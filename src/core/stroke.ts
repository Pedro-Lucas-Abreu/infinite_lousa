import { getStroke } from "perfect-freehand";
import { screenToWorld } from "./camera";
import type { Brush, Camera, Point, Stroke, StrokePoint, Viewport } from "./types";
import { clipInkToExterior, type SolidBoundary } from "../instruments/solids";

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
  )).map((point, i) => points[i].breakBefore ? { ...point, breakBefore: true as const } : point);
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
  const outline = outlineFor(points, brush, complete);
  if (complete) completeOutlines.set(stroke, outline);
  return outline;
}

function outlineFor(points: readonly StrokePoint[], brush: Brush, complete: boolean): readonly Point[] {
  const stabilization = stabilizerFraction(brush.stabilizer);
  // Normalize to the nib size because perfect-freehand uses fixed distance thresholds.
  const scale = brush.size / OUTLINE_BRUSH_SIZE;
  const input = points.map(({ x, y, pressure }) => ({ x: x / scale, y: y / scale, pressure: pressure ?? 0.5 }));
  const [dot] = input;
  if (dot && input.length === 1) {
    // Identical samples keep a click at its center instead of adding an artificial offset.
    input.push(dot, dot);
  }

  return getStroke(input, {
    size: OUTLINE_BRUSH_SIZE,
    simulatePressure: brush.simulatePressure,
    thinning: 0.45,
    streamline: interpolate(0.03, 0.24, stabilization),
    smoothing: interpolate(0.3, 0.55, stabilization),
    last: complete,
  }).map(([x, y]) => ({ x: x * scale, y: y * scale }));
}

export function strokeContours(stroke: Stroke, complete = true): readonly (readonly Point[])[] {
  return stroke.props.contours ?? [strokeOutline(stroke, complete)];
}

export type StrokeRoute = (point: Point, previous?: Point) => readonly StrokePoint[];
type Sample = { point: StrokePoint; guided: boolean };

export class StrokeInput {
  #samples: Sample[] = [];
  #filter: OneEuroFilter;
  #lastPosition?: Point;
  #lastPressure: number | undefined;
  #lastGroupStart = 0;
  #lastRoute?: StrokeRoute;

  constructor(private readonly brush: Brush, private readonly boundaries: readonly SolidBoundary[] = []) {
    this.#filter = new OneEuroFilter(stabilizerFraction(brush.stabilizer));
  }

  get pointCount(): number {
    return this.#samples.length;
  }

  add(screenPoint: StrokePoint, timestampMs: number, camera: Camera, viewport: Viewport, route?: StrokeRoute): void {
    if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) return;

    const filtered = this.#filter.sample({ x: screenPoint.x, y: screenPoint.y }, timestampMs);
    const point = screenToWorld(filtered, camera, viewport);
    this.#lastPosition = screenToWorld(screenPoint, camera, viewport);
    this.#lastPressure = withPressure(point, screenPoint.pressure).pressure ?? this.#lastPressure;
    this.#lastRoute = route;

    const groupStart = this.#samples.length;
    for (const position of route?.(point, this.#samples.at(-1)?.point) ?? [point]) {
      const sample = this.sample(position, screenPoint.pressure, Boolean(route));
      const previous = this.#samples.at(-1);
      if (!sample.point.breakBefore && previous?.guided === sample.guided && previous.point.x === sample.point.x &&
        previous.point.y === sample.point.y && previous.point.pressure === sample.point.pressure) continue;
      this.#samples.push(sample);
    }
    if (this.#samples.length !== groupStart) this.#lastGroupStart = groupStart;
  }

  private sample(point: StrokePoint, pressure: number | undefined, guided: boolean): Sample {
    return { guided, point: { ...withPressure(point, pressure), ...(point.breakBefore ? { breakBefore: true as const } : {}) } };
  }

  private build(id: string, zIndex: number, samples: readonly Sample[], complete: boolean): Stroke | undefined {
    if (!samples.length) return;
    const stroke = createStroke(id, samples.map(({ point }) => point), this.brush, zIndex);
    if (!this.boundaries.length || !samples.some(({ guided }) => guided)) return stroke;
    const [,,,, x, y] = stroke.transform;
    const bodies = this.boundaries.map((body) => body.map((p) => ({ x: p.x - x, y: p.y - y })));
    const points = stroke.props.points;
    const contours: (readonly Point[])[] = [];
    let start = 0;
    for (let end = 1; end <= samples.length; end++) {
      const next = samples[end];
      const guided = samples[end - 1].guided;
      if (next && next.guided === guided && !next.point.breakBefore) continue;
      const outline = outlineFor(points.slice(start, end), stroke.props.brush, complete || Boolean(next));
      const visible = guided ? bodies.reduce(clipInkToExterior, [outline] as readonly SolidBoundary[]) : [outline];
      if (start === 0 && end === samples.length && visible.length === 1 && visible[0] === outline) return stroke;
      contours.push(...visible);
      start = next?.point.breakBefore ? end : end - 1;
    }
    if (!contours.length) return;
    return { ...stroke, props: { ...stroke.props, contours } };
  }

  preview(): Stroke | undefined {
    return this.build("preview", 0, this.#samples, false);
  }

  finish(id: string, zIndex: number): Stroke | undefined {
    if (!this.#lastPosition) return undefined;

    // A guided sample can contain several detour vertices. Keep the verified path
    // drawn so far and route the release point from its actual endpoint.
    const preceding = this.#lastRoute ? this.#samples : this.#samples.slice(0, this.#lastGroupStart);
    const last = this.#lastRoute?.(this.#lastPosition, preceding.at(-1)?.point) ?? [this.#lastPosition];
    return this.build(id, zIndex, [...preceding, ...last.map((point) =>
      this.sample(point, this.#lastPressure, Boolean(this.#lastRoute)))], true);
  }
}
