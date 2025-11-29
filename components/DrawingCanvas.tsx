import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, Point, SymmetryType, AnimationMode, PrecomputedRibbon, EasingType, CapType } from '../types';
import { 
    computeRibbon, 
    distSq, 
    distToSegment, 
    getPathLength, 
    lerp, 
    lerpPoint, 
    getIndexForLength, 
    applyEasing, 
    hexToRgb 
} from '../geometry';

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
  
  // Refs for loop access to avoid dependency churn
  const currentSettingsRef = useRef(currentSettings);
  const selectedStrokeIdRef = useRef(selectedStrokeId);
  const isUIHoveredRef = useRef(isUIHovered);
  const isDrawingRef = useRef(isDrawing);
  const globalSpeedRef = useRef(globalSpeed);
  const strokesRef = useRef<Stroke[]>(strokes);
  const showDebugRef = useRef(showDebug);

  // Sync refs
  useEffect(() => { currentSettingsRef.current = currentSettings; }, [currentSettings]);
  useEffect(() => { selectedStrokeIdRef.current = selectedStrokeId; }, [selectedStrokeId]);
  useEffect(() => { isUIHoveredRef.current = isUIHovered; }, [isUIHovered]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { globalSpeedRef.current = globalSpeed; }, [globalSpeed]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);

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
          // Physics handles point addition in loop
      } else {
          if (isDrawing) {
            const lastPoint = currentPathRef.current[currentPathRef.current.length - 1];
            if (lastPoint) {
                // Optimization: distSq is simpler here
                const dx = lastPoint.x - point.x;
                const dy = lastPoint.y - point.y;
                if (dx*dx + dy*dy > 4) {
                    currentPathRef.current.push(point);
                }
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
    if (!precomputed || precomputed.left.length < 2) return;
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

            // Fill gaps
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
    if (isSelected && points.length > 0) {
      ctx.save();
      
      const pStartCenter = lerpPoint(points[startIndex], points[Math.min(startIndex+1, points.length-1)], startT);
      const pEndCenter = lerpPoint(points[idxEndBase], points[Math.min(idxEndNext, points.length-1)], endT);

      ctx.beginPath();
      ctx.moveTo(pStartCenter.x, pStartCenter.y);
      for (let i = startIndex + 1; i <= idxEndBase; i++) {
          if (points[i]) ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.lineTo(pEndCenter.x, pEndCenter.y);
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.lineCap = 'butt';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = baseWidth + 4; 
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
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
             const pad = strokeWidth + 50; 
             
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
    const settings = currentSettingsRef.current;
    
    if (settings.orbit.enabled) {
        x = physicsStateRef.current.pos.x;
        y = physicsStateRef.current.pos.y;
    } else {
        if (!mousePosRef.current) return;
        x = mousePosRef.current.x;
        y = mousePosRef.current.y;
    }

    const { symmetry, color, width: strokeWidth } = settings;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.max(2, strokeWidth / 2);

    if (settings.orbit.enabled && mousePosRef.current) {
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
    if (!canvas) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
    }
    
    const perfStart = performance.now();
    const settings = currentSettingsRef.current;
    const isDrawingState = isDrawingRef.current;
    const selectedId = selectedStrokeIdRef.current;
    const isHovered = isUIHoveredRef.current;
    const isDebug = showDebugRef.current;
    const currentSpeed = globalSpeedRef.current;
    const currentStrokes = strokesRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (settings.orbit.enabled) {
        const mouse = mousePosRef.current;
        if (mouse || isDrawingState) {
            const target = mouse || physicsStateRef.current.pos;
            const mass = Math.max(0.1, settings.orbit.mass);
            const k = 0.1 / mass; 
            const friction = settings.orbit.friction;

            const dx = target.x - physicsStateRef.current.pos.x;
            const dy = target.y - physicsStateRef.current.pos.y;
            
            const ax = dx * k;
            const ay = dy * k;

            physicsStateRef.current.vel.x = (physicsStateRef.current.vel.x + ax) * friction;
            physicsStateRef.current.vel.y = (physicsStateRef.current.vel.y + ay) * friction;

            physicsStateRef.current.pos.x += physicsStateRef.current.vel.x;
            physicsStateRef.current.pos.y += physicsStateRef.current.vel.y;
            
            if (isDrawingState) {
                const newP = { ...physicsStateRef.current.pos };
                const lastP = currentPathRef.current[currentPathRef.current.length - 1];
                // Check distance squared > 1 to avoid duplicates
                const dxp = lastP ? lastP.x - newP.x : 10;
                const dyp = lastP ? lastP.y - newP.y : 10;
                if (!lastP || (dxp*dxp + dyp*dyp > 1)) { 
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
    // Protect against weird time jumps
    let deltaSeconds = (time - lastTimeRef.current) / 1000;
    if (deltaSeconds > 0.5) deltaSeconds = 0.016; // Cap at 500ms lag

    lastTimeRef.current = time;
    
    scaledTimeRef.current += deltaSeconds * currentSpeed;
    const sec = scaledTimeRef.current;
    
    animationTimeRef.current = sec;

    currentStrokes.forEach(stroke => {
      if (stroke.precomputed) {
          renderSymmetries(ctx, stroke, canvas.width, canvas.height, sec, stroke.id === selectedId);
      }
    });

    if (isDrawingState && currentPathRef.current.length > 1) {
        const points = currentPathRef.current;
        const tempTotalLength = getPathLength(points);
        
        const previewRibbon = computeRibbon(points, { 
            width: settings.width, 
            taper: settings.taper || 0,
            taperEasing: settings.taperEasing
        });

        const previewStroke: Stroke = {
            ...settings,
            capStart: settings.capStart || CapType.BUTT,
            capEnd: settings.capEnd || CapType.BUTT,
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

    if ((mousePosRef.current && !isHovered) || (settings.orbit.enabled && !isHovered)) {
         renderGhostCursor(ctx, canvas.width, canvas.height, mousePosRef.current || {x:0,y:0});
    }

    const perfEnd = performance.now();
    const renderDuration = perfEnd - perfStart;

    if (isDebug && debugPanelRef.current) {
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

            const totalPoints = currentStrokes.reduce((acc, str) => acc + str.points.length, 0);
            const res = `${canvas.width}x${canvas.height}`;
            const mem = (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024) + 'MB' : 'N/A';
            const mouse = mousePosRef.current ? `${Math.round(mousePosRef.current.x)},${Math.round(mousePosRef.current.y)}` : 'N/A';
            
            debugPanelRef.current.innerText = 
`DEBUG METRICS
----------------
FPS: ${s.fps} (Min: ${s.minFps}, Max: ${s.maxFps})
Frame Time: ${s.lastRenderTime.toFixed(2)}ms
Resolution: ${res}
Strokes: ${currentStrokes.length}
Total Points: ${totalPoints}
Memory: ${mem}
Cursor: ${mouse}
Render Scale: ${currentSpeed.toFixed(1)}x`;
        }
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, []); // Empty dependency array for stability!

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