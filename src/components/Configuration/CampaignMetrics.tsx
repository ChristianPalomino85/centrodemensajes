import { useState, useEffect } from "react";
import { apiUrl } from "../../lib/apiBase";
import { TrendingUp, Target, Users, BarChart3, Megaphone, HelpCircle, X } from "lucide-react";

interface CampaignRecord {
  id: number;
  conversation_id: string;
  customer_phone: string;
  customer_name: string | null;
  initial_message: string;
  detected_keyword: string | null;
  keyword_group_name: string | null;
  campaign_source: string | null;
  campaign_name: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  referral_source_url?: string | null;
  referral_source_id?: string | null;
  referral_source_type?: string | null;
  referral_headline?: string | null;
  referral_body?: string | null;
  referral_media_type?: string | null;
  referral_image_url?: string | null;
  referral_video_url?: string | null;
  referral_thumbnail_url?: string | null;
  ctwa_clid?: string | null;
  created_at: string;
}

interface KeywordStat {
  detected_keyword: string;
  keyword_group_name: string;
  count: number;
}

interface CampaignStat {
  source: string;
  campaign: string;
  count: number;
}

interface DetectedKeyword {
  keyword: string;
  group: string;
}

interface ReferralStat {
  referral_source_type: string;
  referral_source_id: string;
  referral_source_url?: string;
  referral_headline: string;
  referral_body?: string;
  referral_media_type: string;
  referral_image_url?: string;
  referral_video_url?: string;
  referral_thumbnail_url?: string;
  ctwa_clid: string;
  count: number;
  detected_keywords?: DetectedKeyword[];
}

interface CampaignData {
  records: CampaignRecord[];
  totalCount: number;
  keywordStats: KeywordStat[];
  campaignStats: CampaignStat[];
  referralStats: ReferralStat[];
}

