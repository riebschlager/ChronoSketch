

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, Point, SymmetryType, AnimationMode, PrecomputedRibbon, EasingType, CapType } from '../types';
import { computeRibbon } from '../App'; // Imported for the live preview stroke

interface DrawingCanvasProps {
  currentSettings: Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>;
  strokes: Stroke[];
  onAddStroke: (points: Point[]) => void;
  selectedStrokeId: string | null;
  onSelectStroke: (id: string | null) => void;
  isUIHovered: boolean;
  selectionLocked: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  globalSpeed: number;
  showDebug: boolean;
  animationTimeRef: React.MutableRefObject<number>;
}

// --- Helper Functions ---

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
const distSq = (p1: Point, p2: Point) => (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

// Standard distance
const dist = (p1: Point, p2: Point) => Math.sqrt(distSq(p1, p2));

const distToSegment = (p: Point, v: Point, w: Point) => {
  const l2 = distSq(v, w);
  if (l2 === 0) return dist(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return dist(p, projection);
};

const getPathLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += dist(points[i - 1], points[i]);
  }
  return length;
};

// Interpolates a point between two points based on ratio t (0-1)
// Inlined in hot loops, but kept here for general use
const lerpPoint = (p1: Point, p2: Point, t: number): Point => ({
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

const drawCap = (
  ctx: CanvasRenderingContext2D,
  pLeft: Point,
  pRight: Point,
  type: CapType,
  color: string,
  isStart: boolean
) => {
   if (type === CapType.BUTT) return;

   const mx = (pLeft.x + pRight.x) / 2;
   const my = (pLeft.y + pRight.y) / 2;
   const dx = pRight.x - pLeft.x;
   const dy = pRight.y - pLeft.y;
   const dist = Math.sqrt(dx*dx + dy*dy);
   const r = dist / 2;

   if (r < 0.1) return;

   // Start Cap points Backward relative to path flow.
   // Vector L->R is perpendicular to path.
   // Forward along path is (dy, -dx)
   // Start Cap Direction (Backward) = (-dy, dx)
   // End Cap Direction (Forward) = (dy, -dx)
   
   let nx = dy;
   let ny = -dx;
   
   // Normalize
   const len = Math.sqrt(nx*nx + ny*ny);
   if (len === 0) return;
   nx /= len;
   ny /= len;

   if (isStart) {
       nx = -nx;
       ny = -ny;
   }

   ctx.fillStyle = color;
   ctx.beginPath();

   if (type === CapType.ROUND) {
       ctx.arc(mx, my, r, 0, Math.PI * 2);
   } else if (type === CapType.SQUARE) {
       const px = nx * r;
       const py = ny * r;
       
       ctx.moveTo(pLeft.x, pLeft.y);
       ctx.lineTo(pRight.x, pRight.y);
       ctx.lineTo(pRight.x + px, pRight.y + py);
       ctx.lineTo(pLeft.x + px, pLeft.y + py);
       ctx.closePath();
   }
   ctx.fill();
};

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ 
  currentSettings, 
  strokes, 
  onAddStroke,
  selectedStrokeId,
  onSelectStroke,
  isUIHovered,
  selectionLocked,
  canvasRef,
  globalSpeed,
  showDebug,
  animationTimeRef
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPathRef = useRef<Point[]>([]);
  
  const mousePosRef = useRef<Point | null>(null);
  
  const physicsStateRef = useRef({
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 }
  });

  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const scaledTimeRef = useRef<number>(0);
  
  const debugPanelRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef({
    lastTime: 0,
    frameCount: 0,
    fps: 0,
    minFps: 60,
    maxFps: 0,
    renderTimeAccumulator: 0,
    lastRenderTime: 0
  });

  const globalSpeedRef = useRef(globalSpeed);
  useEffect(() => {
    globalSpeedRef.current = globalSpeed;
  }, [globalSpeed]);
  
  const strokesRef = useRef<Stroke[]>(strokes);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const checkHit = (inputX: number, inputY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const HIT_THRESHOLD = 15; 

    const checkStroke = (stroke: Stroke, testPoint: Point) => {
      if (stroke.precomputed?.bounds) {
        const { minX, maxX, minY, maxY } = stroke.precomputed.bounds;
        const pad = HIT_THRESHOLD;
        if (testPoint.x < minX - pad || testPoint.x > maxX + pad || 
            testPoint.y < minY - pad || testPoint.y > maxY + pad) {
            return false;
        }
      }

      for(let i=0; i<stroke.points.length-1; i++) {
        if(distToSegment(testPoint, stroke.points[i], stroke.points[i+1]) < Math.max(HIT_THRESHOLD, stroke.width)) {
          return true;
        }
      }
      return false;
    };

    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      const { symmetry } = stroke;

      let testPoints: Point[] = [];
      testPoints.push({ x: inputX, y: inputY });

      if (symmetry.type === SymmetryType.MIRROR_X || symmetry.type === SymmetryType.MIRROR_XY) {
        testPoints.push({ x: width - inputX, y: inputY });
      }

      if (symmetry.type === SymmetryType.MIRROR_Y || symmetry.type === SymmetryType.MIRROR_XY) {
        testPoints.push({ x: inputX, y: height - inputY });
      }

      if (symmetry.type === SymmetryType.MIRROR_XY) {
        testPoints.push({ x: width - inputX, y: height - inputY });
      }

      if (symmetry.type === SymmetryType.RADIAL) {
        const angleStep = (2 * Math.PI) / symmetry.copies;
        for (let j = 1; j < symmetry.copies; j++) {
           const angle = -j * angleStep;
           const cos = Math.cos(angle);
           const sin = Math.sin(angle);
           const dx = inputX - cx;
           const dy = inputY - cy;
           const rx = dx * cos - dy * sin;
           const ry = dx * sin + dy * cos;
           testPoints.push({ x: rx + cx, y: ry + cy });
        }
      }

      if (symmetry.type === SymmetryType.GRID) {
        const gap = symmetry.gridGap || 100;
        const rangeX = Math.ceil(width / gap) + 1;
        const rangeY = Math.ceil(height / gap) + 1;

        for(let gx = -rangeX; gx <= rangeX; gx++) {
            for(let gy = -rangeY; gy <= rangeY; gy++) {
                if (gx === 0 && gy === 0) continue; 
                testPoints.push({ x: inputX - gx * gap, y: inputY - gy * gap });
            }
        }
      }

      for (const p of testPoints) {
        if (checkStroke(stroke, p)) {
          return stroke.id;
        }
      }
    }

    return null;
  };

  const getCanvasPoint = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (isUIHovered) return;
    const point = getCanvasPoint(e);
    if (!point) return;

    if (!selectionLocked) {
      const hitId = checkHit(point.x, point.y);
      if (hitId) {
        onSelectStroke(hitId);
        return;
      }
    }
    
    onSelectStroke(null);
    setIsDrawing(true);

    mousePosRef.current = point;
    
    if (currentSettings.orbit.enabled) {
        physicsStateRef.current.pos = { ...point };
        physicsStateRef.current.vel = { x: 0, y: 0 };
        currentPathRef.current = [{ ...point }];
    } else {
        currentPathRef.current = [point];
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const point = getCanvasPoint(e);
    if (point) {
      mousePosRef.current = point;
      
      if (currentSettings.orbit.enabled) {
      } else {
          if (isDrawing) {
            const lastPoint = currentPathRef.current[currentPathRef.current.length - 1];
            if (lastPoint && distSq(lastPoint, point) > 4) { 
              currentPathRef.current.push(point);
            }
          }
      }
    }
  };

  const handleEnd = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentPathRef.current.length > 1) {
      onAddStroke([...currentPathRef.current]);
    }
    currentPathRef.current = [];
  };

  const handleLeave = () => {
    mousePosRef.current = null;
    handleEnd();
  };

  // OPTIMIZED RENDERER: Uses pre-calculated geometry (Ribbon)
  const renderStrokePath = (
    ctx: CanvasRenderingContext2D, 
    precomputed: PrecomputedRibbon,
    points: Point[], 
    startLength: number,
    endLength: number,
    totalLength: number,
    baseWidth: number,
    color: string,
    endColor: string | undefined,
    capStart: CapType,
    capEnd: CapType,
    isSelected: boolean = false
  ) => {
    if (precomputed.left.length < 2) return;
    if (endLength <= startLength) return;

    const { left, right, cumulativeLengths } = precomputed;
    const count = cumulativeLengths.length;

    const startSearchIdx = getIndexForLength(cumulativeLengths, startLength);
    const startIndex = Math.min(startSearchIdx, count - 2);

    const endSearchIdx = getIndexForLength(cumulativeLengths, endLength);
    const endIndex = Math.min(endSearchIdx + 1, count - 1);

    const startSegmentLen = cumulativeLengths[startIndex + 1] - cumulativeLengths[startIndex];
    const endSegmentLen = cumulativeLengths[endIndex] - cumulativeLengths[endIndex - 1];
    
    let startT = 0;
    if (startSegmentLen > 0) {
        startT = (startLength - cumulativeLengths[startIndex]) / startSegmentLen;
    }
    startT = startT < 0 ? 0 : (startT > 1 ? 1 : startT); 
    
    let endT = 1;
    if (endIndex > 0 && endSegmentLen > 0) {
        endT = (endLength - cumulativeLengths[endIndex - 1]) / endSegmentLen;
    }
    endT = endT < 0 ? 0 : (endT > 1 ? 1 : endT); 

    const ls1 = left[startIndex];
    const ls2 = left[startIndex + 1] || left[startIndex];
    const rs1 = right[startIndex];
    const rs2 = right[startIndex + 1] || right[startIndex];

    const pStartLeftX = lerp(ls1.x, ls2.x, startT);
    const pStartLeftY = lerp(ls1.y, ls2.y, startT);
    const pStartRightX = lerp(rs1.x, rs2.x, startT);
    const pStartRightY = lerp(rs1.y, rs2.y, startT);

    const idxEndBase = Math.max(0, endIndex - 1);
    const idxEndNext = endIndex;
    
    const le1 = left[idxEndBase];
    const le2 = left[idxEndNext];
    const re1 = right[idxEndBase];
    const re2 = right[idxEndNext];

    const pEndLeftX = lerp(le1.x, le2.x, endT);
    const pEndLeftY = lerp(le1.y, le2.y, endT);
    const pEndRightX = lerp(re1.x, re2.x, endT);
    const pEndRightY = lerp(re1.y, re2.y, endT);

    // Color Calculation helpers
    let startCapColor = color;
    let endCapColor = color;

    if (endColor) {
        const startRgb = hexToRgb(color);
        const endRgb = hexToRgb(endColor);
        const dr = endRgb.r - startRgb.r;
        const dg = endRgb.g - startRgb.g;
        const db = endRgb.b - startRgb.b;

        // Calculate cap colors based on position
        const tStart = Math.max(0, Math.min(1, startLength / totalLength));
        const rS = Math.round(startRgb.r + dr * tStart);
        const gS = Math.round(startRgb.g + dg * tStart);
        const bS = Math.round(startRgb.b + db * tStart);
        startCapColor = `rgb(${rS},${gS},${bS})`;

        const tEnd = Math.max(0, Math.min(1, endLength / totalLength));
        const rE = Math.round(startRgb.r + dr * tEnd);
        const gE = Math.round(startRgb.g + dg * tEnd);
        const bE = Math.round(startRgb.b + db * tEnd);
        endCapColor = `rgb(${rE},${gE},${bE})`;

        // RENDER GRADIENT BODY
        let curL = { x: pStartLeftX, y: pStartLeftY };
        let curR = { x: pStartRightX, y: pStartRightY };
        let curDist = startLength;

        ctx.lineWidth = 1; 

        for (let i = startIndex + 1; i < endIndex; i++) {
            const nextL = left[i];
            const nextR = right[i];
            const nextDist = cumulativeLengths[i];
            
            const midDist = (curDist + nextDist) * 0.5;
            const t = Math.max(0, Math.min(1, midDist / totalLength));
            
            const r = Math.round(startRgb.r + dr * t);
            const g = Math.round(startRgb.g + dg * t);
            const b = Math.round(startRgb.b + db * t);
            
            const segColor = `rgb(${r},${g},${b})`;
            ctx.fillStyle = segColor;
            ctx.strokeStyle = segColor;

            ctx.beginPath();
            ctx.moveTo(curL.x, curL.y);
            ctx.lineTo(nextL.x, nextL.y);
            ctx.lineTo(nextR.x, nextR.y);
            ctx.lineTo(curR.x, curR.y);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(nextL.x, nextL.y);
            ctx.lineTo(nextR.x, nextR.y);
            ctx.stroke();

            curL = nextL;
            curR = nextR;
            curDist = nextDist;
        }

        const midDist = (curDist + endLength) * 0.5;
        const t = Math.max(0, Math.min(1, midDist / totalLength));
        const r = Math.round(startRgb.r + dr * t);
        const g = Math.round(startRgb.g + dg * t);
        const b = Math.round(startRgb.b + db * t);
        
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(curL.x, curL.y);
        ctx.lineTo(pEndLeftX, pEndLeftY);
        ctx.lineTo(pEndRightX, pEndRightY);
        ctx.lineTo(curR.x, curR.y);
        ctx.fill();

    } else {
        // SOLID COLOR BODY
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(pStartLeftX, pStartLeftY);
        for (let i = startIndex + 1; i < endIndex; i++) {
            ctx.lineTo(left[i].x, left[i].y);
        }
        ctx.lineTo(pEndLeftX, pEndLeftY);
        ctx.lineTo(pEndRightX, pEndRightY);
        for (let i = endIndex - 1; i > startIndex; i--) {
            ctx.lineTo(right[i].x, right[i].y);
        }
        ctx.lineTo(pStartRightX, pStartRightY);
        ctx.closePath();
        ctx.fill();
    }

    // DRAW CAPS
    drawCap(ctx, {x: pStartLeftX, y: pStartLeftY}, {x: pStartRightX, y: pStartRightY}, capStart, startCapColor, true);
    drawCap(ctx, {x: pEndLeftX, y: pEndLeftY}, {x: pEndRightX, y: pEndRightY}, capEnd, endCapColor, false);


    // Selection Highlight
    if (isSelected) {
      ctx.save();
      ctx.shadowColor = 'white';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = baseWidth + 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      let d = 0;
      
      for (let i = 0; i < points.length; i++) {
         if (i>0) d += dist(points[i-1], points[i]);
         if (d >= startLength && d <= endLength) {
             if (!started) { ctx.moveTo(points[i].x, points[i].y); started = true; }
             else ctx.lineTo(points[i].x, points[i].y);
         }
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  const renderSymmetries = (
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    width: number,
    height: number,
    time: number,
    isSelected: boolean,
    forceFullDraw: boolean = false
  ) => {
    const { symmetry, color, endColor, width: strokeWidth, points, totalLength, animationMode, precomputed, easing, capStart, capEnd } = stroke;
    const centerX = width / 2;
    const centerY = height / 2;

    const drawInstance = (phaseOffset: number, transformFn: () => void) => {
        ctx.save();
        transformFn();
        
        let localStart = 0;
        let localEnd = totalLength;

        if (!forceFullDraw) {
            const totalPhase = (time * stroke.speed + stroke.phase) + phaseOffset;
            
            if (animationMode === AnimationMode.YOYO) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 const rawProgress = cycle > 1 ? 2 - cycle : cycle;
                 const easedProgress = applyEasing(rawProgress, easing || EasingType.LINEAR);
                 localEnd = totalLength * easedProgress;
                 localStart = 0;
            } else if (animationMode === AnimationMode.FLOW) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 if (cycle <= 1) {
                     localStart = 0;
                     const easedProgress = applyEasing(cycle, easing || EasingType.LINEAR);
                     localEnd = totalLength * easedProgress;
                 } else {
                     const easedProgress = applyEasing(cycle - 1, easing || EasingType.LINEAR);
                     localStart = totalLength * easedProgress;
                     localEnd = totalLength;
                 }
            } else {
                 let rawProgress = totalPhase % 1;
                 if (rawProgress < 0) rawProgress += 1;
                 const easedProgress = applyEasing(rawProgress, easing || EasingType.LINEAR);
                 localEnd = totalLength * easedProgress;
                 localStart = 0;
            }
        }
        
        // Pass capStart/capEnd to renderer (defaults to BUTT if undefined)
        renderStrokePath(
            ctx, precomputed, points, localStart, localEnd, totalLength, strokeWidth, color, endColor, 
            capStart || CapType.BUTT, 
            capEnd || CapType.BUTT, 
            isSelected
        );
        ctx.restore();
    };

    switch (symmetry.type) {
      case SymmetryType.NONE:
        drawInstance(0, () => {});
        break;
      case SymmetryType.MIRROR_X:
        drawInstance(0, () => {});
        drawInstance(0, () => {
             ctx.translate(centerX, centerY);
             ctx.scale(-1, 1);
             ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.MIRROR_Y:
        drawInstance(0, () => {});
        drawInstance(0, () => {
             ctx.translate(centerX, centerY);
             ctx.scale(1, -1);
             ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.MIRROR_XY:
        drawInstance(0, () => {});
        drawInstance(0, () => {
            ctx.translate(centerX, centerY);
            ctx.scale(-1, 1);
            ctx.translate(-centerX, -centerY);
        });
        drawInstance(0, () => {
            ctx.translate(centerX, centerY);
            ctx.scale(1, -1);
            ctx.translate(-centerX, -centerY);
        });
        drawInstance(0, () => {
            ctx.translate(centerX, centerY);
            ctx.scale(-1, -1);
            ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.RADIAL:
        const angleStep = (2 * Math.PI) / symmetry.copies;
        for (let i = 0; i < symmetry.copies; i++) {
            drawInstance(i * symmetry.phaseShift, () => {
                ctx.translate(centerX, centerY);
                ctx.rotate(i * angleStep);
                ctx.translate(-centerX, -centerY);
            });
        }
        break;
      case SymmetryType.GRID:
         const gap = symmetry.gridGap || 100;
         if (points.length > 0 && precomputed.bounds) {
             const { minX, maxX, minY, maxY } = precomputed.bounds;
             const pad = strokeWidth + 50; // Add padding for caps
             
             const startX = Math.floor((-maxX - pad) / gap);
             const endX = Math.ceil((width - minX + pad) / gap);
             const startY = Math.floor((-maxY - pad) / gap);
             const endY = Math.ceil((height - minY + pad) / gap);

             for(let x = startX; x <= endX; x++) {
                 for(let y = startY; y <= endY; y++) {
                    drawInstance(0, () => {
                        ctx.translate(x * gap, y * gap);
                    });
                 }
             }
         } else {
             drawInstance(0, () => {});
         }
        break;
    }
  };

  const renderGhostCursor = (ctx: CanvasRenderingContext2D, width: number, height: number, actualCursor: Point) => {
    let x, y;
    if (currentSettings.orbit.enabled) {
        x = physicsStateRef.current.pos.x;
        y = physicsStateRef.current.pos.y;
    } else {
        if (!mousePosRef.current) return;
        x = mousePosRef.current.x;
        y = mousePosRef.current.y;
    }

    const { symmetry, color, width: strokeWidth } = currentSettings;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(2, strokeWidth / 2);

    if (currentSettings.orbit.enabled && mousePosRef.current) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(mousePosRef.current.x, mousePosRef.current.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5;

    const drawDot = () => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    };

    const run = (transformFn: () => void) => {
        ctx.save();
        transformFn();
        drawDot();
        ctx.restore();
    };

    switch (symmetry.type) {
      case SymmetryType.NONE:
        run(() => {});
        break;
      case SymmetryType.MIRROR_X:
        run(() => {});
        run(() => {
             ctx.translate(centerX, centerY);
             ctx.scale(-1, 1);
             ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.MIRROR_Y:
        run(() => {});
        run(() => {
             ctx.translate(centerX, centerY);
             ctx.scale(1, -1);
             ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.MIRROR_XY:
        run(() => {});
        run(() => {
            ctx.translate(centerX, centerY);
            ctx.scale(-1, 1);
            ctx.translate(-centerX, -centerY);
        });
        run(() => {
            ctx.translate(centerX, centerY);
            ctx.scale(1, -1);
            ctx.translate(-centerX, -centerY);
        });
        run(() => {
            ctx.translate(centerX, centerY);
            ctx.scale(-1, -1);
            ctx.translate(-centerX, -centerY);
        });
        break;
      case SymmetryType.RADIAL:
        const angleStep = (2 * Math.PI) / symmetry.copies;
        for (let i = 0; i < symmetry.copies; i++) {
            run(() => {
                ctx.translate(centerX, centerY);
                ctx.rotate(i * angleStep);
                ctx.translate(-centerX, -centerY);
            });
        }
        break;
      case SymmetryType.GRID:
         const gap = symmetry.gridGap || 100;
         const pad = radius + 2; 
         const gStartX = Math.floor((-x - pad) / gap);
         const gEndX = Math.ceil((width - x + pad) / gap);
         const gStartY = Math.floor((-y - pad) / gap);
         const gEndY = Math.ceil((height - y + pad) / gap);

         for(let gx = gStartX; gx <= gEndX; gx++) {
             for(let gy = gStartY; gy <= gEndY; gy++) {
                run(() => {
                    ctx.translate(gx * gap, gy * gap);
                });
             }
         }
        break;
    }

    ctx.globalAlpha = 1.0; 
  };

  const renderLoop = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const perfStart = performance.now();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (currentSettings.orbit.enabled) {
        const mouse = mousePosRef.current;
        if (mouse || isDrawing) {
            const target = mouse || physicsStateRef.current.pos;
            const mass = Math.max(0.1, currentSettings.orbit.mass);
            const k = 0.1 / mass; 
            const friction = currentSettings.orbit.friction;

            const dx = target.x - physicsStateRef.current.pos.x;
            const dy = target.y - physicsStateRef.current.pos.y;
            
            const ax = dx * k;
            const ay = dy * k;

            physicsStateRef.current.vel.x = (physicsStateRef.current.vel.x + ax) * friction;
            physicsStateRef.current.vel.y = (physicsStateRef.current.vel.y + ay) * friction;

            physicsStateRef.current.pos.x += physicsStateRef.current.vel.x;
            physicsStateRef.current.pos.y += physicsStateRef.current.vel.y;
            
            if (isDrawing) {
                const newP = { ...physicsStateRef.current.pos };
                const lastP = currentPathRef.current[currentPathRef.current.length - 1];
                if (!lastP || distSq(lastP, newP) > 1) { 
                    currentPathRef.current.push(newP);
                }
            }
        }
    } else {
        if (mousePosRef.current) {
            physicsStateRef.current.pos = { ...mousePosRef.current };
            physicsStateRef.current.vel = { x: 0, y: 0 };
        }
    }

    if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
    }
    const deltaSeconds = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    
    scaledTimeRef.current += deltaSeconds * globalSpeedRef.current;
    const sec = scaledTimeRef.current;
    
    animationTimeRef.current = sec;

    strokesRef.current.forEach(stroke => {
      if (stroke.precomputed) {
          renderSymmetries(ctx, stroke, canvas.width, canvas.height, sec, stroke.id === selectedStrokeId);
      }
    });

    if (isDrawing && currentPathRef.current.length > 1) {
        const points = currentPathRef.current;
        const tempTotalLength = getPathLength(points);
        
        const previewRibbon = computeRibbon(points, { 
            width: currentSettings.width, 
            taper: currentSettings.taper || 0,
            taperEasing: currentSettings.taperEasing
        });

        const previewStroke: Stroke = {
            ...currentSettings,
            capStart: currentSettings.capStart || CapType.BUTT,
            capEnd: currentSettings.capEnd || CapType.BUTT,
            smoothing: 0, 
            simplification: 0,
            id: 'preview',
            points: points,
            rawPoints: points,
            totalLength: tempTotalLength,
            timestamp: Date.now(),
            precomputed: previewRibbon
        };
        renderSymmetries(ctx, previewStroke, canvas.width, canvas.height, sec, false, true);
    }

    if ((mousePosRef.current && !isUIHovered) || (currentSettings.orbit.enabled && !isUIHovered)) {
         renderGhostCursor(ctx, canvas.width, canvas.height, mousePosRef.current || {x:0,y:0});
    }

    const perfEnd = performance.now();
    const renderDuration = perfEnd - perfStart;

    if (showDebug && debugPanelRef.current) {
        const s = statsRef.current;
        s.frameCount++;
        s.renderTimeAccumulator += renderDuration;

        if (time - s.lastTime >= 500) {
            s.fps = Math.round((s.frameCount * 1000) / (time - s.lastTime));
            s.minFps = Math.min(s.minFps, s.fps);
            s.maxFps = Math.max(s.maxFps, s.fps);
            s.lastRenderTime = s.renderTimeAccumulator / s.frameCount;
            
            s.frameCount = 0;
            s.renderTimeAccumulator = 0;
            s.lastTime = time;

            const totalPoints = strokesRef.current.reduce((acc, str) => acc + str.points.length, 0);
            const res = `${canvas.width}x${canvas.height}`;
            const mem = (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024) + 'MB' : 'N/A';
            const mouse = mousePosRef.current ? `${Math.round(mousePosRef.current.x)},${Math.round(mousePosRef.current.y)}` : 'N/A';
            
            debugPanelRef.current.innerText = 
`DEBUG METRICS
----------------
FPS: ${s.fps} (Min: ${s.minFps}, Max: ${s.maxFps})
Frame Time: ${s.lastRenderTime.toFixed(2)}ms
Resolution: ${res}
Strokes: ${strokesRef.current.length}
Total Points: ${totalPoints}
Memory: ${mem}
Cursor: ${mouse}
Render Scale: ${globalSpeedRef.current.toFixed(1)}x`;
        }
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [isDrawing, currentSettings, selectedStrokeId, isUIHovered, showDebug]); 

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [renderLoop]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
        <canvas
            ref={canvasRef}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleLeave}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            className={`absolute top-0 left-0 w-full h-full block ${selectionLocked ? 'cursor-crosshair' : 'cursor-default'}`}
        />
        {showDebug && (
            <div 
                ref={debugPanelRef}
                className="absolute bottom-4 left-4 p-4 bg-slate-900/90 text-cyan-400 font-mono text-xs rounded-lg border border-cyan-900/50 shadow-2xl pointer-events-none z-50 whitespace-pre leading-relaxed select-none backdrop-blur-md"
            >
                Collecting stats...
            </div>
        )}
    </>
  );
};

export default DrawingCanvas;