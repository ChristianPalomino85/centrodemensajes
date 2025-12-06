/**
 * API Routes para configuración de canales sociales
 * Permite gestionar Instagram, Facebook, WhatsApp y Bitrix desde el panel de admin
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || 'Azaleia.2025',
});

type ChannelType = 'whatsapp' | 'instagram' | 'facebook' | 'bitrix';

interface ChannelConfig {
  id: number;
  channel: ChannelType;
  enabled: boolean;
  config: Record<string, any>;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/channel-config
 * Obtener todas las configuraciones de canales
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query<ChannelConfig>(
      'SELECT * FROM channel_configs ORDER BY channel'
    );

    // Ocultar tokens sensibles en la respuesta
    const sanitized = result.rows.map(row => ({
      ...row,
      config: sanitizeConfig(row.config),
    }));

    res.json({ success: true, data: sanitized });
  } catch (error: any) {
    console.error('[ChannelConfig] Error obteniendo configs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/channel-config/:channel
 * Obtener configuración de un canal específico
 */
router.get('/:channel', async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;

    const result = await pool.query<ChannelConfig>(
      'SELECT * FROM channel_configs WHERE channel = $1',
      [channel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canal no encontrado' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        ...row,
        config: sanitizeConfig(row.config),
      },
    });
  } catch (error: any) {
    console.error('[ChannelConfig] Error obteniendo config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/channel-config/:channel/full
 * Obtener configuración completa (incluyendo tokens) - Solo para uso interno
 */
router.get('/:channel/full', async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;
    const apiKey = req.headers['x-internal-key'];

    // Solo permitir acceso con clave interna
    if (apiKey !== process.env.INTERNAL_API_KEY && apiKey !== 'meta-channels-service') {
      return res.status(403).json({ success: false, error: 'Acceso denegado' });
    }

    const result = await pool.query<ChannelConfig>(
      'SELECT * FROM channel_configs WHERE channel = $1',
      [channel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canal no encontrado' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error('[ChannelConfig] Error obteniendo config completa:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/channel-config/:channel
 * Actualizar configuración de un canal
 */
router.put('/:channel', async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;
    const { enabled, config } = req.body;

    // Validar canal
    const validChannels: ChannelType[] = ['whatsapp', 'instagram', 'facebook', 'bitrix'];
    if (!validChannels.includes(channel as ChannelType)) {
      return res.status(400).json({ success: false, error: 'Canal inválido' });
    }

    // Obtener config actual para merge
    const currentResult = await pool.query<ChannelConfig>(
      'SELECT config FROM channel_configs WHERE channel = $1',
      [channel]
    );

    const currentConfig = currentResult.rows[0]?.config || {};

    // Merge configs (no sobrescribir tokens si vienen vacíos o con placeholder)
    const mergedConfig = mergeConfigs(currentConfig, config || {});

    // Actualizar
    const result = await pool.query<ChannelConfig>(
      `UPDATE channel_configs
       SET enabled = COALESCE($1, enabled),
           config = $2
       WHERE channel = $3
       RETURNING *`,
      [enabled, JSON.stringify(mergedConfig), channel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canal no encontrado' });
    }

    console.log(`[ChannelConfig] Canal ${channel} actualizado`);

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        config: sanitizeConfig(result.rows[0].config),
      },
    });
  } catch (error: any) {
    console.error('[ChannelConfig] Error actualizando config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/channel-config/:channel/toggle
 * Habilitar/deshabilitar un canal
 */
router.post('/:channel/toggle', async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;

    const result = await pool.query<ChannelConfig>(
      `UPDATE channel_configs
       SET enabled = NOT enabled
       WHERE channel = $1
       RETURNING *`,
      [channel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canal no encontrado' });
    }

    const newState = result.rows[0].enabled;
    console.log(`[ChannelConfig] Canal ${channel} ${newState ? 'habilitado' : 'deshabilitado'}`);

    res.json({
      success: true,
      enabled: newState,
      message: `Canal ${channel} ${newState ? 'habilitado' : 'deshabilitado'}`,
    });
  } catch (error: any) {
    console.error('[ChannelConfig] Error toggle:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/channel-config/:channel/test
 * Probar conexión de un canal
 */
router.post('/:channel/test', async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;

    // Obtener config del canal
    const result = await pool.query<ChannelConfig>(
      'SELECT * FROM channel_configs WHERE channel = $1',
      [channel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canal no encontrado' });
    }

    const config = result.rows[0].config;
    let testResult: { success: boolean; message: string; details?: any } = {
      success: false,
      message: 'Test no implementado para este canal',
    };

    switch (channel) {
      case 'instagram':
      case 'facebook':
        testResult = await testMetaConnection(channel, config);
        break;
      case 'whatsapp':
        testResult = await testWhatsAppConnection(config);
        break;
      case 'bitrix':
        testResult = await testBitrixConnection(config);
        break;
    }

    res.json(testResult);
  } catch (error: any) {
    console.error('[ChannelConfig] Error en test:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// HELPERS
// ============================================

/**
 * Oculta tokens sensibles para mostrar en UI
 */
function sanitizeConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['accessToken', 'appSecret', 'verifyToken', 'pageAccessToken', 'webhookUrl'];
  const sanitized = { ...config };

  for (const key of sensitiveKeys) {
    if (sanitized[key] && typeof sanitized[key] === 'string' && sanitized[key].length > 0) {
      // Mostrar solo últimos 4 caracteres
      sanitized[key] = '••••••••' + sanitized[key].slice(-4);
    }
  }

  return sanitized;
}

/**
 * Merge configs sin sobrescribir tokens existentes con valores vacíos
 */
function mergeConfigs(
  current: Record<string, any>,
  updates: Record<string, any>
): Record<string, any> {
  const merged = { ...current };

  for (const [key, value] of Object.entries(updates)) {
    // No sobrescribir si el nuevo valor parece un placeholder o está vacío
    if (
      value === '' ||
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.startsWith('••••'))
    ) {
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

/**
 * Probar conexión con Meta Graph API (Instagram/Facebook)
 */
async function testMetaConnection(
  channel: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const accessToken = config.accessToken || config.pageAccessToken;
    const pageId = config.pageId;

    if (!accessToken || !pageId) {
      return {
        success: false,
        message: 'Faltan credenciales (accessToken o pageId)',
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?fields=id,name&access_token=${accessToken}`
    );

    const data = await response.json();

    if (data.error) {
      return {
        success: false,
        message: data.error.message || 'Error de autenticación',
        details: data.error,
      };
    }

    return {
      success: true,
      message: `Conectado a: ${data.name || pageId}`,
      details: { id: data.id, name: data.name },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error de conexión: ${error.message}`,
    };
  }
}

/**
 * Probar conexión WhatsApp Business API
 */
async function testWhatsAppConnection(
  config: Record<string, any>
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const accessToken = config.accessToken;
    const phoneNumberId = config.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      return {
        success: false,
        message: 'Faltan credenciales (accessToken o phoneNumberId)',
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}?access_token=${accessToken}`
    );

    const data = await response.json();

    if (data.error) {
      return {
        success: false,
        message: data.error.message || 'Error de autenticación',
        details: data.error,
      };
    }

    return {
      success: true,
      message: `WhatsApp conectado: ${data.display_phone_number || phoneNumberId}`,
      details: data,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error de conexión: ${error.message}`,
    };
  }
}

/**
 * Probar conexión Bitrix24
 */
async function testBitrixConnection(
  config: Record<string, any>
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const webhookUrl = config.webhookUrl;

    if (!webhookUrl) {
      return {
        success: false,
        message: 'Falta la URL del webhook',
      };
    }

    // Normalizar URL
    const baseUrl = webhookUrl.endsWith('/') ? webhookUrl : `${webhookUrl}/`;

    const response = await fetch(`${baseUrl}profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    if (data.error) {
      return {
        success: false,
        message: data.error_description || data.error || 'Error de Bitrix',
        details: data,
      };
    }

    if (data.result) {
      return {
        success: true,
        message: `Conectado como: ${data.result.NAME || ''} ${data.result.LAST_NAME || ''}`,
        details: data.result,
      };
    }

    return {
      success: false,
      message: 'Respuesta inesperada de Bitrix',
      details: data,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error de conexión: ${error.message}`,
    };
  }
}

export default router;
