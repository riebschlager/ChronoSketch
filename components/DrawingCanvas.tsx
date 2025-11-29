
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, Point, SymmetryType, AnimationMode } from '../types';

interface DrawingCanvasProps {
  currentSettings: Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp'>;
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
  const cursorPosRef = useRef<Point | null>(null);
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
    currentPathRef.current = [point];
    cursorPosRef.current = point;
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const point = getCanvasPoint(e);
    if (point) {
      cursorPosRef.current = point;
      
      if (isDrawing) {
        const lastPoint = currentPathRef.current[currentPathRef.current.length - 1];
        if (dist(lastPoint, point) > 2) {
          currentPathRef.current.push(point);
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
    cursorPosRef.current = null;
    handleEnd();
  };

  // --- Rendering Logic ---

  const renderStrokePath = (
    ctx: CanvasRenderingContext2D, 
    points: Point[], 
    startLength: number,
    endLength: number,
    totalLength: number,
    baseWidth: number,
    taper: number,
    isSelected: boolean = false
  ) => {
    if (points.length < 2) return;
    if (endLength <= startLength) return;

    // --- Path Construction Logic ---
    // Instead of simple lineTo, we calculate left and right offsets for a variable width polygon
    
    const polygonPointsLeft: Point[] = [];
    const polygonPointsRight: Point[] = [];

    let currentDist = 0;
    
    // Taper Logic: Taper is a percentage (0-100) of total length
    const taperLen = totalLength * (taper / 100);

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let d = 0;
        
        if (i > 0) {
            currentDist += dist(points[i-1], p);
        }

        // Clip Points outside visible range
        // Note: For perfect clipping we should interpolate the exact start/end points, 
        // but for performance in JS loop, simplistic clipping with dense points is usually okay.
        // We add a small buffer to ensure we catch the segment crossing the boundary
        if (currentDist < startLength && i < points.length - 1 && (currentDist + dist(p, points[i+1])) < startLength) {
             continue;
        }
        if (currentDist > endLength && i > 0 && (currentDist - dist(points[i-1], p)) > endLength) {
             break;
        }

        // Calculate Normal
        let nx = 0;
        let ny = 0;
        
        if (i === 0) {
            const next = points[i+1];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            nx = -dy / len;
            ny = dx / len;
        } else if (i === points.length - 1) {
            const prev = points[i-1];
            const dx = p.x - prev.x;
            const dy = p.y - prev.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            nx = -dy / len;
            ny = dx / len;
        } else {
            // Average normal
            const prev = points[i-1];
            const next = points[i+1];
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            nx = -dy / len;
            ny = dx / len;
        }

        // Calculate Width at this point based on Taper
        let currentWidth = baseWidth;
        if (taperLen > 0) {
            // Distance relative to the TOTAL geometry (not just visible part)
            // This ensures the taper stays at the ends of the path, not the ends of the animation
            if (currentDist < taperLen) {
                currentWidth = baseWidth * (currentDist / taperLen);
            } else if (currentDist > totalLength - taperLen) {
                currentWidth = baseWidth * ((totalLength - currentDist) / taperLen);
            }
        }
        // Clamp width to 0
        currentWidth = Math.max(0, currentWidth);
        const halfWidth = currentWidth / 2;

        polygonPointsLeft.push({
            x: p.x + nx * halfWidth,
            y: p.y + ny * halfWidth
        });
        polygonPointsRight.push({
            x: p.x - nx * halfWidth,
            y: p.y - ny * halfWidth
        });
    }

    if (polygonPointsLeft.length < 2) return;

    // Render Selection Glow (Behind)
    if (isSelected) {
      ctx.save();
      ctx.shadowColor = 'white';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = baseWidth + 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Simple centerline for glow
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

    // Render Filled Polygon
    ctx.beginPath();
    ctx.moveTo(polygonPointsLeft[0].x, polygonPointsLeft[0].y);
    
    // Left side forward
    for (let i = 1; i < polygonPointsLeft.length; i++) {
        ctx.lineTo(polygonPointsLeft[i].x, polygonPointsLeft[i].y);
    }
    
    // Cap (Line to last right point)
    ctx.lineTo(polygonPointsRight[polygonPointsRight.length - 1].x, polygonPointsRight[polygonPointsRight.length - 1].y);

    // Right side backward
    for (let i = polygonPointsRight.length - 2; i >= 0; i--) {
        ctx.lineTo(polygonPointsRight[i].x, polygonPointsRight[i].y);
    }
    
    ctx.closePath();
    
    // Fill replaces Stroke
    // Note: color/gradient is set in parent
    ctx.fill();
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
    const { symmetry, color, endColor, width: strokeWidth, taper, speed, phase, points, totalLength, animationMode } = stroke;
    const centerX = width / 2;
    const centerY = height / 2;

    if (endColor && points.length > 1) {
        const startP = points[0];
        const endP = points[points.length - 1];
        // Use fillStyle for polygon fill
        if (Math.abs(startP.x - endP.x) < 0.1 && Math.abs(startP.y - endP.y) < 0.1) {
             ctx.fillStyle = color;
        } else {
             const gradient = ctx.createLinearGradient(startP.x, startP.y, endP.x, endP.y);
             gradient.addColorStop(0, color);
             gradient.addColorStop(1, endColor);
             ctx.fillStyle = gradient;
        }
    } else {
        ctx.fillStyle = color;
    }

    // Reset line styles just in case, though we are filling
    ctx.lineWidth = 1; 

    const baseProgress = (time * speed + phase); 

    const drawInstance = (phaseOffset: number, transformFn: () => void) => {
        ctx.save();
        transformFn();
        
        let startLen = 0;
        let endLen = totalLength;

        if (!forceFullDraw) {
            const totalPhase = baseProgress + phaseOffset;
            
            if (animationMode === AnimationMode.YOYO) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 const localProgress = cycle > 1 ? 2 - cycle : cycle;
                 endLen = totalLength * localProgress;
                 startLen = 0;
            } else if (animationMode === AnimationMode.FLOW) {
                 let cycle = totalPhase % 2;
                 if (cycle < 0) cycle += 2;
                 
                 if (cycle <= 1) {
                     startLen = 0;
                     endLen = totalLength * cycle;
                 } else {
                     startLen = totalLength * (cycle - 1);
                     endLen = totalLength;
                 }
            } else {
                 let localProgress = totalPhase % 1;
                 if (localProgress < 0) localProgress += 1;
                 endLen = totalLength * localProgress;
                 startLen = 0;
            }
        }
        renderStrokePath(ctx, points, startLen, endLen, totalLength, strokeWidth, taper || 0, isSelected);
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

  const renderGhostCursor = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!cursorPosRef.current || isUIHovered) return;
    
    const { x, y } = cursorPosRef.current;
    const { symmetry, color, width: strokeWidth } = currentSettings;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(2, strokeWidth / 2);

    ctx.fillStyle = color;
    // Make it translucent
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

    ctx.globalAlpha = 1.0; // Reset
  };

  const renderLoop = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const sec = time / 1000;
    
    // Render existing strokes
    strokesRef.current.forEach(stroke => {
      renderSymmetries(ctx, stroke, canvas.width, canvas.height, sec, stroke.id === selectedStrokeId);
    });

    // Render current drawing stroke (Live Preview)
    if (isDrawing && currentPathRef.current.length > 1) {
        const points = currentPathRef.current;
        const tempTotalLength = getPathLength(points);
        // Note: For preview, we don't apply full smoothing to save perf
        const previewStroke: Stroke = {
            ...currentSettings,
            smoothing: 0,
            simplification: 0,
            id: 'preview',
            points: points,
            rawPoints: points,
            totalLength: tempTotalLength,
            timestamp: Date.now()
        };
        renderSymmetries(ctx, previewStroke, canvas.width, canvas.height, sec, false, true);
    }

    // Render Ghost Cursor
    renderGhostCursor(ctx, canvas.width, canvas.height);

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
