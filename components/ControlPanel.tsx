
import React, { useState, useEffect } from 'react';
import { Stroke, SymmetryType, AnimationMode, Point, EasingType } from '../types';
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
  Wand2,
  Orbit,
  AlignJustify,
  EyeOff,
  Minimize2,
  Menu,
  MousePointer2,
  Bug,
  FileCode
} from 'lucide-react';

interface ControlPanelProps {
  settings: Omit<Stroke, 'id' | 'points' | 'rawPoints' | 'totalLength' | 'timestamp' | 'precomputed'>;
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
  onExportSVG: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onAIGenerateStroke: (normalizedPoints: Point[]) => void;
  onRedistributePhases: () => void;
  globalSpeed: number;
  setGlobalSpeed: (speed: number) => void;
  showDebug: boolean;
  onToggleDebug: () => void;
}

const DEFAULT_PALETTES = [
  ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff'], // Sunset
  ['#f72585', '#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0'], // Neon
  ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c'], // Tropical
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], // Earth
  ['#003049', '#d62828', '#f77f00', '#fcbf49', '#eae2b7'], // Retro
  ['#cdb4db', '#ffc8dd', '#ffafcc', '#bde0fe', '#a2d2ff'], // Pastel
  ['#22223b', '#4a4e69', '#9a8c98', '#c9ada7', '#f2e9e4'], // Muted
];

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
  onExportSVG,
  onExportJSON,
  onImportJSON,
  onAIGenerateStroke,
  onRedistributePhases,
  globalSpeed,
  setGlobalSpeed,
  showDebug,
  onToggleDebug
}) => {
  const [activeColorTarget, setActiveColorTarget] = useState<'color' | 'endColor'>('color');
  const [palettePrompt, setPalettePrompt] = useState('');
  const [isGeneratingPalette, setIsGeneratingPalette] = useState(false);
  const [isGeneratingStroke, setIsGeneratingStroke] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; color: string } | null>(null);

  // Persistent Palette History
  const [paletteHistory, setPaletteHistory] = useState<string[][]>(() => {
    try {
      const saved = localStorage.getItem('chronosketch_palettes');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return DEFAULT_PALETTES;
    } catch (e) {
      return DEFAULT_PALETTES;
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
    orbit: false,
    project: false
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const collapseAllSections = () => {
    setOpenSections({
        style: false,
        motion: false,
        symmetry: false,
        orbit: false,
        project: false
    });
  };

  const updateSetting = <K extends keyof typeof settings>(key: K, value: typeof settings[K]) => {
    setSettings({ [key]: value });
  };

  const updateSymmetry = <K extends keyof typeof settings.symmetry>(key: K, value: typeof settings.symmetry[K]) => {
    setSettings({
      symmetry: { ...settings.symmetry, [key]: value }
    });
  };

  const updateOrbit = <K extends keyof typeof settings.orbit>(key: K, value: typeof settings.orbit[K]) => {
    setSettings({
        orbit: { ...settings.orbit, [key]: value }
    });
  };

  // Context Menu Handlers
  const handleContextMenu = (e: React.MouseEvent, color: string) => {
      e.preventDefault();
      // Clamp X position so menu doesn't overflow screen right
      const menuWidth = 150;
      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
      const y = Math.min(e.clientY, window.innerHeight - 100);
      setContextMenu({ x, y, color });
  };

  const closeContextMenu = () => setContextMenu(null);

  const applyColorFromContext = (target: 'color' | 'endColor') => {
      if (!contextMenu) return;
      updateSetting(target, contextMenu.color);
      setActiveColorTarget(target);
      closeContextMenu();
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
      setPalettePrompt('');
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

  if (!isPanelVisible) {
    return (
        <button
            onClick={() => setIsPanelVisible(true)}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="fixed z-50 top-4 right-4 bg-slate-900/80 hover:bg-slate-800 backdrop-blur-md text-white p-3 rounded-xl shadow-lg border border-slate-700 transition-all hover:scale-110 hover:shadow-cyan-900/20 group"
            title="Show Controls"
        >
            <Menu size={24} className="text-slate-300 group-hover:text-white" />
        </button>
    );
  }

  return (
    <>
      <div 
        className={`fixed z-50 top-4 right-4 w-80 bg-slate-900/95 backdrop-blur-md border rounded-xl shadow-2xl flex flex-col max-h-[90vh] select-none transition-all duration-300 ${containerBorder}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* --- Fixed Header --- */}
        <div className="flex-none flex flex-col gap-3 border-b border-slate-700 p-4">
          {/* Row 1: Title */}
          <h1 className={`font-bold text-lg flex items-center gap-2 transition-colors ${accentColor}`}>
            {isEditing ? <Edit2 size={20}/> : <Activity size={20}/>}
            {isEditing ? 'Edit Stroke' : 'ChronoSketch'}
          </h1>
          
          {/* Row 2: Header Controls */}
          <div className="flex items-center justify-between">
              {/* Context Label */}
              <div className="text-[10px] text-slate-500 font-mono uppercase tracking-widest font-semibold">
                  {isEditing ? 'Properties' : 'Settings'}
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-1">
                  <button
                      onClick={collapseAllSections}
                      className="text-slate-500 hover:text-white p-1.5 rounded hover:bg-slate-800 transition-colors"
                      title="Collapse All Sections"
                  >
                      <Minimize2 size={16} />
                  </button>

                  <div className="w-px h-4 bg-slate-800 mx-0.5"></div>

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

                  {isEditing ? (
                      <button 
                      onClick={onDeselect}
                      className="ml-1 text-xs text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-1 rounded transition-colors"
                      >
                      <XCircle size={12}/> Done
                      </button>
                  ) : (
                      <div className="text-[10px] text-slate-500 font-mono min-w-[32px] text-center px-1">
                          {strokeCount}L
                      </div>
                  )}

                  <div className="w-px h-4 bg-slate-800 mx-0.5"></div>

                  <button 
                      onClick={onToggleDebug}
                      className={`p-1.5 rounded transition-all ${
                          showDebug ? "text-cyan-400 bg-cyan-900/20" : "text-slate-500 hover:text-white hover:bg-slate-800"
                      }`}
                      title="Toggle Performance Stats (`)"
                  >
                      <Bug size={16} />
                  </button>

                  <div className="w-px h-4 bg-slate-800 mx-0.5"></div>

                  <button
                      onClick={() => {
                        setIsPanelVisible(false);
                        onMouseLeave();
                      }}
                      className="text-slate-500 hover:text-white p-1.5 rounded hover:bg-slate-800 transition-colors"
                      title="Hide Controls"
                  >
                      <EyeOff size={16} />
                  </button>
              </div>
          </div>
        </div>

        {/* --- Scrollable Content (Accordion) --- */}
        <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1 custom-scrollbar">
          
          {/* Style Section */}
          <div className="border-b border-slate-800/50">
            <SectionHeader id="style" label="Colors & Style" icon={Palette} />
            {openSections.style && (
              <div className="px-3 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  
                  {/* Palettes (Moved to Top) */}
                  <div className="space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          <span>Select Palette Color</span>
                          <button onClick={() => setPaletteHistory(DEFAULT_PALETTES)} className="hover:text-purple-400 transition-colors" title="Reset to defaults">Reset</button>
                      </div>
                      
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1 bg-slate-800/30 rounded-lg p-1 border border-slate-800">
                          {paletteHistory.map((palette, pIdx) => (
                              <div key={pIdx} className="flex gap-0.5 group">
                                  <div className="flex-1 flex rounded overflow-hidden border border-slate-700/50 group-hover:border-slate-500 transition-colors">
                                      {palette.map((color, idx) => (
                                          <button 
                                              key={idx}
                                              onClick={() => updateSetting(activeColorTarget, color)}
                                              onContextMenu={(e) => handleContextMenu(e, color)}
                                              className="flex-1 h-6 hover:opacity-80 transition-opacity relative group/color"
                                              style={{ backgroundColor: color }}
                                              title={`${color}\nRight-click for options`}
                                          />
                                      ))}
                                  </div>
                                  <button 
                                      onClick={() => setPaletteHistory(prev => prev.filter((_, i) => i !== pIdx))}
                                      className="w-5 flex items-center justify-center text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="Remove palette"
                                  >
                                      <XCircle size={12} />
                                  </button>
                              </div>
                          ))}
                      </div>

                      {/* AI Generator Compact */}
                      <div className="flex gap-1">
                          <input 
                            type="text" 
                            placeholder="New theme (e.g. 'vaporwave')" 
                            value={palettePrompt}
                            onChange={(e) => setPalettePrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleGeneratePalette()}
                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-500 placeholder:text-slate-600"
                          />
                          <button 
                            onClick={handleGeneratePalette}
                            disabled={isGeneratingPalette}
                            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-purple-400 hover:text-purple-300 rounded p-1.5 transition-colors disabled:opacity-50"
                            title="Generate AI Palette"
                          >
                            <Sparkles size={14} className={isGeneratingPalette ? "animate-spin" : ""} />
                          </button>
                      </div>
                  </div>

                  <div className="h-px bg-slate-800/50 my-1" />

                  {/* Active Color Controls */}
                  <div className="space-y-2">
                      <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">Stroke Settings</span>
                          <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-600">Gradient</span>
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
                                    className={`w-3 h-3 rounded cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-purple-500'}`}
                                />
                          </div>
                      </div>

                      <div className="flex gap-3 items-center">
                          {/* Start Color Box */}
                          <div className="flex flex-col items-center gap-1">
                              <div 
                                  className={`relative w-10 h-10 rounded-lg shadow-sm border-2 transition-all cursor-pointer group ${activeColorTarget === 'color' ? 'border-white ring-2 ring-purple-500/30' : 'border-slate-600 hover:border-slate-500'}`}
                                  onClick={() => setActiveColorTarget('color')}
                              >
                                  <div className="absolute inset-0.5 rounded-md" style={{ backgroundColor: settings.color }}></div>
                                  {/* Native Picker Hidden but accessible */}
                                  <input 
                                      type="color" 
                                      value={settings.color}
                                      onChange={(e) => updateSetting('color', e.target.value)}
                                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                      title="Fine tune color"
                                  />
                                  {activeColorTarget === 'color' && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full shadow border border-slate-200"></div>}
                              </div>
                              <span className={`text-[9px] font-bold ${activeColorTarget === 'color' ? 'text-white' : 'text-slate-500'}`}>START</span>
                          </div>

                          {settings.endColor ? (
                              <>
                                  <ArrowRight size={14} className="text-slate-600"/>
                                  {/* End Color Box */}
                                  <div className="flex flex-col items-center gap-1">
                                      <div 
                                          className={`relative w-10 h-10 rounded-lg shadow-sm border-2 transition-all cursor-pointer group ${activeColorTarget === 'endColor' ? 'border-white ring-2 ring-purple-500/30' : 'border-slate-600 hover:border-slate-500'}`}
                                          onClick={() => setActiveColorTarget('endColor')}
                                      >
                                          <div className="absolute inset-0.5 rounded-md" style={{ backgroundColor: settings.endColor }}></div>
                                          <input 
                                              type="color" 
                                              value={settings.endColor}
                                              onChange={(e) => updateSetting('endColor', e.target.value)}
                                              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                              title="Fine tune color"
                                          />
                                          {activeColorTarget === 'endColor' && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full shadow border border-slate-200"></div>}
                                      </div>
                                      <span className={`text-[9px] font-bold ${activeColorTarget === 'endColor' ? 'text-white' : 'text-slate-500'}`}>END</span>
                                  </div>
                              </>
                          ) : (
                              <div className="flex-1 h-px bg-slate-800 mx-2"></div>
                          )}
                          
                          {/* Thickness Slider - Compact */}
                          <div className="flex-1 ml-2">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                              <span>Width</span>
                              <span>{settings.width}px</span>
                            </div>
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
                  </div>

                  {/* Geometry Controls */}
                  <div className="bg-slate-800/30 rounded-lg p-2 space-y-2 border border-slate-800/50">
                      <div>
                          <label className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>Taper</span>
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
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="flex justify-between text-[10px] text-slate-500 mb-1">
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
                            />
                          </div>
                          <div>
                            <label className="flex justify-between text-[10px] text-slate-500 mb-1">
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
                            />
                          </div>
                      </div>
                  </div>
              </div>
            )}
          </div>

          {/* Animation Section */}
          <div className="border-b border-slate-800/50">
            <SectionHeader id="motion" label="Loop Dynamics" icon={RefreshCcw} />
            {openSections.motion && (
              <div className="px-3 pb-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  
                  {/* Global Speed Control */}
                  <div className="bg-slate-800/40 border border-slate-700/50 p-2 rounded-lg">
                      <div className="flex justify-between text-xs text-cyan-400 mb-1 font-semibold">
                        <span>Global Time Scale</span>
                        <span>{globalSpeed.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="5.0" 
                        step="0.1"
                        value={globalSpeed}
                        onChange={(e) => setGlobalSpeed(Number(e.target.value))}
                        className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                  </div>
                  
                  {/* Per Stroke Speed */}
                  <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Stroke Speed</span>
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
                  
                  {/* Easing Selector */}
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Easing</div>
                    <select
                        value={settings.easing || EasingType.LINEAR}
                        onChange={(e) => updateSetting('easing', e.target.value as EasingType)}
                        className="w-full bg-slate-800 text-xs text-slate-300 border border-slate-700 rounded p-2 focus:outline-none focus:border-cyan-500"
                    >
                        <option value={EasingType.LINEAR}>Linear</option>
                        <option value={EasingType.EASE_IN}>Ease In</option>
                        <option value={EasingType.EASE_OUT}>Ease Out</option>
                        <option value={EasingType.EASE_IN_OUT}>Ease In-Out</option>
                        <option value={EasingType.SINE}>Smooth Sine</option>
                        <option value={EasingType.ELASTIC}>Elastic</option>
                    </select>
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
                  
                  {/* Redistribute Phase Button */}
                  {!isEditing && (
                      <button
                          onClick={onRedistributePhases}
                          className="w-full flex items-center justify-center gap-2 mt-3 bg-slate-800 hover:bg-slate-700 p-2 rounded text-xs text-slate-300 transition-colors"
                          title="Evenly distribute animation start times across all strokes"
                      >
                          <AlignJustify size={14}/> Redistribute Phases
                      </button>
                  )}
              </div>
            )}
          </div>

          {/* Orbit Physics Section */}
          <div className="border-b border-slate-800/50">
            <SectionHeader id="orbit" label="Orbit Dynamics" icon={Orbit} />
            {openSections.orbit && (
              <div className="px-3 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Enable Orbit Physics</span>
                    <input 
                        type="checkbox" 
                        checked={settings.orbit?.enabled || false} 
                        onChange={(e) => updateOrbit('enabled', e.target.checked)}
                        className={`w-4 h-4 rounded cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-orange-500'}`}
                    />
                  </div>
                  
                  <div className={settings.orbit?.enabled ? "opacity-100 transition-opacity" : "opacity-40 pointer-events-none transition-opacity"}>
                      <div>
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Mass (Inertia)</span>
                          <span>{settings.orbit?.mass.toFixed(1)}</span>
                        </div>
                        <input 
                          type="range" 
                          min="0.1" 
                          max="10.0" 
                          step="0.1"
                          value={settings.orbit?.mass || 2.0}
                          onChange={(e) => updateOrbit('mass', Number(e.target.value))}
                          className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-orange-500'}`}
                        />
                      </div>
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Friction (Damping)</span>
                          {/* Display inverted friction: 1.0 (100% friction) means full stop */}
                          <span>{((1 - (settings.orbit?.friction || 0.95)) * 100).toFixed(1)}%</span>
                        </div>
                        <input 
                          type="range" 
                          // Slider goes from Low Damping (0.001) to High Damping (0.9)
                          // Corresponds to Friction 0.999 (slow stop) to 0.1 (fast stop)
                          min="0.001" 
                          max="0.900" 
                          step="0.001"
                          value={1 - (settings.orbit?.friction || 0.95)}
                          onChange={(e) => updateOrbit('friction', 1 - Number(e.target.value))}
                          className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${isEditing ? 'accent-cyan-500' : 'accent-orange-500'}`}
                        />
                      </div>
                  </div>
                  <div className="text-[10px] text-slate-600 bg-slate-900/50 p-2 rounded">
                      Tip: When enabled, the brush orbits your mouse based on speed and mass. Create loops by swinging your cursor!
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
                  <div className="grid grid-cols-4 gap-2">
                      <button 
                          onClick={onSnapshot}
                          className="flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                          title="Save as Image (PNG)"
                      >
                          <ImageIcon size={14}/> Image
                      </button>
                      <button 
                          onClick={onExportSVG}
                          className="flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                          title="Save as SVG"
                      >
                          <FileCode size={14}/> SVG
                      </button>
                      <button 
                          onClick={onExportJSON}
                          className="flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
                          title="Save Project File"
                      >
                          <Download size={14}/> Export
                      </button>
                      <button 
                          onClick={onImportJSON}
                          className="flex flex-col items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 p-2 rounded text-[10px] text-slate-300 transition-colors"
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

      {/* --- Context Menu Portal/Overlay --- */}
      {contextMenu && (
        <>
            <div 
                className="fixed inset-0 z-[60]" 
                onClick={closeContextMenu} 
                onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
            />
            <div 
                className="fixed z-[70] bg-slate-800 border border-slate-600 shadow-2xl rounded-lg py-1 min-w-[140px] flex flex-col animate-in fade-in zoom-in-95 duration-100 origin-top-left"
                style={{ top: contextMenu.y, left: contextMenu.x }}
            >
                {/* Header */}
                <div className="px-3 py-2 border-b border-slate-700/50 flex items-center gap-2 mb-1 bg-slate-900/30">
                    <div className="w-3 h-3 rounded-full border border-slate-500 shadow-sm" style={{ backgroundColor: contextMenu.color }} />
                    <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">{contextMenu.color}</span>
                </div>
                
                <button 
                    onClick={() => applyColorFromContext('color')}
                    className="text-left px-3 py-2 text-xs text-slate-300 hover:bg-cyan-600/20 hover:text-white flex items-center gap-2 transition-colors"
                >
                    <div className="w-2 h-2 rounded-full bg-slate-400" /> Set Start Color
                </button>
                <button 
                    onClick={() => applyColorFromContext('endColor')}
                    className="text-left px-3 py-2 text-xs text-slate-300 hover:bg-cyan-600/20 hover:text-white flex items-center gap-2 transition-colors"
                >
                    <div className="w-2 h-2 rounded-full border border-slate-500" /> Set End Color
                </button>
            </div>
        </>
      )}
    </>
  );
};

export default ControlPanel;
