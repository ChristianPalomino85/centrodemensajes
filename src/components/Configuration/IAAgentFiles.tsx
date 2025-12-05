import { useState, useEffect, useRef } from "react";
import { apiUrl } from "../../lib/apiBase";
import { Upload, FileText, Trash2, Edit, Eye, EyeOff, Plus, Download, CheckSquare, Square, X } from "lucide-react";

type FileCategory = 'catalog' | 'flyer' | 'info' | 'other';

interface AgentFile {
  id: string;
  name: string;
  description: string;
  category: FileCategory;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  tags: string[];
  metadata: {
    brand?: string;
    withPrices?: boolean;
    season?: string;
    year?: string;
    [key: string]: any;
  };
  enabled: boolean;
  priority: number; // 1 = highest, 2 = normal, 3 = low
  isCurrentCatalog: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PendingFile {
  file: File;
  name: string;
  description: string;
  category: FileCategory;
  tags: string;
  brand: string;
  withPrices: boolean;
  season: string;
  year: string;
  priority: number;
  isCurrentCatalog: boolean;
}

const CATEGORY_LABELS: Record<FileCategory, string> = {
  catalog: 'Catálogo',
  flyer: 'Flyer',
  info: 'Información',
  other: 'Otro'
};

const CATEGORY_COLORS: Record<FileCategory, string> = {
  catalog: 'bg-blue-100 text-blue-700',
  flyer: 'bg-green-100 text-green-700',
  info: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-700'
};

const PRIORITY_LABELS: Record<number, string> = {
  1: '⭐ Alta (Catálogo Actual)',
  2: '📄 Normal',
  3: '📁 Baja (Archivo)'
};

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-yellow-100 text-yellow-700',
  2: 'bg-gray-100 text-gray-600',
  3: 'bg-gray-50 text-gray-500'
};

// Auto-detect metadata from filename
function extractMetadataFromFilename(filename: string): Partial<PendingFile> {
  const lowerName = filename.toLowerCase();
  const result: Partial<PendingFile> = {};

  // Detect brand
  const brands = ['azaleia', 'olympikus', 'dijean', 'comfortflex', 'bebece', 'beira rio', 'vizzano', 'moleca', 'dakota', 'ramarim'];
  for (const brand of brands) {
    if (lowerName.includes(brand.replace(' ', ''))) {
      result.brand = brand.charAt(0).toUpperCase() + brand.slice(1);
      break;
    }
  }

  // Detect category
  if (lowerName.includes('catalogo') || lowerName.includes('catalog')) {
    result.category = 'catalog';
  } else if (lowerName.includes('flyer') || lowerName.includes('volante') || lowerName.includes('promo')) {
    result.category = 'flyer';
  } else if (lowerName.includes('info') || lowerName.includes('guia') || lowerName.includes('manual')) {
    result.category = 'info';
  } else {
    result.category = 'catalog'; // Default
  }

  // Detect season
  if (lowerName.includes('pv') || lowerName.includes('primavera') || lowerName.includes('verano') || lowerName.includes('spring') || lowerName.includes('summer')) {
    result.season = 'Primavera/Verano';
  } else if (lowerName.includes('oi') || lowerName.includes('otoño') || lowerName.includes('invierno') || lowerName.includes('fall') || lowerName.includes('winter')) {
    result.season = 'Otoño/Invierno';
  }

  // Detect year
  const yearPatterns = [
    /20(\d{2})/,
    /[_\-\s](\d{2})(?:[_\-\s\.]|$)/,
    /pv(\d{2})/i,
    /oi(\d{2})/i
  ];
  for (const pattern of yearPatterns) {
    const match = filename.match(pattern);
    if (match) {
      const year = match[1].length === 2 ? '20' + match[1] : match[1];
      result.year = year;
      break;
    }
  }

  // Detect prices
  if (lowerName.includes('precio') || lowerName.includes('promotor') || lowerName.includes('mayorista') || lowerName.includes('con_precio')) {
    result.withPrices = true;
  }

  // Generate display name
  const baseName = filename.replace(/\.[^/.]+$/, ''); // Remove extension
  const formattedName = baseName
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  result.name = formattedName;

  // Auto-generate tags
  const tags: string[] = [];
  if (result.brand) tags.push(result.brand.toLowerCase());
  if (result.season) tags.push(result.season.toLowerCase().replace('/', '-'));
  if (result.year) tags.push(result.year);
  if (result.withPrices) tags.push('con-precios');
  result.tags = tags.join(', ');

  return result;
}

