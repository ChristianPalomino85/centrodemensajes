/**
 * QuickActionEditor - Form for creating/editing quick actions
 * Supports: send_files, send_text, and composite actions
 */
import { useState, useEffect } from "react";
import { X, Save, Loader2, FileText, Type, Layers, Plus, Trash2, GripVertical, Clock, Eye, Image, Video, File } from "lucide-react";
import type { QuickAction } from "./QuickActionsButton";

interface AgentFile {
  id: string;
  name: string;
  category: string;
  fileName: string;
  url?: string;
  enabled: boolean;
  metadata?: {
    brand?: string;
    withPrices?: boolean;
    mimeType?: string;
  };
}

interface CompositeStep {
  id: string;
  type: 'text' | 'file' | 'delay';
  content?: string;
  attachmentId?: string;
  fileName?: string;
  displayName?: string;
  delayMs?: number;
}

interface QuickActionEditorProps {
  action: QuickAction | null;
  onSave: (data: Partial<QuickAction>) => Promise<void>;
  onCancel: () => void;
}

const EMOJI_OPTIONS = ['⚡', '📚', '📁', '📄', '🎉', '💰', '🏷️', '📋', '✨', '🚀', '💼', '🎯', '📊', '🔔', '💬', '📝', '🤖', '👋', '🛒', '📦'];

const ACTION_TYPES = [
  { value: 'send_files', label: 'Enviar archivos', icon: FileText, description: 'Envía uno o más archivos/catálogos' },
  { value: 'send_text', label: 'Enviar texto', icon: Type, description: 'Envía un mensaje de texto predefinido' },
  { value: 'composite', label: 'Compuesto', icon: Layers, description: 'Combina texto, archivos y delays' },
];

