
import React, { useState, useEffect } from 'react';
import { Stroke, SymmetryType, AnimationMode, Point } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Trash2, 
  Undo2, 
  Copy, 
  RefreshCcw,
  Palette,
  Activity,
  Edit2,
  XCircle,
  Repeat,
  ArrowRightLeft,
  ChevronsRight,
  Sparkles,
  ArrowRight,
  Lock,
  Unlock,
  Download,
  Upload,
  Image as ImageIcon,
  Save,
  ChevronDown,
  ChevronRight,
  Wand2
} from 'lucide-react';

interface ControlPanelProps {
  settings: Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp'>;
  setSettings: (newSettings: any) => void;
  onClear: () => void;
  onUndo: () => void;
  strokeCount: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  isEditing: boolean;
  onDeselect: () => void;
  selectionLocked: boolean;
  onToggleSelectionLock: () => void;
  onSnapshot: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onAIGenerateStroke: (normalizedPoints: Point[]) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  settings, 
  setSettings, 
  onClear, 
  onUndo, 
  strokeCount,
  onMouseEnter,
  onMouseLeave,
  isEditing,
  onDeselect,
  selectionLocked,
  onToggleSelectionLock,
  onSnapshot,
  onExportJSON,
  onImportJSON,
  onAIGenerateStroke
}) => {
  const [activeColorTarget, setActiveColorTarget] = useState<'color' | 'endColor'>('color');
  const [palettePrompt, setPalettePrompt] = useState('');
  const [isGeneratingPalette, setIsGeneratingPalette] = useState(false);
  const [isGeneratingStroke, setIsGeneratingStroke] = useState(false);
  
  // Persistent Palette History
  const [paletteHistory, setPaletteHistory] = useState<string[][]>(() => {
    try {
      const saved = localStorage.getItem('chronosketch_palettes');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('chronosketch_palettes', JSON.stringify(paletteHistory));
  }, [paletteHistory]);
  
  // Accordion State
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    style: true,
    motion: false,
    symmetry: true,
    project: false
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateSetting = <K extends keyof typeof settings>(key: K, value: typeof settings[K]) => {
    setSettings({ [key]: value });
  };

  const updateSymmetry = <K extends keyof typeof settings.symmetry>(key: K, value: typeof settings.symmetry[K]) => {
    setSettings({
      symmetry: { ...settings.symmetry, [key]: value }
    });
  };

  const handleGeneratePalette = async () => {
    if (!palettePrompt.trim() || !process.env.API_KEY) return;
    
    setIsGeneratingPalette(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Generate a cohesive color palette of 7 hex codes based on this theme: "${palettePrompt}".`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
             type: Type.ARRAY,
             items: { type: Type.STRING }
          }
        }
      });
      
      const json = JSON.parse(response.text || '[]');
      if (Array.isArray(json) && json.length > 0) {
        // Filter to ensure strings
        const validPalette = json.filter(c => typeof c === 'string');
        if (validPalette.length > 0) {
          setPaletteHistory(prev => [validPalette, ...prev].slice(0, 50)); // Keep last 50
        }
      }
    } catch (e) {
      console.error("Failed to generate palette", e);
    } finally {
      setIsGeneratingPalette(false);
    }
  };

  const handleGenerateAIStroke = async () => {
    if (!process.env.API_KEY) return;
    setIsGeneratingStroke(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Generate a creative, abstract 2D path consisting of 20 to 60 coordinates. The path should be smooth, continuous, and artistic (e.g., a spiral, a figure-eight, a wave, or a complex loop). Return a JSON array of objects with 'x' and 'y' properties. The values for x and y must be floats strictly between 0.0 and 1.0.",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER }
              },
              required: ['x', 'y']
            }
          }
        }
      });
      
      const points = JSON.parse(response.text || '[]');
      if (Array.isArray(points) && points.length > 1) {
        onAIGenerateStroke(points);
      }
    } catch (e) {
      console.error("Failed to generate stroke", e);
    } finally {
      setIsGeneratingStroke(false);
    }
  };

  // Theme colors based on mode
  const accentColor = isEditing ? 'text-cyan-400' : 'text-purple-400';
  const accentBg = isEditing ? 'bg-cyan-600/50 border-cyan-400 text-white' : 'bg-purple-600/50 border-purple-400 text-white';
  const containerBorder = isEditing ? 'border-cyan-700/50 shadow-cyan-900/20' : 'border-slate-700 shadow-2xl';

  const SectionHeader = ({ id, label, icon: Icon }: { id: string, label: string, icon: any }) => (
    <button 
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between p-3 hover:bg-slate-800/50 rounded-lg transition-colors text-sm font-semibold text-slate-300 group"
    >
        <div className="flex items-center gap-2 group-hover:text-white transition-colors">
            <Icon size={16} className={openSections[id] ? accentColor : "text-slate-500"} /> 
            {label}
        </div>
        {openSections[id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
  );

  return (
    <div 
      className={`fixed z-50 top-4 right-4 w-80 bg-slate-900/95 backdrop-blur-md border rounded-xl shadow-2xl flex flex-col max-h-[90vh] select-none transition-all duration-300 ${containerBorder}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* --- Fixed Header --- */}
      <div className="flex-none flex items-center justify-between border-b border-slate-700 p-4">
        <h1 className={`font-bold text-lg flex items-center gap-2 transition-colors ${accentColor}`}>
          {isEditing ? <Edit2 size={20}/> : <Activity size={20}/>}
          {isEditing ? 'Edit Stroke' : 'ChronoSketch'}
        </h1>
        <div className="flex items-center gap-3">
            <button
                onClick={onToggleSelectionLock}
                className={`flex items-center justify-center p-1.5 rounded transition-all ${
                    selectionLocked 
                    ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/50' 
                    : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                }`}
                title={selectionLocked ? "Unlock Selection" : "Lock Selection (Draw Only)"}
            >
                {selectionLocked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>

            {isEditing && (
                <button 
                  onClick={onDeselect}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-1 rounded"
                >
                  <XCircle size={12}/> Done
                </button>
            )}
            {!isEditing && <div className="text-xs text-slate-400">{strokeCount} Layers</div>}
        </div>
      </div>

      {/* --- Scrollable Content (Accordion) --- */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1 custom-scrollbar">
        
        {/* Style Section */}
        <div className="border-b border-slate-800/50">
           <SectionHeader id="style" label="Colors & Style" icon={Palette} />
           {openSections.style && (
             <div className="px-3 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Enable Gradient</span>
                  <input 
                      type="checkbox" 
                      checked={!!settings.endColor} 
                      onChange={(e) => {
                          if (e.target.checked) {
                              updateSetting('endColor', settings.color);
                              setActiveColorTarget('endColor');
                          } else {
                              updateSetting('endColor', undefined);
                              setActiveColorTarget('color');
                          }
                      }}
                      className={`w-4 h-4 rounded cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-purple-500'}`}
                  />
                </div>
                
                <div className="flex gap-2 items-center">
                    {/* Start Color */}
                    <div 
                        className={`relative p-1 rounded border-2 transition-all cursor-pointer ${activeColorTarget === 'color' ? 'border-white bg-slate-700' : 'border-transparent hover:bg-slate-800'}`}
                        onClick={() => setActiveColorTarget('color')}
                    >
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: settings.color }}></div>
                        <input 
                            type="color" 
                            value={settings.color}
                            onChange={(e) => updateSetting('color', e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                    </div>

                    {settings.endColor && (
                        <>
                        <ArrowRight size={16} className="text-slate-500"/>
                        {/* End Color */}
                        <div 
                            className={`relative p-1 rounded border-2 transition-all cursor-pointer ${activeColorTarget === 'endColor' ? 'border-white bg-slate-700' : 'border-transparent hover:bg-slate-800'}`}
                            onClick={() => setActiveColorTarget('endColor')}
                        >
                            <div className="w-8 h-8 rounded" style={{ backgroundColor: settings.endColor }}></div>
                            <input 
                                type="color" 
                                value={settings.endColor}
                                onChange={(e) => updateSetting('endColor', e.target.value)}
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            />
                        </div>
                        </>
                    )}
                    
                    <div className="flex-1 ml-2 flex flex-col justify-center">
                      <label className="text-xs text-slate-500 mb-1">Thickness</label>
                      <input 
                        type="range" 
                        min="1" 
                        max="50" 
                        value={settings.width}
                        onChange={(e) => updateSetting('width', Number(e.target.value))}
                        className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-purple-500'}`}
                      />
                    </div>
                </div>

                <div className="pt-2">
                    <label className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Taper Ends</span>
                      <span>{settings.taper ? settings.taper : 0}%</span>
                    </label>
                    <input 
                      type="range" 
                      min="0" 
                      max="50" 
                      step="5"
                      value={settings.taper || 0}
                      onChange={(e) => updateSetting('taper', Number(e.target.value))}
                      className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-teal-500'}`}
                      title="Tapers the stroke width at start and end"
                    />
                </div>

                {/* Path Smoothing & Simplification */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Smooth</span>
                        <span>{settings.smoothing}</span>
                      </label>
                      <input 
                        type="range" 
                        min="0" 
                        max="5" 
                        step="1"
                        value={settings.smoothing}
                        onChange={(e) => updateSetting('smoothing', Number(e.target.value))}
                        className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-indigo-500'}`}
                        title="Smooths jagged corners"
                      />
                    </div>
                    <div>
                      <label className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Simplify</span>
                        <span>{settings.simplification}</span>
                      </label>
                      <input 
                        type="range" 
                        min="0" 
                        max="20" 
                        step="1"
                        value={settings.simplification}
                        onChange={(e) => updateSetting('simplification', Number(e.target.value))}
                        className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-indigo-500'}`}
                        title="Removes redundant points"
                      />
                    </div>
                </div>

                {/* AI Palette Generator */}
                <div className="bg-slate-800/50 p-2 rounded-lg border border-slate-700 space-y-2 mt-2">
                  <div className="flex gap-1">
                    <input 
                      type="text" 
                      placeholder="Theme (e.g. 'neon rain')" 
                      value={palettePrompt}
                      onChange={(e) => setPalettePrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGeneratePalette()}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                    <button 
                      onClick={handleGeneratePalette}
                      disabled={isGeneratingPalette}
                      className="bg-purple-600 hover:bg-purple-500 text-white rounded p-1.5 transition-colors disabled:opacity-50"
                    >
                      <Sparkles size={14} className={isGeneratingPalette ? "animate-spin" : ""} />
                    </button>
                  </div>
                  
                  {/* Saved Palettes History */}
                  {paletteHistory.length > 0 && (
                    <div className="pt-1 space-y-2">
                        <div className="text-[10px] text-slate-500 flex justify-between items-center">
                            <span>Saved Palettes</span>
                            <button onClick={() => setPaletteHistory([])} className="hover:text-red-400">Clear</button>
                        </div>
                        <div className="space-y-1.5 max-h-[140px] overflow-y-auto custom-scrollbar pr-1">
                        {paletteHistory.map((palette, pIdx) => (
                            <div key={pIdx} className="flex gap-0.5 p-1 bg-slate-900/50 rounded border border-slate-700/50 hover:border-slate-600 transition-colors">
                            {palette.map((color, idx) => (
                                <button 
                                key={idx}
                                onClick={() => updateSetting(activeColorTarget, color)}
                                className="flex-1 h-5 first:rounded-l last:rounded-r hover:opacity-80 transition-opacity ring-1 ring-transparent hover:ring-white/20"
                                style={{ backgroundColor: color }}
                                title={color}
                                />
                            ))}
                            <button 
                                onClick={() => setPaletteHistory(prev => prev.filter((_, i) => i !== pIdx))}
                                className="ml-1 px-1 text-slate-600 hover:text-red-400 flex items-center"
                                title="Delete palette"
                            >
                                <XCircle size={12} />
                            </button>
                            </div>
                        ))}
                        </div>
                    </div>
                  )}
                </div>
             </div>
           )}
        </div>

        {/* Animation Section */}
        <div className="border-b border-slate-800/50">
           <SectionHeader id="motion" label="Loop Dynamics" icon={RefreshCcw} />
           {openSections.motion && (
             <div className="px-3 pb-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Speed</span>
                      <span>{settings.speed.toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="3.0" 
                      step="0.1"
                      value={settings.speed}
                      onChange={(e) => updateSetting('speed', Number(e.target.value))}
                      className="w-full accent-pink-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                </div>
                <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Phase Start</span>
                      <span>{Math.round(settings.phase * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01"
                      value={settings.phase}
                      onChange={(e) => updateSetting('phase', Number(e.target.value))}
                      className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-blue-500'}`}
                    />
                </div>

                <div className="flex gap-1 bg-slate-900 rounded p-1">
                  {[
                    { id: AnimationMode.LOOP, label: 'Loop', icon: <Repeat size={14}/> },
                    { id: AnimationMode.YOYO, label: 'PingPong', icon: <ArrowRightLeft size={14}/> },
                    { id: AnimationMode.FLOW, label: 'Flow', icon: <ChevronsRight size={14}/> },
                  ].map((mode) => (
                    <button 
                        key={mode.id}
                        onClick={() => updateSetting('animationMode', mode.id)}
                        className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded text-[10px] transition-colors ${
                            settings.animationMode === mode.id 
                            ? (isEditing ? 'bg-cyan-600 text-white shadow-lg' : 'bg-blue-600 text-white shadow-lg') 
                            : 'hover:bg-slate-700 text-slate-400'
                        }`}
                        title={mode.label}
                    >
                      {mode.icon}
                      {mode.label}
                    </button>
                  ))}
                </div>
             </div>
           )}
        </div>

        {/* Symmetry Section */}
        <div className="border-b border-slate-800/50">
           <SectionHeader id="symmetry" label="Symmetry & Generative" icon={Copy} />
           {openSections.symmetry && (
             <div className="px-3 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: SymmetryType.NONE, label: 'None' },
                    { id: SymmetryType.MIRROR_X, label: 'X-Mir' },
                    { id: SymmetryType.MIRROR_Y, label: 'Y-Mir' },
                    { id: SymmetryType.MIRROR_XY, label: 'Quad' },
                    { id: SymmetryType.RADIAL, label: 'Radial' },
                    { id: SymmetryType.GRID, label: 'Grid' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => updateSymmetry('type', mode.id)}
                      className={`text-xs p-2 rounded border transition-colors ${
                        settings.symmetry.type === mode.id 
                        ? accentBg 
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {settings.symmetry.type === SymmetryType.RADIAL && (
                  <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Copies: {settings.symmetry.copies}</span>
                      </div>
                      <input 
                        type="range" 
                        min="2" 
                        max="32" 
                        step="1"
                        value={settings.symmetry.copies}
                        onChange={(e) => updateSymmetry('copies', Number(e.target.value))}
                        className={`w-full h-1 bg-slate-700 rounded-lg appearance-none ${isEditing ? 'accent-cyan-500' : 'accent-purple-500'}`}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Phase Shift</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="0.5" 
                        step="0.01"
                        value={settings.symmetry.phaseShift}
                        onChange={(e) => updateSymmetry('phaseShift', Number(e.target.value))}
                        className="w-full accent-green-500 h-1 bg-slate-700 rounded-lg appearance-none"
                      />
                    </div>
                  </div>
                )}

                {settings.symmetry.type === SymmetryType.GRID && (
                  <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>Grid Gap: {settings.symmetry.gridGap}px</span>
                      </div>
                      <input 
                        type="range" 
                        min="50" 
                        max="500" 
                        step="10"
                        value={settings.symmetry.gridGap}
                        onChange={(e) => updateSymmetry('gridGap', Number(e.target.value))}
                        className="w-full accent-yellow-500 h-1 bg-slate-700 rounded-lg appearance-none"
                      />
                    </div>
                  </div>
                )}
                
                {/* AI Stroke Generation Button */}
                <button 
                   onClick={handleGenerateAIStroke}
                   disabled={isGeneratingStroke}
                   className={`w-full flex items-center justify-center gap-2 p-2 rounded text-xs font-semibold transition-all ${
                       isGeneratingStroke 
                       ? 'bg-slate-800 text-slate-500' 
                       : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:opacity-90 shadow-lg shadow-purple-900/20'
                   }`}
                >
                    <Wand2 size={14} className={isGeneratingStroke ? "animate-spin" : ""}/>
                    {isGeneratingStroke ? "Dreaming..." : "Magic Draw"}
                </button>
             </div>
           )}
        </div>

        {/* Project Section */}
        <div className="border-b border-slate-800/50">
           <SectionHeader id="project" label="Project Files" icon={Save} />
           {openSections.project && (
             <div className="px-3 pb-3 animate-in slide-in-from-top-2 duration-200">
                <div className="flex gap-2">
                    <button 
                        onClick={onSnapshot}
                        className="flex-1 flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                        title="Save as Image"
                    >
                        <ImageIcon size={14}/> Snapshot
                    </button>
                    <button 
                        onClick={onExportJSON}
                        className="flex-1 flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                        title="Save Project File"
                    >
                        <Download size={14}/> Export
                    </button>
                    <button 
                        onClick={onImportJSON}
                        className="flex-1 flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                        title="Load Project File"
                    >
                        <Upload size={14}/> Import
                    </button>
                </div>
             </div>
           )}
        </div>

      </div>

      {/* --- Fixed Footer (Actions) --- */}
      <div className="flex-none p-4 border-t border-slate-700 bg-slate-900/50 rounded-b-xl">
        <div className="flex gap-2">
            {!isEditing && (
                <button 
                onClick={onUndo}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 p-2 rounded text-sm text-slate-300 transition-colors"
                >
                <Undo2 size={16}/> Undo
                </button>
            )}
            <button 
            onClick={onClear}
            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded text-sm transition-colors ${
                isEditing 
                    ? 'bg-red-500/20 hover:bg-red-500/40 text-red-200 border border-red-900/50' 
                    : 'bg-red-900/30 hover:bg-red-900/50 text-red-400'
            }`}
            >
            <Trash2 size={16}/> {isEditing ? 'Delete Stroke' : 'Clear All'}
            </button>
        </div>
        {!isEditing && (
            <div className="text-[10px] text-slate-600 text-center mt-2">
                {selectionLocked 
                    ? "Selection Locked: Draw freely."
                    : "Click strokes to edit."
                }
            </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;
