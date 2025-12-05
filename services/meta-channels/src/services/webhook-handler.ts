/**
 * Webhook Handler
 * Recibe webhooks de Meta (WhatsApp, Instagram, Facebook) y los enruta al canal correcto
 */

import { logger } from './logger';
import { getBitrixConnector } from './bitrix-connector';
import type { UnifiedMessage, ChannelType } from '../types';

// Channel handlers (se inicializan en index.ts)
import { WhatsAppChannel } from '../channels/whatsapp';
import { InstagramDMChannel, InstagramCommentsChannel } from '../channels/instagram';
import { FacebookMessengerChannel, FacebookCommentsChannel } from '../channels/facebook';

interface ChannelHandlers {
  whatsapp?: WhatsAppChannel;
  instagramDM?: InstagramDMChannel;
  instagramComments?: InstagramCommentsChannel;
  facebookMessenger?: FacebookMessengerChannel;
  facebookComments?: FacebookCommentsChannel;
}

let handlers: ChannelHandlers = {};

/**
 * Inicializa los handlers de canales
 */
export function initializeHandlers(channelHandlers: ChannelHandlers): void {
  handlers = channelHandlers;
  logger.info('[WebhookHandler] Handlers inicializados', {
    whatsapp: !!handlers.whatsapp,
    instagramDM: !!handlers.instagramDM,
    instagramComments: !!handlers.instagramComments,
    facebookMessenger: !!handlers.facebookMessenger,
    facebookComments: !!handlers.facebookComments,
  });
}

/**
 * Procesa webhook de WhatsApp Business API
 */
export async function handleWhatsAppWebhook(body: any): Promise<UnifiedMessage | null> {
  if (!handlers.whatsapp) {
    logger.warn('[WebhookHandler] WhatsApp handler no inicializado');
    return null;
  }

  try {
    const message = handlers.whatsapp.parseIncomingMessage(body);

    if (message) {
      // Sincronizar con Bitrix24
      await syncToBitrix(message);

      // Notificar a Flow Builder
      await notifyFlowBuilder(message);
    }

    return message;
  } catch (error) {
    logger.error('[WebhookHandler] Error procesando WhatsApp webhook', { error });
    return null;
  }
}

/**
 * Procesa webhook de Instagram (DM o Comments)
 */
export async function handleInstagramWebhook(body: any): Promise<UnifiedMessage | null> {
  try {
    // Detectar si es DM o comentario
    const entry = body.entry?.[0];

    // Si tiene 'messaging', es un DM
    if (entry?.messaging) {
      if (!handlers.instagramDM) {
        logger.warn('[WebhookHandler] Instagram DM handler no inicializado');
        return null;
      }

      const message = handlers.instagramDM.parseIncomingMessage(body);
      if (message) {
        await syncToBitrix(message);
        await notifyFlowBuilder(message);
      }
      return message;
    }

    // Si tiene 'changes' con field 'comments', es un comentario
    if (entry?.changes?.some((c: any) => c.field === 'comments')) {
      if (!handlers.instagramComments) {
        logger.warn('[WebhookHandler] Instagram Comments handler no inicializado');
        return null;
      }

      const message = handlers.instagramComments.parseIncomingMessage(body);
      if (message) {
        await syncToBitrix(message);
        await notifyFlowBuilder(message);
      }
      return message;
    }

    logger.debug('[WebhookHandler] Instagram webhook no reconocido', { entry });
    return null;
  } catch (error) {
    logger.error('[WebhookHandler] Error procesando Instagram webhook', { error });
    return null;
  }
}

/**
 * Procesa webhook de Facebook (Messenger o Comments)
 */
export async function handleFacebookWebhook(body: any): Promise<UnifiedMessage | null> {
  try {
    const entry = body.entry?.[0];

    // Si tiene 'messaging', es Messenger
    if (entry?.messaging) {
      if (!handlers.facebookMessenger) {
        logger.warn('[WebhookHandler] Facebook Messenger handler no inicializado');
        return null;
      }

      const message = handlers.facebookMessenger.parseIncomingMessage(body);
      if (message) {
        await syncToBitrix(message);
        await notifyFlowBuilder(message);
      }
      return message;
    }

    // Si tiene 'changes' con field 'feed', es un comentario
    if (entry?.changes?.some((c: any) => c.field === 'feed')) {
      if (!handlers.facebookComments) {
        logger.warn('[WebhookHandler] Facebook Comments handler no inicializado');
        return null;
      }

      const message = handlers.facebookComments.parseIncomingMessage(body);
      if (message) {
        await syncToBitrix(message);
        await notifyFlowBuilder(message);
      }
      return message;
    }

    logger.debug('[WebhookHandler] Facebook webhook no reconocido', { entry });
    return null;
  } catch (error) {
    logger.error('[WebhookHandler] Error procesando Facebook webhook', { error });
    return null;
  }
}

/**
 * Procesa cualquier webhook de Meta detectando automáticamente el tipo
 */
export async function handleMetaWebhook(body: any): Promise<UnifiedMessage | null> {
  try {
    // Detectar tipo de webhook por object field
    const objectType = body.object;

    switch (objectType) {
      case 'whatsapp_business_account':
        return handleWhatsAppWebhook(body);

      case 'instagram':
        return handleInstagramWebhook(body);

      case 'page':
        return handleFacebookWebhook(body);

      default:
        logger.warn('[WebhookHandler] Tipo de webhook desconocido', { objectType });
        return null;
    }
  } catch (error) {
    logger.error('[WebhookHandler] Error en handleMetaWebhook', { error });
    return null;
  }
}

/**
 * Sincroniza mensaje con Bitrix24 Open Channels
 */
async function syncToBitrix(message: UnifiedMessage): Promise<void> {
  const bitrix = getBitrixConnector();
  if (!bitrix) return;

  try {
    // Enviar mensaje a Bitrix Open Channels
    await bitrix.sendIncomingMessage(message);

    // Sincronizar con CRM (crear lead si es nuevo contacto)
    await bitrix.syncToCRM(message);
  } catch (error) {
    logger.error('[WebhookHandler] Error sincronizando con Bitrix', { error });
  }
}

/**
 * Notifica a Flow Builder sobre el mensaje entrante
 */
async function notifyFlowBuilder(message: UnifiedMessage): Promise<void> {
  try {
    const flowBuilderUrl = process.env.FLOW_BUILDER_URL || 'http://localhost:3001';

    const response = await fetch(`${flowBuilderUrl}/api/external/incoming-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.FLOW_BUILDER_API_KEY || '',
      },
      body: JSON.stringify({
        message,
        source: 'meta-channels',
      }),
    });

    if (!response.ok) {
      logger.warn('[WebhookHandler] Flow Builder respondió con error', {
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (error) {
    logger.error('[WebhookHandler] Error notificando a Flow Builder', { error });
  }
}

/**
 * Verifica la firma del webhook de Meta
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  return `sha256=${expectedSignature}` === signature;
}

export default {
  initializeHandlers,
  handleMetaWebhook,
  handleWhatsAppWebhook,
  handleInstagramWebhook,
  handleFacebookWebhook,
  verifyWebhookSignature,
};
