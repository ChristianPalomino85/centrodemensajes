/**
 * Config Loader
 * Carga configuraciones de canales desde la API de Flow Builder
 * en lugar de variables de entorno, para permitir cambios dinámicos desde el panel
 */

import { logger } from './logger';
import type { ChannelConfig } from '../types';

interface ChannelConfigResponse {
  id: number;
  channel: string;
  enabled: boolean;
  config: Record<string, any>;
  updated_at: string;
}

interface LoadedConfig {
  whatsapp: {
    enabled: boolean;
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    verifyToken: string;
    appSecret: string;
  };
  instagram: {
    enabled: boolean;
    accessToken: string;
    pageId: string;
    igUserId: string;
    appSecret: string;
    verifyToken: string;
    enableDM: boolean;
    enableComments: boolean;
  };
  facebook: {
    enabled: boolean;
    accessToken: string;
    pageId: string;
    pageAccessToken: string;
    appSecret: string;
    verifyToken: string;
    enableMessenger: boolean;
    enableComments: boolean;
  };
  bitrix: {
    enabled: boolean;
    webhookUrl: string;
    connectorId: string;
    domain: string;
    enableOpenChannels: boolean;
    enableCRM: boolean;
    autoCreateLeads: boolean;
  };
}

// Cache de configuraciones
let configCache: LoadedConfig | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 60000; // 1 minuto

/**
 * Carga configuraciones desde Flow Builder API
 */
export async function loadConfigFromAPI(): Promise<LoadedConfig | null> {
  const flowBuilderUrl = process.env.FLOW_BUILDER_URL || 'http://localhost:3000';
  const internalKey = process.env.INTERNAL_API_KEY || 'meta-channels-service';

  try {
    // Obtener todas las configuraciones
    const channels = ['whatsapp', 'instagram', 'facebook', 'bitrix'];
    const configs: Record<string, ChannelConfigResponse> = {};

    for (const channel of channels) {
      try {
        const response = await fetch(
          `${flowBuilderUrl}/api/channel-config/${channel}/full`,
          {
            headers: {
              'X-Internal-Key': internalKey,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            configs[channel] = data.data;
          }
        }
      } catch (err) {
        logger.warn(`[ConfigLoader] No se pudo cargar config de ${channel}`);
      }
    }

    // Transformar a formato esperado
    const loadedConfig: LoadedConfig = {
      whatsapp: {
        enabled: configs.whatsapp?.enabled ?? false,
        accessToken: configs.whatsapp?.config?.accessToken || '',
        phoneNumberId: configs.whatsapp?.config?.phoneNumberId || '',
        businessAccountId: configs.whatsapp?.config?.businessAccountId || '',
        verifyToken: configs.whatsapp?.config?.verifyToken || '',
        appSecret: configs.whatsapp?.config?.appSecret || '',
      },
      instagram: {
        enabled: configs.instagram?.enabled ?? false,
        accessToken: configs.instagram?.config?.accessToken || '',
        pageId: configs.instagram?.config?.pageId || '',
        igUserId: configs.instagram?.config?.igUserId || '',
        appSecret: configs.instagram?.config?.appSecret || '',
        verifyToken: configs.instagram?.config?.verifyToken || '',
        enableDM: configs.instagram?.config?.enableDM !== false,
        enableComments: configs.instagram?.config?.enableComments !== false,
      },
      facebook: {
        enabled: configs.facebook?.enabled ?? false,
        accessToken: configs.facebook?.config?.accessToken || configs.facebook?.config?.pageAccessToken || '',
        pageId: configs.facebook?.config?.pageId || '',
        pageAccessToken: configs.facebook?.config?.pageAccessToken || '',
        appSecret: configs.facebook?.config?.appSecret || '',
        verifyToken: configs.facebook?.config?.verifyToken || '',
        enableMessenger: configs.facebook?.config?.enableMessenger !== false,
        enableComments: configs.facebook?.config?.enableComments !== false,
      },
      bitrix: {
        enabled: configs.bitrix?.enabled ?? false,
        webhookUrl: configs.bitrix?.config?.webhookUrl || '',
        connectorId: configs.bitrix?.config?.connectorId || 'flow_builder_connector',
        domain: configs.bitrix?.config?.domain || '',
        enableOpenChannels: configs.bitrix?.config?.enableOpenChannels !== false,
        enableCRM: configs.bitrix?.config?.enableCRM !== false,
        autoCreateLeads: configs.bitrix?.config?.autoCreateLeads !== false,
      },
    };

    configCache = loadedConfig;
    lastLoadTime = Date.now();

    logger.info('[ConfigLoader] Configuraciones cargadas desde API', {
      whatsapp: loadedConfig.whatsapp.enabled,
      instagram: loadedConfig.instagram.enabled,
      facebook: loadedConfig.facebook.enabled,
      bitrix: loadedConfig.bitrix.enabled,
    });

    return loadedConfig;
  } catch (error) {
    logger.error('[ConfigLoader] Error cargando configs desde API', { error });
    return null;
  }
}

/**
 * Obtiene configuraciones (con cache)
 */
export async function getConfig(): Promise<LoadedConfig | null> {
  // Si hay cache válido, usarlo
  if (configCache && Date.now() - lastLoadTime < CACHE_TTL_MS) {
    return configCache;
  }

  // Cargar desde API
  return loadConfigFromAPI();
}

/**
 * Fuerza recarga de configuraciones
 */
export async function reloadConfig(): Promise<LoadedConfig | null> {
  configCache = null;
  lastLoadTime = 0;
  return loadConfigFromAPI();
}

/**
 * Convierte LoadedConfig a ChannelConfig para los handlers
 */
export function toChannelConfig(loaded: LoadedConfig): ChannelConfig {
  return {
    whatsapp: loaded.whatsapp.enabled
      ? {
          accessToken: loaded.whatsapp.accessToken,
          phoneNumberId: loaded.whatsapp.phoneNumberId,
          businessAccountId: loaded.whatsapp.businessAccountId,
        }
      : undefined,
    instagram: loaded.instagram.enabled
      ? {
          accessToken: loaded.instagram.accessToken,
          pageId: loaded.instagram.pageId,
          igUserId: loaded.instagram.igUserId,
        }
      : undefined,
    facebook: loaded.facebook.enabled
      ? {
          accessToken: loaded.facebook.accessToken || loaded.facebook.pageAccessToken,
          pageId: loaded.facebook.pageId,
        }
      : undefined,
  };
}

export default {
  loadConfigFromAPI,
  getConfig,
  reloadConfig,
  toChannelConfig,
};
