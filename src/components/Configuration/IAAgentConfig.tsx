import { useState, useEffect } from "react";
import { apiUrl } from "../../lib/apiBase";
import { IAAgentFiles } from "./IAAgentFiles";
import { RAGAdmin } from "./RAGAdmin";
import { KeywordTracking } from "./KeywordTracking";
import { PersonalityConfig } from "./PersonalityConfig";
import { CampaignMetrics } from "./CampaignMetrics";
import { AITraining } from "./AITraining";

interface Queue {
  id: string;
  name: string;
}

interface IAAgentConfig {
  enabled: boolean;  // Switch maestro ON/OFF
  agentName: string;
  model: string;
  temperature: number;
  maxTokens: number;
  personality: {
    tone: string;
    emojiUsage: string;
    region: string;
    presentsAs: string;
  };
  systemPrompt: string;
  currentPromotions?: string;  // Promociones actuales (se integra al prompt)
  catalogs: Record<string, any>;
  catalogBehavior: {
    sendMode: string;
    groupedSending: boolean;
    delayBetweenFiles: number;
  };
  transferRules: Array<{
    id: string;
    name: string;
    queueId: string;
    keywords: string[];
    enabled: boolean;
    schedule?: {
      days: number[];
      startTime: string;
      endTime: string;
    };
  }>;
  leadQualification: {
    enabled: boolean;
    questions: {
      askName: boolean;
      askLocation: boolean;
      askBusinessType: boolean;
      askQuantity: boolean;
      askBudget: boolean;
    };
  };
  businessHours: {
    timezone: string;
    defaultSchedule: {
      days: number[];
      startTime: string;
      endTime: string;
    };
  };
  advancedSettings: {
    messageGrouping: {
      enabled: boolean;
      timeoutSeconds: number;
    };
    conversationMemory: {
      enabled: boolean;
      maxMessages: number;
      saveToBitrix: boolean;
      rememberPreviousConversations: boolean;
    };
    sentimentDetection: {
      enabled: boolean;
      onFrustratedAction: string;
    };
    maxInteractionsBeforeSuggestHuman: number;
    fallbackResponse: string;
  };
  integrations: {
    bitrix24: {
      enabled: boolean;
      autoCreateContact: boolean;
      updateContactInfo: boolean;
      logInteractions: boolean;
      fieldsToSave: Record<string, boolean>;
    };
    knowledgeBase: {
      enabled: boolean;
      documents: any[];
    };
  };
  visionAndOCR?: {
    visionEnabled: boolean;
    ocrEnabled: boolean;
    googleCloudCredentials?: string;
    visionInstructions?: string;
    ocrInstructions?: string;
  };
  version: string;
  lastUpdated: string;
}

