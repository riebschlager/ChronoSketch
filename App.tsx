
import React, { useState, useRef } from 'react';
import DrawingCanvas from './components/DrawingCanvas';
import ControlPanel from './components/ControlPanel';
import { Stroke, SymmetryType, AnimationMode, Point, PrecomputedRibbon, StrokeSettings } from './types';

// --- Geometry Helpers ---

const dist = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

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
    const l2 = Math.pow(dist(start, end), 2);
    if (l2 === 0) {
      d = dist(p, start);
    } else {
      const t = ((p.x - start.x) * (end.x - start.x) + (p.y - start.y) * (end.y - start.y)) / l2;
      if (t < 0) d = dist(p, start);
      else if (t > 1) d = dist(p, end);
      else {
        const proj = {
          x: start.x + t * (end.x - start.x),
          y: start.y + t * (end.y - start.y)
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

        left.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth });
        right.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth });
    }

    return { left, right, cumulativeLengths };
};

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isUIHovered, setIsUIHovered] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  
  // Ref for the canvas to support snapshot functionality
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Default settings for NEW strokes
  const [currentSettings, setCurrentSettings] = useState<Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>>({
    color: '#a855f7', // Purple 500
    endColor: undefined, // Default no gradient
    width: 4,
    taper: 0, // Default no taper
    smoothing: 3, // Default some smoothing
    simplification: 2, // Default slight simplification
    speed: 0.5,
    phase: 0,
    animationMode: AnimationMode.FLOW, // Default to the new flow mode
    symmetry: {
      type: SymmetryType.NONE,
      copies: 8,
      phaseShift: 0.05,
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
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
        onAIGenerateStroke={handleAIGeneratedStroke}
        onRedistributePhases={handleRedistributePhases}
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