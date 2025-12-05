/**
 * Sales-WhatsApp Conversions Panel
 * Enhanced with Looker Studio-style filters, campaign tracking, sorting and pagination
 */

import { useEffect, useState, useCallback } from 'react';
import { apiUrl } from '../lib/apiBase';

// Types
interface ConversionStats {
  totalSales: number;
  withWhatsApp: number;
  withoutWhatsApp: number;
  conversionRate: string;
  totalAmount: number;
  amountWithWhatsApp: number;
  avgDaysToConversion: string | null;
  lastSync: string | null;
}

interface WhatsAppNumberStats {
  whatsappNumberId: string;
  whatsappDisplayName: string;
  totalSales: number;
  totalAmount: number;
  avgDaysToConversion: string | null;
}

interface SellerStats {
  sellerName: string;
  totalSales: number;
  withWhatsApp: number;
  conversionRate: string;
  totalAmount: number;
  amountWithWhatsApp: number;
  avgDaysToConversion: string | null;
}

interface AreaStats {
  area: string;
  totalSales: number;
  withWhatsApp: number;
  conversionRate: string;
  totalAmount: number;
  amountWithWhatsApp: number;
}

interface CampaignStats {
  campaignId: string;
  campaignName: string;
  templateName: string;
  startedAt: string;
  totalRecipients: number;
  delivered: number;
  read: number;
  responded: number;
  converted: number;
  conversionRate: string;
  totalRevenue: number;
}

interface RecentConversion {
  customerPhone: string;
  customerName: string;
  saleDate: string;
  saleAmount: number;
  area: string;
  sellerName: string;
  firstWhatsAppContact: string | null;
  whatsappDisplayName: string | null;
  daysToConversion: number | null;
  contactedViaWhatsApp: boolean;
  campaignName: string | null;
  sourceType: 'campaign' | 'chat' | 'direct';
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface FilterOptions {
  sellers: string[];
  areas: string[];
  dateRange: {
    minDate: string;
    maxDate: string;
    totalRecords: number;
  };
  campaignDateRange: {
    minDate: string;
    maxDate: string;
    totalCampaigns: number;
  };
}

interface WhatsAppNumber {
  numberId: string;
  phoneNumber: string;
  displayName: string;
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  seller: string;
  area: string;
  whatsappNumberId: string;
}

type SortColumn = 'sale_date' | 'sale_amount' | 'customer_name' | 'seller_name' | 'area' | 'days_to_conversion';
type SortOrder = 'asc' | 'desc';

// Campaign detail types
interface CampaignDetailConversion {
  phone: string;
  customerName: string;
  saleDate: string;
  saleAmount: number;
  area: string;
  sellerName: string;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

interface CampaignDetailNotConverted {
  phone: string;
  messageStatus: string;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  responded: boolean;
}

interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    templateName: string;
    startedAt: string;
  };
  summary: {
    totalRecipients: number;
    totalConverted: number;
    totalRevenue: number;
    conversionRate: string;
  };
  converted: CampaignDetailConversion[];
  notConverted: CampaignDetailNotConverted[];
  notConvertedTotal: number;
}

// Date preset helpers
const getDatePreset = (preset: string): { from: string; to: string } => {
  const today = new Date();
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { from: formatDate(today), to: formatDate(today) };
    case 'last7':
      const last7 = new Date(today);
      last7.setDate(last7.getDate() - 7);
      return { from: formatDate(last7), to: formatDate(today) };
    case 'last30':
      const last30 = new Date(today);
      last30.setDate(last30.getDate() - 30);
      return { from: formatDate(last30), to: formatDate(today) };
    case 'thisMonth':
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: formatDate(firstDay), to: formatDate(today) };
    case 'lastMonth':
      const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: formatDate(lastMonthStart), to: formatDate(lastMonthEnd) };
    default:
      return { from: '', to: '' };
  }
};

