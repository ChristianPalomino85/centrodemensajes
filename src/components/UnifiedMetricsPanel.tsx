import React, { useState } from 'react';
import { MetricsPanel } from './MetricsPanel';
import MetricsDashboard from '../crm/MetricsDashboard';
import AIAnalyticsPanel from './AIAnalyticsPanel';
import InvestmentControlPanel from './InvestmentControlPanel';
import KeywordUsagePanel from './KeywordUsagePanel';
import { CampaignsPanel } from './CampaignsPanel';
import { AdTrackingPanel } from './AdTrackingPanel';
import { SalesConversionsPanel } from './SalesConversionsPanel';
import type { WhatsAppNumberAssignment } from '../flow/types';

interface UnifiedMetricsPanelProps {
  whatsappNumbers?: WhatsAppNumberAssignment[];
}

export function UnifiedMetricsPanel({ whatsappNumbers = [] }: UnifiedMetricsPanelProps) {
  const [activeTab, setActiveTab] = useState<'bot' | 'advisors' | 'ai-analytics' | 'investment' | 'keywords' | 'campaigns' | 'ad-tracking' | 'sales-conversions'>('bot');

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('bot')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'bot'
                  ? 'bg-gradient-to-r from-emerald-50 to-blue-50 text-emerald-700 border-b-2 border-emerald-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              🤖 Métricas del Bot
            </button>
            <button
              onClick={() => setActiveTab('advisors')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'advisors'
                  ? 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border-b-2 border-purple-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              👥 Métricas de Asesores
            </button>
            <button
              onClick={() => setActiveTab('ai-analytics')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'ai-analytics'
                  ? 'bg-gradient-to-r from-orange-50 to-yellow-50 text-orange-700 border-b-2 border-orange-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              🤖 Analytics IA
            </button>
            <button
              onClick={() => setActiveTab('investment')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'investment'
                  ? 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-700 border-b-2 border-indigo-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              💰 Control de Inversión
            </button>
            <button
              onClick={() => setActiveTab('keywords')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'keywords'
                  ? 'bg-gradient-to-r from-rose-50 to-red-50 text-rose-700 border-b-2 border-rose-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              🔑 Palabras Clave
            </button>
            <button
              onClick={() => setActiveTab('campaigns')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'campaigns'
                  ? 'bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 border-b-2 border-emerald-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              📢 Campañas
            </button>
            <button
              onClick={() => setActiveTab('ad-tracking')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'ad-tracking'
                  ? 'bg-gradient-to-r from-cyan-50 to-blue-50 text-cyan-700 border-b-2 border-cyan-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              🎯 Tracking de Ads
            </button>
            <button
              onClick={() => setActiveTab('sales-conversions')}
              className={`px-6 py-3 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === 'sales-conversions'
                  ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border-b-2 border-green-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              💰 Conversiones WSP→Ventas
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'bot' ? (
          <MetricsPanel whatsappNumbers={whatsappNumbers} />
        ) : activeTab === 'advisors' ? (
          <div className="h-full overflow-auto">
            <div className="p-6">
              <MetricsDashboard />
            </div>
          </div>
        ) : activeTab === 'ai-analytics' ? (
          <AIAnalyticsPanel />
        ) : activeTab === 'investment' ? (
          <InvestmentControlPanel />
        ) : activeTab === 'keywords' ? (
          <KeywordUsagePanel />
        ) : activeTab === 'campaigns' ? (
          <CampaignsPanel />
        ) : activeTab === 'ad-tracking' ? (
          <AdTrackingPanel />
        ) : (
          <SalesConversionsPanel />
        )}
      </div>
    </div>
  );
}
