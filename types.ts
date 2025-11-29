

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export enum SymmetryType {
  NONE = 'NONE',
  MIRROR_X = 'MIRROR_X',
  MIRROR_Y = 'MIRROR_Y',
  MIRROR_XY = 'MIRROR_XY',
  RADIAL = 'RADIAL',
  GRID = 'GRID',
}

export enum AnimationMode {
  LOOP = 'LOOP',    // 0 -> 100 -> restart
  YOYO = 'YOYO',    // 0 -> 100 -> 0
  FLOW = 'FLOW',    // Draw 0->100, then Undraw 0->100 (Erasure follows tip)
}

export enum EasingType {
  LINEAR = 'LINEAR',
  EASE_IN = 'EASE_IN',
  EASE_OUT = 'EASE_OUT',
  EASE_IN_OUT = 'EASE_IN_OUT',
  SINE = 'SINE',
  ELASTIC = 'ELASTIC'
}

export enum CapType {
  BUTT = 'BUTT',
  ROUND = 'ROUND',
  SQUARE = 'SQUARE'
}

export interface SymmetrySettings {
  type: SymmetryType;
  copies: number; // For Radial
  phaseShift: number; // For Radial: delays the animation of clones
  gridGap: number; // For Grid
}

export interface OrbitSettings {
  enabled: boolean;
  mass: number;      // Determines how "heavy" the cursor feels (0.1 to 10.0)
  friction: number;  // Determines how quickly it stops (0.1 to 0.999)
}

export interface StrokeSettings {
  color: string;
  endColor?: string; // Optional: if present, stroke is a gradient
  width: number;
  capStart: CapType;
  capEnd: CapType;
  taper: number; // 0-100 represents percentage of length tapered on each end
  taperEasing: EasingType;
  smoothing: number; // 0-5 iterations
  simplification: number; // 0-20 pixel tolerance
  speed: number; // Cycles per second
  phase: number; // 0-1 offset
  easing: EasingType;
  symmetry: SymmetrySettings;
  animationMode: AnimationMode;
  orbit: OrbitSettings;
}

// Optimization: Store the calculated polygon edges to avoid re-computing normals every frame
export interface PrecomputedRibbon {
  left: Point[];
  right: Point[];
  cumulativeLengths: number[];
  bounds?: Bounds;
}

export interface Stroke extends StrokeSettings {
  id: string;
  points: Point[];     // The processed/rendered points
  rawPoints: Point[];  // The original captured points
  totalLength: number;
  timestamp: number;
  precomputed: PrecomputedRibbon; // Cached geometry
}

// Pre-calculated path segment for efficient rendering
export interface PathSegment {
  point: Point;
  lengthAtPoint: number;
}