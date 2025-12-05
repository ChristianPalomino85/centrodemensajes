import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';

interface TemplateUsageRecord {
  id: number;
  template_name: string;
  template_category: string;
  cost_usd: number;
  advisor_id: string;
  advisor_name: string;
  conversation_id: string;
  customer_phone: string;
  customer_name: string | null;
  sending_phone_number_id: string | null;
  sending_display_number: string | null;
  sent_at: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_total_sent: number | null;
  campaign_total_cost: number | null;
}

interface TemplateUsageStats {
  totalCount: number;
  totalCost: number;
  sentCount: number;
  failedCount: number;
  sentCost: number;
}

interface TemplateUsageResponse {
  records: TemplateUsageRecord[];
  stats: TemplateUsageStats;
}

interface RagUsageRecord {
  id: number;
  query: string;
  category: string;
  chunks_used: number;
  found: boolean;
  embedding_cost_usd: number;
  completion_cost_usd: number;
  total_cost_usd: number;
  advisor_id: string;
  advisor_name: string;
  conversation_id: string;
  customer_phone: string;
  customer_name: string | null;
  created_at: string;
}

interface RagUsageStats {
  totalCount: number;
  totalCost: number;
  totalEmbeddingCost: number;
  totalCompletionCost: number;
  totalChunksUsed: number;
  foundCount: number;
  notFoundCount: number;
  avgChunksUsed: number;
}

interface RagUsageResponse {
  records: RagUsageRecord[];
  stats: RagUsageStats;
}

interface CampaignCostItem {
  campaignId: string;
  campaignName: string;
  templateName?: string | null;
  totalMessages: number;
  sent: number;
  delivered: number;
  read: number;
  cost: number;
}

interface CampaignCostResponse {
  costPerMessage: number;
  totalCost: number;
  totalMessages: number;
  campaigns: CampaignCostItem[];
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULT_TEMPLATE_COST: Record<string, number> = {
  MARKETING: 0.0703,
  UTILITY: 0.02,
  AUTHENTICATION: 0.02,
};

// Chat message interface
interface ChatMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: string;
  text: string | null;
  createdAt: string;
  status?: string;
}

// Drawer state interface
interface DrawerState {
  isOpen: boolean;
  record: TemplateUsageRecord | RagUsageRecord | null;
  messages: ChatMessage[];
  loading: boolean;
  recordType: 'template' | 'rag';
}

