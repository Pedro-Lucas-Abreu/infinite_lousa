export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface StrokePoint extends Point {
  readonly pressure?: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Camera extends Point {
  readonly zoom: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type Affine = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export interface Brush {
  readonly color: string;
  readonly size: number;
  readonly stabilizer: number;
  readonly simulatePressure: boolean;
  readonly opacity?: number;
}

interface ObjectBase {
  readonly id: string;
  readonly transform: Affine;
  readonly zIndex: number;
  readonly locked: boolean;
}

export interface Stroke extends ObjectBase {
  readonly type: "stroke";
  readonly parentId?: string;
  readonly props: {
    readonly points: readonly StrokePoint[];
    readonly brush: Brush;
    readonly version: 1;
  };
}

export interface PageObject extends ObjectBase {
  readonly type: "image" | "pdfPage";
  readonly props: {
    readonly width: number;
    readonly height: number;
    readonly assetId: string;
    readonly pageIndex?: number;
  };
}

export interface FrameObject extends ObjectBase {
  readonly type: "frame";
  readonly parentId?: string;
  readonly props: {
    readonly width: number;
    readonly height: number;
    readonly name: string;
    readonly order: number;
  };
}

export interface TextObject extends ObjectBase {
  readonly type: "text";
  readonly parentId?: string;
  readonly props: {
    readonly text: string;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly fontSize: number;
  };
}

export type ShapeKind = "line" | "arrow" | "rectangle" | "ellipse" | "polygon";

export interface ShapeObject extends ObjectBase {
  readonly type: "shape";
  readonly parentId?: string;
  readonly props: {
    readonly kind: ShapeKind;
    readonly points: readonly Point[];
    readonly color: string;
    readonly size: number;
  };
}

export interface EquationPath {
  readonly d: string;
  readonly transform: Affine;
}

export interface EquationObject extends ObjectBase {
  readonly type: "equation";
  readonly parentId?: string;
  readonly props: {
    readonly latex: string;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly fontSize: number;
    readonly paths: readonly EquationPath[];
  };
}

export type BoardObject = Stroke | PageObject | FrameObject | TextObject | ShapeObject | EquationObject;

export interface BoardChange {
  readonly before?: BoardObject;
  readonly after?: BoardObject;
}

export function isPageObject(object: BoardObject | undefined): object is PageObject {
  return object?.type === "image" || object?.type === "pdfPage";
}
