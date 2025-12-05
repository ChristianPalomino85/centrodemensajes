/**
 * Meta Channels Microservice
 * Punto de entrada principal
 *
 * Maneja múltiples canales de Meta (WhatsApp, Instagram, Facebook)
 * con integración a Bitrix24 Open Channels
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { logger } from './services/logger';
import { initBitrixConnector, getBitrixConnector } from './services/bitrix-connector';
import { initializeHandlers } from './services/webhook-handler';
import routes, { setSendMessageHandler } from './api/routes';

// Channel Handlers
import { WhatsAppChannel } from './channels/whatsapp';
import { InstagramDMChannel, InstagramCommentsChannel } from './channels/instagram';
import { FacebookMessengerChannel, FacebookCommentsChannel } from './channels/facebook';
import type { ChannelType, OutboundMessage, SendMessageResult, ChannelConfig } from './types';

// ============================================
// INICIALIZACIÓN
// ============================================

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      logger.debug(`${req.method} ${req.path}`, {
        status: res.statusCode,
        duration: `${duration}ms`,
      });
    }
  });
  next();
});

// ============================================
// CHANNEL HANDLERS
// ============================================

// Instancias de handlers
let whatsappHandler: WhatsAppChannel | undefined;
let instagramDMHandler: InstagramDMChannel | undefined;
let instagramCommentsHandler: InstagramCommentsChannel | undefined;
let facebookMessengerHandler: FacebookMessengerChannel | undefined;
let facebookCommentsHandler: FacebookCommentsChannel | undefined;

/**
 * Inicializa los handlers de cada canal habilitado
 */
function initializeChannelHandlers(): void {
  const channelConfig: ChannelConfig = {
    whatsapp: config.channels.whatsapp.enabled ? {
      accessToken: config.channels.whatsapp.accessToken,
      phoneNumberId: config.channels.whatsapp.phoneNumberId,
      businessAccountId: config.channels.whatsapp.businessAccountId,
    } : undefined,
    instagram: config.channels.instagram.enabled ? {
      accessToken: config.channels.instagram.accessToken,
      igUserId: config.channels.instagram.igUserId,
      pageId: config.channels.instagram.pageId,
    } : undefined,
    facebook: config.channels.facebook.enabled ? {
      accessToken: config.channels.facebook.accessToken,
      pageId: config.channels.facebook.pageId,
    } : undefined,
  };

  // WhatsApp
  if (config.channels.whatsapp.enabled) {
    whatsappHandler = new WhatsAppChannel(channelConfig);
    logger.info('[Main] WhatsApp handler inicializado');
  }

  // Instagram DM
  if (config.channels.instagram.enabled) {
    instagramDMHandler = new InstagramDMChannel(channelConfig);
    logger.info('[Main] Instagram DM handler inicializado');
  }

  // Instagram Comments
  if (config.channels.instagram.enabled) {
    instagramCommentsHandler = new InstagramCommentsChannel(channelConfig);
    logger.info('[Main] Instagram Comments handler inicializado');
  }

  // Facebook Messenger
  if (config.channels.facebook.enabled) {
    facebookMessengerHandler = new FacebookMessengerChannel(channelConfig);
    logger.info('[Main] Facebook Messenger handler inicializado');
  }

  // Facebook Comments
  if (config.channels.facebook.enabled) {
    facebookCommentsHandler = new FacebookCommentsChannel(channelConfig);
    logger.info('[Main] Facebook Comments handler inicializado');
  }

  // Registrar handlers en webhook handler
  initializeHandlers({
    whatsapp: whatsappHandler,
    instagramDM: instagramDMHandler,
    instagramComments: instagramCommentsHandler,
    facebookMessenger: facebookMessengerHandler,
    facebookComments: facebookCommentsHandler,
  });
}

/**
 * Handler central para enviar mensajes a cualquier canal
 */
