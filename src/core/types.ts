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
}

export interface Stroke {
  readonly id: string;
  readonly type: "stroke";
  readonly transform: Affine;
  readonly zIndex: number;
  readonly locked: boolean;
  readonly props: {
    readonly points: readonly StrokePoint[];
    readonly brush: Brush;
    readonly version: 1;
  };
}
