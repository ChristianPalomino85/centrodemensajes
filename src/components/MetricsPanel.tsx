import React, { useEffect, useState, useMemo } from 'react';
import { API_BASE, apiUrl } from '../lib/apiBase';
import type { WhatsAppNumberAssignment, ChannelType } from '../flow/types';

interface MetricsStats {
  activeConversations: number;
  totalConversations: number;
  messagesPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  uptime: number;
}

interface ConversationMetric {
  sessionId: string;
  flowId: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  messagesReceived: number;
  messagesSent: number;
  nodesExecuted: number;
  webhooksCalled: number;
  errors: number;
  status: 'active' | 'ended' | 'error';
  channelType?: ChannelType;
  whatsappNumberId?: string;
}

interface MenuStat {
  nodeId: string;
  optionId: string;
  label: string;
  count: number;
}

interface MetricsPanelProps {
  whatsappNumbers?: WhatsAppNumberAssignment[];
}

type DateFilter = 'today' | 'week' | 'month' | 'all';

export function MetricsPanel({ whatsappNumbers = [] }: MetricsPanelProps) {
  const [stats, setStats] = useState<MetricsStats | null>(null);
  const [metrics, setMetrics] = useState<ConversationMetric[]>([]);
  const [activeConversations, setActiveConversations] = useState<ConversationMetric[]>([]);
  const [menuStats, setMenuStats] = useState<MenuStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [channelFilter, setChannelFilter] = useState<ChannelType | 'all'>('all');
  const [numberFilter, setNumberFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const fetchStats = async () => {
    try {
      // Use ?source=crm to get real CRM stats from database
      const response = await fetch(apiUrl('/api/stats?source=crm'));
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limit hit, will retry on next interval');
          return;
        }
        throw new Error('Failed to fetch stats');
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const fetchMetrics = async () => {
    try {
      // Use ?source=crm to get real CRM metrics from database
      const response = await fetch(apiUrl('/api/metrics?source=crm'));
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limit hit for metrics');
          return;
        }
        throw new Error('Failed to fetch metrics');
      }
      const data = await response.json();
      setMetrics(data.metrics || []);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    }
  };

  const fetchActiveConversations = async () => {
    try {
      // Use ?source=crm to get real CRM active conversations
      const response = await fetch(apiUrl('/api/conversations/active?source=crm'));
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limit hit for active conversations');
          return;
        }
        throw new Error('Failed to fetch active conversations');
      }
      const data = await response.json();
      setActiveConversations(data.conversations || []);
    } catch (err) {
      console.error('Error fetching active conversations:', err);
    }
  };

  const getDateRange = (): { startDate?: number; endDate?: number } => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    switch (dateFilter) {
      case 'today':
        return {
          startDate: now - oneDayMs,
          endDate: now,
        };
      case 'week':
        return {
          startDate: now - 7 * oneDayMs,
          endDate: now,
        };
      case 'month':
        return {
          startDate: now - 30 * oneDayMs,
          endDate: now,
        };
      case 'all':
      default:
        return {};
    }
  };

  const fetchMenuStats = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate.toString());
      if (endDate) params.set('endDate', endDate.toString());

      const url = `/api/metrics/menu-stats${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(apiUrl(url));
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limit hit for menu stats');
          return;
        }
        throw new Error('Failed to fetch menu stats');
      }
      const data = await response.json();
      setMenuStats(data.stats || []);
    } catch (err) {
      console.error('Error fetching menu stats:', err);
    }
  };

  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      // Fetch sequentially with small delays to avoid rate limiting
      await fetchStats();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchMetrics();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchActiveConversations();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchMenuStats();
      setLoading(false);
      setLastUpdate(new Date());
    };

    loadData();

    // Auto-refresh every 60 seconds (increased from 30) to reduce load
    const interval = setInterval(async () => {
      await fetchStats();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchMetrics();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchActiveConversations();
      await new Promise(resolve => setTimeout(resolve, 200));
      await fetchMenuStats();
      setLastUpdate(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, [dateFilter]);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  // Filter metrics based on selected channel and number
  const filteredMetrics = useMemo(() => {
    let filtered = metrics;

    if (channelFilter !== 'all') {
      filtered = filtered.filter((m) => m.channelType === channelFilter);
    }

    if (numberFilter !== 'all') {
      filtered = filtered.filter((m) => m.whatsappNumberId === numberFilter);
    }

    return filtered;
  }, [metrics, channelFilter, numberFilter]);

  // Calculate filtered stats
  const filteredStats = useMemo(() => {
    if (!stats) return null;

    const active = filteredMetrics.filter((m) => m.status === 'active').length;
    const total = filteredMetrics.length;

    return {
      ...stats,
      activeConversations: active,
      totalConversations: total,
    };
  }, [stats, filteredMetrics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-600">Cargando métricas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
          <div className="text-rose-800 font-semibold">Error al cargar métricas</div>
          <div className="text-rose-600 text-sm mt-1">{error}</div>
          <div className="text-slate-600 text-sm mt-2">
            Asegúrate de que el servidor esté disponible en{' '}
            <code className="bg-rose-100 px-1 rounded">{API_BASE}</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">📊 Métricas del Bot</h2>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            Actualización automática
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Filtrar por:</span>
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">Canal:</label>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as ChannelType | 'all')}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Todos los canales</option>
                <option value="whatsapp">📱 WhatsApp</option>
                <option value="facebook">💬 Facebook</option>
                <option value="instagram">📷 Instagram</option>
                <option value="telegram">✈️ Telegram</option>
              </select>
            </div>

            {/* Number Filter (only for WhatsApp) */}
            {channelFilter === 'whatsapp' && whatsappNumbers.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600">Número:</label>
                <select
                  value={numberFilter}
                  onChange={(e) => setNumberFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Todos los números</option>
                  {whatsappNumbers.map((number) => (
                    <option key={number.numberId} value={number.numberId}>
                      {number.displayName} ({number.phoneNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Reset Filter */}
            {(channelFilter !== 'all' || numberFilter !== 'all') && (
              <button
                onClick={() => {
                  setChannelFilter('all');
                  setNumberFilter('all');
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
              >
                Limpiar filtros
              </button>
            )}

            {/* Filter info */}
            {(channelFilter !== 'all' || numberFilter !== 'all') && (
              <div className="text-xs text-slate-500 italic">
                Mostrando métricas filtradas
              </div>
            )}

            {/* Live update indicator */}
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Actualización en tiempo real</span>
              <span className="text-slate-400">
                ({lastUpdate.toLocaleTimeString('es-ES')})
              </span>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        {filteredStats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
              <div className="text-slate-600 text-xs font-medium">Total Conversaciones</div>
              <div className="text-2xl font-bold text-blue-600 mt-1">{filteredStats.totalConversations}</div>
              <div className="text-slate-500 text-xs mt-0.5">Desde inicio</div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
              <div className="text-slate-600 text-xs font-medium">Mensajes/Minuto</div>
              <div className="text-2xl font-bold text-violet-600 mt-1">{filteredStats.messagesPerMinute}</div>
              <div className="text-slate-500 text-xs mt-0.5">Promedio actual</div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
              <div className="text-slate-600 text-xs font-medium">Tiempo de Respuesta</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">{Math.round(filteredStats.averageResponseTime)}ms</div>
              <div className="text-slate-500 text-xs mt-0.5">Promedio</div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
              <div className="text-slate-600 text-xs font-medium">Tasa de Error</div>
              <div className="text-2xl font-bold text-rose-600 mt-1">{(filteredStats.errorRate * 100).toFixed(2)}%</div>
              <div className="text-slate-500 text-xs mt-0.5">Últimos mensajes</div>
            </div>

            <div className="bg-white rounded-lg shadow p-3 border border-slate-200">
              <div className="text-slate-600 text-xs font-medium">Uptime</div>
              <div className="text-2xl font-bold text-cyan-600 mt-1">{formatUptime(filteredStats.uptime)}</div>
              <div className="text-slate-500 text-xs mt-0.5">Tiempo activo</div>
            </div>
          </div>
        )}

        {/* Menu Analytics */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-r from-violet-50 to-white p-3">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">📊 Análisis de Opciones de Menú</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Estadísticas de selecciones de menús y botones por los usuarios
                </p>
              </div>
            </div>
            {/* Date Filter for Menu Stats */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs font-medium text-slate-700">Período:</span>
              <button
                onClick={() => setDateFilter('today')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  dateFilter === 'today'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                Hoy
              </button>
              <button
                onClick={() => setDateFilter('week')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  dateFilter === 'week'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                Última Semana
              </button>
              <button
                onClick={() => setDateFilter('month')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  dateFilter === 'month'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                Último Mes
              </button>
              <button
                onClick={() => setDateFilter('all')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  dateFilter === 'all'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                Todo
              </button>
            </div>
          </div>
          <div className="p-4">
            {menuStats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-5xl mb-4">📋</div>
                <p className="text-slate-600 font-medium">No hay datos de menús aún</p>
                <p className="text-sm text-slate-500 mt-2">
                  Las estadísticas aparecerán cuando los usuarios interactúen con los menús del flujo
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {menuStats.slice(0, 20).map((stat, index) => {
                  const maxCount = Math.max(...menuStats.map(s => s.count));
                  const percentage = (stat.count / maxCount) * 100;
                  return (
                    <div key={`${stat.nodeId}-${stat.optionId}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{stat.label}</p>
                            <p className="text-xs text-slate-500">Node: {stat.nodeId.slice(0, 8)}...</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-violet-600">{stat.count}</p>
                          <p className="text-xs text-slate-500">clicks</p>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {menuStats.length > 20 && (
                  <p className="text-center text-sm text-slate-500 mt-4">
                    Mostrando top 20 de {menuStats.length} opciones
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
