/**
 * API Routes
 * Endpoints para webhooks de Meta y comunicación con Flow Builder
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  handleMetaWebhook,
  handleWhatsAppWebhook,
  handleInstagramWebhook,
  handleFacebookWebhook,
  verifyWebhookSignature,
} from '../services/webhook-handler';
import { getBitrixConnector } from '../services/bitrix-connector';
import type { OutboundMessage, ChannelType } from '../types';

// Channel handlers (se importan del index principal)
let sendMessageHandler: ((channel: ChannelType, message: OutboundMessage) => Promise<any>) | null = null;

export function setSendMessageHandler(handler: typeof sendMessageHandler): void {
  sendMessageHandler = handler;
}

const router = Router();

// ============================================
// WEBHOOK ENDPOINTS (Meta)
// ============================================

/**
 * Verificación de webhook (GET) - Requerido por Meta
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('[API] Webhook verificado exitosamente');
    res.status(200).send(challenge);
  } else {
    logger.warn('[API] Verificación de webhook fallida', { mode, token });
    res.sendStatus(403);
  }
});

/**
 * Webhook unificado (POST) - Recibe todos los eventos de Meta
 * Detecta automáticamente si es WhatsApp, Instagram o Facebook
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Verificar firma si está configurado
    const appSecret = process.env.META_APP_SECRET;
    const signature = req.headers['x-hub-signature-256'] as string;

    if (appSecret && signature) {
      const payload = JSON.stringify(req.body);
      if (!verifyWebhookSignature(payload, signature, appSecret)) {
        logger.warn('[API] Firma de webhook inválida');
        return res.sendStatus(401);
      }
    }

    // Responder inmediatamente (Meta requiere respuesta rápida)
    res.sendStatus(200);

    // Procesar en background
    const message = await handleMetaWebhook(req.body);

    if (message) {
      logger.debug('[API] Mensaje procesado', {
        channel: message.channel,
        source: message.source,
        from: message.from.id,
      });
    }
  } catch (error) {
    logger.error('[API] Error procesando webhook', { error });
    // Ya enviamos 200, no podemos enviar error
  }
});

/**
 * Webhooks específicos por canal (alternativo)
 */
router.post('/webhook/whatsapp', async (req: Request, res: Response) => {
  res.sendStatus(200);
  await handleWhatsAppWebhook(req.body);
});

router.post('/webhook/instagram', async (req: Request, res: Response) => {
  res.sendStatus(200);
  await handleInstagramWebhook(req.body);
});

router.post('/webhook/facebook', async (req: Request, res: Response) => {
  res.sendStatus(200);
  await handleFacebookWebhook(req.body);
});

// ============================================
// API ENDPOINTS (Flow Builder)
// ============================================

/**
 * Enviar mensaje a cualquier canal
 * POST /api/send
 */