export function IAAgentFiles() {
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingFile, setEditingFile] = useState<AgentFile | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [filterCategory, setFilterCategory] = useState<FileCategory | 'all'>('all');

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Pending files for batch upload
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state for single file edit
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'catalog' as FileCategory,
    attachmentId: '',
    tags: '',
    brand: '',
    withPrices: false,
    season: '',
    year: '',
    priority: 2,
    isCurrentCatalog: false
  });

  useEffect(() => {
    loadFiles();
  }, [filterCategory]);

  async function loadFiles() {
    try {
      const url = filterCategory === 'all'
        ? apiUrl("/api/ia-agent-files")
        : apiUrl(`/api/ia-agent-files?category=${filterCategory}`);

      const response = await fetch(url, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setLoading(false);
    }
  }

  // Handle direct file selection (multiple)
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newPendingFiles: PendingFile[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const metadata = extractMetadataFromFilename(file.name);

      newPendingFiles.push({
        file,
        name: metadata.name || file.name,
        description: '',
        category: metadata.category || 'catalog',
        tags: metadata.tags || '',
        brand: metadata.brand || '',
        withPrices: metadata.withPrices || false,
        season: metadata.season || '',
        year: metadata.year || '',
        priority: 2, // Default to normal priority
        isCurrentCatalog: false
      });
    }

    setPendingFiles(prev => [...prev, ...newPendingFiles]);
    setShowUploadForm(true);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  // Update a pending file's metadata
  function updatePendingFile(index: number, updates: Partial<PendingFile>) {
    setPendingFiles(prev => {
      const newFiles = [...prev];
      newFiles[index] = { ...newFiles[index], ...updates };
      return newFiles;
    });
  }

  // Remove a pending file
  function removePendingFile(index: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  // Upload all pending files
  async function handleBatchUpload() {
    if (pendingFiles.length === 0) return;

    setUploading(true);
    const uploadedFiles: any[] = [];

    try {
      for (const pending of pendingFiles) {
        // First upload the file to get attachment using multipart endpoint
        const uploadFormData = new FormData();
        uploadFormData.append('file', pending.file);

        const uploadResponse = await fetch(apiUrl('/api/crm/attachments/upload-multipart'), {
          method: 'POST',
          credentials: 'include',
          body: uploadFormData
        });

        if (!uploadResponse.ok) {
          console.error(`Failed to upload ${pending.file.name}`);
          continue;
        }

        const attachment = await uploadResponse.json();

        // Prepare file data for agent files
        uploadedFiles.push({
          name: pending.name,
          description: pending.description,
          category: pending.category,
          url: attachment.url,
          fileName: attachment.filename,
          mimeType: attachment.mime,
          size: attachment.size,
          tags: pending.tags ? pending.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          metadata: {
            brand: pending.brand || undefined,
            withPrices: pending.withPrices,
            season: pending.season || undefined,
            year: pending.year || undefined
          },
          priority: pending.priority,
          isCurrentCatalog: pending.isCurrentCatalog
        });
      }

      if (uploadedFiles.length > 0) {
        // Batch create in agent files
        const response = await fetch(apiUrl('/api/ia-agent-files/batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ files: uploadedFiles })
        });

        if (response.ok) {
          const result = await response.json();
          alert(`✅ ${result.count} archivo(s) subido(s) exitosamente`);
          setPendingFiles([]);
          setShowUploadForm(false);
          await loadFiles();
        } else {
          alert('❌ Error al registrar archivos');
        }
      }
    } catch (error) {
      console.error('Failed to batch upload:', error);
      alert('❌ Error al subir archivos');
    } finally {
      setUploading(false);
    }
  }

  // Handle single file edit submit
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingFile) return;

    setUploading(true);
    try {
      const fileData = {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
        metadata: {
          brand: formData.brand || undefined,
          withPrices: formData.withPrices,
          season: formData.season || undefined,
          year: formData.year || undefined
        },
        priority: formData.priority,
        isCurrentCatalog: formData.isCurrentCatalog
      };

      const response = await fetch(apiUrl(`/api/ia-agent-files/${editingFile.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(fileData),
      });

      if (response.ok) {
        await loadFiles();
        resetForm();
        alert('✅ Archivo actualizado exitosamente');
      } else {
        const data = await response.json();
        alert(`❌ Error: ${data.error || 'Error al guardar'}`);
      }
    } catch (error) {
      console.error("Failed to save file:", error);
      alert("❌ Error al guardar el archivo");
    } finally {
      setUploading(false);
    }
  }

  // Batch delete selected files
  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;

    if (!confirm(`¿Estás seguro de eliminar ${selectedIds.size} archivo(s)?`)) {
      return;
    }

    try {
      const response = await fetch(apiUrl('/api/ia-agent-files/batch'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`✅ ${result.count} archivo(s) eliminado(s)`);
        setSelectedIds(new Set());
        setSelectionMode(false);
        await loadFiles();
      } else {
        alert('❌ Error al eliminar archivos');
      }
    } catch (error) {
      console.error('Failed to batch delete:', error);
      alert('❌ Error al eliminar');
    }
  }

  async function handleDelete(file: AgentFile) {
    if (!confirm(`¿Estás seguro de eliminar "${file.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/ia-agent-files/${file.id}`), {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        await loadFiles();
        alert("✅ Archivo eliminado");
      } else {
        alert("❌ Error al eliminar");
      }
    } catch (error) {
      console.error("Failed to delete file:", error);
      alert("❌ Error al eliminar");
    }
  }

  async function handleToggle(file: AgentFile) {
    try {
      const response = await fetch(apiUrl(`/api/ia-agent-files/${file.id}/toggle`), {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        await loadFiles();
      } else {
        alert("❌ Error al cambiar estado");
      }
    } catch (error) {
      console.error("Failed to toggle file:", error);
      alert("❌ Error al cambiar estado");
    }
  }

  function startEdit(file: AgentFile) {
    setEditingFile(file);
    setFormData({
      name: file.name,
      description: file.description,
      category: file.category,
      attachmentId: file.url.split('/').pop() || '',
      tags: file.tags.join(', '),
      brand: file.metadata.brand || '',
      withPrices: file.metadata.withPrices || false,
      season: file.metadata.season || '',
      year: file.metadata.year || '',
      priority: file.priority || 2,
      isCurrentCatalog: file.isCurrentCatalog || false
    });
    setPendingFiles([]);
    setShowUploadForm(true);
  }

  function resetForm() {
    setFormData({
      name: '',
      description: '',
      category: 'catalog',
      attachmentId: '',
      tags: '',
      brand: '',
      withPrices: false,
      season: '',
      year: '',
      priority: 2,
      isCurrentCatalog: false
    });
    setEditingFile(null);
    setPendingFiles([]);
    setShowUploadForm(false);
  }

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  function selectAll() {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map(f => f.id)));
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  if (loading) {
    return <div className="p-6">Cargando archivos...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with filters and add button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Gestión de Archivos</h2>
          <p className="text-sm text-gray-600">Sube y administra catálogos, flyers e información para el agente</p>
        </div>
        <div className="flex gap-2">
          {/* Selection mode toggle */}
          {files.length > 0 && (
            <button
              onClick={() => {
                setSelectionMode(!selectionMode);
                setSelectedIds(new Set());
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                selectionMode
                  ? 'bg-amber-100 text-amber-700 border border-amber-300'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              {selectionMode ? 'Cancelar' : 'Seleccionar'}
            </button>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Upload className="w-4 h-4" />
            Subir Archivos
          </button>
        </div>
      </div>

      {/* Batch delete bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3">
          <span className="text-red-700 font-medium">
            {selectedIds.size} archivo(s) seleccionado(s)
          </span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-sm bg-white border rounded hover:bg-gray-50"
            >
              {selectedIds.size === files.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </button>
            <button
              onClick={handleBatchDelete}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar seleccionados
            </button>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 border-b pb-3">
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1 rounded-lg text-sm font-medium ${
            filterCategory === 'all'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Todos ({files.length})
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
          const count = files.filter(f => f.category === key).length;
          return (
            <button
              key={key}
              onClick={() => setFilterCategory(key as FileCategory)}
              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                filterCategory === key
                  ? CATEGORY_COLORS[key as FileCategory]
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Upload/Edit form */}
      {showUploadForm && (
        <div className="bg-white p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {editingFile ? 'Editar Archivo' : `Archivos a Subir (${pendingFiles.length})`}
            </h3>
            <button onClick={resetForm} className="text-gray-500 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Editing existing file */}
          {editingFile && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nombre</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Categoría</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as FileCategory })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Descripción</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Marca</label>
                  <input
                    type="text"
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Temporada</label>
                  <input
                    type="text"
                    value={formData.season}
                    onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Año</label>
                  <input
                    type="text"
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Prioridad de Búsqueda</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value={1}>⭐ Alta (Catálogo Actual)</option>
                    <option value={2}>📄 Normal</option>
                    <option value={3}>📁 Baja (Archivo)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">El agente busca primero en catálogos de alta prioridad</p>
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.isCurrentCatalog}
                      onChange={(e) => setFormData({ ...formData, isCurrentCatalog: e.target.checked, priority: e.target.checked ? 1 : formData.priority })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium">Es catálogo vigente/actual</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">Se busca primero en catálogos vigentes</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.withPrices}
                    onChange={(e) => setFormData({ ...formData, withPrices: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Incluye precios</span>
                </label>
                <div className="flex-1">
                  <input
                    type="text"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Tags (separados por coma)"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={resetForm} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                  Cancelar
                </button>
                <button type="submit" disabled={uploading} className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {uploading ? 'Guardando...' : 'Actualizar'}
                </button>
              </div>
            </form>
          )}

          {/* Batch upload pending files */}
          {!editingFile && pendingFiles.length > 0 && (
            <div className="space-y-4">
              {/* Info box */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                <strong>Auto-detección:</strong> Los metadatos se extraen automáticamente del nombre del archivo. Puedes editarlos si es necesario.
              </div>

              {/* Pending files list */}
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {pendingFiles.map((pending, index) => (
                  <div key={index} className="p-4 border rounded-lg bg-gray-50">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-500" />
                        <span className="font-medium">{pending.file.name}</span>
                        <span className="text-xs text-gray-500">({formatFileSize(pending.file.size)})</span>
                      </div>
                      <button
                        onClick={() => removePendingFile(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                        <input
                          type="text"
                          value={pending.name}
                          onChange={(e) => updatePendingFile(index, { name: e.target.value })}
                          className="w-full px-2 py-1 border rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
                        <select
                          value={pending.category}
                          onChange={(e) => updatePendingFile(index, { category: e.target.value as FileCategory })}
                          className="w-full px-2 py-1 border rounded text-sm"
                        >
                          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                        <input
                          type="text"
                          value={pending.brand}
                          onChange={(e) => updatePendingFile(index, { brand: e.target.value })}
                          className="w-full px-2 py-1 border rounded text-sm"
                          placeholder="Auto-detectado"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Temporada/Año</label>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={pending.season}
                            onChange={(e) => updatePendingFile(index, { season: e.target.value })}
                            className="w-1/2 px-2 py-1 border rounded text-sm"
                            placeholder="PV"
                          />
                          <input
                            type="text"
                            value={pending.year}
                            onChange={(e) => updatePendingFile(index, { year: e.target.value })}
                            className="w-1/2 px-2 py-1 border rounded text-sm"
                            placeholder="2025"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mt-2">
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={pending.withPrices}
                          onChange={(e) => updatePendingFile(index, { withPrices: e.target.checked })}
                          className="w-3 h-3"
                        />
                        <span>Con precios</span>
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={pending.isCurrentCatalog}
                          onChange={(e) => updatePendingFile(index, { isCurrentCatalog: e.target.checked, priority: e.target.checked ? 1 : 2 })}
                          className="w-3 h-3"
                        />
                        <span className="text-yellow-700 font-medium">⭐ Catálogo vigente</span>
                      </label>
                      <select
                        value={pending.priority}
                        onChange={(e) => updatePendingFile(index, { priority: Number(e.target.value) })}
                        className="px-2 py-1 border rounded text-xs"
                      >
                        <option value={1}>Alta prioridad</option>
                        <option value={2}>Normal</option>
                        <option value={3}>Baja (archivo)</option>
                      </select>
                      <div className="flex-1">
                        <input
                          type="text"
                          value={pending.tags}
                          onChange={(e) => updatePendingFile(index, { tags: e.target.value })}
                          className="w-full px-2 py-1 border rounded text-xs"
                          placeholder="Tags auto-generados"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add more files */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar más archivos
              </button>

              {/* Upload button */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button onClick={resetForm} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                  Cancelar
                </button>
                <button
                  onClick={handleBatchUpload}
                  disabled={uploading || pendingFiles.length === 0}
                  className="px-6 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <>Subiendo...</>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Subir {pendingFiles.length} archivo(s)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Empty state for upload */}
          {!editingFile && pendingFiles.length === 0 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="py-12 border-2 border-dashed border-gray-300 rounded-lg text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50"
            >
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-600 font-medium">Haz clic para seleccionar archivos</p>
              <p className="text-sm text-gray-500 mt-1">o arrastra y suelta aquí</p>
              <p className="text-xs text-gray-400 mt-3">PDF, JPG, PNG, DOC (máx. 50MB cada uno)</p>
            </div>
          )}
        </div>
      )}

      {/* Files list */}
      <div className="space-y-3">
        {files.length === 0 && !showUploadForm && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
            <FileText className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600">No hay archivos en esta categoría</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 text-blue-600 hover:text-blue-700 font-medium"
            >
              Subir tu primer archivo
            </button>
          </div>
        )}

        {files.map(file => (
          <div
            key={file.id}
            className={`bg-white p-4 rounded-lg border ${
              !file.enabled ? 'opacity-60 bg-gray-50' : ''
            } ${selectedIds.has(file.id) ? 'border-blue-500 bg-blue-50' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                {/* Selection checkbox */}
                {selectionMode && (
                  <button
                    onClick={() => toggleSelection(file.id)}
                    className="mt-1 text-gray-400 hover:text-blue-600"
                  >
                    {selectedIds.has(file.id) ? (
                      <CheckSquare className="w-5 h-5 text-blue-600" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                )}

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-semibold">{file.name}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[file.category]}`}>
                      {CATEGORY_LABELS[file.category]}
                    </span>
                    {file.isCurrentCatalog && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                        ⭐ Vigente
                      </span>
                    )}
                    {file.priority === 1 && !file.isCurrentCatalog && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-50 text-yellow-600">
                        Alta prioridad
                      </span>
                    )}
                    {file.priority === 3 && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500">
                        📁 Archivo
                      </span>
                    )}
                    {file.metadata.withPrices && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                        Con Precios
                      </span>
                    )}
                    {!file.enabled && (
                      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600">
                        Desactivado
                      </span>
                    )}
                  </div>

                  {file.description && (
                    <p className="text-sm text-gray-600 mb-2">{file.description}</p>
                  )}

                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>📄 {file.fileName}</span>
                    <span>💾 {formatFileSize(file.size)}</span>
                    {file.metadata.brand && <span>🏷️ {file.metadata.brand}</span>}
                    {file.metadata.season && <span>🌸 {file.metadata.season}</span>}
                    {file.metadata.year && <span>📅 {file.metadata.year}</span>}
                  </div>

                  {file.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {file.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!selectionMode && (
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleToggle(file)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                    title={file.enabled ? "Desactivar" : "Activar"}
                  >
                    {file.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                    title="Ver archivo"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => startEdit(file)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    title="Editar"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(file)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {files.length > 0 && (
        <div className="text-sm text-gray-500 text-center pt-4 border-t">
          Mostrando {files.length} archivo{files.length !== 1 ? 's' : ''}
          {filterCategory !== 'all' && ` en categoría ${CATEGORY_LABELS[filterCategory]}`}
        </div>
      )}
    </div>
  );
}
