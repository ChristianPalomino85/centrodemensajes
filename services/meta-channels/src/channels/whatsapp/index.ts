/**
 * WhatsApp Channel Handler
 * Handles WhatsApp Business API messages
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseChannel } from '../base-channel';
import type {
  UnifiedMessage,
  OutboundMessage,
  SendMessageResult,
  ChannelConfig,
  MessageType,
} from '../../types';
import { logger } from '../../services/logger';

export class WhatsAppChannel extends BaseChannel {
  constructor(config: ChannelConfig) {
    super('whatsapp', config);
  }

  /**
   * Parse WhatsApp webhook event into unified message
   */
  parseIncomingMessage(event: any): UnifiedMessage | null {
    try {
      // WhatsApp webhook structure:
      // event.entry[].changes[].value.messages[]
      const entry = event.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value?.messages?.[0]) {
        return null;
      }

      const msg = value.messages[0];
      const contact = value.contacts?.[0];

      const messageType = this.mapMessageType(msg.type);
      const content = this.extractContent(msg);

      const unified: UnifiedMessage = {
        id: uuidv4(),
        externalId: msg.id,
        channel: 'whatsapp',
        source: 'whatsapp_dm',
        timestamp: new Date(parseInt(msg.timestamp) * 1000),

        from: {
          id: msg.from,
          name: contact?.profile?.name,
          phone: msg.from,
        },

        to: {
          id: value.metadata?.phone_number_id || '',
          phoneNumberId: value.metadata?.phone_number_id,
        },

        type: messageType,
        content,

        context: msg.context ? {
          replyToId: msg.context.id,
        } : undefined,

        metadata: {
          raw: msg,
        },
      };

      this.logIncoming(unified);
      return unified;
    } catch (error) {
      logger.error('[WhatsApp] Failed to parse incoming message', { error, event });
      return null;
    }
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const phoneNumberId = this.config.whatsapp?.phoneNumberId;
      if (!phoneNumberId) {
        return { success: false, error: 'Phone number ID not configured' };
      }

      let payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.recipientId,
      };

      switch (message.type) {
        case 'text':
          payload.type = 'text';
          payload.text = { body: message.content.text };
          break;

        case 'image':
          payload.type = 'image';
          payload.image = {
            link: message.content.mediaUrl,
            caption: message.content.caption,
          };
          break;

        case 'video':
          payload.type = 'video';
          payload.video = {
            link: message.content.mediaUrl,
            caption: message.content.caption,
          };
          break;

        case 'audio':
          payload.type = 'audio';
          payload.audio = { link: message.content.mediaUrl };
          break;

        case 'file':
          payload.type = 'document';
          payload.document = {
            link: message.content.mediaUrl,
            caption: message.content.caption,
          };
          break;

        case 'template':
          payload.type = 'template';
          payload.template = {
            name: message.content.templateName,
            language: { code: 'es' },
            components: message.content.templateParams ? [{
              type: 'body',
              parameters: Object.values(message.content.templateParams).map(value => ({
                type: 'text',
                text: value,
              })),
            }] : undefined,
          };
          break;

        case 'reaction':
          payload.type = 'reaction';
          payload.reaction = {
            message_id: message.context?.commentId,
            emoji: message.content.reaction,
          };
          break;

        default:
          return { success: false, error: `Unsupported message type: ${message.type}` };
      }

      const response = await this.callMetaAPI(
        `/${phoneNumberId}/messages`,
        'POST',
        payload
      );

      const result: SendMessageResult = {
        success: true,
        messageId: response.messages?.[0]?.id,
        externalId: response.messages?.[0]?.id,
      };

      this.logOutgoing(message, result);
      return result;
    } catch (error: any) {
      const result: SendMessageResult = {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
      this.logOutgoing(message, result);
      return result;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string, _senderId: string): Promise<boolean> {
    try {
      const phoneNumberId = this.config.whatsapp?.phoneNumberId;
      if (!phoneNumberId) return false;

      await this.callMetaAPI(`/${phoneNumberId}/messages`, 'POST', {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });

      return true;
    } catch (error) {
      logger.error('[WhatsApp] Failed to mark as read', { messageId, error });
      return false;
    }
  }

  /**
   * Health check
   */
  protected async performHealthCheck(): Promise<boolean> {
    try {
      const phoneNumberId = this.config.whatsapp?.phoneNumberId;
      if (!phoneNumberId) return false;

      const response = await this.callMetaAPI(`/${phoneNumberId}`);
      return !!response.id;
    } catch {
      return false;
    }
  }

  /**
   * Map WhatsApp message type to unified type
   */
  private mapMessageType(waType: string): MessageType {
    const typeMap: Record<string, MessageType> = {
      text: 'text',
      image: 'image',
      video: 'video',
      audio: 'audio',
      document: 'file',
      sticker: 'sticker',
      location: 'location',
      contacts: 'contact',
      reaction: 'reaction',
    };
    return typeMap[waType] || 'text';
  }

  /**
   * Extract content from WhatsApp message
   */
  private extractContent(msg: any): UnifiedMessage['content'] {
    const content: UnifiedMessage['content'] = {};

    switch (msg.type) {
      case 'text':
        content.text = msg.text?.body;
        break;

      case 'image':
        content.mediaUrl = msg.image?.id;
        content.mediaMimeType = msg.image?.mime_type;
        content.caption = msg.image?.caption;
        break;

      case 'video':
        content.mediaUrl = msg.video?.id;
        content.mediaMimeType = msg.video?.mime_type;
        content.caption = msg.video?.caption;
        break;

      case 'audio':
        content.mediaUrl = msg.audio?.id;
        content.mediaMimeType = msg.audio?.mime_type;
        break;

      case 'document':
        content.mediaUrl = msg.document?.id;
        content.mediaMimeType = msg.document?.mime_type;
        content.caption = msg.document?.caption || msg.document?.filename;
        break;

      case 'sticker':
        content.stickerId = msg.sticker?.id;
        content.mediaMimeType = msg.sticker?.mime_type;
        break;

      case 'location':
        content.location = {
          latitude: msg.location?.latitude,
          longitude: msg.location?.longitude,
          name: msg.location?.name,
          address: msg.location?.address,
        };
        break;

      case 'contacts':
        const contact = msg.contacts?.[0];
        if (contact) {
          content.contact = {
            name: contact.name?.formatted_name || '',
            phone: contact.phones?.[0]?.phone,
            email: contact.emails?.[0]?.email,
          };
        }
        break;

      case 'reaction':
        content.reaction = {
          emoji: msg.reaction?.emoji,
          targetMessageId: msg.reaction?.message_id,
        };
        break;
    }

    return content;
  }
}

export default WhatsAppChannel;