export default function QuickActionEditor({ action, onSave, onCancel }: QuickActionEditorProps) {
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  // Form state
  const [name, setName] = useState(action?.name || '');
  const [icon, setIcon] = useState(action?.icon || '⚡');
  const [type, setType] = useState<string>(action?.type || 'send_files');
  const [command, setCommand] = useState(action?.command || '');
  const [delayBetweenMs, setDelayBetweenMs] = useState(action?.delayBetweenMs || 500);

  // Config state based on type
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(action?.config?.fileIds || []);
  const [fileDisplayNames, setFileDisplayNames] = useState<Record<string, string>>(action?.config?.fileDisplayNames || {});
  const [text, setText] = useState(action?.config?.text || '');
  const [filterBrand, setFilterBrand] = useState(action?.config?.fileFilters?.brand || '');
  const [filterWithPrices, setFilterWithPrices] = useState<boolean | undefined>(action?.config?.fileFilters?.withPrices);

  // Composite steps state
  const [steps, setSteps] = useState<CompositeStep[]>(() => {
    if (action?.config?.steps) {
      return action.config.steps.map((s: any, idx: number) => ({
        id: `step-${idx}`,
        type: s.type,
        content: s.content,
        attachmentId: s.attachmentId || s.fileId,
        displayName: s.displayName || s.caption,
        delayMs: s.delayMs,
      }));
    }
    return [];
  });

  // Load available files
  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    setLoadingFiles(true);
    try {
      const response = await fetch("/api/ia-agent-files", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files?.filter((f: AgentFile) => f.enabled) || []);
      }
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setLoadingFiles(false);
    }
  };

  // Auto-generate command from name
  useEffect(() => {
    if (!action && name && !command) {
      const generated = '/' + name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .substring(0, 45);
      setCommand(generated);
    }
  }, [name, action, command]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('El nombre es requerido');
      return;
    }

    setSaving(true);
    try {
      const config: any = {};

      if (type === 'send_files') {
        if (selectedFileIds.length > 0) {
          config.fileIds = selectedFileIds;
          // Only include display names that differ from original
          const customNames: Record<string, string> = {};
          selectedFileIds.forEach(id => {
            if (fileDisplayNames[id]) {
              customNames[id] = fileDisplayNames[id];
            }
          });
          if (Object.keys(customNames).length > 0) {
            config.fileDisplayNames = customNames;
          }
        } else if (filterBrand || filterWithPrices !== undefined) {
          config.fileFilters = {};
          if (filterBrand) config.fileFilters.brand = filterBrand;
          if (filterWithPrices !== undefined) config.fileFilters.withPrices = filterWithPrices;
        }
      } else if (type === 'send_text') {
        config.text = text;
      } else if (type === 'composite') {
        config.steps = steps.map(step => ({
          type: step.type,
          content: step.content,
          attachmentId: step.attachmentId,
          displayName: step.displayName,
          delayMs: step.delayMs,
        }));
      }

      await onSave({
        name: name.trim(),
        icon,
        type: type as any,
        command: command || undefined,
        config,
        delayBetweenMs,
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleFile = (fileId: string) => {
    setSelectedFileIds(prev =>
      prev.includes(fileId)
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const updateFileDisplayName = (fileId: string, displayName: string) => {
    setFileDisplayNames(prev => ({
      ...prev,
      [fileId]: displayName,
    }));
  };

  // Composite steps management
  const addStep = (stepType: 'text' | 'file' | 'delay') => {
    const newStep: CompositeStep = {
      id: `step-${Date.now()}`,
      type: stepType,
      content: stepType === 'text' ? '' : undefined,
      delayMs: stepType === 'delay' ? 1000 : undefined,
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (stepId: string, updates: Partial<CompositeStep>) => {
    setSteps(steps.map(s => s.id === stepId ? { ...s, ...updates } : s));
  };

  const removeStep = (stepId: string) => {
    setSteps(steps.filter(s => s.id !== stepId));
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return;
    if (direction === 'up' && idx > 0) {
      const newSteps = [...steps];
      [newSteps[idx - 1], newSteps[idx]] = [newSteps[idx], newSteps[idx - 1]];
      setSteps(newSteps);
    } else if (direction === 'down' && idx < steps.length - 1) {
      const newSteps = [...steps];
      [newSteps[idx], newSteps[idx + 1]] = [newSteps[idx + 1], newSteps[idx]];
      setSteps(newSteps);
    }
  };

  // Get file icon based on mime type
  const getFileIcon = (file: AgentFile) => {
    const mime = file.metadata?.mimeType || '';
    if (mime.startsWith('image/')) return <Image className="w-4 h-4 text-blue-500" />;
    if (mime.startsWith('video/')) return <Video className="w-4 h-4 text-purple-500" />;
    return <File className="w-4 h-4 text-slate-500" />;
  };

  // Get unique brands from files
  const brands = [...new Set(files.map(f => f.metadata?.brand).filter(Boolean))] as string[];

  // Get selected files with their details
  const selectedFiles = files.filter(f => selectedFileIds.includes(f.id));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            {action ? 'Editar Acción' : 'Nueva Acción Rápida'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${
                showPreview ? 'bg-amber-100 text-amber-700' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Eye className="w-4 h-4" />
              Vista previa
            </button>
            <button
              onClick={onCancel}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Form */}
          <form onSubmit={handleSubmit} className={`flex-1 overflow-y-auto p-6 space-y-6 ${showPreview ? 'w-1/2' : 'w-full'}`}>
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nombre *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Enviar catálogos Azaleia"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                  required
                />
              </div>

              {/* Icon */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Icono
                </label>
                <div className="flex flex-wrap gap-1 p-2 border border-slate-300 rounded-lg max-h-20 overflow-y-auto">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      className={`w-7 h-7 rounded flex items-center justify-center text-base transition ${
                        icon === emoji
                          ? 'bg-amber-100 ring-2 ring-amber-400'
                          : 'hover:bg-slate-100'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Command */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Comando (auto-generado)
              </label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="/nombre-de-comando"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>

            {/* Type selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Tipo de Acción
              </label>
              <div className="grid grid-cols-3 gap-3">
                {ACTION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={`p-3 rounded-xl border-2 text-left transition ${
                      type === t.value
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <t.icon className={`w-5 h-5 mb-1 ${type === t.value ? 'text-amber-600' : 'text-slate-400'}`} />
                    <div className="font-medium text-sm text-slate-800">{t.label}</div>
                    <div className="text-xs text-slate-500">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Type-specific config */}
            {type === 'send_files' && (
              <div className="space-y-4">
                {/* Mode selector */}
                <div className="flex gap-4 p-3 bg-slate-50 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fileMode"
                      checked={selectedFileIds.length > 0 || (!filterBrand && filterWithPrices === undefined)}
                      onChange={() => { setFilterBrand(''); setFilterWithPrices(undefined); }}
                      className="text-amber-500"
                    />
                    <span className="text-sm">Seleccionar archivos específicos</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="fileMode"
                      checked={selectedFileIds.length === 0 && (!!filterBrand || filterWithPrices !== undefined)}
                      onChange={() => setSelectedFileIds([])}
                      className="text-amber-500"
                    />
                    <span className="text-sm">Usar filtros dinámicos</span>
                  </label>
                </div>

                {/* File selector */}
                {(selectedFileIds.length > 0 || (!filterBrand && filterWithPrices === undefined)) && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Archivos a enviar
                    </label>
                    {loadingFiles ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                      </div>
                    ) : (
                      <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                        {files.map((file) => (
                          <label
                            key={file.id}
                            className={`flex items-center gap-3 p-2.5 cursor-pointer hover:bg-slate-50 ${
                              selectedFileIds.includes(file.id) ? 'bg-amber-50' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedFileIds.includes(file.id)}
                              onChange={() => toggleFile(file.id)}
                              className="w-4 h-4 text-amber-500 rounded"
                            />
                            {getFileIcon(file)}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-slate-800 text-sm truncate">{file.name}</div>
                              <div className="text-xs text-slate-400">
                                {file.category} • {file.metadata?.brand || 'Sin marca'}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Custom display names for selected files */}
                    {selectedFiles.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <label className="block text-sm font-medium text-slate-700">
                          Nombres personalizados (opcional)
                        </label>
                        {selectedFiles.map((file) => (
                          <div key={file.id} className="flex items-center gap-2">
                            {getFileIcon(file)}
                            <input
                              type="text"
                              value={fileDisplayNames[file.id] || ''}
                              onChange={(e) => updateFileDisplayName(file.id, e.target.value)}
                              placeholder={file.name}
                              className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-300"
                            />
                          </div>
                        ))}
                        <p className="text-xs text-slate-400">
                          Deja vacío para usar el nombre original
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Dynamic filters */}
                {selectedFileIds.length === 0 && (!!filterBrand || filterWithPrices !== undefined) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Filtrar por marca
                      </label>
                      <select
                        value={filterBrand}
                        onChange={(e) => setFilterBrand(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      >
                        <option value="">Todas las marcas</option>
                        {brands.map((brand) => (
                          <option key={brand} value={brand}>{brand}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Incluye precios
                      </label>
                      <select
                        value={filterWithPrices === undefined ? '' : filterWithPrices ? 'true' : 'false'}
                        onChange={(e) => setFilterWithPrices(e.target.value === '' ? undefined : e.target.value === 'true')}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      >
                        <option value="">Cualquiera</option>
                        <option value="true">Con precios</option>
                        <option value="false">Sin precios</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {type === 'send_text' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Mensaje a enviar
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Escribe el mensaje que se enviará automáticamente..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            )}

            {type === 'composite' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-700">
                    Pasos de la acción
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => addStep('text')}
                      className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1"
                    >
                      <Type className="w-3 h-3" /> Texto
                    </button>
                    <button
                      type="button"
                      onClick={() => addStep('file')}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex items-center gap-1"
                    >
                      <FileText className="w-3 h-3" /> Archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => addStep('delay')}
                      className="px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded hover:bg-slate-200 flex items-center gap-1"
                    >
                      <Clock className="w-3 h-3" /> Delay
                    </button>
                  </div>
                </div>

                {steps.length === 0 ? (
                  <div className="p-6 bg-slate-50 rounded-lg text-center text-slate-500">
                    <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p>No hay pasos configurados</p>
                    <p className="text-xs mt-1">Agrega texto, archivos o delays usando los botones de arriba</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {steps.map((step, idx) => (
                      <div
                        key={step.id}
                        className={`flex items-start gap-2 p-3 rounded-lg border ${
                          step.type === 'text' ? 'bg-green-50 border-green-200' :
                          step.type === 'file' ? 'bg-blue-50 border-blue-200' :
                          'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveStep(step.id, 'up')}
                            disabled={idx === 0}
                            className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStep(step.id, 'down')}
                            disabled={idx === steps.length - 1}
                            className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>

                        <div className="flex-1">
                          <div className="text-xs font-medium text-slate-500 mb-1">
                            Paso {idx + 1}: {step.type === 'text' ? 'Texto' : step.type === 'file' ? 'Archivo' : 'Delay'}
                          </div>

                          {step.type === 'text' && (
                            <textarea
                              value={step.content || ''}
                              onChange={(e) => updateStep(step.id, { content: e.target.value })}
                              placeholder="Escribe el mensaje..."
                              rows={2}
                              className="w-full px-2 py-1.5 text-sm border border-green-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                            />
                          )}

                          {step.type === 'file' && (
                            <div className="space-y-2">
                              <select
                                value={step.attachmentId || ''}
                                onChange={(e) => {
                                  const file = files.find(f => f.url?.includes(e.target.value));
                                  updateStep(step.id, {
                                    attachmentId: e.target.value,
                                    fileName: file?.name,
                                  });
                                }}
                                className="w-full px-2 py-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                <option value="">Seleccionar archivo...</option>
                                {files.map((file) => {
                                  const attachmentId = file.url?.split('/').pop()?.split('?')[0];
                                  return (
                                    <option key={file.id} value={attachmentId}>{file.name}</option>
                                  );
                                })}
                              </select>
                              <input
                                type="text"
                                value={step.displayName || ''}
                                onChange={(e) => updateStep(step.id, { displayName: e.target.value })}
                                placeholder="Nombre a mostrar (opcional)"
                                className="w-full px-2 py-1.5 text-sm border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          )}

                          {step.type === 'delay' && (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={step.delayMs || 1000}
                                onChange={(e) => updateStep(step.id, { delayMs: Number(e.target.value) })}
                                min={100}
                                max={10000}
                                step={100}
                                className="w-24 px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                              />
                              <span className="text-xs text-slate-500">ms</span>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => removeStep(step.id)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Delay setting */}
            {(type === 'send_files' || type === 'composite') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Delay entre envíos (ms)
                </label>
                <input
                  type="number"
                  value={delayBetweenMs}
                  onChange={(e) => setDelayBetweenMs(Number(e.target.value))}
                  min={100}
                  max={5000}
                  step={100}
                  className="w-32 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Tiempo de espera entre cada mensaje (recomendado: 500ms)
                </p>
              </div>
            )}
          </form>

          {/* Preview Panel */}
          {showPreview && (
            <div className="w-1/2 border-l border-slate-200 bg-slate-50 p-4 overflow-y-auto">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Vista previa</h3>
              <div className="space-y-2">
                {/* Sender badge */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">{icon}</span>
                  <span className="font-medium text-slate-800">{name || 'Sin nombre'}</span>
                </div>

                {/* Messages preview */}
                {type === 'send_text' && text && (
                  <div className="bg-emerald-100 p-3 rounded-lg rounded-tr-none max-w-[85%] ml-auto">
                    <p className="text-sm whitespace-pre-wrap">{text}</p>
                    <div className="text-xs text-emerald-600 mt-1 text-right">
                      {icon} {name || 'Acción'}
                    </div>
                  </div>
                )}

                {type === 'send_files' && selectedFiles.map((file, idx) => (
                  <div key={file.id} className="bg-emerald-100 p-3 rounded-lg rounded-tr-none max-w-[85%] ml-auto">
                    <div className="flex items-center gap-2">
                      {getFileIcon(file)}
                      <span className="text-sm font-medium">
                        {fileDisplayNames[file.id] || file.name}
                      </span>
                    </div>
                    <div className="text-xs text-emerald-600 mt-1 text-right">
                      {icon} {name || 'Acción'}
                    </div>
                  </div>
                ))}

                {type === 'composite' && steps.map((step, idx) => (
                  <div key={step.id}>
                    {step.type === 'text' && step.content && (
                      <div className="bg-emerald-100 p-3 rounded-lg rounded-tr-none max-w-[85%] ml-auto">
                        <p className="text-sm whitespace-pre-wrap">{step.content}</p>
                        <div className="text-xs text-emerald-600 mt-1 text-right">
                          {icon} {name || 'Acción'}
                        </div>
                      </div>
                    )}
                    {step.type === 'file' && step.attachmentId && (
                      <div className="bg-emerald-100 p-3 rounded-lg rounded-tr-none max-w-[85%] ml-auto">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-500" />
                          <span className="text-sm font-medium">
                            {step.displayName || step.fileName || 'Archivo'}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-600 mt-1 text-right">
                          {icon} {name || 'Acción'}
                        </div>
                      </div>
                    )}
                    {step.type === 'delay' && (
                      <div className="text-center text-xs text-slate-400 py-2">
                        <Clock className="w-3 h-3 inline mr-1" />
                        Espera {step.delayMs}ms
                      </div>
                    )}
                  </div>
                ))}

                {((type === 'send_text' && !text) ||
                  (type === 'send_files' && selectedFiles.length === 0) ||
                  (type === 'composite' && steps.length === 0)) && (
                  <div className="text-center text-slate-400 py-8">
                    <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Configura la acción para ver la vista previa</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
