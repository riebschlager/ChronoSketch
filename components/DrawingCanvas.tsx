
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, Point, SymmetryType, AnimationMode, PrecomputedRibbon } from '../types';
import { computeRibbon } from '../App'; // Imported for the live preview stroke

interface DrawingCanvasProps {
  currentSettings: Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>;
  strokes: Stroke[];
  onAddStroke: (points: Point[]) => void;
  selectedStrokeId: string | null;
  onSelectStroke: (id: string | null) => void;
  isUIHovered: boolean;
  selectionLocked: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

// --- Helper Functions ---

const dist = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const distToSegment = (p: Point, v: Point, w: Point) => {
  const l2 = Math.pow(dist(v, w), 2);
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
const lerpPoint = (p1: Point, p2: Point, t: number): Point => ({
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t
});

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ 
  currentSettings, 
  strokes, 
  onAddStroke,
  selectedStrokeId,
  onSelectStroke,
  isUIHovered,
  selectionLocked,
  canvasRef
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
        const gridRange = 3;
        for(let gx = -gridRange; gx <= gridRange; gx++) {
            for(let gy = -gridRange; gy <= gridRange; gy++) {
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
            if (lastPoint && dist(lastPoint, point) > 2) {
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

    // Binary search for start and end indices is faster than linear scan for large arrays,
    // but linear is fine for < 100 points. Let's do a simple scan for robustness.
    
    let startIndex = 0;
    let endIndex = count - 1;

    // Find closest indices (Performance: O(N), could be O(log N) but N is small)
    while (startIndex < count - 1 && cumulativeLengths[startIndex + 1] < startLength) {
        startIndex++;
    }
    while (endIndex > 0 && cumulativeLengths[endIndex - 1] > endLength) {
        endIndex--;
    }

    // Determine interpolation factors for smooth cutoff
    // This prevents the stroke from "jumping" between vertices
    const startSegmentLen = cumulativeLengths[startIndex + 1] - cumulativeLengths[startIndex];
    const endSegmentLen = cumulativeLengths[endIndex] - cumulativeLengths[endIndex - 1];
    
    let startT = 0;
    if (startSegmentLen > 0) {
        startT = (startLength - cumulativeLengths[startIndex]) / startSegmentLen;
    }
    // Clamp
    startT = Math.max(0, Math.min(1, startT));
    
    let endT = 1; // Default to full segment
    if (endIndex > 0 && endSegmentLen > 0) {
        endT = (endLength - cumulativeLengths[endIndex - 1]) / endSegmentLen;
    }
    endT = Math.max(0, Math.min(1, endT));

    // Construct the polygon
    ctx.beginPath();
    
    // 1. Interpolated Start Points
    const pStartLeft = lerpPoint(left[startIndex], left[startIndex + 1] || left[startIndex], startT);
    const pStartRight = lerpPoint(right[startIndex], right[startIndex + 1] || right[startIndex], startT);

    // 2. Interpolated End Points
    // Careful: endIndex indexes the point *after* the segment
    const idxEndBase = Math.max(0, endIndex - 1);
    const idxEndNext = endIndex;
    const pEndLeft = lerpPoint(left[idxEndBase], left[idxEndNext], endT);
    const pEndRight = lerpPoint(right[idxEndBase], right[idxEndNext], endT);

    // Trace Outline
    ctx.moveTo(pStartLeft.x, pStartLeft.y);

    // Left side forward
    for (let i = startIndex + 1; i < endIndex; i++) {
        ctx.lineTo(left[i].x, left[i].y);
    }
    
    ctx.lineTo(pEndLeft.x, pEndLeft.y);
    ctx.lineTo(pEndRight.x, pEndRight.y);

    // Right side backward
    for (let i = endIndex - 1; i > startIndex; i--) {
        ctx.lineTo(right[i].x, right[i].y);
    }

    ctx.lineTo(pStartRight.x, pStartRight.y);
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
      
      // We can use the same indexing logic roughly for the spine
      // Just drawing the whole spine within range is easier
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
    const { symmetry, color, endColor, width: strokeWidth, points, totalLength, animationMode, precomputed } = stroke;
    const centerX = width / 2;
    const centerY = height / 2;

    if (endColor && points.length > 1) {
        const startP = points[0];
        const endP = points[points.length - 1];
        // Optimization: Create gradient once per frame per stroke, not per symmetry if possible,
        // but coordinates change. Keeping this is okay as it's not the main bottleneck.
        const gradient = ctx.createLinearGradient(startP.x, startP.y, endP.x, endP.y);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, endColor);
        ctx.fillStyle = gradient;
    } else {
        ctx.fillStyle = color;
    }

    // No strokeStyle needed for fill, unless selection
    
    // Calculate animation state once per stroke
    let startLen = 0;
    let endLen = totalLength;

    if (!forceFullDraw) {
        const baseProgress = (time * stroke.speed + stroke.phase); 
        // We pass the phase offset to the drawInstance, so we calculate specific lengths inside the loop if needed?
        // Actually, for Radial symmetry with phase shift, the lengths differ per copy.
        // So we must calculate lengths inside the symmetry loop.
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
                 const localProgress = cycle > 1 ? 2 - cycle : cycle;
                 localEnd = totalLength * localProgress;
                 localStart = 0;
            } else if (animationMode === AnimationMode.FLOW) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 if (cycle <= 1) {
                     localStart = 0;
                     localEnd = totalLength * cycle;
                 } else {
                     localStart = totalLength * (cycle - 1);
                     localEnd = totalLength;
                 }
            } else {
                 let localProgress = totalPhase % 1;
                 if (localProgress < 0) localProgress += 1;
                 localEnd = totalLength * localProgress;
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
         const gridRange = 3; 
         for(let x = -gridRange; x <= gridRange; x++) {
             for(let y = -gridRange; y <= gridRange; y++) {
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
         const gridRange = 3; 
         for(let gx = -gridRange; gx <= gridRange; gx++) {
             for(let gy = -gridRange; gy <= gridRange; gy++) {
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
                if (!lastP || dist(lastP, newP) > 1) { 
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

    const sec = time / 1000;
    
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
  }, [isDrawing, currentSettings, selectedStrokeId, isUIHovered]);

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