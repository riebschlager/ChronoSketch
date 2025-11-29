
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, Point, SymmetryType, AnimationMode, PrecomputedRibbon, EasingType } from '../types';
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
}

// --- Helper Functions ---

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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Binary search for the highest index i such that arr[i] <= value
const getIndexForLength = (lengths: number[], target: number): number => {
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
const applyEasing = (t: number, type: EasingType): number => {
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

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ 
  currentSettings, 
  strokes, 
  onAddStroke,
  selectedStrokeId,
  onSelectStroke,
  isUIHovered,
  selectionLocked,
  canvasRef,
  globalSpeed
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPathRef = useRef<Point[]>([]);
  
  // Real mouse position
  const mousePosRef = useRef<Point | null>(null);
  
  // Physics/Ghost cursor state
  const physicsStateRef = useRef({
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 }
  });

  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const scaledTimeRef = useRef<number>(0);
  
  // Use a ref for globalSpeed to access it inside the animation loop 
  // without triggering a re-creation of the loop callback
  const globalSpeedRef = useRef(globalSpeed);
  useEffect(() => {
    globalSpeedRef.current = globalSpeed;
  }, [globalSpeed]);
  
  const strokesRef = useRef<Stroke[]>(strokes);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // --- Hit Detection Logic ---

  const checkHit = (inputX: number, inputY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const HIT_THRESHOLD = 15; // px

    const checkStroke = (stroke: Stroke, testPoint: Point) => {
      // Simple bounding box check could go here for further optimization
      for(let i=0; i<stroke.points.length-1; i++) {
        if(distToSegment(testPoint, stroke.points[i], stroke.points[i+1]) < Math.max(HIT_THRESHOLD, stroke.width)) {
          return true;
        }
      }
      return false;
    };

    // Iterate strokes from top (newest) to bottom
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      const { symmetry } = stroke;

      let testPoints: Point[] = [];
      // 1. Identity
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
        // Cover a large enough area to ensure we find copies if they are on screen
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

  // --- Input Handlers ---

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
    
    // If physics is enabled, snap to mouse initially
    if (currentSettings.orbit.enabled) {
        physicsStateRef.current.pos = { ...point };
        physicsStateRef.current.vel = { x: 0, y: 0 };
        currentPathRef.current = [{ ...point }];
    } else {
        // Direct drawing
        currentPathRef.current = [point];
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const point = getCanvasPoint(e);
    if (point) {
      mousePosRef.current = point;
      
      // Update Physics target, but don't add point yet if Physics is ON (loop handles that)
      if (currentSettings.orbit.enabled) {
          // Pass, logic is in renderLoop
      } else {
          // Standard direct drawing
          if (isDrawing) {
            const lastPoint = currentPathRef.current[currentPathRef.current.length - 1];
            if (lastPoint && distSq(lastPoint, point) > 4) { // > 2px squared
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

  // --- Rendering Logic ---

  // OPTIMIZED RENDERER: Uses pre-calculated geometry (Ribbon)
  const renderStrokePath = (
    ctx: CanvasRenderingContext2D, 
    precomputed: PrecomputedRibbon,
    points: Point[], // Still needed for selection highlight
    startLength: number,
    endLength: number,
    totalLength: number,
    baseWidth: number,
    isSelected: boolean = false
  ) => {
    if (precomputed.left.length < 2) return;
    if (endLength <= startLength) return;

    const { left, right, cumulativeLengths } = precomputed;
    const count = cumulativeLengths.length;

    // Use binary search for O(log N) lookup instead of O(N) scan
    const startSearchIdx = getIndexForLength(cumulativeLengths, startLength);
    const startIndex = Math.min(startSearchIdx, count - 2);

    const endSearchIdx = getIndexForLength(cumulativeLengths, endLength);
    // Ensure endIndex captures the segment containing endLength
    const endIndex = Math.min(endSearchIdx + 1, count - 1);

    // Determine interpolation factors for smooth cutoff
    const startSegmentLen = cumulativeLengths[startIndex + 1] - cumulativeLengths[startIndex];
    const endSegmentLen = cumulativeLengths[endIndex] - cumulativeLengths[endIndex - 1];
    
    let startT = 0;
    if (startSegmentLen > 0) {
        startT = (startLength - cumulativeLengths[startIndex]) / startSegmentLen;
    }
    startT = startT < 0 ? 0 : (startT > 1 ? 1 : startT); // Fast clamp
    
    let endT = 1;
    if (endIndex > 0 && endSegmentLen > 0) {
        endT = (endLength - cumulativeLengths[endIndex - 1]) / endSegmentLen;
    }
    endT = endT < 0 ? 0 : (endT > 1 ? 1 : endT); // Fast clamp

    // Construct the polygon
    ctx.beginPath();
    
    // 1. Interpolated Start Points (Inlined lerp for perf)
    const ls1 = left[startIndex];
    const ls2 = left[startIndex + 1] || left[startIndex];
    const rs1 = right[startIndex];
    const rs2 = right[startIndex + 1] || right[startIndex];

    const pStartLeftX = lerp(ls1.x, ls2.x, startT);
    const pStartLeftY = lerp(ls1.y, ls2.y, startT);
    const pStartRightX = lerp(rs1.x, rs2.x, startT);
    const pStartRightY = lerp(rs1.y, rs2.y, startT);

    // 2. Interpolated End Points
    // Careful: endIndex indexes the point *after* the segment
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

    // Trace Outline
    ctx.moveTo(pStartLeftX, pStartLeftY);

    // Left side forward
    for (let i = startIndex + 1; i < endIndex; i++) {
        ctx.lineTo(left[i].x, left[i].y);
    }
    
    ctx.lineTo(pEndLeftX, pEndLeftY);
    ctx.lineTo(pEndRightX, pEndRightY);

    // Right side backward
    for (let i = endIndex - 1; i > startIndex; i--) {
        ctx.lineTo(right[i].x, right[i].y);
    }

    ctx.lineTo(pStartRightX, pStartRightY);
    ctx.closePath();
    ctx.fill();

    // Selection Highlight (Draws the spine)
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
      
      // Simple loop for spine is acceptable as selection is rare and single
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
    const { symmetry, color, endColor, width: strokeWidth, points, totalLength, animationMode, precomputed, easing } = stroke;
    const centerX = width / 2;
    const centerY = height / 2;

    if (endColor && points.length > 1) {
        const startP = points[0];
        const endP = points[points.length - 1];
        // Optimization: Create gradient once per frame per stroke
        const gradient = ctx.createLinearGradient(startP.x, startP.y, endP.x, endP.y);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, endColor);
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle = color;
    }

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
                 // Easing applies to the 0-1 normalized progress
                 const rawProgress = cycle > 1 ? 2 - cycle : cycle;
                 const easedProgress = applyEasing(rawProgress, easing || EasingType.LINEAR);
                 
                 localEnd = totalLength * easedProgress;
                 localStart = 0;
            } else if (animationMode === AnimationMode.FLOW) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 if (cycle <= 1) {
                     // Draw phase
                     localStart = 0;
                     const easedProgress = applyEasing(cycle, easing || EasingType.LINEAR);
                     localEnd = totalLength * easedProgress;
                 } else {
                     // Erase phase
                     const easedProgress = applyEasing(cycle - 1, easing || EasingType.LINEAR);
                     localStart = totalLength * easedProgress;
                     localEnd = totalLength;
                 }
            } else {
                 // LOOP
                 let rawProgress = totalPhase % 1;
                 if (rawProgress < 0) rawProgress += 1;
                 const easedProgress = applyEasing(rawProgress, easing || EasingType.LINEAR);
                 
                 localEnd = totalLength * easedProgress;
                 localStart = 0;
            }
        }
        
        // Use optimized renderer
        renderStrokePath(ctx, precomputed, points, localStart, localEnd, totalLength, strokeWidth, isSelected);
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
         
         // Dynamically calculate the grid range needed to cover the viewport
         // BBox of the stroke
         let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
         if (points.length > 0) {
             for (const p of points) {
                 if (p.x < minX) minX = p.x;
                 if (p.x > maxX) maxX = p.x;
                 if (p.y < minY) minY = p.y;
                 if (p.y > maxY) maxY = p.y;
             }
         } else {
             minX = 0; maxX = 0; minY = 0; maxY = 0;
         }
         
         const pad = strokeWidth; 
         // Calculate which grid indices (ix, iy) place the stroke inside the canvas [0,0, width, height]
         // Stroke range shifted: [minX + ix*gap, maxX + ix*gap]
         // Overlap condition: (minX + ix*gap < width) AND (maxX + ix*gap > 0)
         
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
        break;
    }
  };

  const renderGhostCursor = (ctx: CanvasRenderingContext2D, width: number, height: number, actualCursor: Point) => {
    // Determine the point to replicate
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

    // Draw connection string if Orbit is active and mouse is present
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
         
         // Dynamically cover screen
         // The cursor has essentially 0 width/height for BBox purposes (or small radius)
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

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // --- Physics Simulation ---
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

    // Time handling for speed scaling
    if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
    }
    const deltaSeconds = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    
    // Increment local scaled time
    // Access globalSpeed via ref to avoid renderLoop recreation
    scaledTimeRef.current += deltaSeconds * globalSpeedRef.current;
    const sec = scaledTimeRef.current;
    
    // Render existing strokes
    strokesRef.current.forEach(stroke => {
      // Safety check for legacy or invalid strokes without precomputed data
      if (stroke.precomputed) {
          renderSymmetries(ctx, stroke, canvas.width, canvas.height, sec, stroke.id === selectedStrokeId);
      }
    });

    // Render current drawing stroke (Live Preview)
    if (isDrawing && currentPathRef.current.length > 1) {
        const points = currentPathRef.current;
        const tempTotalLength = getPathLength(points);
        
        // Optimize: For preview, we generate geometry on the fly. 
        // This is fine for 1 stroke.
        const previewRibbon = computeRibbon(points, { 
            width: currentSettings.width, 
            taper: currentSettings.taper || 0 
        });

        const previewStroke: Stroke = {
            ...currentSettings,
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

    // Render Ghost Cursor
    if ((mousePosRef.current && !isUIHovered) || (currentSettings.orbit.enabled && !isUIHovered)) {
         renderGhostCursor(ctx, canvas.width, canvas.height, mousePosRef.current || {x:0,y:0});
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [isDrawing, currentSettings, selectedStrokeId, isUIHovered]); // Removed globalSpeed from dependency

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
  );
};

export default DrawingCanvas;
