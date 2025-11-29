import { Point, EasingType, PrecomputedRibbon, CapType } from './types';

export const hexToRgb = (hex: string) => {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => {
    return r + r + g + g + b + b;
  });

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

// Fast distance (squared) to avoid sqrt in tight loops
export const distSq = (p1: Point, p2: Point) => (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

// Standard distance
export const dist = (p1: Point, p2: Point) => Math.sqrt(distSq(p1, p2));

export const distToSegment = (p: Point, v: Point, w: Point) => {
  const l2 = distSq(v, w);
  if (l2 === 0) return dist(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return dist(p, projection);
};

export const getPathLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += dist(points[i - 1], points[i]);
  }
  return length;
};

// Interpolates a point between two points based on ratio t (0-1)
export const lerpPoint = (p1: Point, p2: Point, t: number): Point => ({
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t
});

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Binary search for the highest index i such that arr[i] <= value
export const getIndexForLength = (lengths: number[], target: number): number => {
    let ans = 0;
    let l = 0;
    let r = lengths.length - 1;
    
    while (l <= r) {
        let mid = (l + r) >> 1;
        if (lengths[mid] <= target) {
            ans = mid;
            l = mid + 1;
        } else {
            r = mid - 1;
        }
    }
    return ans; 
};

// Easing Functions
export const applyEasing = (t: number, type: EasingType): number => {
    switch (type) {
        case EasingType.LINEAR: return t;
        case EasingType.EASE_IN: return t * t;
        case EasingType.EASE_OUT: return t * (2 - t);
        case EasingType.EASE_IN_OUT: return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        case EasingType.SINE: return (1 - Math.cos(t * Math.PI)) / 2;
        case EasingType.ELASTIC: 
            if (t === 0 || t === 1) return t;
            const p = 0.3;
            return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        default: return t;
    }
};

// Ramer-Douglas-Peucker simplification
export const simplifyPoints = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 2 || tolerance <= 0) return points;

  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    // Perpendicular distance
    let d = 0;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const l2 = dx * dx + dy * dy;
    
    if (l2 === 0) {
      d = dist(p, start);
    } else {
      const t = ((p.x - start.x) * dx + (p.y - start.y) * dy) / l2;
      if (t < 0) d = dist(p, start);
      else if (t > 1) d = dist(p, end);
      else {
        const proj = {
          x: start.x + t * dx,
          y: start.y + t * dy
        };
        d = dist(p, proj);
      }
    }

    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPoints(points.slice(0, index + 1), tolerance);
    const right = simplifyPoints(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [start, end];
  }
};

// Chaikin's Smoothing Algorithm
export const smoothPoints = (points: Point[], iterations: number): Point[] => {
  if (iterations <= 0 || points.length < 3) return points;
  
  let current = points;
  for (let k = 0; k < iterations; k++) {
    const next: Point[] = [current[0]]; // Always keep start
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      
      // Cut corners at 25% and 75%
      next.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y
      });
      next.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y
      });
    }
    next.push(current[current.length - 1]); // Always keep end
    current = next;
  }
  return current;
};

export const processPoints = (points: Point[], smoothing: number, simplification: number): Point[] => {
  const simplified = simplifyPoints(points, simplification);
  const smoothed = smoothPoints(simplified, Math.floor(smoothing));
  return smoothed;
};

// Pre-calculate the Ribbon (Left/Right polygon edges) for the entire stroke
export const computeRibbon = (points: Point[], settings: { width: number, taper: number, taperEasing?: EasingType }): PrecomputedRibbon => {
    const left: Point[] = [];
    const right: Point[] = [];
    const cumulativeLengths: number[] = [0];
    
    // Bounds tracking
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    if (points.length < 2) return { left: [], right: [], cumulativeLengths: [] };

    const totalLength = getPathLength(points);
    const taperLen = totalLength * (settings.taper / 100);
    const baseWidth = settings.width;

    let currentDist = 0;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (i > 0) {
            currentDist += dist(points[i-1], p);
            cumulativeLengths.push(currentDist);
        }

        let nx = 0;
        let ny = 0;

        if (i === 0) {
            const next = points[i+1];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len = Math.sqrt(dx*dx + dy*dy) || 1;
            nx = -dy / len;
            ny = dx / len;
        } else if (i === points.length - 1) {
            const prev = points[i-1];
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const len = Math.sqrt(dx*dx + dy*dy) || 1;
            nx = -dy / len;
            ny = dx / len;
        } else {
            // Average normal for smooth joins
            const prev = points[i-1];
            const next = points[i+1];
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const len = Math.sqrt(dx*dx + dy*dy) || 1;
            nx = -dy / len;
            ny = dx / len;
        }

        let currentWidth = baseWidth;
        if (taperLen > 0) {
            let t = -1;
            if (currentDist < taperLen) {
                t = currentDist / taperLen;
            } else if (currentDist > totalLength - taperLen) {
                t = (totalLength - currentDist) / taperLen;
            }
            
            if (t >= 0) {
                 const easing = settings.taperEasing || EasingType.LINEAR;
                 const easedT = applyEasing(t, easing);
                 currentWidth = baseWidth * easedT;
            }
        }
        currentWidth = Math.max(0.1, currentWidth); // Ensure it doesn't disappear completely for logic
        const halfWidth = currentWidth / 2;

        const lx = p.x + nx * halfWidth;
        const ly = p.y + ny * halfWidth;
        const rx = p.x - nx * halfWidth;
        const ry = p.y - ny * halfWidth;

        left.push({ x: lx, y: ly });
        right.push({ x: rx, y: ry });

        // Update Bounds
        minX = Math.min(minX, lx, rx);
        maxX = Math.max(maxX, lx, rx);
        minY = Math.min(minY, ly, ry);
        maxY = Math.max(maxY, ly, ry);
    }

    return { 
        left, 
        right, 
        cumulativeLengths,
        bounds: { minX, maxX, minY, maxY }
    };
};
