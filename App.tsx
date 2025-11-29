import React, { useState, useRef, useEffect } from 'react';
import DrawingCanvas from './components/DrawingCanvas';
import ControlPanel from './components/ControlPanel';
import { Stroke, SymmetryType, AnimationMode, Point, PrecomputedRibbon, StrokeSettings, EasingType, CapType } from './types';
import { 
    processPoints, 
    computeRibbon, 
    getPathLength, 
    lerp, 
    getIndexForLength, 
    hexToRgb, 
    applyEasing,
    lerpPoint 
} from './geometry';

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isUIHovered, setIsUIHovered] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState(1.0);
  const [showDebug, setShowDebug] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const animationTimeRef = useRef<number>(0);

  const [currentSettings, setCurrentSettings] = useState<Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>>({
    color: '#a855f7', 
    endColor: undefined, 
    width: 4,
    taper: 0, 
    taperEasing: EasingType.LINEAR,
    capStart: CapType.ROUND,
    capEnd: CapType.ROUND,
    smoothing: 0, 
    simplification: 0, 
    speed: 0.5,
    phase: 0,
    easing: EasingType.SINE, 
    animationMode: AnimationMode.FLOW, 
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
  
  const panelSettings = activeStroke || currentSettings;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
                if (updates.symmetry) {
                    mergedSettings.symmetry = { ...s.symmetry, ...updates.symmetry };
                }
                if (updates.orbit) {
                    mergedSettings.orbit = { ...s.orbit, ...updates.orbit };
                }

                const needsPointProcess = updates.smoothing !== undefined || updates.simplification !== undefined;
                const needsRibbonRecalc = needsPointProcess || updates.width !== undefined || updates.taper !== undefined || updates.taperEasing !== undefined;

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
                        taper: mergedSettings.taper,
                        taperEasing: mergedSettings.taperEasing
                    });
                }
                
                return mergedSettings;
            }
            return s;
        }));
    } else {
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
    
    const ribbon = computeRibbon(processedPoints, { 
      width: currentSettings.width, 
      taper: currentSettings.taper,
      taperEasing: currentSettings.taperEasing
    });

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
          const { totalLength, animationMode, speed, phase, easing } = stroke;
          let localStart = 0;
          let localEnd = totalLength;
          
          const generatePathsForInstance = (transformAttr: string, phaseOffset: number = 0) => {
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

              const { left, right, cumulativeLengths } = stroke.precomputed;
              const count = cumulativeLengths.length;

              const startSearchIdx = getIndexForLength(cumulativeLengths, localStart);
              const startIndex = Math.min(startSearchIdx, count - 2);
              const endSearchIdx = getIndexForLength(cumulativeLengths, localEnd);
              const endIndex = Math.min(endSearchIdx + 1, count - 1);

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
              let startCapColor = stroke.color;
              let endCapColor = stroke.color;

              if (stroke.endColor) {
                const startRgb = hexToRgb(stroke.color);
                const endRgb = hexToRgb(stroke.endColor);
                const dr = endRgb.r - startRgb.r;
                const dg = endRgb.g - startRgb.g;
                const db = endRgb.b - startRgb.b;

                // Cap Colors
                const tS = Math.max(0, Math.min(1, localStart / totalLength));
                const rS = Math.round(startRgb.r + dr * tS);
                const gS = Math.round(startRgb.g + dg * tS);
                const bS = Math.round(startRgb.b + db * tS);
                startCapColor = `rgb(${rS},${gS},${bS})`;
                
                const tE = Math.max(0, Math.min(1, localEnd / totalLength));
                const rE = Math.round(startRgb.r + dr * tE);
                const gE = Math.round(startRgb.g + dg * tE);
                const bE = Math.round(startRgb.b + db * tE);
                endCapColor = `rgb(${rE},${gE},${bE})`;

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
                 const midDist = (curDist + localEnd) * 0.5;
                 const t = Math.max(0, Math.min(1, midDist / totalLength));
                 const r = Math.round(startRgb.r + dr * t);
                 const g = Math.round(startRgb.g + dg * t);
                 const b = Math.round(startRgb.b + db * t);
                 const fill = `rgb(${r},${g},${b})`;
                 const d = `M ${curL.x.toFixed(2)} ${curL.y.toFixed(2)} L ${pEndLeftX.toFixed(2)} ${pEndLeftY.toFixed(2)} L ${pEndRightX.toFixed(2)} ${pEndRightY.toFixed(2)} L ${curR.x.toFixed(2)} ${curR.y.toFixed(2)} Z`;
                 paths += `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.5" />`;

              } else {
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

              // --- SVG Cap Logic ---
              const drawSvgCap = (pLeft: Point, pRight: Point, type: CapType, color: string, isStart: boolean) => {
                  if (!type || type === CapType.BUTT) return '';
                  const mx = (pLeft.x + pRight.x) / 2;
                  const my = (pLeft.y + pRight.y) / 2;
                  const dx = pRight.x - pLeft.x;
                  const dy = pRight.y - pLeft.y;
                  const dist = Math.sqrt(dx*dx + dy*dy);
                  const r = dist / 2;
                  if (r < 0.1) return '';

                  let nx = dy;
                  let ny = -dx;
                  const len = Math.sqrt(nx*nx + ny*ny);
                  if (len === 0) return '';
                  nx /= len;
                  ny /= len;
                  if (isStart) { nx = -nx; ny = -ny; }

                  if (type === CapType.ROUND) {
                      return `<circle cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="${r.toFixed(2)}" fill="${color}" />`;
                  } else if (type === CapType.SQUARE) {
                      const px = nx * r;
                      const py = ny * r;
                      const p1 = {x: pRight.x, y: pRight.y};
                      const p2 = {x: pRight.x + px, y: pRight.y + py};
                      const p3 = {x: pLeft.x + px, y: pLeft.y + py};
                      const p4 = {x: pLeft.x, y: pLeft.y};
                      return `<polygon points="${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}" fill="${color}" />`;
                  }
                  return '';
              };

              paths += drawSvgCap({x: pStartLeftX, y: pStartLeftY}, {x: pStartRightX, y: pStartRightY}, stroke.capStart || CapType.BUTT, startCapColor, true);
              paths += drawSvgCap({x: pEndLeftX, y: pEndLeftY}, {x: pEndRightX, y: pEndRightY}, stroke.capEnd || CapType.BUTT, endCapColor, false);

              
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
                    const fixedStrokes = json.map((s: any) => {
                        const rawPoints = s.rawPoints || s.points;
                        const smoothing = s.smoothing || 0;
                        const simplification = s.simplification || 0;
                        
                        // Re-process points based on stored raw points and settings
                        const processedPoints = processPoints(rawPoints, smoothing, simplification);
                        const taperEasing = s.taperEasing || EasingType.LINEAR;
                        const ribbon = computeRibbon(processedPoints, { width: s.width, taper: s.taper || 0, taperEasing });
                        
                        return {
                             ...s,
                             rawPoints,
                             points: processedPoints,
                             precomputed: ribbon,
                             taperEasing
                        };
                    });
                    setStrokes(fixedStrokes);
                    setSelectedStrokeId(null);
                }
            } catch (err) {
                console.error("Invalid JSON", err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-900 select-none touch-none">
       <DrawingCanvas 
          currentSettings={currentSettings}
          strokes={strokes}
          onAddStroke={handleAddStroke}
          selectedStrokeId={selectedStrokeId}
          onSelectStroke={(id) => {
              if (selectionLocked) return;
              setSelectedStrokeId(id);
          }}
          isUIHovered={isUIHovered}
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
       
       {strokes.length === 0 && !isUIHovered && (
           <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 pointer-events-none text-slate-500 text-sm animate-pulse">
               Draw on the canvas to start...
           </div>
       )}
    </div>
  );
}

export default App;