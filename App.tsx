
import React, { useState, useRef } from 'react';
import DrawingCanvas from './components/DrawingCanvas';
import ControlPanel from './components/ControlPanel';
import { Stroke, SymmetryType, AnimationMode, Point } from './types';

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

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isUIHovered, setIsUIHovered] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  
  // Ref for the canvas to support snapshot functionality
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Default settings for NEW strokes
  const [currentSettings, setCurrentSettings] = useState<Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp'>>({
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
    }
  });

  const activeStroke = selectedStrokeId ? strokes.find(s => s.id === selectedStrokeId) : null;
  
  const panelSettings = activeStroke || currentSettings;

  const updatePanelSettings = (updates: any) => {
    if (activeStroke) {
        setStrokes(prev => prev.map(s => {
            if (s.id === activeStroke.id) {
                const mergedSettings = { ...s, ...updates };
                // Ensure symmetry object is properly merged
                if (updates.symmetry) {
                    mergedSettings.symmetry = { ...s.symmetry, ...updates.symmetry };
                }

                // If geometry parameters changed, re-process points
                if (updates.smoothing !== undefined || updates.simplification !== undefined) {
                    const newPoints = processPoints(
                        s.rawPoints, 
                        mergedSettings.smoothing, 
                        mergedSettings.simplification
                    );
                    mergedSettings.points = newPoints;
                    mergedSettings.totalLength = getPathLength(newPoints);
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
             return next;
        });
    }
  };

  const handleAddStroke = (rawPoints: Point[]) => {
    const processedPoints = processPoints(rawPoints, currentSettings.smoothing, currentSettings.simplification);
    
    const newStroke: Stroke = {
      ...currentSettings,
      id: crypto.randomUUID(),
      rawPoints: rawPoints,
      points: processedPoints,
      totalLength: getPathLength(processedPoints),
      timestamp: Date.now(),
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
    // Only save what's necessary (we can reconstruct points from rawPoints if needed, 
    // but saving points is safer for exact reproduction if algorithm changes)
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(strokes, null, 2));
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
                    // Backwards compatibility check: if rawPoints missing, use points
                    const fixedStrokes = json.map((s: any) => ({
                        ...s,
                        rawPoints: s.rawPoints || s.points,
                        smoothing: s.smoothing ?? 0,
                        simplification: s.simplification ?? 0,
                        taper: s.taper ?? 0, // Backward compat for taper
                    }));
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