async function sendMessage(
  channel: ChannelType,
  message: OutboundMessage
): Promise<SendMessageResult> {
  try {
    // Determinar qué handler usar basado en canal y contexto
    switch (channel) {
      case 'whatsapp':
        if (!whatsappHandler) {
          return { success: false, error: 'WhatsApp no habilitado' };
        }
        return whatsappHandler.sendMessage(message);

      case 'instagram':
        // Si tiene commentId en context, es respuesta a comentario
        if (message.context?.commentId) {
          if (!instagramCommentsHandler) {
            return { success: false, error: 'Instagram Comments no habilitado' };
          }
          return instagramCommentsHandler.sendMessage(message);
        }
        // Si no, es DM
        if (!instagramDMHandler) {
          return { success: false, error: 'Instagram DM no habilitado' };
        }
        return instagramDMHandler.sendMessage(message);

      case 'facebook':
        // Si tiene commentId en context, es respuesta a comentario
        if (message.context?.commentId) {
          if (!facebookCommentsHandler) {
            return { success: false, error: 'Facebook Comments no habilitado' };
          }
          return facebookCommentsHandler.sendMessage(message);
        }
        // Si no, es Messenger
        if (!facebookMessengerHandler) {
          return { success: false, error: 'Facebook Messenger no habilitado' };
        }
        return facebookMessengerHandler.sendMessage(message);

      default:
        return { success: false, error: `Canal desconocido: ${channel}` };
    }
  } catch (error: any) {
    logger.error('[Main] Error enviando mensaje', { channel, error });
    return { success: false, error: error.message };
  }
}

// ============================================
// BITRIX24 INTEGRATION
// ============================================

/**
 * Inicializa la conexión con Bitrix24
 */
async function initializeBitrix(): Promise<void> {
  if (!config.bitrix.enabled) {
    logger.info('[Main] Bitrix24 deshabilitado');
    return;
  }

  if (!config.bitrix.webhookUrl || !config.bitrix.connectorId) {
    logger.warn('[Main] Bitrix24 habilitado pero faltan configuraciones');
    return;
  }

  try {
    const connector = initBitrixConnector({
      webhookUrl: config.bitrix.webhookUrl,
      connectorId: config.bitrix.connectorId,
      enabled: true,
    });

    // Registrar conector en Bitrix
    const registered = await connector.registerConnector();

    if (registered) {
      logger.info('[Main] Bitrix24 Open Channels conectado');
    } else {
      logger.warn('[Main] No se pudo registrar el conector de Bitrix24');
    }
  } catch (error) {
    logger.error('[Main] Error inicializando Bitrix24', { error });
  }
}

// ============================================
// ROUTES
// ============================================

// Registrar send message handler
setSendMessageHandler(sendMessage);

// Montar rutas
app.use('/', routes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('[Main] Error no manejado', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ============================================
// STARTUP
// ============================================

async function start(): Promise<void> {
  try {
    // Validar configuración
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
      logger.warn('[Main] Advertencias de configuración:', configErrors);
    }

    // Inicializar handlers de canales
    initializeChannelHandlers();

    // Inicializar Bitrix24
    await initializeBitrix();

    // Iniciar servidor
    app.listen(config.port, () => {
      logger.info(`[Main] Meta Channels Microservice iniciado`, {
        port: config.port,
        environment: config.nodeEnv,
        channels: {
          whatsapp: config.channels.whatsapp.enabled,
          instagram: config.channels.instagram.enabled,
          facebook: config.channels.facebook.enabled,
        },
        bitrix: config.bitrix.enabled,
      });

      console.log(`
╔═══════════════════════════════════════════════════════╗
║         META CHANNELS MICROSERVICE v1.0.0             ║
╠═══════════════════════════════════════════════════════╣
║  Puerto:    ${config.port.toString().padEnd(42)}║
║  WhatsApp:  ${(config.channels.whatsapp.enabled ? 'Habilitado' : 'Deshabilitado').padEnd(42)}║
║  Instagram: ${(config.channels.instagram.enabled ? 'Habilitado' : 'Deshabilitado').padEnd(42)}║
║  Facebook:  ${(config.channels.facebook.enabled ? 'Habilitado' : 'Deshabilitado').padEnd(42)}║
║  Bitrix24:  ${(config.bitrix.enabled ? 'Conectado' : 'Deshabilitado').padEnd(42)}║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('[Main] Error fatal al iniciar', { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('[Main] SIGTERM recibido, cerrando...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[Main] SIGINT recibido, cerrando...');
  process.exit(0);
});

// Iniciar servicio
start();

export { app, sendMessage };
