import { useState, useEffect } from "react";
import { apiUrl } from "../../lib/apiBase";
import { Brain, Upload, Trash2, RefreshCw, Check, X, Database, Sparkles, FileText, DollarSign, AlertCircle, HelpCircle } from "lucide-react";

interface Document {
  id: string;
  name: string;
  url: string;
  indexed: boolean;
  chunks?: number;
}

interface RAGStatus {
  enabled: boolean;
  apiKeyConfigured: boolean;
  documentsIndexed: number;
  totalDocuments: number;
  totalChunks: number;
}

export function RAGAdmin() {
  const [status, setStatus] = useState<RAGStatus | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch(apiUrl("/api/rag-admin/status"), {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error("Failed to load RAG status:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim()) {
      alert("Por favor ingresa una API key válida");
      return;
    }

    setValidatingKey(true);
    try {
      const response = await fetch(apiUrl("/api/rag-admin/save-api-key"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✅ API key guardada y validada: ${data.modelsAvailable} modelos disponibles`);
        setShowApiKeyInput(false);
        setApiKey("");
        loadStatus();
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.message}`);
      }
    } catch (error) {
      console.error("Failed to save API key:", error);
      alert("❌ Error al guardar la API key");
    } finally {
      setValidatingKey(false);
    }
  }

  async function handleIndexAll() {
    if (!confirm("¿Indexar todos los documentos? Esto puede tomar varios minutos.")) {
      return;
    }

    setIndexing(true);
    try {
      const response = await fetch(apiUrl("/api/rag-admin/index"), {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        let message = `✅ Indexación completa: ${data.totalChunks} chunks totales`;
        if (data.indexed > 0) message += `\n📄 ${data.indexed} documento(s) indexado(s)`;
        if (data.skipped > 0) message += `\n⏭️ ${data.skipped} documento(s) ya indexado(s)`;
        if (data.totalCost) message += `\n💰 Costo: $${data.totalCost.toFixed(4)} USD`;
        if (data.errors && data.errors.length > 0) {
          message += `\n\n⚠️ Errores:\n${data.errors.join('\n')}`;
        }
        alert(message);
        loadStatus();
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.message || 'Error desconocido'}`);
      }
    } catch (error) {
      console.error("Failed to index documents:", error);
      alert(`❌ Error al indexar documentos: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    } finally {
      setIndexing(false);
    }
  }

  async function handleReindexDocument(docId: string) {
    if (!confirm("¿Re-indexar este documento?")) {
      return;
    }

    setIndexing(true);
    try {
      const response = await fetch(apiUrl(`/api/rag-admin/reindex/${docId}`), {
        method: "POST",
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✅ Re-indexado: ${data.chunks} chunks\n💰 Costo: $${data.cost.toFixed(4)} USD`);
        loadStatus();
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.message}`);
      }
    } catch (error) {
      console.error("Failed to reindex document:", error);
      alert("❌ Error al re-indexar documento");
    } finally {
      setIndexing(false);
    }
  }

  async function handleClearIndex() {
    if (!confirm("⚠️ ¿ELIMINAR todos los índices? Esta acción no se puede deshacer.")) {
      return;
    }

    try {
      const response = await fetch(apiUrl("/api/rag-admin/clear-index"), {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        alert("✅ Índices eliminados correctamente");
        loadStatus();
      } else {
        const error = await response.json();
        alert(`❌ Error: ${error.message}`);
      }
    } catch (error) {
      console.error("Failed to clear index:", error);
      alert("❌ Error al eliminar índices");
    }
  }

  async function handleUploadFiles() {
    if (selectedFiles.length === 0) {
      alert("Por favor selecciona al menos un archivo PDF");
      return;
    }

    // Validate all files are PDFs
    const invalidFiles = selectedFiles.filter(f => !f.name.toLowerCase().endsWith('.pdf'));
    if (invalidFiles.length > 0) {
      alert(`Solo se permiten archivos PDF. Archivos inválidos: ${invalidFiles.map(f => f.name).join(', ')}`);
      return;
    }

    setUploading(true);
    const results: { success: string[]; failed: string[] } = { success: [], failed: [] };

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress(`Subiendo ${i + 1}/${selectedFiles.length}: ${file.name}`);

        const formData = new FormData();
        formData.append('pdf', file);

        try {
          const response = await fetch(apiUrl("/api/rag-admin/upload-pdf"), {
            method: "POST",
            credentials: "include",
            body: formData,
          });

          if (response.ok) {
            results.success.push(file.name);
          } else {
            const error = await response.json();
            results.failed.push(`${file.name}: ${error.message}`);
          }
        } catch (err) {
          results.failed.push(`${file.name}: Error de conexión`);
        }
      }

      // Show summary
      let message = '';
      if (results.success.length > 0) {
        message += `✅ ${results.success.length} archivo(s) subido(s):\n${results.success.join('\n')}\n\n`;
      }
      if (results.failed.length > 0) {
        message += `❌ ${results.failed.length} archivo(s) fallaron:\n${results.failed.join('\n')}`;
      }
      alert(message);

      // Reset
      setSelectedFiles([]);
      setUploadProgress("");
      const fileInput = document.getElementById('pdf-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadStatus();
    } catch (error) {
      console.error("Failed to upload files:", error);
      alert("❌ Error al subir los archivos");
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con animación */}
      <div className="bg-gradient-to-r from-purple-50 via-blue-50 to-indigo-50 rounded-xl p-6 border border-purple-200/50 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg p-3 shadow-lg">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-700 to-indigo-700 bg-clip-text text-transparent">
                RAG & Búsqueda Inteligente
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Sistema de recuperación aumentada con OpenAI Embeddings
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowHelpModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-purple-50 text-purple-600 rounded-lg border border-purple-200 shadow-sm transition-colors"
              title="Guía de RAG"
            >
              <HelpCircle className="w-5 h-5" />
              <span className="text-sm font-medium">Ayuda</span>
            </button>
            {status && (
              <>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600" />
                    <div>
                      <div className="text-xs text-slate-600">Documentos</div>
                      <div className="text-lg font-bold text-slate-900">{status.totalDocuments}</div>
                    </div>
                  </div>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <div>
                      <div className="text-xs text-slate-600">Chunks</div>
                      <div className="text-lg font-bold text-slate-900">{status.totalChunks}</div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* API Key Configuration */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-emerald-400 to-green-500 rounded-lg p-2">
                <Check className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">OpenAI API Key</h3>
                <p className="text-xs text-slate-600">Configuración de credenciales</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {status?.apiKeyConfigured ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300">
                  <Check className="w-3 h-3" />
                  Configurada
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300">
                  <AlertCircle className="w-3 h-3" />
                  No configurada
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-6">
          {showApiKeyInput ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  API Key de OpenAI
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  La API key se guardará encriptada y se usará para crear embeddings y generar respuestas
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveApiKey}
                  disabled={validatingKey}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 font-medium transition-all shadow-sm disabled:opacity-50"
                >
                  {validatingKey ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Validando...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Guardar y Validar
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowApiKeyInput(false);
                    setApiKey("");
                  }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowApiKeyInput(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 rounded-lg hover:from-slate-200 hover:to-slate-300 font-medium transition-all border border-slate-300"
            >
              {status?.apiKeyConfigured ? "Cambiar API Key" : "Configurar API Key"}
            </button>
          )}
        </div>
      </div>

      {/* Documents & Indexing */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-400 to-indigo-500 rounded-lg p-2">
                <FileText className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Documentos Indexados</h3>
                <p className="text-xs text-slate-600">Gestión de base de conocimiento</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Upload PDF Button */}
              <div className="flex items-center gap-2 flex-wrap">
                <label
                  htmlFor="pdf-upload"
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm rounded-lg hover:from-emerald-700 hover:to-teal-700 font-medium transition-all shadow-sm cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Elegir PDFs
                </label>
                <input
                  id="pdf-upload"
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      setSelectedFiles(Array.from(files));
                    }
                  }}
                  className="hidden"
                />
                {selectedFiles.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-slate-600 font-medium">
                        {selectedFiles.length} archivo(s) seleccionado(s):
                      </span>
                      <div className="flex flex-wrap gap-1 max-w-[300px]">
                        {selectedFiles.slice(0, 3).map((file, idx) => (
                          <span key={idx} className="text-xs bg-slate-100 px-2 py-0.5 rounded truncate max-w-[100px]" title={file.name}>
                            {file.name}
                          </span>
                        ))}
                        {selectedFiles.length > 3 && (
                          <span className="text-xs bg-slate-200 px-2 py-0.5 rounded font-medium">
                            +{selectedFiles.length - 3} más
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleUploadFiles}
                      disabled={uploading}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          {uploadProgress || 'Subiendo...'}
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Subir {selectedFiles.length > 1 ? `${selectedFiles.length} archivos` : ''}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFiles([]);
                        const fileInput = document.getElementById('pdf-upload') as HTMLInputElement;
                        if (fileInput) fileInput.value = '';
                      }}
                      className="text-slate-400 hover:text-slate-600 transition"
                      title="Limpiar selección"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleIndexAll}
                disabled={!status?.apiKeyConfigured || indexing || documents.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm rounded-lg hover:from-purple-700 hover:to-indigo-700 font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {indexing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Indexando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Indexar Todo
                  </>
                )}
              </button>
              <button
                onClick={handleClearIndex}
                disabled={indexing || status?.totalChunks === 0}
                className="inline-flex items-center gap-2 px-3 py-2 border border-red-300 text-red-700 text-sm rounded-lg hover:bg-red-50 font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Limpiar
              </button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {documents.length === 0 ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                <FileText className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-600 font-medium">No hay documentos configurados</p>
              <p className="text-sm text-slate-500 mt-1">
                Agrega documentos en la configuración del agente IA
              </p>
            </div>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${doc.indexed ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                    <div>
                      <div className="font-medium text-slate-900">{doc.name}</div>
                      {doc.chunks !== undefined && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {doc.chunks} chunks indexados
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {doc.indexed ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <Check className="w-3 h-3" />
                        Indexado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                        <X className="w-3 h-3" />
                        Sin indexar
                      </span>
                    )}

                    <button
                      onClick={() => handleReindexDocument(doc.id)}
                      disabled={!status?.apiKeyConfigured || indexing}
                      className="p-2 text-slate-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Re-indexar"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200/50">
        <div className="flex items-start gap-3">
          <div className="bg-blue-500 rounded-lg p-2 mt-0.5">
            <DollarSign className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-blue-900 mb-1">Costos de Indexación</h4>
            <p className="text-sm text-blue-700 leading-relaxed">
              La indexación usa OpenAI <span className="font-semibold">text-embedding-3-small</span> ($0.0001 por 1M tokens).
              Cada búsqueda usa embeddings + <span className="font-semibold">gpt-4o-mini</span> para generar respuestas.
              Puedes ver todos los costos en el panel de "Control de Inversión".
            </p>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setShowHelpModal(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-4 rounded-t-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-lg p-2">
                    <HelpCircle className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold">Guía de RAG - Búsqueda Inteligente</h2>
                </div>
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 space-y-6">
                {/* ¿Qué es RAG? */}
                <div className="bg-slate-50 rounded-lg p-5 border-l-4 border-purple-500">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-600" />
                    ¿Qué es RAG?
                  </h3>
                  <p className="text-slate-700 leading-relaxed mb-3">
                    <span className="font-semibold">RAG (Retrieval-Augmented Generation)</span> es una tecnología que permite al bot buscar información específica en tus documentos y usarla para generar respuestas precisas y contextualizadas.
                  </p>
                  <p className="text-slate-700 leading-relaxed">
                    En lugar de solo depender de su conocimiento general, el bot puede consultar catálogos de productos, manuales, políticas de la empresa, FAQs y cualquier documento que hayas subido, brindando respuestas más exactas y actualizadas.
                  </p>
                </div>

                {/* Cómo funciona */}
                <div className="bg-slate-50 rounded-lg p-5 border-l-4 border-indigo-500">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-600" />
                    ¿Cómo funciona?
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="bg-indigo-100 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-indigo-700">1</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Indexación de Documentos</p>
                        <p className="text-sm text-slate-600">Tus PDFs se dividen en fragmentos pequeños (chunks) y se convierten en vectores matemáticos usando OpenAI Embeddings.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="bg-indigo-100 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-indigo-700">2</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Búsqueda Semántica</p>
                        <p className="text-sm text-slate-600">Cuando un cliente hace una pregunta, el sistema busca los fragmentos más relevantes usando similitud vectorial.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="bg-indigo-100 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-indigo-700">3</span>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Generación de Respuesta</p>
                        <p className="text-sm text-slate-600">El bot usa los fragmentos encontrados como contexto para generar una respuesta precisa y natural con GPT-4.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Usos Prácticos */}
                <div className="bg-slate-50 rounded-lg p-5 border-l-4 border-emerald-500">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-emerald-600" />
                    Usos Prácticos
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-white rounded-lg p-3 border border-emerald-200">
                      <p className="font-semibold text-emerald-900 text-sm mb-1">📦 Catálogos de Productos</p>
                      <p className="text-xs text-slate-600">Sube tu catálogo y el bot podrá responder sobre precios, especificaciones, disponibilidad y características de productos.</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-emerald-200">
                      <p className="font-semibold text-emerald-900 text-sm mb-1">❓ Preguntas Frecuentes</p>
                      <p className="text-xs text-slate-600">Indexa tus FAQs y el bot responderá automáticamente las dudas más comunes de tus clientes.</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-emerald-200">
                      <p className="font-semibold text-emerald-900 text-sm mb-1">📋 Políticas y Manuales</p>
                      <p className="text-xs text-slate-600">Sube políticas de devolución, garantías, términos de servicio y el bot citará la información exacta.</p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-emerald-200">
                      <p className="font-semibold text-emerald-900 text-sm mb-1">📚 Base de Conocimiento</p>
                      <p className="text-xs text-slate-600">Crea una biblioteca de documentos internos para que el bot asista a tu equipo con información técnica.</p>
                    </div>
                  </div>
                </div>

                {/* Cómo usar el sistema */}
                <div className="bg-slate-50 rounded-lg p-5 border-l-4 border-blue-500">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <Upload className="w-5 h-5 text-blue-600" />
                    Cómo usar el sistema
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <p className="font-semibold text-slate-900 mb-2">1️⃣ Configura tu API Key de OpenAI</p>
                      <p className="text-sm text-slate-600 mb-2">
                        Primero necesitas una API key de OpenAI. Si no tienes una:
                      </p>
                      <ul className="text-sm text-slate-600 list-disc list-inside space-y-1 ml-2">
                        <li>Visita <span className="font-mono text-xs bg-slate-200 px-1 py-0.5 rounded">platform.openai.com</span></li>
                        <li>Crea una cuenta o inicia sesión</li>
                        <li>Ve a API Keys y genera una nueva clave</li>
                        <li>Pégala en el campo "OpenAI API Key" arriba</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-900 mb-2">2️⃣ Sube tus documentos PDF</p>
                      <p className="text-sm text-slate-600 mb-2">
                        Haz clic en <span className="font-semibold">"Elegir PDF"</span> y selecciona el documento que quieres que el bot pueda consultar. Los PDFs se guardarán en la carpeta <span className="font-mono text-xs bg-slate-200 px-1 py-0.5 rounded">rag-documents/</span>.
                      </p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-900 mb-2">3️⃣ Indexa los documentos</p>
                      <p className="text-sm text-slate-600 mb-2">
                        Haz clic en <span className="font-semibold">"Indexar Todo"</span> para procesar todos tus documentos. Este proceso:
                      </p>
                      <ul className="text-sm text-slate-600 list-disc list-inside space-y-1 ml-2">
                        <li>Extrae el texto de cada PDF</li>
                        <li>Divide el contenido en fragmentos manejables</li>
                        <li>Crea embeddings vectoriales con OpenAI</li>
                        <li>Guarda todo en la base de datos para búsquedas rápidas</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-900 mb-2">4️⃣ El bot usará la información automáticamente</p>
                      <p className="text-sm text-slate-600">
                        Una vez indexados, el bot consultará automáticamente tus documentos cuando reciba preguntas relacionadas. Verás en los logs cuando el RAG esté activo buscando información para responder.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Costos */}
                <div className="bg-amber-50 rounded-lg p-5 border-l-4 border-amber-500">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-amber-600" />
                    Costos de Operación
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-amber-600 font-bold">•</span>
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold">Indexación:</span> Se usa el modelo <span className="font-mono text-xs bg-slate-200 px-1 py-0.5 rounded">text-embedding-3-small</span> a $0.0001 por 1M tokens. Un PDF típico de 50 páginas cuesta ~$0.001-0.005 USD.
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-amber-600 font-bold">•</span>
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold">Búsquedas:</span> Cada consulta usa embeddings + <span className="font-mono text-xs bg-slate-200 px-1 py-0.5 rounded">gpt-4o-mini</span> para generar la respuesta. Costo promedio: $0.0005-0.002 USD por pregunta.
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 mt-3 border border-amber-200">
                      <p className="text-sm text-slate-700">
                        💡 <span className="font-semibold">Consejo:</span> Puedes ver el desglose detallado de todos los costos de RAG en tiempo real en el panel de <span className="font-semibold">"Control de Inversión"</span> en la sección de Métricas.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tips */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-5 border border-purple-200">
                  <h3 className="font-bold text-lg text-slate-900 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-purple-600" />
                    Tips y Mejores Prácticas
                  </h3>
                  <div className="space-y-2 text-sm text-slate-700">
                    <p>✅ <span className="font-semibold">Organiza tus documentos:</span> Divide información por temas (catálogo, políticas, FAQs) en PDFs separados para mejor precisión.</p>
                    <p>✅ <span className="font-semibold">Actualiza regularmente:</span> Si cambias precios o políticas, re-indexa el documento actualizado.</p>
                    <p>✅ <span className="font-semibold">Usa texto claro:</span> PDFs con texto bien formateado funcionan mejor que imágenes escaneadas.</p>
                    <p>✅ <span className="font-semibold">Monitorea costos:</span> Revisa el Control de Inversión para optimizar el uso de RAG según tu presupuesto.</p>
                    <p>⚠️ <span className="font-semibold">Límite de contexto:</span> El sistema selecciona los fragmentos más relevantes, pero no puede procesar documentos completos de 1000+ páginas en una sola consulta.</p>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-slate-50 px-6 py-4 rounded-b-xl border-t border-slate-200">
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold py-3 rounded-lg transition-all shadow-sm"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
