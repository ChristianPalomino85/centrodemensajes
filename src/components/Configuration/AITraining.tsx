import { useState, useEffect } from "react";
import { apiUrl } from "../../lib/apiBase";

interface TrainingStatus {
  trainingData: {
    exists: boolean;
    date: string;
    size: number;
    conversations: number;
    messages: number;
  };
  patterns: {
    exists: boolean;
    size: number;
    indexed: boolean;
    chunks: number;
  };
  fineTuning: {
    exists: boolean;
    examples: number;
  };
}

export function AITraining() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [exportDays, setExportDays] = useState(30);
  const [minMessages, setMinMessages] = useState(5);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch(apiUrl("/api/rag-admin/training/status"), {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error("Error loading training status:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setLastResult(null);
    try {
      const response = await fetch(apiUrl("/api/rag-admin/training/export"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: exportDays, minMessages }),
      });

      const data = await response.json();
      if (response.ok) {
        setLastResult({
          type: "export",
          success: true,
          ...data,
        });
        loadStatus();
      } else {
        setLastResult({
          type: "export",
          success: false,
          error: data.error,
        });
      }
    } catch (error) {
      setLastResult({
        type: "export",
        success: false,
        error: String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleIndexPatterns() {
    setIndexing(true);
    setLastResult(null);
    try {
      const response = await fetch(apiUrl("/api/rag-admin/training/index-patterns"), {
        method: "POST",
        credentials: "include",
      });

      const data = await response.json();
      if (response.ok) {
        setLastResult({
          type: "index",
          success: true,
          ...data,
        });
        loadStatus();
      } else {
        setLastResult({
          type: "index",
          success: false,
          error: data.error,
        });
      }
    } catch (error) {
      setLastResult({
        type: "index",
        success: false,
        error: String(error),
      });
    } finally {
      setIndexing(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-lg border border-purple-200">
        <h2 className="text-xl font-bold text-purple-800 mb-2">
          Entrenamiento de IA
        </h2>
        <p className="text-purple-700">
          Extrae patrones de conversaciones reales para mejorar las respuestas del agente.
          La IA aprenderá cómo tus asesores responden a los clientes.
        </p>
      </div>

      {/* Current Status */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4">Estado Actual</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Training Data */}
          <div className={`p-4 rounded-lg border-2 ${
            status?.trainingData.exists
              ? "border-green-200 bg-green-50"
              : "border-gray-200 bg-gray-50"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">📊</span>
              <span className="font-medium">Datos de Entrenamiento</span>
            </div>
            {status?.trainingData.exists ? (
              <div className="text-sm space-y-1">
                <p>Fecha: <strong>{status.trainingData.date}</strong></p>
                <p>Conversaciones: <strong>{status.trainingData.conversations}</strong></p>
                <p>Mensajes: <strong>{status.trainingData.messages}</strong></p>
                <p>Tamaño: <strong>{formatBytes(status.trainingData.size)}</strong></p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No hay datos exportados</p>
            )}
          </div>

          {/* Patterns */}
          <div className={`p-4 rounded-lg border-2 ${
            status?.patterns.indexed
              ? "border-green-200 bg-green-50"
              : status?.patterns.exists
                ? "border-yellow-200 bg-yellow-50"
                : "border-gray-200 bg-gray-50"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🧠</span>
              <span className="font-medium">Patrones en RAG</span>
            </div>
            {status?.patterns.indexed ? (
              <div className="text-sm space-y-1">
                <p className="text-green-600 font-medium">Indexado</p>
                <p>Chunks: <strong>{status.patterns.chunks}</strong></p>
                <p>Tamaño: <strong>{formatBytes(status.patterns.size)}</strong></p>
              </div>
            ) : status?.patterns.exists ? (
              <div className="text-sm space-y-1">
                <p className="text-yellow-600 font-medium">Pendiente de indexar</p>
                <p>Tamaño: <strong>{formatBytes(status.patterns.size)}</strong></p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No hay patrones generados</p>
            )}
          </div>

          {/* Fine-tuning */}
          <div className={`p-4 rounded-lg border-2 ${
            status?.fineTuning.exists
              ? "border-blue-200 bg-blue-50"
              : "border-gray-200 bg-gray-50"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🎯</span>
              <span className="font-medium">Fine-tuning (Opcional)</span>
            </div>
            {status?.fineTuning.exists ? (
              <div className="text-sm space-y-1">
                <p>Ejemplos: <strong>{status.fineTuning.examples}</strong></p>
                <p className="text-xs text-gray-500 mt-2">
                  Archivo .jsonl listo para OpenAI
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No hay archivo generado</p>
            )}
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4">
          Paso 1: Exportar Conversaciones
        </h3>
        <p className="text-gray-600 mb-4">
          Extrae conversaciones recientes de tu sistema para generar patrones de entrenamiento.
        </p>

        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Últimos días
            </label>
            <input
              type="number"
              value={exportDays}
              onChange={(e) => setExportDays(parseInt(e.target.value) || 30)}
              min={1}
              max={90}
              className="w-24 px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Mínimo mensajes
            </label>
            <input
              type="number"
              value={minMessages}
              onChange={(e) => setMinMessages(parseInt(e.target.value) || 5)}
              min={3}
              max={50}
              className="w-24 px-3 py-2 border rounded-lg"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className={`px-6 py-2 rounded-lg font-medium ${
              exporting
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            {exporting ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span> Exportando...
              </span>
            ) : (
              "Exportar Chats"
            )}
          </button>
        </div>

        {lastResult?.type === "export" && (
          <div className={`p-4 rounded-lg ${
            lastResult.success
              ? "bg-green-50 border border-green-200"
              : "bg-red-50 border border-red-200"
          }`}>
            {lastResult.success ? (
              <div className="text-green-800">
                <p className="font-medium">Exportación exitosa</p>
                <p className="text-sm mt-1">
                  {lastResult.conversations} conversaciones, {lastResult.messages} mensajes extraídos.
                  {lastResult.fineTuningExamples > 0 && (
                    <span> {lastResult.fineTuningExamples} ejemplos para fine-tuning.</span>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-red-800">Error: {lastResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Index Section */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4">
          Paso 2: Indexar Patrones en RAG
        </h3>
        <p className="text-gray-600 mb-4">
          Procesa los patrones exportados y los agrega a la base de conocimiento del agente.
        </p>

        <button
          onClick={handleIndexPatterns}
          disabled={indexing || !status?.patterns.exists}
          className={`px-6 py-2 rounded-lg font-medium ${
            indexing || !status?.patterns.exists
              ? "bg-gray-300 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {indexing ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span> Indexando...
            </span>
          ) : (
            "Indexar Patrones"
          )}
        </button>

        {!status?.patterns.exists && (
          <p className="text-sm text-gray-500 mt-2">
            Primero exporta las conversaciones para generar patrones.
          </p>
        )}

        {lastResult?.type === "index" && (
          <div className={`mt-4 p-4 rounded-lg ${
            lastResult.success
              ? "bg-green-50 border border-green-200"
              : "bg-red-50 border border-red-200"
          }`}>
            {lastResult.success ? (
              <div className="text-green-800">
                <p className="font-medium">Indexación exitosa</p>
                <p className="text-sm mt-1">
                  {lastResult.chunksAdded} chunks agregados.
                  Total en RAG: {lastResult.totalChunks} chunks.
                </p>
              </div>
            ) : (
              <p className="text-red-800">Error: {lastResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h4 className="font-medium text-blue-800 mb-2">¿Cómo funciona?</h4>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>
            <strong>Exportar:</strong> Extrae conversaciones reales de tu CRM y genera un documento de patrones.
          </li>
          <li>
            <strong>Indexar:</strong> Convierte los patrones en embeddings que el agente puede consultar.
          </li>
          <li>
            <strong>Resultado:</strong> El agente usa estos patrones como referencia al responder.
          </li>
          <li>
            <strong>Recomendación:</strong> Ejecuta este proceso cada 1-2 semanas para mantener actualizado el aprendizaje.
          </li>
        </ul>
      </div>

      {/* Cost Info */}
      <div className="bg-gray-50 p-4 rounded-lg border">
        <h4 className="font-medium text-gray-800 mb-2">Costo Estimado</h4>
        <div className="text-sm text-gray-600 space-y-1">
          <p>• Exportar: <strong>Gratis</strong> (solo usa tu base de datos)</p>
          <p>• Indexar: <strong>~$0.10-0.20</strong> por cada 100 conversaciones (embeddings OpenAI)</p>
        </div>
      </div>
    </div>
  );
}