export function IAAgentConfig() {
  const [config, setConfig] = useState<IAAgentConfig | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'personality' | 'files' | 'rag' | 'training' | 'keywords' | 'campaigns' | 'transfer' | 'vision' | 'advanced'>('general');

  useEffect(() => {
    loadConfig();
    loadQueues();
  }, []);

  async function loadQueues() {
    try {
      const response = await fetch(apiUrl("/api/admin/queues"), {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setQueues(data.queues || []);
      }
    } catch (error) {
      console.error("Failed to load queues:", error);
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch(apiUrl("/api/ia-agent-config"), {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();

        // Convert old object format to new array format if needed
        if (data.transferRules && !Array.isArray(data.transferRules)) {
          console.log('[IAAgentConfig] Converting old transferRules format to array');
          const oldRules = data.transferRules;
          data.transferRules = Object.keys(oldRules).map(key => ({
            id: key,
            name: oldRules[key].queueName || key,
            queueId: oldRules[key].queueId,
            keywords: oldRules[key].keywords || [],
            enabled: oldRules[key].enabled !== false,
            schedule: {
              days: [1, 2, 3, 4, 5, 6],
              startTime: '09:00',
              endTime: '18:00',
            }
          }));
        }

        setConfig(data);
      }
    } catch (error) {
      console.error("Failed to load IA Agent config:", error);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config) return;

    setSaving(true);
    try {
      const response = await fetch(apiUrl("/api/ia-agent-config"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });

      if (response.ok) {
        await loadConfig();
        alert("✅ Configuración del agente guardada exitosamente");
      } else {
        const data = await response.json();
        alert(`❌ Error: ${data.error || 'Error al guardar'}`);
      }
    } catch (error) {
      console.error("Failed to save config:", error);
      alert("❌ Error al guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6">Cargando configuración...</div>;
  }

  if (!config) {
    return <div className="p-6">No se pudo cargar la configuración</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">Configuración del Agente IA</h1>
            <p className="text-gray-600">
              Configura el agente virtual inteligente con herramientas y capacidades avanzadas
            </p>
          </div>

          {/* SWITCH MAESTRO ON/OFF */}
          <div className={`p-4 rounded-lg border-2 ${config.enabled ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className={`text-3xl mb-1 ${config.enabled ? '' : 'grayscale opacity-50'}`}>🤖</div>
                <div className={`text-xs font-bold ${config.enabled ? 'text-green-700' : 'text-red-700'}`}>
                  {config.enabled ? 'ACTIVO' : 'INACTIVO'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-14 h-8 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
          </div>
        </div>

        {!config.enabled && (
          <div className="p-4 bg-yellow-50 border border-yellow-300 rounded-lg mb-4">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Agente Desactivado:</strong> Los clientes serán transferidos automáticamente a un asesor humano.
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'general'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          General
        </button>
        <button
          onClick={() => setActiveTab('personality')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'personality'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          ✨ Personalidad
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'files'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📁 Archivos
        </button>
        <button
          onClick={() => setActiveTab('rag')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'rag'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          🧠 RAG
        </button>
        <button
          onClick={() => setActiveTab('training')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'training'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          🎓 Entrenamiento
        </button>
        <button
          onClick={() => setActiveTab('keywords')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'keywords'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📊 Keywords
        </button>
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'campaigns'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          🎯 Campañas
        </button>
        <button
          onClick={() => setActiveTab('transfer')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'transfer'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Transferencias
        </button>
        <button
          onClick={() => setActiveTab('vision')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'vision'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📸 Vision & OCR
        </button>
        <button
          onClick={() => setActiveTab('advanced')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'advanced'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Avanzado
        </button>
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          {/* Configuración del Modelo */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Configuración del Modelo</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre del Agente</label>
                <input
                  type="text"
                  value={config.agentName}
                  onChange={(e) => setConfig({ ...config, agentName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Asistente Virtual Azaleia"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Modelo</label>
                <select
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <optgroup label="🚀 GPT-5 (Agosto 2025+)">
                    <option value="gpt-5">GPT-5 (Más potente)</option>
                    <option value="gpt-5-mini">GPT-5 Mini (Balanceado)</option>
                    <option value="gpt-5-nano">GPT-5 Nano (Ultra rápido, económico)</option>
                    <option value="gpt-5.1">GPT-5.1 (Última versión)</option>
                    <option value="gpt-5.1-mini">GPT-5.1 Mini</option>
                    <option value="gpt-5.1-nano">GPT-5.1 Nano</option>
                  </optgroup>
                  <optgroup label="⚡ GPT-4">
                    <option value="gpt-4o">GPT-4o (Multimodal)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    <option value="gpt-4">GPT-4</option>
                  </optgroup>
                  <optgroup label="💰 GPT-3.5">
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Económico)</option>
                  </optgroup>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  GPT-5 Nano: $0.05/1M tokens input | GPT-4o: $2.50/1M tokens input
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Temperatura</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">0 = más preciso, 2 = más creativo</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Máx. Tokens</label>
                  <input
                    type="number"
                    min="100"
                    max="4000"
                    step="100"
                    value={config.maxTokens}
                    onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">Longitud máxima de respuesta</p>
                </div>
              </div>
            </div>
          </div>

          {/* System Prompt */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Prompt del Sistema</h2>
            <p className="text-sm text-gray-600 mb-3">
              Define cómo debe comportarse el agente y qué instrucciones seguir
            </p>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              rows={12}
              className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
              placeholder="Eres el asistente virtual..."
            />
          </div>

          {/* Promociones Actuales */}
          <div className="bg-white p-6 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🎉</span>
              <h2 className="text-lg font-semibold">Promociones Actuales</h2>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Escribe las promociones vigentes. Se integrarán automáticamente al prompt del agente en formato TOON.
            </p>
            <div className="mb-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs text-amber-800">
                <strong>💡 Tip:</strong> Escribe en lenguaje natural. Ejemplo:<br/>
                "2x1 en sandalias Azaleia hasta el 30/11"<br/>
                "20% descuento en Olympikus Running esta semana"<br/>
                "Envío gratis en compras mayores a S/200"
              </p>
            </div>
            <textarea
              value={config.currentPromotions || ''}
              onChange={(e) => setConfig({ ...config, currentPromotions: e.target.value })}
              rows={6}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-amber-500 focus:border-amber-500"
              placeholder="Escribe aquí las promociones actuales...&#10;&#10;Ejemplo:&#10;- 2x1 en sandalias Azaleia (hasta 30/11)&#10;- 15% descuento en Olympikus Running&#10;- Envío gratis Lima pedidos > S/250"
            />
            {config.currentPromotions && (
              <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xs text-green-800">
                  ✓ Las promociones se guardarán y el agente las mencionará cuando sea relevante.
                </p>
              </div>
            )}
          </div>

          {/* Horario de Atención */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Horario de Atención</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Hora de Inicio</label>
                  <input
                    type="time"
                    value={config.businessHours.defaultSchedule.startTime}
                    onChange={(e) => setConfig({
                      ...config,
                      businessHours: {
                        ...config.businessHours,
                        defaultSchedule: {
                          ...config.businessHours.defaultSchedule,
                          startTime: e.target.value
                        }
                      }
                    })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Hora de Fin</label>
                  <input
                    type="time"
                    value={config.businessHours.defaultSchedule.endTime}
                    onChange={(e) => setConfig({
                      ...config,
                      businessHours: {
                        ...config.businessHours,
                        defaultSchedule: {
                          ...config.businessHours.defaultSchedule,
                          endTime: e.target.value
                        }
                      }
                    })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800">
                  <strong>💡 Nota:</strong> Los mensajes fuera de horario son generados dinámicamente por la IA. No uses mensajes estáticos.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Personality Tab */}
      {activeTab === 'personality' && (
        <PersonalityConfig />
      )}

      {/* Files Tab */}
      {activeTab === 'files' && (
        <IAAgentFiles />
      )}

      {/* RAG Tab */}
      {activeTab === 'rag' && (
        <RAGAdmin />
      )}

      {/* Training Tab */}
      {activeTab === 'training' && (
        <AITraining />
      )}

      {/* Keywords Tab */}
      {activeTab === 'keywords' && (
        <KeywordTracking />
      )}

      {/* Campaigns Tab */}
      {activeTab === 'campaigns' && (
        <CampaignMetrics />
      )}

      {/* Transfer Tab */}
      {activeTab === 'transfer' && (
        <div className="space-y-6">
          {/* Header with info */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-900">
              <strong>⚠️ IMPORTANTE:</strong> Aquí solo configuras <strong>REGLAS DE TRANSFERENCIA</strong> (palabras clave, horarios, colas).
              La IA genera los mensajes dinámicamente - <strong>NUNCA repite las mismas frases</strong>.
            </p>
          </div>

          {/* Add New Rule Button */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                const newRule = {
                  id: `rule-${Date.now()}`,
                  name: 'Nueva Regla',
                  queueId: '',
                  keywords: [],
                  enabled: true,
                  schedule: {
                    days: [1, 2, 3, 4, 5, 6],
                    startTime: '09:00',
                    endTime: '18:00',
                  },
                };
                const currentRules = Array.isArray(config.transferRules) ? config.transferRules : [];
                setConfig({
                  ...config,
                  transferRules: [...currentRules, newRule],
                });
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
            >
              ➕ Agregar Regla de Transferencia
            </button>
          </div>

          {/* Transfer Rules */}
          {config.transferRules && Array.isArray(config.transferRules) && config.transferRules.map((rule, index) => (
            <div key={rule.id} className="bg-white p-6 rounded-lg border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{rule.name}</h2>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => {
                        const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                        updatedRules[index] = { ...rule, enabled: e.target.checked };
                        setConfig({ ...config, transferRules: updatedRules });
                      }}
                      className="w-5 h-5"
                    />
                    <span>Habilitado</span>
                  </label>
                  <button
                    onClick={() => {
                      if (confirm(`¿Eliminar la regla "${rule.name}"?`)) {
                        const currentRules = Array.isArray(config.transferRules) ? config.transferRules : [];
                        setConfig({
                          ...config,
                          transferRules: currentRules.filter((_, i) => i !== index),
                        });
                      }
                    }}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
                  >
                    🗑️ Eliminar
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nombre de la Regla</label>
                  <input
                    type="text"
                    value={rule.name}
                    onChange={(e) => {
                      const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                      updatedRules[index] = { ...rule, name: e.target.value };
                      setConfig({ ...config, transferRules: updatedRules });
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Ej: Ventas, Soporte, Prospectos..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Cola de Destino</label>
                  <select
                    value={rule.queueId}
                    onChange={(e) => {
                      const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                      updatedRules[index] = { ...rule, queueId: e.target.value };
                      setConfig({ ...config, transferRules: updatedRules });
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Seleccionar cola...</option>
                    {queues.map(queue => (
                      <option key={queue.id} value={queue.id}>
                        {queue.name}
                      </option>
                    ))}
                  </select>
                  {rule.queueId && (
                    <p className="text-xs text-gray-500 mt-1">ID: {rule.queueId}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Palabras Clave (separadas por coma)
                  </label>
                  <textarea
                    value={rule.keywords.join(', ')}
                    onChange={(e) => {
                      const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                      updatedRules[index] = {
                        ...rule,
                        keywords: e.target.value.split(',').map(k => k.trim()).filter(k => k),
                      };
                      setConfig({ ...config, transferRules: updatedRules });
                    }}
                    rows={2}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="pedido, comprar, precio, cotización..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Cuando el cliente mencione estas palabras, el agente considerará transferir a esta cola
                  </p>
                </div>

                {/* Schedule */}
                {rule.schedule && (
                  <div className="border-t pt-4">
                    <h3 className="font-medium mb-3">Horario de esta regla</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Hora Inicio</label>
                        <input
                          type="time"
                          value={rule.schedule.startTime}
                          onChange={(e) => {
                            const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                            updatedRules[index] = {
                              ...rule,
                              schedule: { ...rule.schedule!, startTime: e.target.value },
                            };
                            setConfig({ ...config, transferRules: updatedRules });
                          }}
                          className="w-full px-3 py-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Hora Fin</label>
                        <input
                          type="time"
                          value={rule.schedule.endTime}
                          onChange={(e) => {
                            const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                            updatedRules[index] = {
                              ...rule,
                              schedule: { ...rule.schedule!, endTime: e.target.value },
                            };
                            setConfig({ ...config, transferRules: updatedRules });
                          }}
                          className="w-full px-3 py-2 border rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-sm font-medium mb-2">Días activos</label>
                      <div className="flex gap-2">
                        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, dayIndex) => {
                          const dayNum = dayIndex + 1;
                          const isActive = rule.schedule!.days.includes(dayNum);
                          return (
                            <button
                              key={dayNum}
                              onClick={() => {
                                const updatedRules = Array.isArray(config.transferRules) ? [...config.transferRules] : [];
                                const currentDays = rule.schedule!.days;
                                const newDays = isActive
                                  ? currentDays.filter(d => d !== dayNum)
                                  : [...currentDays, dayNum].sort();
                                updatedRules[index] = {
                                  ...rule,
                                  schedule: { ...rule.schedule!, days: newDays },
                                };
                                setConfig({ ...config, transferRules: updatedRules });
                              }}
                              className={`w-10 h-10 rounded-full font-medium ${
                                isActive
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Lead Qualification */}
          <div className="bg-white p-6 rounded-lg border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Calificación de Leads</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.leadQualification.enabled}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      enabled: e.target.checked
                    }
                  })}
                  className="w-5 h-5"
                />
                <span>Habilitado</span>
              </label>
            </div>

            <p className="text-sm text-gray-600 mb-3">
              Cuando está habilitado, el agente recopilará información del cliente antes de transferir
            </p>

            <div className="space-y-2">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.leadQualification.questions.askName}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      questions: {
                        ...config.leadQualification.questions,
                        askName: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Preguntar nombre</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.leadQualification.questions.askLocation}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      questions: {
                        ...config.leadQualification.questions,
                        askLocation: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Preguntar ubicación</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.leadQualification.questions.askBusinessType}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      questions: {
                        ...config.leadQualification.questions,
                        askBusinessType: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Preguntar tipo de negocio</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.leadQualification.questions.askQuantity}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      questions: {
                        ...config.leadQualification.questions,
                        askQuantity: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Preguntar cantidad aproximada</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.leadQualification.questions.askBudget}
                  onChange={(e) => setConfig({
                    ...config,
                    leadQualification: {
                      ...config.leadQualification,
                      questions: {
                        ...config.leadQualification.questions,
                        askBudget: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Preguntar presupuesto</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Vision & OCR Tab */}
      {activeTab === 'vision' && (
        <div className="space-y-6">
          {/* Vision Settings */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              📸 GPT-4 Vision - Análisis de Imágenes
            </h2>

            <div className="mb-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>✓ ACTIVO:</strong> El agente puede ver y analizar imágenes de productos que le envíen los clientes.
              </p>
              <p className="text-sm text-blue-600 mt-2">
                • Modelo: <strong>gpt-4o</strong> con Vision<br/>
                • Describe productos (color, estilo, tipo)<br/>
                • Busca productos similares en el catálogo RAG<br/>
                • Sugiere alternativas con precios
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Estado de Vision
                </label>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                    ✓ Habilitado automáticamente con gpt-4o
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Vision está activo cuando el modelo es "gpt-4o". El agente puede ver imágenes en los mensajes.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Instrucciones personalizadas para Vision (opcional)
                </label>
                <textarea
                  value={config.visionAndOCR?.visionInstructions || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    visionAndOCR: {
                      ...config.visionAndOCR,
                      visionEnabled: true,
                      ocrEnabled: config.visionAndOCR?.ocrEnabled ?? true,
                      visionInstructions: e.target.value
                    }
                  })}
                  placeholder="Ej: Al analizar zapatos, siempre menciona el tipo de tacón, material y estilo..."
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Instrucciones adicionales que se agregarán al system prompt para análisis de imágenes.
                </p>
              </div>
            </div>
          </div>

          {/* OCR Settings */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              📄 Google Cloud Vision OCR - Extracción de Texto
            </h2>

            <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-900">
                <strong>⚙️ OCR:</strong> Extrae texto de documentos (DNI, RUC, vouchers, facturas, comprobantes).
              </p>
              <p className="text-sm text-amber-700 mt-2">
                • Requiere credenciales de Google Cloud Vision API<br/>
                • Configura las credenciales abajo para habilitar OCR<br/>
                • Sin credenciales, el agente mostrará un mensaje amigable
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Credenciales de Google Cloud (Service Account JSON)
                </label>
                <textarea
                  value={config.visionAndOCR?.googleCloudCredentials || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    visionAndOCR: {
                      ...config.visionAndOCR,
                      visionEnabled: config.visionAndOCR?.visionEnabled ?? true,
                      ocrEnabled: true,
                      googleCloudCredentials: e.target.value
                    }
                  })}
                  placeholder='{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}'
                  rows={8}
                  className="w-full px-3 py-2 border rounded-lg text-xs font-mono"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Pega aquí el contenido completo del archivo JSON de Service Account de Google Cloud.
                </p>
                <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>¿Cómo obtener las credenciales?</strong><br/>
                    1. Ve a <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a><br/>
                    2. Selecciona tu proyecto o crea uno nuevo<br/>
                    3. Habilita "Cloud Vision API"<br/>
                    4. Ve a "IAM & Admin" → "Service Accounts"<br/>
                    5. Crea una cuenta de servicio con rol "Cloud Vision API User"<br/>
                    6. Genera una clave JSON y pega el contenido aquí
                  </p>
                </div>
              </div>

              {config.visionAndOCR?.googleCloudCredentials && (
                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm text-green-800">
                    ✓ Credenciales configuradas. El OCR se activará al guardar la configuración.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Instrucciones personalizadas para OCR (opcional)
                </label>
                <textarea
                  value={config.visionAndOCR?.ocrInstructions || ''}
                  onChange={(e) => setConfig({
                    ...config,
                    visionAndOCR: {
                      ...config.visionAndOCR,
                      visionEnabled: config.visionAndOCR?.visionEnabled ?? true,
                      ocrEnabled: true,
                      ocrInstructions: e.target.value
                    }
                  })}
                  placeholder="Ej: Al extraer DNI, siempre verifica que tenga 8 dígitos..."
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Instrucciones adicionales para procesamiento de documentos OCR.
                </p>
              </div>
            </div>
          </div>

          {/* Examples */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">💡 Ejemplos de Uso</h2>

            <div className="space-y-4">
              <div className="p-4 bg-purple-50 rounded-lg">
                <p className="font-medium text-purple-900 mb-2">📸 Vision - Análisis de Productos</p>
                <p className="text-sm text-purple-800">
                  <strong>Cliente:</strong> [Envía foto de sandalia blanca]<br/>
                  <strong>Agente:</strong> "¡Qué linda sandalia! Veo que es tipo tacón alto en tono nude. Déjame buscar modelos similares en nuestro catálogo..." → Busca en RAG → Sugiere productos
                </p>
              </div>

              <div className="p-4 bg-indigo-50 rounded-lg">
                <p className="font-medium text-indigo-900 mb-2">📄 OCR - Voucher de Pago</p>
                <p className="text-sm text-indigo-800">
                  <strong>Cliente:</strong> [Envía captura de Yape]<br/>
                  <strong>Agente:</strong> Usa extract_text_ocr → Extrae número de operación, monto, fecha → "Perfecto! Veo que pagaste S/150.50 el 17/11/2025, operación #123456"
                </p>
              </div>

              <div className="p-4 bg-pink-50 rounded-lg">
                <p className="font-medium text-pink-900 mb-2">📄 OCR - DNI</p>
                <p className="text-sm text-pink-800">
                  <strong>Cliente:</strong> [Envía foto de DNI]<br/>
                  <strong>Agente:</strong> Usa extract_text_ocr → Extrae número DNI → "Perfecto, tengo tu DNI 12345678. Voy a completar tu pedido..."
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="space-y-6">
          {/* Conversation Memory */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Memoria de Conversación</h2>

            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.advancedSettings.conversationMemory.enabled}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      conversationMemory: {
                        ...config.advancedSettings.conversationMemory,
                        enabled: e.target.checked
                      }
                    }
                  })}
                  className="w-5 h-5"
                />
                <span>Habilitar memoria de conversación</span>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1">Máximo de mensajes en memoria</label>
                <input
                  type="number"
                  min="5"
                  max="50"
                  value={config.advancedSettings.conversationMemory.maxMessages}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      conversationMemory: {
                        ...config.advancedSettings.conversationMemory,
                        maxMessages: parseInt(e.target.value)
                      }
                    }
                  })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.advancedSettings.conversationMemory.saveToBitrix}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      conversationMemory: {
                        ...config.advancedSettings.conversationMemory,
                        saveToBitrix: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Guardar en Bitrix24</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.advancedSettings.conversationMemory.rememberPreviousConversations}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      conversationMemory: {
                        ...config.advancedSettings.conversationMemory,
                        rememberPreviousConversations: e.target.checked
                      }
                    }
                  })}
                  className="w-4 h-4"
                />
                <span>Recordar conversaciones previas</span>
              </label>
            </div>
          </div>

          {/* Message Grouping */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Agrupación de Mensajes</h2>

            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.advancedSettings.messageGrouping.enabled}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      messageGrouping: {
                        ...config.advancedSettings.messageGrouping,
                        enabled: e.target.checked
                      }
                    }
                  })}
                  className="w-5 h-5"
                />
                <span>Agrupar múltiples mensajes del cliente</span>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1">Timeout (segundos)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={config.advancedSettings.messageGrouping.timeoutSeconds}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      messageGrouping: {
                        ...config.advancedSettings.messageGrouping,
                        timeoutSeconds: parseFloat(e.target.value)
                      }
                    }
                  })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Espera este tiempo antes de procesar para agrupar mensajes rápidos
                </p>
              </div>
            </div>
          </div>

          {/* Sentiment Detection */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Detección de Sentimiento</h2>

            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.advancedSettings.sentimentDetection.enabled}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      sentimentDetection: {
                        ...config.advancedSettings.sentimentDetection,
                        enabled: e.target.checked
                      }
                    }
                  })}
                  className="w-5 h-5"
                />
                <span>Detectar frustración del cliente</span>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1">Acción cuando detecta frustración</label>
                <select
                  value={config.advancedSettings.sentimentDetection.onFrustratedAction}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      sentimentDetection: {
                        ...config.advancedSettings.sentimentDetection,
                        onFrustratedAction: e.target.value
                      }
                    }
                  })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="transfer_supervisor">Transferir a supervisor</option>
                  <option value="transfer_queue">Transferir a cola de soporte</option>
                  <option value="empathize">Mostrar empatía y continuar</option>
                </select>
              </div>
            </div>
          </div>

          {/* Fallback */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Respuestas de Fallback</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Máximo de interacciones antes de sugerir humano
                </label>
                <input
                  type="number"
                  min="3"
                  max="20"
                  value={config.advancedSettings.maxInteractionsBeforeSuggestHuman}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      maxInteractionsBeforeSuggestHuman: parseInt(e.target.value)
                    }
                  })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Respuesta de fallback</label>
                <textarea
                  value={config.advancedSettings.fallbackResponse}
                  onChange={(e) => setConfig({
                    ...config,
                    advancedSettings: {
                      ...config.advancedSettings,
                      fallbackResponse: e.target.value
                    }
                  })}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Cuando el agente no puede ayudar..."
                />
              </div>
            </div>
          </div>

          {/* Bitrix24 Integration */}
          <div className="bg-white p-6 rounded-lg border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Integración con Bitrix24</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.integrations.bitrix24.enabled}
                  onChange={(e) => setConfig({
                    ...config,
                    integrations: {
                      ...config.integrations,
                      bitrix24: {
                        ...config.integrations.bitrix24,
                        enabled: e.target.checked
                      }
                    }
                  })}
                  className="w-5 h-5"
                />
                <span>Habilitado</span>
              </label>
            </div>

            <div className="space-y-4">
              {/* Opciones generales */}
              <div className="space-y-2">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.integrations.bitrix24.autoCreateContact}
                    onChange={(e) => setConfig({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        bitrix24: {
                          ...config.integrations.bitrix24,
                          autoCreateContact: e.target.checked
                        }
                      }
                    })}
                    className="w-4 h-4"
                  />
                  <span>Crear contacto automáticamente</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.integrations.bitrix24.updateContactInfo}
                    onChange={(e) => setConfig({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        bitrix24: {
                          ...config.integrations.bitrix24,
                          updateContactInfo: e.target.checked
                        }
                      }
                    })}
                    className="w-4 h-4"
                  />
                  <span>Actualizar información del contacto</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.integrations.bitrix24.logInteractions}
                    onChange={(e) => setConfig({
                      ...config,
                      integrations: {
                        ...config.integrations,
                        bitrix24: {
                          ...config.integrations.bitrix24,
                          logInteractions: e.target.checked
                        }
                      }
                    })}
                    className="w-4 h-4"
                  />
                  <span>Registrar interacciones en timeline</span>
                </label>
              </div>

              {/* Campos CRM */}
              <div className="border-t pt-4">
                <h3 className="font-medium mb-3">Campos CRM a Guardar</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Selecciona qué información del cliente debe guardarse en Bitrix24
                </p>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2">
                  {/* Información Básica */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.name !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              name: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Nombre</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.phone !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              phone: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Teléfono</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.email !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              email: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Email</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.location !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              location: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Ubicación/Ciudad</span>
                  </label>

                  {/* Información de Negocio */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.businessType !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              businessType: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Tipo de Negocio</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.interest !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              interest: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Interés</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.company !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              company: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Empresa</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.position !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              position: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Cargo</span>
                  </label>

                  {/* Detalles Comerciales */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.estimatedQuantity !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              estimatedQuantity: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Cantidad Estimada</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.budget !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              budget: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Presupuesto</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.catalogsDownloaded !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              catalogsDownloaded: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Catálogos Descargados</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.source !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              source: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Fuente/Origen</span>
                  </label>

                  {/* Información Adicional para Prospectos */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.dni !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              dni: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">DNI</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.ruc !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              ruc: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">RUC</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.address !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              address: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Dirección</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.district !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              district: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Distrito</span>
                  </label>

                  {/* Estado y Seguimiento */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.status !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              status: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Estado</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.stage !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              stage: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Etapa</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.leadScore !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              leadScore: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Puntuación Lead</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.notes !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              notes: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Notas</span>
                  </label>

                  {/* Campos Personalizados */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.customField1 !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              customField1: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Campo Personalizado 1</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.customField2 !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              customField2: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Campo Personalizado 2</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={config.integrations.bitrix24.fieldsToSave?.customField3 !== false}
                      onChange={(e) => setConfig({
                        ...config,
                        integrations: {
                          ...config.integrations,
                          bitrix24: {
                            ...config.integrations.bitrix24,
                            fieldsToSave: {
                              ...config.integrations.bitrix24.fieldsToSave,
                              customField3: e.target.checked
                            }
                          }
                        }
                      })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Campo Personalizado 3</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <button
          onClick={loadConfig}
          disabled={saving}
          className="px-6 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          Descartar Cambios
        </button>
        <button
          onClick={saveConfig}
          disabled={saving}
          className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </div>
    </div>
  );
}