export default function InvestmentControlPanel() {
  const [activeTab, setActiveTab] = useState<'templates' | 'rag'>('templates');
  const [data, setData] = useState<TemplateUsageResponse | null>(null);
  const [ragData, setRagData] = useState<RagUsageResponse | null>(null);
  const [campaignCosts, setCampaignCosts] = useState<CampaignCostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [costPerMessage] = useState<number>(0.02); // Default Perú no-MKT (sin selector)

  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAdvisor, setSelectedAdvisor] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const templateOptions = React.useMemo(() => {
    const set = new Set<string>();
    if (campaignCosts?.campaigns) {
      campaignCosts.campaigns.forEach((c) => {
        if (c.templateName) set.add(c.templateName);
      });
    }
    if (data?.records) {
      data.records.forEach((r) => {
        if (r.template_name) set.add(r.template_name);
      });
    }
    return Array.from(set).sort();
  }, [campaignCosts, data]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 50;

  // Chat Drawer state
  const [drawer, setDrawer] = useState<DrawerState>({
    isOpen: false,
    record: null,
    messages: [],
    loading: false,
    recordType: 'template',
  });

  useEffect(() => {
    if (activeTab === 'templates') {
      fetchTemplateUsage();
      fetchCampaignCosts();
    } else {
      fetchRagUsage();
    }
  }, [startDate, endDate, selectedAdvisor, selectedStatus, selectedTemplate, currentPage, activeTab, costPerMessage]);

  const fetchTemplateUsage = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      if (selectedAdvisor) params.append('advisorId', selectedAdvisor);
      if (selectedStatus) params.append('status', selectedStatus);
      if (selectedTemplate) params.append('templateName', selectedTemplate);

      params.append('limit', recordsPerPage.toString());
      params.append('offset', ((currentPage - 1) * recordsPerPage).toString());

      const response = await fetch(apiUrl(`/api/crm/metrics/template-usage?${params.toString()}`), {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Error al cargar datos de inversión');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error('Error fetching template usage:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaignCosts = async () => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', new Date(startDate).getTime().toString());
      if (endDate) params.append('endDate', new Date(endDate).getTime().toString());
      if (selectedTemplate) params.append('templateName', selectedTemplate);
      const response = await fetch(apiUrl(`/api/crm/metrics/campaign-costs?${params.toString()}`), {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Error al calcular costos de campañas');
      }
      const result = await response.json();
      setCampaignCosts(result);
    } catch (err) {
      console.error('Error fetching campaign costs:', err);
      setCampaignCosts(null);
    }
  };

  const fetchRagUsage = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());
      if (selectedAdvisor) params.append('advisorId', selectedAdvisor);

      params.append('limit', recordsPerPage.toString());
      params.append('offset', ((currentPage - 1) * recordsPerPage).toString());

      const response = await fetch(apiUrl(`/api/crm/metrics/rag-usage?${params.toString()}`), {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Error al cargar datos de RAG');
      }

      const result = await response.json();
      setRagData(result);
    } catch (err) {
      console.error('Error fetching RAG usage:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  // Open drawer with conversation messages
  const openChatDrawer = async (record: TemplateUsageRecord | RagUsageRecord, type: 'template' | 'rag') => {
    const conversationId = record.conversation_id;
    if (!conversationId) return;

    setDrawer({
      isOpen: true,
      record,
      messages: [],
      loading: true,
      recordType: type,
    });

    try {
      const response = await fetch(apiUrl(`/api/crm/conversations/${conversationId}/messages`), {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setDrawer(prev => ({
          ...prev,
          messages: data.messages || [],
          loading: false,
        }));
      } else {
        setDrawer(prev => ({
          ...prev,
          messages: [],
          loading: false,
        }));
      }
    } catch (error) {
      console.error('Error loading chat messages:', error);
      setDrawer(prev => ({
        ...prev,
        messages: [],
        loading: false,
      }));
    }
  };

  const closeDrawer = () => {
    setDrawer({
      isOpen: false,
      record: null,
      messages: [],
      loading: false,
      recordType: 'template',
    });
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedAdvisor('');
    setSelectedStatus('');
    setCurrentPage(1);
  };

  const formatDate = (dateStr: string | number) => {
    let date: Date;
    if (typeof dateStr === 'number') {
      date = new Date(dateStr);
    } else {
      const cleanStr = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
      date = new Date(cleanStr);
    }

    return new Intl.DateTimeFormat('es-PE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Lima'
    }).format(date);
  };

  const formatTime = (dateStr: string | number) => {
    let date: Date;
    if (typeof dateStr === 'number') {
      date = new Date(dateStr);
    } else {
      const cleanStr = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
      date = new Date(cleanStr);
    }

    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Lima'
    }).format(date);
  };

  const formatCurrency = (amount: number) => {
    const safe = Number.isFinite(amount) ? amount : 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(safe);
  };

  const formatPhoneNumber = (phone: string) => {
    if (!phone) return 'N/A';
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    const digits = cleaned.replace('+', '');

    if (cleaned.startsWith('+51') && digits.length === 11) {
      return `+51 ${digits.substring(2, 5)} ${digits.substring(5, 8)} ${digits.substring(8)}`;
    }
    if (digits.length === 10 && digits.startsWith('51')) {
      return `+51 ${digits.substring(2, 5)} ${digits.substring(5, 8)} ${digits.substring(8)}`;
    }
    if (digits.length === 9) {
      return `+51 ${digits.substring(0, 3)} ${digits.substring(3, 6)} ${digits.substring(6)}`;
    }
    return cleaned;
  };

  const getCategoryBadge = (category: string) => {
    const colors = {
      MARKETING: 'bg-purple-100 text-purple-700 border-purple-300',
      UTILITY: 'bg-blue-100 text-blue-700 border-blue-300',
      AUTHENTICATION: 'bg-green-100 text-green-700 border-green-300'
    };
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getStatusBadge = (status: string) => {
    return status === 'sent'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
      : 'bg-red-100 text-red-700 border-red-300';
  };

  const uniqueAdvisors = React.useMemo(() => {
    if (!data) return [];
    const advisors = new Set(data.records.map(r => JSON.stringify({ id: r.advisor_id, name: r.advisor_name })));
    return Array.from(advisors).map(a => JSON.parse(a));
  }, [data]);

  const totalPages = activeTab === 'templates'
    ? (data ? Math.ceil(data.stats.totalCount / recordsPerPage) : 1)
    : (ragData ? Math.ceil(ragData.stats.totalCount / recordsPerPage) : 1);

  const totalCount = activeTab === 'templates'
    ? (data ? data.stats.totalCount : 0)
    : (ragData ? ragData.stats.totalCount : 0);

  // === Aggregates ===
  const campaignSummary = React.useMemo(() => {
    if (campaignCosts && campaignCosts.campaigns) {
      const campaigns = campaignCosts.campaigns.map((c) => ({
        id: c.campaignId || 'N/A',
        name: c.campaignName || c.campaignId || 'Sin nombre',
        cost: toNumber(c.cost, 0),
        sent: c.totalMessages,
      })).sort((a, b) => b.cost - a.cost);
      return {
        totalCost: toNumber(campaignCosts.totalCost, 0),
        campaigns,
      };
    }

    if (!data) return { totalCost: 0, campaigns: [] as Array<{ id: string; name: string; cost: number; sent: number }> };
    const map = new Map<string, { id: string; name: string; cost: number; sent: number }>();

    for (const rec of data.records) {
      if (!rec.campaign_id) continue;
      const entry = map.get(rec.campaign_id) ?? {
        id: rec.campaign_id,
        name: rec.campaign_name || rec.campaign_id,
        cost: 0,
        sent: 0,
      };
      const fallbackCost = toNumber(rec.cost_usd, DEFAULT_TEMPLATE_COST[rec.template_category] ?? 0);
      entry.cost += fallbackCost;
      entry.sent += 1;
      map.set(rec.campaign_id, entry);
    }

    const campaigns = Array.from(map.values()).sort((a, b) => b.cost - a.cost);
    const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);

    // Fallback: si no hay campañas mapeadas, mostrar estimado global
    if (campaigns.length === 0) {
      const fallbackCost = data.records.reduce((sum, rec) => {
        const cost = toNumber(rec.cost_usd, DEFAULT_TEMPLATE_COST[rec.template_category] ?? 0);
        return sum + cost;
      }, 0);
      return {
        totalCost: fallbackCost,
        campaigns: [],
      };
    }

    return { totalCost, campaigns };
  }, [data]);

  const aiCostSummary = React.useMemo(() => {
    const ragCost = toNumber(ragData?.stats?.totalCost, 0);
    // Si a futuro se agregan más fuentes de IA (ej. agente IA), sumar aquí.
    return { ragCost, totalCost: ragCost };
  }, [ragData]);

  const campaignMonthSummary = React.useMemo(() => {
    if (campaignCosts) {
      return {
        totalCost: toNumber(campaignCosts.totalCost, 0),
        sent: campaignCosts.totalMessages,
      };
    }
    if (!data) return { totalCost: 0, sent: 0 };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

    let totalCost = 0;
    let sent = 0;

    for (const rec of data.records) {
      const sentAt = new Date(rec.sent_at).getTime();
      if (sentAt >= monthStart && sentAt < monthEnd) {
        const fallbackCost = toNumber(rec.cost_usd, DEFAULT_TEMPLATE_COST[rec.template_category] ?? 0);
        totalCost += fallbackCost;
        sent += 1;
      }
    }

    return { totalCost, sent };
  }, [data]);

  // Check if a message is the template message
  const isTemplateMessage = (message: ChatMessage, record: TemplateUsageRecord) => {
    if (!message.text) return false;
    // Template messages are typically outgoing and contain template content
    // We can also check by timestamp proximity
    const msgTime = new Date(message.createdAt).getTime();
    const sentTime = new Date(record.sent_at).getTime();
    const timeDiff = Math.abs(msgTime - sentTime);
    // Within 5 minutes and outgoing
    return message.direction === 'outgoing' && timeDiff < 5 * 60 * 1000;
  };

  // Parse and format message text (handle template JSON)
  const formatMessageText = (text: string | null): { content: string; isTemplate: boolean; templateName?: string; footer?: string } => {
    if (!text) return { content: '[Mensaje sin texto]', isTemplate: false };

    // Try to detect if it's a template JSON
    if (text.startsWith('{') && text.includes('templateName') && text.includes('components')) {
      try {
        const templateData = JSON.parse(text);
        if (templateData.templateName && templateData.components) {
          // Extract BODY content
          const bodyComponent = templateData.components.find((c: any) => c.type === 'BODY');
          const footerComponent = templateData.components.find((c: any) => c.type === 'FOOTER');
          const headerComponent = templateData.components.find((c: any) => c.type === 'HEADER');

          let content = '';

          // Add header if exists
          if (headerComponent?.text) {
            content += headerComponent.text + '\n\n';
          }

          // Add body
          if (bodyComponent?.text) {
            content += bodyComponent.text;
          }

          return {
            content: content || text,
            isTemplate: true,
            templateName: templateData.templateName,
            footer: footerComponent?.text,
          };
        }
      } catch (e) {
        // Not valid JSON, return as-is
      }
    }

    return { content: text, isTemplate: false };
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-50 relative">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm px-8 py-5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-2 shadow-md">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent whitespace-nowrap">
                Control de Inversion
              </h1>
            </div>
          </div>

          <div className="flex items-end gap-2 flex-1">
            <div className="w-32">
              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Inicio</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div className="w-32">
              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Fin</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div className="w-40">
              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Asesor</label>
              <select
                value={selectedAdvisor}
                onChange={(e) => { setSelectedAdvisor(e.target.value); setCurrentPage(1); }}
                className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">Todos</option>
                {uniqueAdvisors.map(advisor => (
                  <option key={advisor.id} value={advisor.id}>{advisor.name}</option>
                ))}
              </select>
            </div>
            {activeTab === 'templates' && (
              <div className="w-28">
                <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Estado</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                  className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Todos</option>
                  <option value="sent">Enviadas</option>
                  <option value="failed">Fallidas</option>
                </select>
              </div>
            )}
            {activeTab === 'templates' && (
              <div className="w-48">
                <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Plantilla</label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => {
                    setSelectedTemplate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">Todas</option>
                  {templateOptions.map((tpl) => (
                    <option key={tpl} value={tpl}>{tpl}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={handleResetFilters}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded transition-colors border border-slate-300"
            >
              Limpiar
            </button>
          </div>

          {activeTab === 'templates' && data && (
            <div className="flex gap-2 flex-shrink-0">
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg px-3 py-2 border border-emerald-200">
                <div className="text-[10px] font-semibold text-emerald-700 uppercase">Enviadas</div>
                <div className="text-lg font-bold text-emerald-900">{data.stats.sentCount}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg px-3 py-2 border border-purple-200">
                <div className="text-[10px] font-semibold text-purple-700 uppercase">Inversion</div>
                <div className="text-lg font-bold text-purple-900">{formatCurrency(data.stats.sentCost)}</div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg px-3 py-2 border border-blue-200">
                <div className="text-[10px] font-semibold text-blue-700 uppercase">Campañas (costo)</div>
                <div className="text-lg font-bold text-blue-900">{formatCurrency(campaignSummary.totalCost)}</div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg px-3 py-2 border border-red-200">
                <div className="text-[10px] font-semibold text-red-700 uppercase">Fallidas</div>
                <div className="text-lg font-bold text-red-900">{data.stats.failedCount}</div>
              </div>
            </div>
          )}
          {activeTab === 'rag' && ragData && (
            <div className="flex gap-2 flex-shrink-0">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg px-3 py-2 border border-blue-200">
                <div className="text-[10px] font-semibold text-blue-700 uppercase">Busquedas</div>
                <div className="text-lg font-bold text-blue-900">{ragData.stats.totalCount}</div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg px-3 py-2 border border-emerald-200">
                <div className="text-[10px] font-semibold text-emerald-700 uppercase">Encontradas</div>
                <div className="text-lg font-bold text-emerald-900">{ragData.stats.foundCount}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg px-3 py-2 border border-purple-200">
                <div className="text-[10px] font-semibold text-purple-700 uppercase">Costo IA (RAG)</div>
                <div className="text-lg font-bold text-purple-900">{formatCurrency(aiCostSummary.totalCost)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-8">
        <div className="flex gap-2">
          <button
            onClick={() => { setActiveTab('templates'); setCurrentPage(1); }}
            className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${
              activeTab === 'templates'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Plantillas WhatsApp
          </button>
          <button
            onClick={() => { setActiveTab('rag'); setCurrentPage(1); }}
            className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${
              activeTab === 'rag'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            RAG / Inteligencia Artificial
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <div className="text-red-700 font-semibold mb-2">Error al cargar datos</div>
            <div className="text-red-600 text-sm">{error}</div>
          </div>
        ) : activeTab === 'templates' && data && data.records.length > 0 ? (
          <>
            {/* Resumen de campañas masivas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Costo campañas masivas</div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(campaignSummary.totalCost)}</div>
                <div className="text-xs text-slate-500 mt-1">Costeo estimado (Perú: MKT 0.0703, otros 0.02)</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Top campañas por gasto</div>
                <div className="mt-2 space-y-2">
                  {campaignSummary.campaigns.slice(0, 3).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-blue-600">📢</span>
                        <span className="font-semibold text-slate-800">{c.name}</span>
                      </div>
                      <div className="text-slate-700 font-semibold">{formatCurrency(c.cost)}</div>
                    </div>
                  ))}
                  {campaignSummary.campaigns.length === 0 && (
                    <div className="text-xs text-slate-500">Sin campañas en el rango</div>
                  )}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">Gasto total (plantillas)</div>
                <div className="text-2xl font-bold text-purple-900 mt-1">{formatCurrency(data.stats.sentCost)}</div>
                <div className="text-xs text-slate-500 mt-1">Incluye campañas y envíos individuales</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase">Campañas este mes (estimado)</div>
                    <div className="text-xs text-slate-500 mt-1">Calculado por tipo de plantilla si falta costo</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-600">Envíos: <span className="font-semibold text-slate-900">{campaignMonthSummary.sent}</span></div>
                    <div className="text-xl font-bold text-slate-900">{formatCurrency(campaignMonthSummary.totalCost)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Asesor</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Plantilla</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Tipo</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Numero Envio</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Campaña</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Costo</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Fecha</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Chat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.records.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-slate-900">{record.advisor_name}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-900 font-medium">{record.template_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getCategoryBadge(record.template_category)}`}>
                            {record.template_category}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-900">{record.customer_name || record.customer_phone}</div>
                          {record.customer_name && (
                            <div className="text-xs text-slate-500">{record.customer_phone}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.sending_display_number ? (
                            <div className="text-sm font-medium text-emerald-700">
                              {formatPhoneNumber(record.sending_display_number)}
                            </div>
                          ) : record.sending_phone_number_id ? (
                            <div className="text-xs text-slate-500 italic">
                              ID: {record.sending_phone_number_id}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 italic">Sin numero</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {record.campaign_id ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-blue-600 text-lg">📢</span>
                                <div className="text-sm font-semibold text-blue-700">{record.campaign_name}</div>
                              </div>
                              <div className="text-xs text-slate-600">
                                {record.campaign_total_sent} enviados - {formatCurrency(record.campaign_total_cost || 0)} total
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 italic">Manual</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-purple-700">{formatCurrency(record.cost_usd)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(record.status)}`}>
                            {record.status === 'sent' ? 'Enviada' : 'Fallida'}
                          </span>
                          {record.error_message && (
                            <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={record.error_message}>
                              {record.error_message}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                          {formatDate(record.sent_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => openChatDrawer(record, 'template')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 font-medium text-sm rounded-lg transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            Ver Chat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-4">
                <div className="text-sm text-slate-600">
                  Pagina {currentPage} de {totalPages} ({totalCount} registros totales)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        ) : activeTab === 'rag' && ragData && ragData.records.length > 0 ? (
          <>
            <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Consulta</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Categoria</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Resultados</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Chunks</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Costo Embedding</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Costo LLM</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Costo Total</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Fecha</th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Chat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {ragData.records.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-900 font-medium max-w-xs truncate" title={record.query}>
                            {record.query}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-900">{record.customer_name || record.customer_phone}</div>
                          {record.customer_name && (
                            <div className="text-xs text-slate-500">{record.customer_phone}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border bg-blue-100 text-blue-700 border-blue-300">
                            {record.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
                            record.found
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                              : 'bg-amber-100 text-amber-700 border-amber-300'
                          }`}>
                            {record.found ? 'Encontrado' : 'No encontrado'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="text-sm font-medium text-slate-700">{record.chunks_used}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-blue-700">{formatCurrency(record.embedding_cost_usd)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-indigo-700">{formatCurrency(record.completion_cost_usd)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-purple-700">{formatCurrency(record.total_cost_usd)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                          {formatDate(record.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.conversation_id ? (
                            <button
                              onClick={() => openChatDrawer(record, 'rag')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 font-medium text-sm rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Ver Chat
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-4">
                <div className="text-sm text-slate-600">
                  Pagina {currentPage} de {totalPages} ({totalCount} registros totales)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl p-12 text-center">
            <div className="text-slate-400 text-6xl mb-4">📊</div>
            <div className="text-slate-600 font-semibold text-lg mb-2">No hay datos disponibles</div>
            <div className="text-slate-500 text-sm">Aun no se han registrado plantillas enviadas o prueba ajustando los filtros</div>
          </div>
        )}
      </div>

      {/* Chat Drawer - Slides from right */}
      <div
        className={`fixed inset-y-0 right-0 w-[500px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${
          drawer.isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {drawer.isOpen && (
          <div className="h-full flex flex-col">
            {/* Drawer Header */}
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-6 py-4 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Historial del Chat</h2>
                  {drawer.record && (
                    <p className="text-purple-200 text-sm mt-1">
                      {drawer.recordType === 'template'
                        ? `Plantilla: ${(drawer.record as TemplateUsageRecord).template_name}`
                        : `Consulta RAG: ${(drawer.record as RagUsageRecord).query.substring(0, 50)}...`
                      }
                    </p>
                  )}
                </div>
                <button
                  onClick={closeDrawer}
                  className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Template/Record Info Card */}
            {drawer.record && drawer.recordType === 'template' && (
              <div className="bg-purple-50 border-b border-purple-200 px-6 py-4 flex-shrink-0">
                <div className="flex items-start gap-4">
                  <div className="bg-purple-600 text-white rounded-lg p-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-purple-900">
                      {(drawer.record as TemplateUsageRecord).template_name}
                    </h3>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                      <div>
                        <span className="text-purple-600">Categoria:</span>
                        <span className="ml-1 text-purple-900">{(drawer.record as TemplateUsageRecord).template_category}</span>
                      </div>
                      <div>
                        <span className="text-purple-600">Costo:</span>
                        <span className="ml-1 text-purple-900 font-medium">{formatCurrency((drawer.record as TemplateUsageRecord).cost_usd)}</span>
                      </div>
                      <div>
                        <span className="text-purple-600">Cliente:</span>
                        <span className="ml-1 text-purple-900">{(drawer.record as TemplateUsageRecord).customer_name || (drawer.record as TemplateUsageRecord).customer_phone}</span>
                      </div>
                      <div>
                        <span className="text-purple-600">Enviado:</span>
                        <span className="ml-1 text-purple-900">{formatDate((drawer.record as TemplateUsageRecord).sent_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {drawer.record && drawer.recordType === 'rag' && (
              <div className="bg-blue-50 border-b border-blue-200 px-6 py-4 flex-shrink-0">
                <div className="flex items-start gap-4">
                  <div className="bg-blue-600 text-white rounded-lg p-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-blue-900">Busqueda RAG</h3>
                    <p className="text-sm text-blue-800 mt-1">{(drawer.record as RagUsageRecord).query}</p>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                      <div>
                        <span className="text-blue-600">Categoria:</span>
                        <span className="ml-1 text-blue-900">{(drawer.record as RagUsageRecord).category}</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Costo:</span>
                        <span className="ml-1 text-blue-900 font-medium">{formatCurrency((drawer.record as RagUsageRecord).total_cost_usd)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-100">
              {drawer.loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600 mx-auto mb-3"></div>
                    <p className="text-slate-600 text-sm">Cargando mensajes...</p>
                  </div>
                </div>
              ) : drawer.messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-slate-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>No se encontraron mensajes</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {drawer.messages.map((message, index) => {
                    const isIncoming = message.direction === 'incoming';
                    const isSystem = message.type === 'system' || message.type === 'event';
                    const isHighlighted = drawer.recordType === 'template' &&
                      drawer.record &&
                      isTemplateMessage(message, drawer.record as TemplateUsageRecord);

                    if (isSystem) {
                      return (
                        <div key={message.id || index} className="flex justify-center">
                          <div className="bg-slate-200 text-slate-600 text-xs px-3 py-1.5 rounded-full max-w-[80%] text-center">
                            {message.text}
                          </div>
                        </div>
                      );
                    }

                    // Format the message text (parse template JSON if needed)
                    const formattedMsg = formatMessageText(message.text);
                    const showAsTemplate = isHighlighted || formattedMsg.isTemplate;

                    return (
                      <div
                        key={message.id || index}
                        className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${
                            showAsTemplate
                              ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white ring-2 ring-purple-300 ring-offset-2'
                              : isIncoming
                              ? 'bg-white text-slate-900'
                              : 'bg-emerald-500 text-white'
                          }`}
                        >
                          {showAsTemplate && (
                            <div className="flex items-center gap-1.5 text-purple-200 text-xs mb-1.5">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              Plantilla: {formattedMsg.templateName || (drawer.record as TemplateUsageRecord)?.template_name || 'enviada'}
                            </div>
                          )}
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {formattedMsg.content}
                          </p>
                          {/* Show footer if it's a template */}
                          {formattedMsg.footer && (
                            <p className="text-xs mt-2 pt-2 border-t border-purple-400 border-opacity-30 text-purple-200 italic">
                              {formattedMsg.footer}
                            </p>
                          )}
                          <div className={`text-[10px] mt-1.5 flex items-center gap-1 ${
                            showAsTemplate
                              ? 'text-purple-200'
                              : isIncoming
                              ? 'text-slate-400'
                              : 'text-emerald-100'
                          }`}>
                            {formatTime(message.createdAt)}
                            {!isIncoming && message.status && (
                              <span className="ml-1">
                                {message.status === 'sent' && '✓'}
                                {message.status === 'delivered' && '✓✓'}
                                {message.status === 'read' && '✓✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="border-t border-slate-200 px-6 py-4 bg-white flex-shrink-0">
              <button
                onClick={closeDrawer}
                className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold py-3 rounded-lg hover:from-purple-700 hover:to-purple-800 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Overlay when drawer is open */}
      {drawer.isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-30 z-40"
          onClick={closeDrawer}
        />
      )}
    </div>
  );
}
