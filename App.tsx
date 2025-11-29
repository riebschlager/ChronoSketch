
import React, { useState, useRef, useEffect } from 'react';
import DrawingCanvas, { getIndexForLength, lerp, hexToRgb, applyEasing } from './components/DrawingCanvas';
import ControlPanel from './components/ControlPanel';
import { Stroke, SymmetryType, AnimationMode, Point, PrecomputedRibbon, StrokeSettings, EasingType } from './types';

// --- Geometry Helpers ---

// Replaced pow with direct multiplication for slight perf gain in hot paths
const dist = (p1: Point, p2: Point) => Math.sqrt((p2.x - p1.x)*(p2.x - p1.x) + (p2.y - p1.y)*(p2.y - p1.y));

const getPathLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += dist(points[i - 1], points[i]);
  }
  return length;
};

// Ramer-Douglas-Peucker simplification
const simplifyPoints = (points: Point[], tolerance: number): Point[] => {
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
const smoothPoints = (points: Point[], iterations: number): Point[] => {
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

const processPoints = (points: Point[], smoothing: number, simplification: number): Point[] => {
  const simplified = simplifyPoints(points, simplification);
  const smoothed = smoothPoints(simplified, Math.floor(smoothing));
  return smoothed;
};

// Pre-calculate the Ribbon (Left/Right polygon edges) for the entire stroke
export const computeRibbon = (points: Point[], settings: { width: number, taper: number }): PrecomputedRibbon => {
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
            if (currentDist < taperLen) {
                currentWidth = baseWidth * (currentDist / taperLen);
            } else if (currentDist > totalLength - taperLen) {
                currentWidth = baseWidth * ((totalLength - currentDist) / taperLen);
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

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isUIHovered, setIsUIHovered] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState(1.0);
  const [showDebug, setShowDebug] = useState(false);
  
  // Ref for the canvas to support snapshot functionality
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Shared time ref to sync SVG export with visual state
  const animationTimeRef = useRef<number>(0);

  // Default settings for NEW strokes
  const [currentSettings, setCurrentSettings] = useState<Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>>({
    color: '#a855f7', // Purple 500
    endColor: undefined, // Default no gradient
    width: 4,
    taper: 0, // Default no taper
    smoothing: 0, // Default no smoothing
    simplification: 0, // Default no simplification
    speed: 0.5,
    phase: 0,
    easing: EasingType.SINE, // Default easing
    animationMode: AnimationMode.FLOW, // Default to the new flow mode
    symmetry: {
      type: SymmetryType.NONE,
      copies: 8,
      phaseShift: 0,
      gridGap: 150,
    },
    orbit: {
        enabled: false,
        mass: 2.0,
        friction: 0.95
    }
  });

  const activeStroke = selectedStrokeId ? strokes.find(s => s.id === selectedStrokeId) : null;
  
  // Flatten panel settings for display
  const panelSettings = activeStroke || currentSettings;

  // Add Keyboard Shortcut for Debug Panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Toggle debug with Backtick (`) or F3
        if (e.key === '`' || e.key === 'F3') {
            setShowDebug(prev => !prev);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updatePanelSettings = (updates: any) => {
    if (activeStroke) {
        setStrokes(prev => prev.map(s => {
            if (s.id === activeStroke.id) {
                const mergedSettings = { ...s, ...updates };
                // Ensure deep merge for nested objects
                if (updates.symmetry) {
                    mergedSettings.symmetry = { ...s.symmetry, ...updates.symmetry };
                }
                if (updates.orbit) {
                    mergedSettings.orbit = { ...s.orbit, ...updates.orbit };
                }

                // Check if we need to recalculate geometry
                const needsPointProcess = updates.smoothing !== undefined || updates.simplification !== undefined;
                const needsRibbonRecalc = needsPointProcess || updates.width !== undefined || updates.taper !== undefined;

                if (needsPointProcess) {
                    const newPoints = processPoints(
                        s.rawPoints, 
                        mergedSettings.smoothing, 
                        mergedSettings.simplification
                    );
                    mergedSettings.points = newPoints;
                    mergedSettings.totalLength = getPathLength(newPoints);
                }
                
                if (needsRibbonRecalc) {
                    mergedSettings.precomputed = computeRibbon(mergedSettings.points, {
                        width: mergedSettings.width,
                        taper: mergedSettings.taper
                    });
                }
                
                return mergedSettings;
            }
            return s;
        }));
    } else {
        // Update global settings for new strokes
        setCurrentSettings(prev => {
             const next = { ...prev, ...updates };
             if (updates.symmetry) {
                 next.symmetry = { ...prev.symmetry, ...updates.symmetry };
             }
             if (updates.orbit) {
                 next.orbit = { ...prev.orbit, ...updates.orbit };
             }
             return next;
        });
    }
  };

  const handleAddStroke = (rawPoints: Point[]) => {
    const processedPoints = processPoints(rawPoints, currentSettings.smoothing, currentSettings.simplification);
    
    // Initial Ribbon Calculation
    const ribbon = computeRibbon(processedPoints, { width: currentSettings.width, taper: currentSettings.taper });

    const newStroke: Stroke = {
      ...currentSettings,
      id: crypto.randomUUID(),
      rawPoints: rawPoints,
      points: processedPoints,
      totalLength: getPathLength(processedPoints),
      timestamp: Date.now(),
      precomputed: ribbon
    };
    setStrokes(prev => [...prev, newStroke]);
  };

  const handleAIGeneratedStroke = (normalizedPoints: Point[]) => {
      // Scale normalized (0-1) points to fit within the current window, centered
      const width = window.innerWidth;
      const height = window.innerHeight;
      const padding = Math.min(width, height) * 0.2;
      const effectiveWidth = width - padding * 2;
      const effectiveHeight = height - padding * 2;

      const scaledPoints = normalizedPoints.map(p => ({
          x: p.x * effectiveWidth + padding,
          y: p.y * effectiveHeight + padding
      }));

      handleAddStroke(scaledPoints);
  };

  const handleRedistributePhases = () => {
      setStrokes(prev => {
          if (prev.length <= 1) return prev.map(s => ({ ...s, phase: 0 }));
          
          return prev.map((stroke, index) => ({
              ...stroke,
              phase: index / (prev.length - 1)
          }));
      });
  };

  const handleClear = () => {
    if (selectedStrokeId) {
        setStrokes(prev => prev.filter(s => s.id !== selectedStrokeId));
        setSelectedStrokeId(null);
    } else {
        setStrokes([]);
        setSelectedStrokeId(null);
    }
  };

  const handleUndo = () => {
    setStrokes(prev => prev.slice(0, -1));
  };

  const handleToggleSelectionLock = () => {
    const newState = !selectionLocked;
    setSelectionLocked(newState);
    if (newState) {
        setSelectedStrokeId(null);
    }
  };

  const handleSnapshot = () => {
    if (canvasRef.current) {
        const link = document.createElement('a');
        link.download = `chronosketch-${Date.now()}.png`;
        link.href = canvasRef.current.toDataURL();
        link.click();
    }
  };

  const handleExportSVG = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const time = animationTimeRef.current;

      const getStrokeSVG = (stroke: Stroke) => {
          // Replicate animation logic to find start/end length
          const { totalLength, animationMode, speed, phase, easing } = stroke;
          let localStart = 0;
          let localEnd = totalLength;
          
          // Helper to generate path for a specific transform
          // We generate separate paths for each transform instance
          const generatePathsForInstance = (transformAttr: string, phaseOffset: number = 0) => {
              // Calculate specific time state for this instance
              const totalPhase = (time * speed + phase) + phaseOffset;
              
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

              if (localEnd <= localStart) return '';

              // Get ribbon geometry
              const { left, right, cumulativeLengths } = stroke.precomputed;
              const count = cumulativeLengths.length;

              const startSearchIdx = getIndexForLength(cumulativeLengths, localStart);
              const startIndex = Math.min(startSearchIdx, count - 2);
              const endSearchIdx = getIndexForLength(cumulativeLengths, localEnd);
              const endIndex = Math.min(endSearchIdx + 1, count - 1);

              // Interpolation
              const startSegmentLen = cumulativeLengths[startIndex + 1] - cumulativeLengths[startIndex];
              const endSegmentLen = cumulativeLengths[endIndex] - cumulativeLengths[endIndex - 1];
              
              let startT = (startSegmentLen > 0) ? (localStart - cumulativeLengths[startIndex]) / startSegmentLen : 0;
              startT = Math.max(0, Math.min(1, startT));
              
              let endT = (endIndex > 0 && endSegmentLen > 0) ? (localEnd - cumulativeLengths[endIndex - 1]) / endSegmentLen : 1;
              endT = Math.max(0, Math.min(1, endT));

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

              let paths = '';

              if (stroke.endColor) {
                const startRgb = hexToRgb(stroke.color);
                const endRgb = hexToRgb(stroke.endColor);
                const dr = endRgb.r - startRgb.r;
                const dg = endRgb.g - startRgb.g;
                const db = endRgb.b - startRgb.b;

                let curL = { x: pStartLeftX, y: pStartLeftY };
                let curR = { x: pStartRightX, y: pStartRightY };
                let curDist = localStart;

                for (let i = startIndex + 1; i < endIndex; i++) {
                    const nextL = left[i];
                    const nextR = right[i];
                    const nextDist = cumulativeLengths[i];
                    
                    const midDist = (curDist + nextDist) * 0.5;
                    const t = Math.max(0, Math.min(1, midDist / totalLength));
                    const r = Math.round(startRgb.r + dr * t);
                    const g = Math.round(startRgb.g + dg * t);
                    const b = Math.round(startRgb.b + db * t);
                    const fill = `rgb(${r},${g},${b})`;

                    const d = `M ${curL.x.toFixed(2)} ${curL.y.toFixed(2)} L ${nextL.x.toFixed(2)} ${nextL.y.toFixed(2)} L ${nextR.x.toFixed(2)} ${nextR.y.toFixed(2)} L ${curR.x.toFixed(2)} ${curR.y.toFixed(2)} Z`;
                    
                    paths += `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.5" />`;

                    curL = nextL;
                    curR = nextR;
                    curDist = nextDist;
                }
                 // Final segment
                 const midDist = (curDist + localEnd) * 0.5;
                 const t = Math.max(0, Math.min(1, midDist / totalLength));
                 const r = Math.round(startRgb.r + dr * t);
                 const g = Math.round(startRgb.g + dg * t);
                 const b = Math.round(startRgb.b + db * t);
                 const fill = `rgb(${r},${g},${b})`;
                 const d = `M ${curL.x.toFixed(2)} ${curL.y.toFixed(2)} L ${pEndLeftX.toFixed(2)} ${pEndLeftY.toFixed(2)} L ${pEndRightX.toFixed(2)} ${pEndRightY.toFixed(2)} L ${curR.x.toFixed(2)} ${curR.y.toFixed(2)} Z`;
                 paths += `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.5" />`;

              } else {
                  // Solid Color
                  let d = `M ${pStartLeftX.toFixed(2)} ${pStartLeftY.toFixed(2)}`;
                  for (let i = startIndex + 1; i < endIndex; i++) {
                      d += ` L ${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`;
                  }
                  d += ` L ${pEndLeftX.toFixed(2)} ${pEndLeftY.toFixed(2)}`;
                  d += ` L ${pEndRightX.toFixed(2)} ${pEndRightY.toFixed(2)}`;
                  
                  for (let i = endIndex - 1; i > startIndex; i--) {
                      d += ` L ${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`;
                  }
                  d += ` L ${pStartRightX.toFixed(2)} ${pStartRightY.toFixed(2)} Z`;

                  paths += `<path d="${d}" fill="${stroke.color}" />`;
              }
              
              return `<g transform="${transformAttr}">${paths}</g>`;
          };

          const centerX = width / 2;
          const centerY = height / 2;
          let content = '';

          switch (stroke.symmetry.type) {
              case SymmetryType.NONE:
                  content += generatePathsForInstance('');
                  break;
              case SymmetryType.MIRROR_X:
                  content += generatePathsForInstance('');
                  content += generatePathsForInstance(`translate(${width}, 0) scale(-1, 1)`);
                  break;
              case SymmetryType.MIRROR_Y:
                  content += generatePathsForInstance('');
                  content += generatePathsForInstance(`translate(0, ${height}) scale(1, -1)`);
                  break;
              case SymmetryType.MIRROR_XY:
                  content += generatePathsForInstance('');
                  content += generatePathsForInstance(`translate(${width}, 0) scale(-1, 1)`);
                  content += generatePathsForInstance(`translate(0, ${height}) scale(1, -1)`);
                  content += generatePathsForInstance(`translate(${width}, ${height}) scale(-1, -1)`);
                  break;
              case SymmetryType.RADIAL:
                  const angleStep = 360 / stroke.symmetry.copies;
                  for (let i = 0; i < stroke.symmetry.copies; i++) {
                      content += generatePathsForInstance(`rotate(${i * angleStep}, ${centerX}, ${centerY})`, i * stroke.symmetry.phaseShift);
                  }
                  break;
              case SymmetryType.GRID:
                 const gap = stroke.symmetry.gridGap || 100;
                 if (stroke.precomputed.bounds) {
                    const { minX, maxX, minY, maxY } = stroke.precomputed.bounds;
                    const pad = stroke.width;
                    const startX = Math.floor((-maxX - pad) / gap);
                    const endX = Math.ceil((width - minX + pad) / gap);
                    const startY = Math.floor((-maxY - pad) / gap);
                    const endY = Math.ceil((height - minY + pad) / gap);
                    
                    for(let x = startX; x <= endX; x++) {
                        for(let y = startY; y <= endY; y++) {
                            content += generatePathsForInstance(`translate(${x * gap}, ${y * gap})`);
                        }
                    }
                 } else {
                     content += generatePathsForInstance('');
                 }
                 break;
          }

          return `<g id="${stroke.id}">${content}</g>`;
      };

      const svgContent = strokes.map(getStrokeSVG).join('\n');
      const svgString = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="background-color: #0f172a">
  ${svgContent}
</svg>
      `.trim();

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chronosketch-${Date.now()}.svg`;
      link.click();
      URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    // We only need to export the data required to reconstruct the stroke
    // Precomputed data can be stripped to save space, as it's derivative
    const exportData = strokes.map(({ precomputed, ...rest }) => rest);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const link = document.createElement('a');
    link.href = dataStr;
    link.download = `chronosketch-project-${Date.now()}.json`;
    link.click();
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (Array.isArray(json)) {
                    // Backwards compatibility and Hydration
                    const fixedStrokes = json.map((s: any) => {
                        const rawPoints = s.rawPoints || s.points;
                        const smoothing = s.smoothing ?? 0;
                        const simplification = s.simplification ?? 0;
                        
                        // Ensure points are processed if not present or if settings match
                        // But usually we trust rawPoints and re-process to be safe
                        const points = processPoints(rawPoints, smoothing, simplification);
                        const width = s.width || 4;
                        const taper = s.taper || 0;

                        return {
                            ...s,
                            rawPoints: rawPoints,
                            points: points,
                            smoothing,
                            simplification,
                            taper,
                            width,
                            totalLength: getPathLength(points),
                            orbit: s.orbit || { enabled: false, mass: 2, friction: 0.95 },
                            easing: s.easing || EasingType.LINEAR,
                            // Hydrate the precomputed ribbon
                            precomputed: computeRibbon(points, { width, taper })
                        };
                    });
                    setStrokes(fixedStrokes);
                    setSelectedStrokeId(null);
                } else {
                    alert("Invalid file format.");
                }
            } catch (err) {
                console.error("Failed to parse JSON", err);
                alert("Failed to parse the file.");
            }
        };
        reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="relative w-screen h-screen bg-slate-950 overflow-hidden font-sans">
      <DrawingCanvas 
        strokes={strokes} 
        onAddStroke={handleAddStroke}
        currentSettings={currentSettings}
        isUIHovered={isUIHovered}
        selectedStrokeId={selectedStrokeId}
        onSelectStroke={setSelectedStrokeId}
        selectionLocked={selectionLocked}
        canvasRef={canvasRef}
        globalSpeed={globalSpeed}
        showDebug={showDebug}
        animationTimeRef={animationTimeRef}
      />
      
      <ControlPanel 
        settings={panelSettings}
        setSettings={updatePanelSettings}
        onClear={handleClear}
        onUndo={handleUndo}
        strokeCount={strokes.length}
        onMouseEnter={() => setIsUIHovered(true)}
        onMouseLeave={() => setIsUIHovered(false)}
        isEditing={!!selectedStrokeId}
        onDeselect={() => setSelectedStrokeId(null)}
        selectionLocked={selectionLocked}
        onToggleSelectionLock={handleToggleSelectionLock}
        onSnapshot={handleSnapshot}
        onExportSVG={handleExportSVG}
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        onAIGenerateStroke={handleAIGeneratedStroke}
        onRedistributePhases={handleRedistributePhases}
        globalSpeed={globalSpeed}
        setGlobalSpeed={setGlobalSpeed}
        showDebug={showDebug}
        onToggleDebug={() => setShowDebug(!showDebug)}
      />

      {strokes.length === 0 && (
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 pointer-events-none text-slate-600 text-sm animate-pulse">
          Click and drag to draw. {selectionLocked ? 'Selection is locked.' : 'Click strokes to edit.'}
        </div>
      )}
    </div>
  );
}

export default App;