export function SalesConversionsPanel() {
  // State
  const [stats, setStats] = useState<ConversionStats | null>(null);
  const [numberStats, setNumberStats] = useState<WhatsAppNumberStats[]>([]);
  const [sellerStats, setSellerStats] = useState<SellerStats[]>([]);
  const [areaStats, setAreaStats] = useState<AreaStats[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStats[]>([]);
  const [recentConversions, setRecentConversions] = useState<RecentConversion[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [whatsappNumbers, setWhatsappNumbers] = useState<WhatsAppNumber[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  // Filters
  const [filters, setFilters] = useState<Filters>({
    dateFrom: '',
    dateTo: '',
    seller: 'all',
    area: 'all',
    whatsappNumberId: 'all',
  });
  const [datePreset, setDatePreset] = useState('all');

  // Sorting
  const [sortBy, setSortBy] = useState<SortColumn>('sale_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // UI State
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns'>('overview');

  // Campaign detail modal
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [loadingCampaignDetail, setLoadingCampaignDetail] = useState(false);
  const [campaignDetailTab, setCampaignDetailTab] = useState<'converted' | 'all'>('converted');

  // Build query params from filters
  const buildQueryParams = useCallback((extraParams: Record<string, string | number> = {}) => {
    const params = new URLSearchParams();
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (filters.seller !== 'all') params.append('seller', filters.seller);
    if (filters.area !== 'all') params.append('area', filters.area);
    if (filters.whatsappNumberId !== 'all') params.append('whatsappNumberId', filters.whatsappNumberId);
    Object.entries(extraParams).forEach(([key, value]) => params.append(key, String(value)));
    return params.toString() ? `?${params.toString()}` : '';
  }, [filters]);

  // Load filter options
  const loadFilterOptions = async () => {
    try {
      const response = await fetch(apiUrl('/api/crm/sales-conversions/filters'), {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setFilterOptions(data);
      }
    } catch (error) {
      console.error('[SalesConversions] Error loading filter options:', error);
    }
  };

  // Load WhatsApp numbers
  const loadWhatsAppNumbers = async () => {
    try {
      const response = await fetch(apiUrl('/api/admin/whatsapp-numbers'), {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        if (data.numbers && Array.isArray(data.numbers)) {
          setWhatsappNumbers(data.numbers.map((n: any) => ({
            numberId: n.numberId,
            displayName: n.displayName,
            phoneNumber: n.phoneNumber,
          })));
        }
      }
    } catch (error) {
      console.error('[SalesConversions] Error loading WhatsApp numbers:', error);
    }
  };

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = buildQueryParams();

      // Load stats, by-whatsapp-number, by-seller, by-area in parallel
      const [statsRes, numberRes, sellerRes, areaRes, campaignsRes] = await Promise.all([
        fetch(apiUrl(`/api/crm/sales-conversions/stats${queryParams}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/crm/sales-conversions/by-whatsapp-number${queryParams}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/crm/sales-conversions/by-seller${queryParams}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/crm/sales-conversions/by-area${queryParams}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/crm/sales-conversions/campaigns${queryParams}`), { credentials: 'include' }),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (numberRes.ok) setNumberStats((await numberRes.json()).data);
      if (sellerRes.ok) setSellerStats((await sellerRes.json()).data);
      if (areaRes.ok) setAreaStats((await areaRes.json()).data);
      if (campaignsRes.ok) setCampaignStats((await campaignsRes.json()).data);

      // Load recent with pagination
      await loadRecentConversions(1);

    } catch (error) {
      console.error('[SalesConversions] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams]);

  // Load recent conversions with pagination
  const loadRecentConversions = async (page: number) => {
    try {
      const queryParams = buildQueryParams({
        page,
        limit: pagination.limit,
        sortBy,
        sortOrder,
      });

      const response = await fetch(apiUrl(`/api/crm/sales-conversions/recent${queryParams}`), {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setRecentConversions(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('[SalesConversions] Error loading recent conversions:', error);
    }
  };

  // Handle sort change
  const handleSort = (column: SortColumn) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  // Handle date preset change
  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setFilters(f => ({ ...f, dateFrom: '', dateTo: '' }));
    } else if (preset !== 'custom') {
      const { from, to } = getDatePreset(preset);
      setFilters(f => ({ ...f, dateFrom: from, dateTo: to }));
    }
  };

  // Force sync
  const forceSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await fetch(apiUrl('/api/crm/sales-conversions/sync'), {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('[SalesConversions] Error during sync:', error);
    } finally {
      setSyncing(false);
    }
  };

  // Load campaign details
  const loadCampaignDetails = async (campaignId: string) => {
    setLoadingCampaignDetail(true);
    setCampaignDetailTab('converted');
    try {
      const response = await fetch(apiUrl(`/api/crm/sales-conversions/campaigns/${campaignId}/details`), {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSelectedCampaign(data);
      }
    } catch (error) {
      console.error('[SalesConversions] Error loading campaign details:', error);
    } finally {
      setLoadingCampaignDetail(false);
    }
  };

  // Effects
  useEffect(() => {
    loadFilterOptions();
    loadWhatsAppNumbers();
  }, []);

  useEffect(() => {
    loadData();
  }, [filters, loadData]);

  useEffect(() => {
    loadRecentConversions(pagination.page);
  }, [sortBy, sortOrder]);

  // Formatters
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: 'PEN',
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-PE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('es-PE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Sort indicator component
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortBy !== column) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-emerald-600 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  // Source badge component
  const SourceBadge = ({ type, campaignName }: { type: string; campaignName?: string | null }) => {
    switch (type) {
      case 'campaign':
        return (
          <div className="text-xs">
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
              📢 Campaña
            </span>
            {campaignName && <div className="text-slate-500 mt-0.5 truncate max-w-[120px]">{campaignName}</div>}
          </div>
        );
      case 'chat':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-medium">
            💬 Chat
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium">
            🏪 Directo
          </span>
        );
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-sm text-slate-600">Cargando conversiones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Conversiones WhatsApp - Ventas</h1>
            <p className="text-sm text-slate-600 mt-1">
              Tracking de clientes que contactaron por WhatsApp o recibieron campañas y realizaron compras
            </p>
          </div>
          <div className="flex items-center gap-3">
            {stats?.lastSync && (
              <div className="text-xs text-slate-500">
                Ultima actualizacion: {formatDateTime(stats.lastSync)}
              </div>
            )}
            <button
              onClick={() => setShowHelp(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
            >
              ? Ayuda
            </button>
            <button
              onClick={forceSync}
              disabled={syncing}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Sincronizando...
                </>
              ) : (
                'Actualizar Ahora'
              )}
            </button>
          </div>
        </div>

        {/* Filters Bar - Looker Studio Style */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Date Preset */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-slate-500 mb-1">Periodo</label>
              <select
                value={datePreset}
                onChange={(e) => handleDatePresetChange(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100 bg-white"
              >
                <option value="all">Todo el tiempo</option>
                <option value="today">Hoy</option>
                <option value="last7">Ultimos 7 dias</option>
                <option value="last30">Ultimos 30 dias</option>
                <option value="thisMonth">Este mes</option>
                <option value="lastMonth">Mes anterior</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            {/* Custom Date Range */}
            {datePreset === 'custom' && (
              <>
                <div className="flex flex-col">
                  <label className="text-xs font-medium text-slate-500 mb-1">Desde</label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs font-medium text-slate-500 mb-1">Hasta</label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100"
                  />
                </div>
              </>
            )}

            {/* Seller Filter */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-slate-500 mb-1">Vendedor</label>
              <select
                value={filters.seller}
                onChange={(e) => setFilters(f => ({ ...f, seller: e.target.value }))}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100 bg-white min-w-[140px]"
              >
                <option value="all">Todos</option>
                {filterOptions?.sellers.map((seller) => (
                  <option key={seller} value={seller}>{seller}</option>
                ))}
              </select>
            </div>

            {/* Area Filter */}
            <div className="flex flex-col">
              <label className="text-xs font-medium text-slate-500 mb-1">Area</label>
              <select
                value={filters.area}
                onChange={(e) => setFilters(f => ({ ...f, area: e.target.value }))}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100 bg-white min-w-[140px]"
              >
                <option value="all">Todas</option>
                {filterOptions?.areas.map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </div>

            {/* WhatsApp Number Filter */}
            {whatsappNumbers.length > 0 && (
              <div className="flex flex-col">
                <label className="text-xs font-medium text-slate-500 mb-1">Numero WSP</label>
                <select
                  value={filters.whatsappNumberId}
                  onChange={(e) => setFilters(f => ({ ...f, whatsappNumberId: e.target.value }))}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-emerald-400 focus:ring focus:ring-emerald-100 bg-white min-w-[160px]"
                >
                  <option value="all">Todos</option>
                  {whatsappNumbers.map((num) => (
                    <option key={num.numberId} value={num.numberId}>
                      {num.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Clear Filters */}
            {(filters.dateFrom || filters.seller !== 'all' || filters.area !== 'all' || filters.whatsappNumberId !== 'all') && (
              <button
                onClick={() => {
                  setFilters({ dateFrom: '', dateTo: '', seller: 'all', area: 'all', whatsappNumberId: 'all' });
                  setDatePreset('all');
                }}
                className="mt-5 px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Data availability warning */}
          {filterOptions && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500">
              <span>
                Datos de ventas: {formatDate(filterOptions.dateRange.minDate)} - {formatDate(filterOptions.dateRange.maxDate)}
                ({filterOptions.dateRange.totalRecords.toLocaleString()} registros)
              </span>
              {filterOptions.campaignDateRange.totalCampaigns > 0 && (
                <span>
                  | Campañas: {formatDate(filterOptions.campaignDateRange.minDate)} - {formatDate(filterOptions.campaignDateRange.maxDate)}
                  ({filterOptions.campaignDateRange.totalCampaigns} campañas)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex gap-2 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'overview'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Vista General
          </button>
          <button
            onClick={() => setActiveTab('campaigns')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === 'campaigns'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Conversiones por Campaña
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* KPI Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600">Total Ventas</p>
                  <span className="text-2xl">🛍</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">{stats.totalSales.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">En el periodo seleccionado</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600">Con WhatsApp</p>
                  <span className="text-2xl">📱</span>
                </div>
                <p className="text-3xl font-bold text-emerald-600">{stats.withWhatsApp.toLocaleString()}</p>
                <p className="text-xs text-emerald-600 font-semibold mt-1">{stats.conversionRate}% tasa de conversion</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600">Monto Total</p>
                  <span className="text-2xl">💵</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(stats.totalAmount)}</p>
                <p className="text-xs text-slate-500 mt-1">Ventas totales</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-slate-600">Dias Promedio</p>
                  <span className="text-2xl">⏱</span>
                </div>
                <p className="text-3xl font-bold text-blue-600">
                  {stats.avgDaysToConversion ? `${stats.avgDaysToConversion}` : 'N/A'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Contacto - Venta</p>
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* By WhatsApp Number */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Por Numero WhatsApp</h3>
              {numberStats.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No hay datos disponibles</p>
              ) : (
                <div className="space-y-3">
                  {numberStats.map((stat, index) => {
                    const maxSales = Math.max(...numberStats.map(s => s.totalSales));
                    const percentage = (stat.totalSales / maxSales) * 100;
                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{stat.whatsappDisplayName}</span>
                          <span className="text-emerald-600 font-bold">{stat.totalSales}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-green-600 transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500">{formatCurrency(stat.totalAmount)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* By Seller */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Por Vendedor</h3>
              {sellerStats.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No hay datos disponibles</p>
              ) : (
                <div className="space-y-3">
                  {sellerStats.map((stat, index) => {
                    const maxSales = Math.max(...sellerStats.map(s => s.totalSales));
                    const percentage = (stat.totalSales / maxSales) * 100;
                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{stat.sellerName}</span>
                          <span className="text-purple-600 font-bold">{stat.totalSales}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-600 transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>{formatCurrency(stat.totalAmount)}</span>
                          <span>{stat.conversionRate}% WSP</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* By Area */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Por Area</h3>
              {areaStats.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No hay datos disponibles</p>
              ) : (
                <div className="space-y-4">
                  {areaStats.map((stat, index) => (
                    <div key={index} className="border-b border-slate-100 pb-3 last:border-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-slate-900">{stat.area}</span>
                        <span className="text-sm font-medium px-2 py-1 bg-emerald-100 text-emerald-700 rounded">
                          {stat.conversionRate}% con WSP
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>{stat.totalSales} ventas totales</span>
                        <span className="font-medium">{formatCurrency(stat.totalAmount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Campaigns Tab */
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-6 py-4 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Conversiones por Campaña de Mensajes Masivos</h3>
            <p className="text-sm text-slate-600 mt-1">Mide el ROI de tus campañas: destinatarios que compraron despues de recibir el mensaje</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Campaña</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Fecha</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Enviados</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Entregados</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Leidos</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Respondieron</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Compraron</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Tasa Conv.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {campaignStats.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      No hay campañas con datos de conversion
                    </td>
                  </tr>
                ) : (
                  campaignStats.map((campaign) => (
                    <tr
                      key={campaign.campaignId}
                      className="hover:bg-purple-50 cursor-pointer transition-colors"
                      onClick={() => loadCampaignDetails(campaign.campaignId)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 flex items-center gap-2">
                          {campaign.campaignName}
                          <span className="text-purple-500 text-xs">Ver detalle →</span>
                        </div>
                        <div className="text-xs text-slate-500">{campaign.templateName}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">
                        {campaign.startedAt ? formatDate(campaign.startedAt) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-slate-900">
                        {campaign.totalRecipients.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">
                        {campaign.delivered > 0 ? campaign.delivered.toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">
                        {campaign.read > 0 ? campaign.read.toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">
                        {campaign.responded > 0 ? campaign.responded.toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm">
                          {campaign.converted}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded font-bold text-sm ${
                          parseFloat(campaign.conversionRate) >= 10
                            ? 'bg-green-100 text-green-700'
                            : parseFloat(campaign.conversionRate) >= 5
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {campaign.conversionRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                        {formatCurrency(campaign.totalRevenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {campaignStats.length > 0 && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                  <tr>
                    <td className="px-4 py-3 font-bold text-slate-900">TOTAL</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {campaignStats.reduce((sum, c) => sum + c.totalRecipients, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {campaignStats.reduce((sum, c) => sum + c.delivered, 0).toLocaleString() || '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {campaignStats.reduce((sum, c) => sum + c.read, 0).toLocaleString() || '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {campaignStats.reduce((sum, c) => sum + c.responded, 0).toLocaleString() || '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-emerald-600">
                      {campaignStats.reduce((sum, c) => sum + c.converted, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {(
                        (campaignStats.reduce((sum, c) => sum + c.converted, 0) /
                          campaignStats.reduce((sum, c) => sum + c.totalRecipients, 0)) *
                        100
                      ).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-600">
                      {formatCurrency(campaignStats.reduce((sum, c) => sum + c.totalRevenue, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Recent Conversions Table - Always visible */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-50 to-blue-50 px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">Ventas Recientes</h3>
          <p className="text-sm text-slate-600">Haz clic en los encabezados para ordenar</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('customer_name')}
                >
                  Cliente <SortIndicator column="customer_name" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('sale_date')}
                >
                  Fecha <SortIndicator column="sale_date" />
                </th>
                <th
                  className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('sale_amount')}
                >
                  Monto <SortIndicator column="sale_amount" />
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('area')}
                >
                  Area <SortIndicator column="area" />
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('seller_name')}
                >
                  Vendedor <SortIndicator column="seller_name" />
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">
                  Origen
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('days_to_conversion')}
                >
                  Dias <SortIndicator column="days_to_conversion" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {recentConversions.map((conv, index) => (
                <tr key={index} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-900">{conv.customerName}</div>
                    <div className="text-xs text-slate-500">{conv.customerPhone}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatDate(conv.saleDate)}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                    {formatCurrency(conv.saleAmount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded">
                      {conv.area}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-slate-700">{conv.sellerName}</td>
                  <td className="px-4 py-3 text-center">
                    <SourceBadge type={conv.sourceType} campaignName={conv.campaignName} />
                  </td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-slate-700">
                    {conv.daysToConversion !== null ? `${conv.daysToConversion}d` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Mostrando {((pagination.page - 1) * pagination.limit) + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadRecentConversions(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="px-3 py-1 text-sm">
              Pagina {pagination.page} de {pagination.totalPages}
            </span>
            <button
              onClick={() => loadRecentConversions(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-emerald-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-2">Guia de Metricas</h2>
                  <p className="text-blue-100">Aprende a interpretar los datos</p>
                </div>
                <button
                  onClick={() => setShowHelp(false)}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-200">
                <h3 className="text-xl font-bold text-slate-900 mb-3">Tipos de Origen</h3>
                <ul className="space-y-2 text-sm text-slate-700">
                  <li><strong className="text-emerald-600">Chat:</strong> Cliente que te escribio por WhatsApp antes de comprar</li>
                  <li><strong className="text-purple-600">Campaña:</strong> Cliente que recibio un mensaje masivo y luego compro</li>
                  <li><strong className="text-slate-600">Directo:</strong> Compra sin contacto previo por WhatsApp</li>
                </ul>
              </div>

              <div className="bg-blue-50 rounded-xl p-5 border border-blue-200">
                <h3 className="text-xl font-bold text-slate-900 mb-3">Filtros</h3>
                <p className="text-sm text-slate-700">
                  Usa los filtros para analizar segmentos especificos: por periodo, vendedor, area o numero de WhatsApp.
                  Los datos se actualizan automaticamente al cambiar los filtros.
                </p>
              </div>

              <div className="bg-purple-50 rounded-xl p-5 border border-purple-200">
                <h3 className="text-xl font-bold text-slate-900 mb-3">Conversiones por Campaña</h3>
                <p className="text-sm text-slate-700">
                  Mide el ROI de tus mensajes masivos. Una conversion se cuenta cuando alguien que recibio
                  tu campaña realizo una compra despues de recibir el mensaje.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 bg-slate-100 p-4 rounded-b-2xl border-t border-slate-200">
              <button
                onClick={() => setShowHelp(false)}
                className="w-full bg-gradient-to-r from-blue-600 to-emerald-600 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-emerald-700 transition"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Detail Modal */}
      {(selectedCampaign || loadingCampaignDetail) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  {loadingCampaignDetail ? (
                    <div className="animate-pulse">
                      <div className="h-6 bg-white bg-opacity-30 rounded w-48 mb-2"></div>
                      <div className="h-4 bg-white bg-opacity-20 rounded w-32"></div>
                    </div>
                  ) : selectedCampaign && (
                    <>
                      <h2 className="text-2xl font-bold mb-1">{selectedCampaign.campaign.name}</h2>
                      <p className="text-purple-100">
                        Template: {selectedCampaign.campaign.templateName} |
                        Enviada: {selectedCampaign.campaign.startedAt ? formatDate(selectedCampaign.campaign.startedAt) : 'N/A'}
                      </p>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCampaign(null)}
                  className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {loadingCampaignDetail ? (
              <div className="flex-1 flex items-center justify-center p-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-slate-600">Cargando detalles...</p>
                </div>
              </div>
            ) : selectedCampaign && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-4 gap-4 p-6 bg-slate-50 border-b">
                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <p className="text-sm text-slate-600">Total Enviados</p>
                    <p className="text-2xl font-bold text-slate-900">{selectedCampaign.summary.totalRecipients.toLocaleString()}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <p className="text-sm text-slate-600">Compraron</p>
                    <p className="text-2xl font-bold text-emerald-600">{selectedCampaign.summary.totalConverted}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <p className="text-sm text-slate-600">Tasa Conversion</p>
                    <p className="text-2xl font-bold text-purple-600">{selectedCampaign.summary.conversionRate}%</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <p className="text-sm text-slate-600">Revenue Total</p>
                    <p className="text-2xl font-bold text-emerald-600">{formatCurrency(selectedCampaign.summary.totalRevenue)}</p>
                  </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-slate-200 px-6">
                  <div className="flex gap-4">
                    <button
                      onClick={() => setCampaignDetailTab('converted')}
                      className={`py-3 px-4 text-sm font-medium border-b-2 transition ${
                        campaignDetailTab === 'converted'
                          ? 'border-emerald-600 text-emerald-700'
                          : 'border-transparent text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Clientes que Compraron ({selectedCampaign.converted.length})
                    </button>
                    <button
                      onClick={() => setCampaignDetailTab('all')}
                      className={`py-3 px-4 text-sm font-medium border-b-2 transition ${
                        campaignDetailTab === 'all'
                          ? 'border-slate-600 text-slate-700'
                          : 'border-transparent text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      No Compraron ({selectedCampaign.notConvertedTotal})
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                  {campaignDetailTab === 'converted' ? (
                    selectedCampaign.converted.length === 0 ? (
                      <div className="text-center py-12 text-slate-500">
                        <p className="text-lg">No hay conversiones registradas para esta campaña</p>
                        <p className="text-sm mt-2">Los destinatarios de esta campaña aun no han realizado compras</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Telefono</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Cliente</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Fecha Compra</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Monto</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Area</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Vendedor</th>
                              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Msg Leido</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {selectedCampaign.converted.map((conv, index) => (
                              <tr key={index} className="hover:bg-emerald-50">
                                <td className="px-4 py-3 font-mono text-sm text-slate-900">{conv.phone}</td>
                                <td className="px-4 py-3 text-sm font-medium text-slate-900">{conv.customerName}</td>
                                <td className="px-4 py-3 text-center text-sm text-slate-700">{formatDate(conv.saleDate)}</td>
                                <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600">{formatCurrency(conv.saleAmount)}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded">{conv.area}</span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm text-slate-700">{conv.sellerName}</td>
                                <td className="px-4 py-3 text-center">
                                  {conv.readAt ? (
                                    <span className="text-emerald-600">Si</span>
                                  ) : conv.deliveredAt ? (
                                    <span className="text-yellow-600">Entregado</span>
                                  ) : (
                                    <span className="text-slate-400">No</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="bg-emerald-50 border-t-2 border-emerald-300">
                            <tr>
                              <td colSpan={3} className="px-4 py-3 font-bold text-slate-900">
                                TOTAL: {selectedCampaign.converted.length} clientes
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-emerald-700 text-lg">
                                {formatCurrency(selectedCampaign.converted.reduce((sum, c) => sum + c.saleAmount, 0))}
                              </td>
                              <td colSpan={3}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )
                  ) : (
                    /* Not Converted Tab */
                    <div className="overflow-x-auto">
                      <div className="mb-4 p-3 bg-slate-100 rounded-lg text-sm text-slate-600">
                        Mostrando los primeros 50 de {selectedCampaign.notConvertedTotal} destinatarios que no han comprado
                      </div>
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Telefono</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Estado Mensaje</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Enviado</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Entregado</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Leido</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase">Respondio</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {selectedCampaign.notConverted.map((nc, index) => (
                            <tr key={index} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono text-sm text-slate-900">{nc.phone}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-xs font-medium px-2 py-1 rounded ${
                                  nc.messageStatus === 'sent' ? 'bg-blue-100 text-blue-700' :
                                  nc.messageStatus === 'delivered' ? 'bg-emerald-100 text-emerald-700' :
                                  nc.messageStatus === 'read' ? 'bg-green-100 text-green-700' :
                                  nc.messageStatus === 'failed' ? 'bg-red-100 text-red-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {nc.messageStatus}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center text-xs text-slate-600">
                                {nc.sentAt ? formatDate(nc.sentAt) : '-'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {nc.deliveredAt ? <span className="text-emerald-600">Si</span> : <span className="text-slate-400">-</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {nc.readAt ? <span className="text-emerald-600">Si</span> : <span className="text-slate-400">-</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {nc.responded ? <span className="text-emerald-600">Si</span> : <span className="text-slate-400">-</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-200 p-4 bg-slate-50">
                  <button
                    onClick={() => setSelectedCampaign(null)}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold py-3 rounded-lg hover:from-purple-700 hover:to-pink-700 transition"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
