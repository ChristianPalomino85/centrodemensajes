/**
 * Bitrix24 Open Channels Connector
 * Implementa la API imconnector para sincronizar mensajes con Bitrix24
 * Permite ver historial de chats, usar automatizaciones y CRM
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';
import type { UnifiedMessage, OutboundMessage, ChannelType } from '../types';

interface BitrixConfig {
  webhookUrl: string;
  connectorId: string;
  enabled: boolean;
}

interface BitrixUser {
  id: string;
  name?: string;
  avatar?: string;
  email?: string;
  phone?: string;
}

interface BitrixMessageData {
  connector: string;
  line: string;
  chat_id: string;
  user: BitrixUser;
  message: {
    id: string;
    date: string;
    text?: string;
    files?: Array<{
      name: string;
      type: string;
      link: string;
    }>;
  };
}

/**
 * Conector de Bitrix24 Open Channels (imconnector)
 * Sincroniza todos los canales (WhatsApp, Instagram, Facebook) con Bitrix24
 */
export class BitrixConnector {
  private readonly config: BitrixConfig;
  private readonly client: AxiosInstance;
  private isRegistered = false;
  private lineId: string | null = null;

  constructor(config: BitrixConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.webhookUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Registra el conector personalizado en Bitrix24
   * Solo necesita ejecutarse una vez
   */
  async registerConnector(): Promise<boolean> {
    if (!this.config.enabled) {
      logger.info('[Bitrix] Conector deshabilitado');
      return false;
    }

    try {
      // Verificar si ya está registrado
      const statusResponse = await this.client.post('imconnector.status', {
        CONNECTOR: this.config.connectorId,
      });

      if (statusResponse.data?.result?.active) {
        this.isRegistered = true;
        this.lineId = statusResponse.data.result.line;
        logger.info('[Bitrix] Conector ya registrado', { lineId: this.lineId });
        return true;
      }

      // Registrar nuevo conector
      const registerResponse = await this.client.post('imconnector.register', {
        ID: this.config.connectorId,
        NAME: 'Flow Builder Multi-Channel',
        ICON: {
          DATA_IMAGE: '', // Base64 del icono (opcional)
        },
        PLACEMENT_HANDLER: '', // URL para configuración en Bitrix (opcional)
      });

      if (registerResponse.data?.result) {
        logger.info('[Bitrix] Conector registrado exitosamente');

        // Activar el conector
        await this.activateConnector();
        return true;
      }

      logger.error('[Bitrix] Error al registrar conector', registerResponse.data);
      return false;
    } catch (error: any) {
      logger.error('[Bitrix] Error en registro', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Activa el conector en una línea de Open Channels
   */
  async activateConnector(): Promise<boolean> {
    try {
      const response = await this.client.post('imconnector.activate', {
        CONNECTOR: this.config.connectorId,
        LINE: 0, // 0 = crear nueva línea automáticamente
        ACTIVE: 1,
      });

      if (response.data?.result) {
        this.isRegistered = true;
        this.lineId = response.data.result.line || response.data.result;
        logger.info('[Bitrix] Conector activado', { lineId: this.lineId });
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error('[Bitrix] Error al activar', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Envía un mensaje entrante a Bitrix24
   * Crea la conversación en Open Channels y actualiza CRM
   */
  async sendIncomingMessage(message: UnifiedMessage): Promise<boolean> {
    if (!this.config.enabled || !this.isRegistered) {
      return false;
    }

    try {
      // Construir ID único de chat basado en canal y usuario
      const chatId = this.buildChatId(message.channel, message.from.id);

      // Construir datos del usuario
      const user: BitrixUser = {
        id: message.from.id,
        name: message.from.name || message.from.username || message.from.phone || 'Usuario',
      };

      // Agregar teléfono si es WhatsApp
      if (message.channel === 'whatsapp' && message.from.phone) {
        user.phone = message.from.phone;
      }

      // Construir mensaje para Bitrix
      const bitrixMessage: BitrixMessageData = {
        connector: this.config.connectorId,
        line: this.lineId || '1',
        chat_id: chatId,
        user,
        message: {
          id: message.externalId,
          date: message.timestamp.toISOString(),
          text: message.content.text,
        },
      };

      // Agregar archivos adjuntos si hay
      if (message.content.mediaUrl) {
        bitrixMessage.message.files = [{
          name: this.getMediaFileName(message),
          type: this.getMediaMimeType(message),
          link: message.content.mediaUrl,
        }];
      }

      // Enviar a Bitrix
      const response = await this.client.post('imconnector.send.messages', {
        CONNECTOR: this.config.connectorId,
        LINE: this.lineId,
        MESSAGES: [bitrixMessage],
      });

      if (response.data?.result) {
        logger.debug('[Bitrix] Mensaje sincronizado', {
          channel: message.channel,
          chatId,
          messageId: message.externalId,
        });
        return true;
      }

      logger.warn('[Bitrix] Respuesta inesperada', response.data);
      return false;
    } catch (error: any) {
      logger.error('[Bitrix] Error enviando mensaje', {
        channel: message.channel,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Envía un mensaje saliente (respuesta del bot) a Bitrix24
   * Para que aparezca en el historial de chat
   */
  async sendOutgoingMessage(
    recipientId: string,
    channel: ChannelType,
    message: OutboundMessage
  ): Promise<boolean> {
    if (!this.config.enabled || !this.isRegistered) {
      return false;
    }

    try {
      const chatId = this.buildChatId(channel, recipientId);

      const response = await this.client.post('imconnector.send.status.delivery', {
        CONNECTOR: this.config.connectorId,
        LINE: this.lineId,
        MESSAGES: [{
          im: chatId,
          message: {
            id: message.id || `out_${Date.now()}`,
            date: new Date().toISOString(),
            text: message.content.text || message.content.caption || '[Media]',
          },
        }],
      });

      return !!response.data?.result;
    } catch (error: any) {
      logger.error('[Bitrix] Error enviando respuesta', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Actualiza el estado de lectura en Bitrix
   */
  async updateReadStatus(
    recipientId: string,
    channel: ChannelType,
    messageIds: string[]
  ): Promise<boolean> {
    if (!this.config.enabled || !this.isRegistered) {
      return false;
    }

    try {
      const chatId = this.buildChatId(channel, recipientId);

      await this.client.post('imconnector.send.status.reading', {
        CONNECTOR: this.config.connectorId,
        LINE: this.lineId,
        CHAT: chatId,
        MESSAGES: messageIds.map(id => ({ id })),
      });

      return true;
    } catch (error: any) {
      logger.error('[Bitrix] Error actualizando estado de lectura', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Crea o actualiza un lead/contacto en Bitrix CRM
   */
  async syncToCRM(message: UnifiedMessage): Promise<string | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Buscar contacto existente
      let contactId: string | null = null;

      // Buscar por teléfono si es WhatsApp
      if (message.channel === 'whatsapp' && message.from.phone) {
        const searchResponse = await this.client.post('crm.contact.list', {
          filter: { PHONE: message.from.phone },
          select: ['ID'],
        });

        if (searchResponse.data?.result?.[0]?.ID) {
          contactId = searchResponse.data.result[0].ID;
        }
      }

      // Si no existe, crear lead
      if (!contactId) {
        const leadResponse = await this.client.post('crm.lead.add', {
          fields: {
            TITLE: `${this.getChannelLabel(message.channel)}: ${message.from.name || message.from.id}`,
            NAME: message.from.name || message.from.username,
            PHONE: message.from.phone ? [{ VALUE: message.from.phone, VALUE_TYPE: 'WORK' }] : undefined,
            SOURCE_ID: 'WEB',
            SOURCE_DESCRIPTION: `Canal: ${message.channel}, Fuente: ${message.source}`,
            COMMENTS: `Primer mensaje: ${message.content.text || '[Media]'}`,
          },
        });

        if (leadResponse.data?.result) {
          logger.info('[Bitrix] Lead creado', { leadId: leadResponse.data.result });
          return leadResponse.data.result.toString();
        }
      }

      return contactId;
    } catch (error: any) {
      logger.error('[Bitrix] Error sincronizando CRM', {
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Obtiene el historial de chat desde Bitrix
   */
  async getChatHistory(
    recipientId: string,
    channel: ChannelType,
    limit = 50
  ): Promise<any[]> {
    if (!this.config.enabled || !this.isRegistered) {
      return [];
    }

    try {
      const chatId = this.buildChatId(channel, recipientId);

      const response = await this.client.post('im.dialog.messages.get', {
        DIALOG_ID: chatId,
        LIMIT: limit,
      });

      return response.data?.result?.messages || [];
    } catch (error: any) {
      logger.error('[Bitrix] Error obteniendo historial', {
        error: error.response?.data || error.message,
      });
      return [];
    }
  }

  /**
   * Transfiere chat a un operador humano
   */
  async transferToOperator(
    recipientId: string,
    channel: ChannelType,
    operatorId?: string
  ): Promise<boolean> {
    if (!this.config.enabled || !this.isRegistered) {
      return false;
    }

    try {
      const chatId = this.buildChatId(channel, recipientId);

      // Enviar evento de transferencia
      await this.client.post('imopenlines.session.transfer', {
        CHAT_ID: chatId,
        TRANSFER_ID: operatorId, // Si no se especifica, va a cola general
      });

      logger.info('[Bitrix] Chat transferido', { chatId, operatorId });
      return true;
    } catch (error: any) {
      logger.error('[Bitrix] Error en transferencia', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Verifica la conexión con Bitrix24
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.post('imconnector.status', {
        CONNECTOR: this.config.connectorId,
      });
      return !!response.data?.result;
    } catch {
      return false;
    }
  }

  // --- Helpers privados ---

  private buildChatId(channel: ChannelType, recipientId: string): string {
    // Crear ID único que incluya canal para evitar colisiones
    return `${channel}_${recipientId}`;
  }

  private getMediaFileName(message: UnifiedMessage): string {
    const type = message.type;
    const ext = type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'file';
    return `${type}_${message.externalId}.${ext}`;
  }

  private getMediaMimeType(message: UnifiedMessage): string {
    switch (message.type) {
      case 'image': return 'image/jpeg';
      case 'video': return 'video/mp4';
      case 'audio': return 'audio/mpeg';
      default: return 'application/octet-stream';
    }
  }

  private getChannelLabel(channel: ChannelType): string {
    switch (channel) {
      case 'whatsapp': return 'WhatsApp';
      case 'instagram': return 'Instagram';
      case 'facebook': return 'Facebook';
      default: return channel;
    }
  }
}

// Singleton para uso global
let bitrixConnector: BitrixConnector | null = null;

export function initBitrixConnector(config: BitrixConfig): BitrixConnector {
  bitrixConnector = new BitrixConnector(config);
  return bitrixConnector;
}

export function getBitrixConnector(): BitrixConnector | null {
  return bitrixConnector;
}

export default BitrixConnector;
