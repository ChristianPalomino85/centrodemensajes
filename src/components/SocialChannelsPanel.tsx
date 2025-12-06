/**
 * Panel de Configuración de Canales Sociales
 * Permite configurar Instagram, Facebook y Bitrix24 Open Channels desde la UI
 */

import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/apiBase';

type ChannelType = 'instagram' | 'facebook' | 'bitrix';

interface ChannelConfig {
  id: number;
  channel: ChannelType;
  enabled: boolean;
  config: Record<string, any>;
  updated_at: string;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
}

const CHANNEL_INFO: Record<ChannelType, { name: string; icon: string; description: string; color: string }> = {
  instagram: {
    name: 'Instagram',
    icon: '📸',
    description: 'DM y comentarios de Instagram',
    color: 'from-pink-500 to-purple-600',
  },
  facebook: {
    name: 'Facebook',
    icon: '📘',
    description: 'Messenger y comentarios de página',
    color: 'from-blue-500 to-blue-700',
  },
  bitrix: {
    name: 'Bitrix24 Open Channels',
    icon: '🔗',
    description: 'Sincronizar chats con Bitrix24 CRM',
    color: 'from-emerald-500 to-teal-600',
  },
};

export function SocialChannelsPanel() {
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<ChannelType | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ChannelType | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Cargar configuraciones
  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/channel-config'));
      const data = await response.json();

      if (data.success) {
        // Filtrar solo los canales que queremos mostrar aquí
        const relevantChannels = data.data.filter(
          (c: ChannelConfig) => ['instagram', 'facebook', 'bitrix'].includes(c.channel)
        );
        setConfigs(relevantChannels);
      } else {
        setError(data.error || 'Error cargando configuraciones');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // Toggle habilitar/deshabilitar canal
  const handleToggle = async (channel: ChannelType) => {
    try {
      const response = await fetch(apiUrl(`/api/channel-config/${channel}/toggle`), {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        setConfigs(prev =>
          prev.map(c =>
            c.channel === channel ? { ...c, enabled: data.enabled } : c
          )
        );
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Abrir modal de edición
  const handleEdit = (channel: ChannelType) => {
    const config = configs.find(c => c.channel === channel);
    if (config) {
      setFormData({ ...config.config });
      setEditingChannel(channel);
      setTestResult(null);
    }
  };

  // Guardar configuración
  const handleSave = async () => {
    if (!editingChannel) return;

    try {
      setSaving(true);
      const response = await fetch(apiUrl(`/api/channel-config/${editingChannel}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: formData }),
      });
      const data = await response.json();

      if (data.success) {
        await loadConfigs();
        setEditingChannel(null);
        setFormData({});
      } else {
        setError(data.error || 'Error guardando');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Probar conexión
  const handleTest = async () => {
    if (!editingChannel) return;

    try {
      setTesting(editingChannel);
      setTestResult(null);

      // Primero guardar los cambios actuales
      await fetch(apiUrl(`/api/channel-config/${editingChannel}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: formData }),
      });

      // Luego probar
      const response = await fetch(apiUrl(`/api/channel-config/${editingChannel}/test`), {
        method: 'POST',
      });
      const data = await response.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(null);
    }
  };

  // Renderizar campos del formulario según el canal
  const renderFormFields = () => {
    if (!editingChannel) return null;

    switch (editingChannel) {
      case 'instagram':
        return (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Page ID</label>
                <input
                  type="text"
                  value={formData.pageId || ''}
                  onChange={e => setFormData({ ...formData, pageId: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="ID de la página de Facebook vinculada"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">IG User ID</label>
                <input
                  type="text"
                  value={formData.igUserId || ''}
                  onChange={e => setFormData({ ...formData, igUserId: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="ID del usuario de Instagram Business"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Access Token</label>
                <input
                  type="password"
                  value={formData.accessToken || ''}
                  onChange={e => setFormData({ ...formData, accessToken: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Token de acceso de Meta"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">App Secret</label>
                <input
                  type="password"
                  value={formData.appSecret || ''}
                  onChange={e => setFormData({ ...formData, appSecret: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Secret de la aplicación Meta"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Verify Token</label>
                <input
                  type="text"
                  value={formData.verifyToken || ''}
                  onChange={e => setFormData({ ...formData, verifyToken: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Token para verificar webhooks"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableDM !== false}
                    onChange={e => setFormData({ ...formData, enableDM: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Habilitar DM</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableComments !== false}
                    onChange={e => setFormData({ ...formData, enableComments: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Habilitar Comentarios</span>
                </label>
              </div>
            </div>
          </>
        );

      case 'facebook':
        return (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Page ID</label>
                <input
                  type="text"
                  value={formData.pageId || ''}
                  onChange={e => setFormData({ ...formData, pageId: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="ID de la página de Facebook"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Page Access Token</label>
                <input
                  type="password"
                  value={formData.pageAccessToken || ''}
                  onChange={e => setFormData({ ...formData, pageAccessToken: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Token de acceso de la página"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">App Secret</label>
                <input
                  type="password"
                  value={formData.appSecret || ''}
                  onChange={e => setFormData({ ...formData, appSecret: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Secret de la aplicación Meta"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Verify Token</label>
                <input
                  type="text"
                  value={formData.verifyToken || ''}
                  onChange={e => setFormData({ ...formData, verifyToken: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="Token para verificar webhooks"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableMessenger !== false}
                    onChange={e => setFormData({ ...formData, enableMessenger: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Habilitar Messenger</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableComments !== false}
                    onChange={e => setFormData({ ...formData, enableComments: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Habilitar Comentarios</span>
                </label>
              </div>
            </div>
          </>
        );

      case 'bitrix':
        return (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Webhook URL</label>
                <input
                  type="text"
                  value={formData.webhookUrl || ''}
                  onChange={e => setFormData({ ...formData, webhookUrl: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="https://tu-dominio.bitrix24.com/rest/1/tu_token/"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Crea un webhook en Bitrix24: Aplicaciones → Webhooks → Agregar webhook entrante
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Connector ID</label>
                <input
                  type="text"
                  value={formData.connectorId || 'flow_builder_connector'}
                  onChange={e => setFormData({ ...formData, connectorId: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="flow_builder_connector"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Dominio Bitrix24</label>
                <input
                  type="text"
                  value={formData.domain || ''}
                  onChange={e => setFormData({ ...formData, domain: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  placeholder="tu-empresa.bitrix24.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableOpenChannels !== false}
                    onChange={e => setFormData({ ...formData, enableOpenChannels: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Habilitar Open Channels (chat history)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enableCRM !== false}
                    onChange={e => setFormData({ ...formData, enableCRM: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Sincronizar con CRM</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.autoCreateLeads !== false}
                    onChange={e => setFormData({ ...formData, autoCreateLeads: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700">Crear leads automáticamente</span>
                </label>
              </div>
            </div>
          </>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-slate-500">Cargando configuraciones...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Canales Sociales</h2>
        <p className="mt-1 text-sm text-slate-600">
          Configura Instagram, Facebook y la integración con Bitrix24 Open Channels.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Cerrar
          </button>
        </div>
      )}

      {/* Lista de canales */}
      <div className="grid gap-4 md:grid-cols-3">
        {(['instagram', 'facebook', 'bitrix'] as ChannelType[]).map(channel => {
          const config = configs.find(c => c.channel === channel);
          const info = CHANNEL_INFO[channel];

          return (
            <div
              key={channel}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${info.color} text-2xl text-white`}
                  >
                    {info.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{info.name}</h3>
                    <p className="text-xs text-slate-500">{info.description}</p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => handleToggle(channel)}
                  className={`relative h-6 w-11 rounded-full transition ${
                    config?.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                      config?.enabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Estado */}
              <div className="mt-4 flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    config?.enabled
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {config?.enabled ? 'Habilitado' : 'Deshabilitado'}
                </span>

                <button
                  onClick={() => handleEdit(channel)}
                  className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
                >
                  Configurar →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Nota informativa */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h4 className="font-semibold text-blue-800">Cómo funciona</h4>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-blue-700">
          <li>
            <strong>Instagram/Facebook:</strong> Los mensajes y comentarios llegan al microservicio
            meta-channels
          </li>
          <li>
            <strong>Bitrix24:</strong> Todos los chats se sincronizan automáticamente con Open
            Channels para historial y CRM
          </li>
          <li>Los tokens se guardan encriptados y nunca se muestran completos</li>
        </ul>
      </div>

      {/* Modal de edición */}
      {editingChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {CHANNEL_INFO[editingChannel].icon} Configurar{' '}
                {CHANNEL_INFO[editingChannel].name}
              </h3>
              <button
                onClick={() => {
                  setEditingChannel(null);
                  setFormData({});
                  setTestResult(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {renderFormFields()}

            {/* Resultado del test */}
            {testResult && (
              <div
                className={`mt-4 rounded-lg p-3 text-sm ${
                  testResult.success
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-700'
                }`}
              >
                {testResult.success ? '✓' : '✗'} {testResult.message}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleTest}
                disabled={testing !== null}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {testing === editingChannel ? 'Probando...' : 'Probar conexión'}
              </button>
              <button
                onClick={() => {
                  setEditingChannel(null);
                  setFormData({});
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SocialChannelsPanel;
