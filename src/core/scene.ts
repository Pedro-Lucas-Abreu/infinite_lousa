import RBush from "rbush";
import { shapeArrowHead } from "./shapes";
import { strokeOutline } from "./stroke";
import type { Affine, BoardChange, BoardObject, Bounds, Point, ShapeObject } from "./types";

interface IndexedObject extends Bounds {
  readonly object: BoardObject;
}

export interface SceneSnapshot {
  readonly version: 1;
  readonly objects: readonly BoardObject[];
}

function compareObjects(a: BoardObject, b: BoardObject): number {
  return a.zIndex - b.zIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function rectangleBounds([a, b, c, d, e, f]: Affine, x: number, y: number, width: number, height: number): Bounds {
  // An affine rectangle reaches its extrema at its four corners.
  const left = a * x + c * y + e;
  const top = b * x + d * y + f;
  return {
    minX: left + Math.min(0, a * width) + Math.min(0, c * height),
    minY: top + Math.min(0, b * width) + Math.min(0, d * height),
    maxX: left + Math.max(0, a * width) + Math.max(0, c * height),
    maxY: top + Math.max(0, b * width) + Math.max(0, d * height),
  };
}

function pointBounds(points: readonly Point[], [a, b, c, d, e, f]: Affine): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = a * point.x + c * point.y + e;
    const y = b * point.x + d * point.y + f;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function shapeBounds(object: ShapeObject): Bounds {
  const { kind, points, size } = object.props;
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end || !Number.isFinite(size) || size <= 0) {
    throw new RangeError("A shape needs finite points and positive stroke size.");
  }

  let bounds: Bounds;
  if (kind === "rectangle" || kind === "ellipse") {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    bounds = rectangleBounds(object.transform, x, y, Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  } else {
    const vertices = kind === "polygon" ? points :
      kind === "arrow" ? [start, end, ...shapeArrowHead(start, end, size)] : [start, end];
    bounds = pointBounds(vertices, object.transform);
  }
  const [a, b, c, d] = object.transform;
  const radius = size / 2;
  const padX = Math.hypot(a, c) * radius;
  const padY = Math.hypot(b, d) * radius;
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}

export function objectBounds(object: BoardObject): Bounds {
  if (object.type === "stroke") return pointBounds(strokeOutline(object), object.transform);
  if (object.type === "shape") return shapeBounds(object);

  const { width, height } = object.props;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Rectangular objects need finite positive dimensions.");
  }
  return rectangleBounds(object.transform, 0, 0, width, height);
}

function indexObject(object: BoardObject): IndexedObject {
  const bounds = objectBounds(object);
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, object.zIndex].every(Number.isFinite)) {
    throw new RangeError("A board object must have finite bounds and z-index.");
  }
  return { ...bounds, object };
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

export class Scene {
  #tree = new RBush<IndexedObject>();
  #entries = new Map<string, IndexedObject>();
  #ordered: readonly BoardObject[] | undefined;
  #bounds: Bounds | undefined;
  #nextZIndex = 0;

  constructor(objects: readonly BoardObject[] = []) {
    if (objects.length > 0) this.replace(objects);
  }

  get(id: string): BoardObject | undefined {
    return this.#entries.get(id)?.object;
  }

  add(object: BoardObject): void {
    this.applyChanges([{ after: object }]);
  }

  remove(id: string): boolean {
    const object = this.get(id);
    if (!object) return false;
    this.applyChanges([{ before: object }]);
    return true;
  }

  applyChanges(changes: readonly BoardChange[]): void {
    if (changes.length === 0) return;
    const touched = new Set<string>();
    const prepared = changes.map(({ before, after }) => {
      const id = before?.id ?? after?.id;
      if (id === undefined || (after && id !== after.id) || touched.has(id)) {
        throw new Error("Each change must address a distinct board object.");
      }
      const current = this.#entries.get(id);
      if (Boolean(before) !== Boolean(current) || (before && before.type !== current?.object.type) ||
          (before && after && before.type !== after.type)) {
        throw new Error("A scene change does not match the current object.");
      }
      touched.add(id);
      return { id, current, next: after ? indexObject(after) : undefined };
    });

    for (const { id, current, next } of prepared) {
      if (current) this.#tree.remove(current);
      if (next) {
        this.#tree.insert(next);
        this.#entries.set(id, next);
        this.#nextZIndex = Math.max(this.#nextZIndex, next.object.zIndex + 1);
      } else {
        this.#entries.delete(id);
      }
    }
    this.#refreshBounds();
  }

  replace(objects: readonly BoardObject[]): void {
    const replacement = new Map<string, IndexedObject>();
    let nextZIndex = 0;
    for (const object of objects) {
      if (replacement.has(object.id)) throw new Error("An object with this ID already exists.");
      replacement.set(object.id, indexObject(object));
      nextZIndex = Math.max(nextZIndex, object.zIndex + 1);
    }
    this.#tree = new RBush<IndexedObject>().load(Array.from(replacement.values()));
    this.#entries = replacement;
    this.#nextZIndex = nextZIndex;
    this.#refreshBounds();
  }

  search(bounds: Bounds): readonly BoardObject[] {
    if (this.#bounds && contains(bounds, this.#bounds)) return this.all();
    return this.#tree.search(bounds).map(({ object }) => object).sort(compareObjects);
  }

  all(): readonly BoardObject[] {
    return this.#ordered ??= Array.from(this.#entries.values(), ({ object }) => object).sort(compareObjects);
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

  #refreshBounds(): void {
    const { minX, minY, maxX, maxY } = this.#tree.toJSON() as Bounds;
    this.#bounds = this.#entries.size > 0 ? { minX, minY, maxX, maxY } : undefined;
    this.#ordered = undefined;
  }
}