router.post('/api/send', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const { channel, message } = req.body as {
      channel: ChannelType;
      message: OutboundMessage;
    };

    if (!channel || !message) {
      return res.status(400).json({ error: 'channel y message son requeridos' });
    }

    if (!sendMessageHandler) {
      return res.status(503).json({ error: 'Handlers no inicializados' });
    }

    const result = await sendMessageHandler(channel, message);

    // Sincronizar con Bitrix
    const bitrix = getBitrixConnector();
    if (bitrix && result.success) {
      await bitrix.sendOutgoingMessage(message.recipientId, channel, message);
    }

    res.json(result);
  } catch (error: any) {
    logger.error('[API] Error enviando mensaje', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Enviar mensaje a WhatsApp específicamente
 * POST /api/whatsapp/send
 */
router.post('/api/whatsapp/send', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    if (!sendMessageHandler) {
      return res.status(503).json({ error: 'Handlers no inicializados' });
    }

    const result = await sendMessageHandler('whatsapp', req.body);
    res.json(result);
  } catch (error: any) {
    logger.error('[API] Error enviando mensaje WhatsApp', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Enviar mensaje a Instagram (DM o reply a comentario)
 * POST /api/instagram/send
 */
router.post('/api/instagram/send', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    if (!sendMessageHandler) {
      return res.status(503).json({ error: 'Handlers no inicializados' });
    }

    const result = await sendMessageHandler('instagram', req.body);
    res.json(result);
  } catch (error: any) {
    logger.error('[API] Error enviando mensaje Instagram', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Enviar mensaje a Facebook (Messenger o reply a comentario)
 * POST /api/facebook/send
 */
router.post('/api/facebook/send', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    if (!sendMessageHandler) {
      return res.status(503).json({ error: 'Handlers no inicializados' });
    }

    const result = await sendMessageHandler('facebook', req.body);
    res.json(result);
  } catch (error: any) {
    logger.error('[API] Error enviando mensaje Facebook', { error });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MODERATION ENDPOINTS
// ============================================

/**
 * Ocultar comentario (Instagram o Facebook)
 * POST /api/comments/hide
 */
router.post('/api/comments/hide', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const { channel, commentId } = req.body;

    if (!channel || !commentId) {
      return res.status(400).json({ error: 'channel y commentId son requeridos' });
    }

    // TODO: Implementar llamada al handler correspondiente
    res.json({ success: true, message: 'Comentario ocultado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Eliminar comentario (Instagram o Facebook)
 * POST /api/comments/delete
 */
router.post('/api/comments/delete', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const { channel, commentId } = req.body;

    if (!channel || !commentId) {
      return res.status(400).json({ error: 'channel y commentId son requeridos' });
    }

    // TODO: Implementar llamada al handler correspondiente
    res.json({ success: true, message: 'Comentario eliminado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BITRIX ENDPOINTS
// ============================================

/**
 * Transferir conversación a operador en Bitrix
 * POST /api/bitrix/transfer
 */
router.post('/api/bitrix/transfer', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const bitrix = getBitrixConnector();
    if (!bitrix) {
      return res.status(503).json({ error: 'Bitrix no configurado' });
    }

    const { recipientId, channel, operatorId } = req.body;

    const result = await bitrix.transferToOperator(recipientId, channel, operatorId);
    res.json({ success: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener historial de chat desde Bitrix
 * GET /api/bitrix/history/:channel/:recipientId
 */
router.get('/api/bitrix/history/:channel/:recipientId', async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.META_CHANNELS_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const bitrix = getBitrixConnector();
    if (!bitrix) {
      return res.status(503).json({ error: 'Bitrix no configurado' });
    }

    const { channel, recipientId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const history = await bitrix.getChatHistory(recipientId, channel as ChannelType, limit);
    res.json({ messages: history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH & STATUS
// ============================================

/**
 * Health check
 */
router.get('/health', async (req: Request, res: Response) => {
  const bitrix = getBitrixConnector();

  const status = {
    service: 'meta-channels',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    bitrix: bitrix ? await bitrix.healthCheck() : false,
  };

  res.json(status);
});

/**
 * Estado detallado de los canales
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    service: 'meta-channels',
    version: '1.0.0',
    channels: {
      whatsapp: {
        enabled: process.env.WHATSAPP_ENABLED === 'true',
        configured: !!process.env.WHATSAPP_ACCESS_TOKEN,
      },
      instagram: {
        enabled: process.env.INSTAGRAM_ENABLED === 'true',
        configured: !!process.env.INSTAGRAM_ACCESS_TOKEN,
      },
      facebook: {
        enabled: process.env.FACEBOOK_ENABLED === 'true',
        configured: !!process.env.FACEBOOK_ACCESS_TOKEN,
      },
    },
    bitrix: {
      enabled: process.env.BITRIX_ENABLED === 'true',
      configured: !!process.env.BITRIX_WEBHOOK_URL,
    },
  });
});

export default router;
