import RBush from "rbush";
import { strokeOutline } from "./stroke";
import type { Bounds, Stroke } from "./types";

interface IndexedStroke extends Bounds {
  readonly stroke: Stroke;
}

export interface SceneSnapshot {
  readonly version: 1;
  readonly objects: readonly Stroke[];
}

function compareStrokes(a: Stroke, b: Stroke): number {
  return a.zIndex - b.zIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function indexStroke(stroke: Stroke): IndexedStroke {
  const [a, b, c, d, e, f] = stroke.transform;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of strokeOutline(stroke)) {
    const x = a * point.x + c * point.y + e;
    const y = b * point.x + d * point.y + f;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (![minX, minY, maxX, maxY, stroke.zIndex].every(Number.isFinite)) {
    throw new RangeError("A stroke must have finite bounds and z-index.");
  }

  return { minX, minY, maxX, maxY, stroke };
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY;
}

export class Scene {
  #tree = new RBush<IndexedStroke>();
  #strokes = new Map<string, Stroke>();
  #ordered: readonly Stroke[] | undefined;
  #bounds: Bounds | undefined;
  #nextZIndex = 0;

  constructor(strokes: readonly Stroke[] = []) {
    if (strokes.length > 0) this.replace(strokes);
  }

  add(stroke: Stroke): void {
    if (this.#strokes.has(stroke.id)) throw new Error("A stroke with this ID already exists.");

    const entry = indexStroke(stroke);
    this.#tree.insert(entry);
    this.#strokes.set(stroke.id, stroke);
    const { minX, minY, maxX, maxY } = entry;
    this.#bounds = this.#bounds ? union(this.#bounds, entry) : { minX, minY, maxX, maxY };
    this.#nextZIndex = Math.max(this.#nextZIndex, stroke.zIndex + 1);
    this.#ordered = undefined;
  }

  remove(id: string): boolean {
    const stroke = this.#strokes.get(id);
    if (!stroke) return false;

    this.#tree.remove(indexStroke(stroke), (a, b) => a.stroke.id === b.stroke.id);
    this.#strokes.delete(id);
    this.#ordered = undefined;
    // A stale enclosing bound is safe for culling, but callers also use bounds to fit content.
    const { minX, minY, maxX, maxY } = this.#tree.toJSON() as Bounds;
    this.#bounds = this.#strokes.size > 0 ? { minX, minY, maxX, maxY } : undefined;
    return true;
  }

  replace(strokes: readonly Stroke[]): void {
    const replacement = new Map<string, Stroke>();
    let bounds: Bounds | undefined;
    let nextZIndex = 0;
    const entries = strokes.map((stroke) => {
      if (replacement.has(stroke.id)) throw new Error("A stroke with this ID already exists.");

      const entry = indexStroke(stroke);
      replacement.set(stroke.id, stroke);
      const { minX, minY, maxX, maxY } = entry;
      bounds = bounds ? union(bounds, entry) : { minX, minY, maxX, maxY };
      nextZIndex = Math.max(nextZIndex, stroke.zIndex + 1);
      return entry;
    });

    this.#tree = new RBush<IndexedStroke>().load(entries);
    this.#strokes = replacement;
    this.#bounds = bounds;
    this.#nextZIndex = nextZIndex;
    this.#ordered = undefined;
  }

  search(bounds: Bounds): readonly Stroke[] {
    if (this.#bounds && contains(bounds, this.#bounds)) return this.all();
    return this.#tree.search(bounds).map(({ stroke }) => stroke).sort(compareStrokes);
  }

  all(): readonly Stroke[] {
    return this.#ordered ??= Array.from(this.#strokes.values()).sort(compareStrokes);
  }

  bounds(): Bounds | undefined {
    return this.#bounds;
  }

  nextZIndex(): number {
    return this.#nextZIndex;
  }

  snapshot(): SceneSnapshot {
    return { version: 1, objects: this.all() };
  }
}