export function CampaignMetrics() {
  const [data, setData] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelpModal, setShowHelpModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const response = await fetch(apiUrl("/api/crm/metrics/ads-tracking?limit=50"), {
        credentials: "include",
      });

      if (response.ok) {
        const result = await response.json();
        console.log("[CampaignMetrics] Raw API response:", result);
        console.log("[CampaignMetrics] keywordStats:", result.keywordStats);
        if (result.keywordStats && result.keywordStats.length > 0) {
          const total = result.keywordStats.reduce((sum: number, k: any) => {
            console.log(`[CampaignMetrics] Adding count: ${k.count} (type: ${typeof k.count})`);
            return sum + Number(k.count);
          }, 0);
          console.log("[CampaignMetrics] Total keyphrases count:", total);
        }
        setData(result);
      }
    } catch (error) {
      console.error("Failed to load campaign metrics:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-slate-600">
        Error al cargar métricas de campaña
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 via-cyan-50 to-teal-50 rounded-xl p-6 border border-blue-200/50 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg p-3 shadow-lg">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-700 to-cyan-700 bg-clip-text text-transparent">
                Métricas de Campañas
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Trackea el origen de tus leads y qué keywords están convirtiendo
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowHelpModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-blue-50 text-blue-600 rounded-lg border border-blue-200 shadow-sm transition-colors"
            title="Cómo leer las métricas"
          >
            <HelpCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Ayuda</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Total Conversaciones</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{data.totalCount}</p>
            </div>
            <div className="bg-blue-100 rounded-lg p-3">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Frases Clave Detectadas</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {data.keywordStats.reduce((sum, k) => sum + Number(k.count), 0)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Frases completas (3+ palabras)</p>
            </div>
            <div className="bg-green-100 rounded-lg p-3">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Campañas Activas</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{data.campaignStats.length}</p>
            </div>
            <div className="bg-purple-100 rounded-lg p-3">
              <Target className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Frases Clave Configuradas (Key Phrases from Flows) */}
      {data.keywordStats.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-green-400 to-emerald-500 rounded-lg p-2">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">Frases Clave Detectadas</h3>
                <p className="text-xs text-slate-600 mt-0.5">Frases completas configuradas en flujos de validación</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.keywordStats.slice(0, 6).map((stat, idx) => {
                // Identificar si es una frase clave real (más de 3 palabras) o una palabra suelta
                const isKeyPhrase = stat.detected_keyword.split(' ').length >= 3;

                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      isKeyPhrase
                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                        : 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className={`text-sm font-medium ${isKeyPhrase ? 'text-green-700' : 'text-amber-700'}`}>
                          {stat.keyword_group_name || 'Sin grupo'}
                        </p>
                        {!isKeyPhrase && (
                          <span className="text-xs px-2 py-0.5 rounded bg-amber-200 text-amber-800">
                            Palabra
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-slate-900">{stat.detected_keyword}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${isKeyPhrase ? 'text-green-700' : 'text-amber-700'}`}>
                        {stat.count}
                      </p>
                      <p className={`text-xs ${isKeyPhrase ? 'text-green-600' : 'text-amber-600'}`}>
                        conversiones
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Nota aclaratoria */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-800">
                ℹ️ <strong>Frases clave</strong> = Frases completas configuradas en flujos (ej: "Quiero los catálogos para vender").
                <strong className="ml-2">Palabras</strong> = Palabras individuales detectadas en otros flujos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Sources */}
      {data.campaignStats.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-purple-400 to-fuchsia-500 rounded-lg p-2">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900">Campañas por Fuente</h3>
            </div>
          </div>

          <div className="p-6">
            <div className="space-y-3">
              {data.campaignStats.slice(0, 8).map((stat, idx) => {
                const percentage = (Number(stat.count) / data.totalCount) * 100;
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {stat.source} {stat.campaign !== 'Unknown' && `- ${stat.campaign}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-slate-900">{stat.count}</span>
                        <span className="text-xs text-slate-500 ml-2">({percentage.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-purple-500 to-fuchsia-500 h-2 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Meta Ads / Click-to-WhatsApp Ads */}
      {data.referralStats && data.referralStats.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg p-2.5 shadow-lg">
                <Megaphone className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Anuncios de Meta (Click-to-WhatsApp)</h3>
                <p className="text-xs text-slate-600 mt-0.5">Leads directos desde anuncios de Facebook/Instagram</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 gap-5">
              {data.referralStats.slice(0, 10).map((stat, idx) => {
                const percentage = (Number(stat.count) / data.totalCount) * 100;
                const hasMedia = stat.referral_image_url || stat.referral_video_url || stat.referral_thumbnail_url;

                return (
                  <div
                    key={idx}
                    className="relative rounded-xl bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border border-indigo-200 hover:shadow-lg transition-all overflow-hidden"
                  >
                    <div className="flex gap-4">
                      {/* Media Preview Section */}
                      {hasMedia && (
                        <div className="w-32 h-48 shrink-0 bg-slate-900 flex items-center justify-center">
                          {stat.referral_image_url && (
                            <img
                              src={stat.referral_image_url}
                              alt="Ad preview"
                              className="w-full h-full object-cover"
                            />
                          )}
                          {!stat.referral_image_url && stat.referral_thumbnail_url && (
                            <img
                              src={stat.referral_thumbnail_url}
                              alt="Video thumbnail"
                              className="w-full h-full object-cover"
                            />
                          )}
                          {!stat.referral_image_url && !stat.referral_thumbnail_url && stat.referral_video_url && (
                            <div className="flex flex-col items-center justify-center text-white p-3">
                              <svg className="w-10 h-10 mb-1" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M6 4l10 6-10 6V4z"/>
                              </svg>
                              <span className="text-xs opacity-75">Video</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Content Section */}
                      <div className="flex-1 p-5">
                        {/* Header: Type Badge + Headline */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold px-2.5 py-1 rounded shadow-sm">
                            {stat.referral_source_type?.toUpperCase() || 'AD'}
                          </div>
                          <h4 className="font-bold text-slate-900 text-base flex-1 leading-tight">
                            {stat.referral_headline || 'Anuncio sin título'}
                          </h4>
                        </div>

                        {/* Ad Body Text */}
                        {stat.referral_body && (
                          <p className="text-sm text-slate-700 mb-4 leading-relaxed">
                            {stat.referral_body}
                          </p>
                        )}

                        {/* Metadata Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          {stat.referral_source_id && (
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                              <span className="text-xs text-slate-500 font-medium block mb-1">ID del Anuncio</span>
                              <code className="text-xs text-slate-900 font-mono break-all">
                                {stat.referral_source_id}
                              </code>
                            </div>
                          )}

                          {stat.referral_media_type && (
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                              <span className="text-xs text-slate-500 font-medium block mb-1">Tipo de Medio</span>
                              <span className="text-xs text-slate-900 font-semibold uppercase">
                                {stat.referral_media_type}
                              </span>
                            </div>
                          )}

                          {stat.ctwa_clid && (
                            <div className="bg-white rounded-lg p-3 border border-slate-200 col-span-2">
                              <span className="text-xs text-slate-500 font-medium block mb-1">Click ID (CTWA)</span>
                              <code className="text-xs text-slate-900 font-mono break-all">
                                {stat.ctwa_clid}
                              </code>
                            </div>
                          )}

                          {stat.referral_source_url && (
                            <div className="bg-white rounded-lg p-3 border border-slate-200 col-span-2">
                              <span className="text-xs text-slate-500 font-medium block mb-1">URL del Anuncio</span>
                              <a
                                href={stat.referral_source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-700 underline break-all"
                              >
                                {stat.referral_source_url}
                              </a>
                            </div>
                          )}
                        </div>

                        {/* Detected Keywords Section */}
                        {stat.detected_keywords && stat.detected_keywords.length > 0 && (
                          <div className="mt-4 mb-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-semibold text-slate-600 uppercase">
                                🔑 Frases Clave Detectadas
                              </span>
                              <span className="text-xs text-slate-500">({stat.detected_keywords.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {stat.detected_keywords.map((kw, kidx) => (
                                <div
                                  key={kidx}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-300 rounded-lg shadow-sm"
                                >
                                  <div className="flex-1">
                                    <p className="text-xs font-bold text-green-800">{kw.keyword}</p>
                                    <p className="text-xs text-green-600">{kw.group}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Progress Bar */}
                        <div className="w-full bg-indigo-200/50 rounded-full h-2 mb-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 h-2 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>

                        {/* Stats Footer */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-600 font-medium">
                            {stat.count} conversiones • {percentage.toFixed(1)}% del total
                          </span>
                        </div>
                      </div>

                      {/* Stats Badge */}
                      <div className="shrink-0 p-5">
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-xl p-4 shadow-lg text-center min-w-[80px]">
                          <p className="text-3xl font-bold">{stat.count}</p>
                          <p className="text-xs opacity-90 mt-1">conversiones</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Total de conversiones desde anuncios de Meta
                </p>
                <p className="text-lg font-bold text-indigo-600">
                  {data.referralStats.reduce((sum, s) => sum + Number(s.count), 0)} leads
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Conversations */}
      {data.records.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-400 to-cyan-500 rounded-lg p-2">
                <Users className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900">Conversaciones Recientes</h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">
                    Cliente
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">
                    Frase Clave
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">
                    Origen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.records.slice(0, 10).map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {record.customer_name || 'Sin nombre'}
                        </p>
                        <p className="text-xs text-slate-500">{record.customer_phone}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {record.detected_keyword ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                          {record.detected_keyword}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {record.referral_source_type ? (
                        <div className="text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                              META {record.referral_source_type?.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-900">
                            {record.referral_headline || 'Anuncio sin título'}
                          </p>
                        </div>
                      ) : (record.campaign_source || record.utm_source) ? (
                        <div className="text-sm">
                          <p className="font-medium text-slate-900">
                            {record.campaign_source || record.utm_source}
                          </p>
                          {(record.campaign_name || record.utm_campaign) && (
                            <p className="text-xs text-slate-500">
                              {record.campaign_name || record.utm_campaign}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Orgánico</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(record.created_at).toLocaleString('es-PE', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Lima',
                        hour12: true,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {data.totalCount === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
            <Target className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-600 font-medium mb-2">No hay datos de campaña aún</p>
          <p className="text-sm text-slate-500">
            Las conversaciones se trackearán automáticamente cuando lleguen mensajes
          </p>
        </div>
      )}

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
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-6 py-4 rounded-t-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-lg p-2">
                    <HelpCircle className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold">Cómo Leer las Métricas de Campañas</h2>
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
                {/* Introducción */}
                <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4">
                  <p className="text-sm text-slate-700">
                    Este panel te ayuda a entender <strong>de dónde vienen tus conversaciones</strong> y qué campañas o anuncios están generando más leads.
                  </p>
                </div>

                {/* Sección 1: Total Conversaciones */}
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    Total Conversaciones
                  </h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    <p className="text-sm text-slate-700">
                      <strong>Qué es:</strong> El número total de conversaciones que han iniciado contacto con tu negocio.
                    </p>
                    <p className="text-sm text-slate-700">
                      <strong>Incluye:</strong>
                    </p>
                    <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-4">
                      <li>Conversaciones desde anuncios de Facebook/Instagram (con tracking completo)</li>
                      <li>Conversaciones orgánicas (clientes que escribieron directamente)</li>
                      <li>Conversaciones de envíos masivos</li>
                      <li>Conversaciones de otras fuentes sin tracking</li>
                    </ul>
                  </div>
                </div>

                {/* Sección 2: Frases Clave Detectadas */}
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    Frases Clave Detectadas
                  </h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    <p className="text-sm text-slate-700">
                      <strong>Qué es:</strong> Frases específicas que los clientes mencionan en sus mensajes iniciales.
                    </p>
                    <p className="text-sm text-slate-700">
                      <strong>Configuración:</strong> Estas frases se configuran en los <em>flujos de validación</em>. Por ejemplo: "quiero el catálogo", "precio de zapatillas", etc.
                    </p>
                    <p className="text-sm text-slate-700">
                      <strong>Utilidad:</strong> Te ayuda a saber qué productos o servicios están generando más interés.
                    </p>
                  </div>
                </div>

                {/* Sección 3: Campañas Activas vs Anuncios */}
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5 text-purple-600" />
                    Campañas Activas
                  </h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-slate-700">
                      <strong>Importante:</strong> No todas las "campañas" son anuncios pagados.
                    </p>
                    <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-3">
                      <p className="text-sm text-slate-700 font-medium mb-2">
                        El campo "campaign_id" se usa para múltiples propósitos:
                      </p>
                      <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-2">
                        <li><strong>Envíos masivos</strong> (ej: "legacy-mass-send")</li>
                        <li><strong>Templates manuales</strong> (ej: "template-1762965203960")</li>
                        <li><strong>Anuncios de Facebook/Instagram</strong> (solo con ad_ctwa_clid)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Sección 4: Seguimiento de Anuncios */}
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <Megaphone className="w-5 h-5 text-blue-600" />
                    Tarjetas de Anuncios (Facebook/Instagram)
                  </h3>
                  <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-slate-700">
                      <strong>Qué muestran:</strong> Solo las conversaciones que vienen de anuncios de Facebook/Instagram con tracking completo.
                    </p>
                    <div className="bg-green-50 border-l-4 border-green-500 rounded-r-lg p-3">
                      <p className="text-sm text-slate-700 mb-2">
                        <strong>Identificación:</strong> Una conversación se cuenta como "desde anuncio" solo si tiene:
                      </p>
                      <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-2">
                        <li><code className="bg-slate-200 px-1 py-0.5 rounded text-xs">ad_ctwa_clid</code> (Click ID de Facebook)</li>
                        <li><code className="bg-slate-200 px-1 py-0.5 rounded text-xs">ad_source_id</code> (ID del anuncio)</li>
                      </ul>
                    </div>
                    <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-3 mt-3">
                      <p className="text-sm text-slate-700">
                        <strong>Ejemplo:</strong> Si ves "24 conversaciones totales" pero solo 1 tarjeta de anuncio con "12 conversiones", significa que:
                      </p>
                      <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 ml-2 mt-2">
                        <li><strong>12 conversiones</strong> vinieron del anuncio (tracking completo)</li>
                        <li><strong>12 conversiones restantes</strong> son orgánicas, envíos masivos, o sin tracking</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Sección 5: Consejos */}
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-3">💡 Consejos</h3>
                  <div className="bg-slate-50 rounded-lg p-4">
                    <ul className="space-y-2 text-sm text-slate-700">
                      <li className="flex gap-2">
                        <span className="text-blue-600 font-bold">•</span>
                        <span>Si no ves una tarjeta de anuncio, es porque ese grupo de conversaciones no vino de anuncios pagados.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-600 font-bold">•</span>
                        <span>Las conversaciones antiguas de antes de implementar el tracking NO aparecerán como anuncios.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-600 font-bold">•</span>
                        <span>Usa las "Frases Clave Detectadas" para optimizar tus anuncios y mensajes.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-slate-50 px-6 py-4 rounded-b-xl border-t border-slate-200">
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
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
