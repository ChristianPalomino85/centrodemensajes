/**
 * Facebook Messenger Channel Handler
 * Handles Facebook Messenger conversations
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

export class FacebookMessengerChannel extends BaseChannel {
  constructor(config: ChannelConfig) {
    super('facebook', config);
  }

  /**
   * Parse Facebook Messenger webhook event
   */
  parseIncomingMessage(event: any): UnifiedMessage | null {
    try {
      const entry = event.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (!messaging?.message) {
        // Could be a postback, delivery, read receipt, etc.
        return null;
      }

      const msg = messaging.message;
      const senderId = messaging.sender?.id;
      const recipientId = messaging.recipient?.id;

      let messageType: MessageType = 'text';
      const content: UnifiedMessage['content'] = {};

      // Extract text
      if (msg.text) {
        content.text = msg.text;
      }

      // Extract attachments
      if (msg.attachments?.length > 0) {
        const attachment = msg.attachments[0];
        switch (attachment.type) {
          case 'image':
            messageType = 'image';
            content.mediaUrl = attachment.payload?.url;
            break;
          case 'video':
            messageType = 'video';
            content.mediaUrl = attachment.payload?.url;
            break;
          case 'audio':
            messageType = 'audio';
            content.mediaUrl = attachment.payload?.url;
            break;
          case 'file':
            messageType = 'file';
            content.mediaUrl = attachment.payload?.url;
            break;
          case 'location':
            messageType = 'location';
            content.location = {
              latitude: attachment.payload?.coordinates?.lat,
              longitude: attachment.payload?.coordinates?.long,
            };
            break;
          case 'fallback':
            // Shared content (links, posts, etc.)
            content.text = attachment.title || attachment.url || content.text;
            break;
        }
      }

      // Handle sticker
      if (msg.sticker_id) {
        messageType = 'sticker';
        content.stickerId = msg.sticker_id;
      }

      const unified: UnifiedMessage = {
        id: uuidv4(),
        externalId: msg.mid,
        channel: 'facebook',
        source: 'facebook_messenger',
        timestamp: new Date(messaging.timestamp),

        from: {
          id: senderId,
        },

        to: {
          id: recipientId,
          pageId: this.config.facebook?.pageId,
        },

        type: messageType,
        content,

        context: msg.reply_to ? {
          replyToId: msg.reply_to.mid,
        } : undefined,

        metadata: {
          raw: messaging,
          isEcho: msg.is_echo,
          appId: msg.app_id,
        },
      };

      this.logIncoming(unified);
      return unified;
    } catch (error) {
      logger.error('[Facebook Messenger] Failed to parse message', { error, event });
      return null;
    }
  }

  /**
   * Send Facebook Messenger message
   */
  async sendMessage(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const pageId = this.config.facebook?.pageId;
      if (!pageId) {
        return { success: false, error: 'Facebook page ID not configured' };
      }

      let payload: any = {
        recipient: { id: message.recipientId },
        messaging_type: 'RESPONSE',
      };

      switch (message.type) {
        case 'text':
          payload.message = { text: message.content.text };
          break;

        case 'image':
          payload.message = {
            attachment: {
              type: 'image',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          };
          break;

        case 'video':
          payload.message = {
            attachment: {
              type: 'video',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          };
          break;

        case 'audio':
          payload.message = {
            attachment: {
              type: 'audio',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          };
          break;

        case 'file':
          payload.message = {
            attachment: {
              type: 'file',
              payload: { url: message.content.mediaUrl, is_reusable: true },
            },
          };
          break;

        case 'template':
          payload.message = {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'generic',
                elements: [{
                  title: message.content.templateName,
                  // Add buttons, images, etc. as needed
                }],
              },
            },
          };
          break;

        default:
          payload.message = { text: message.content.text || 'Message' };
      }

      const response = await this.callMetaAPI(
        `/${pageId}/messages`,
        'POST',
        payload
      );

      const result: SendMessageResult = {
        success: true,
        messageId: response.message_id,
        externalId: response.message_id,
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
   * Mark message as seen
   */
  async markAsRead(_messageId: string, senderId: string): Promise<boolean> {
    try {
      const pageId = this.config.facebook?.pageId;
      if (!pageId) return false;

      await this.callMetaAPI(`/${pageId}/messages`, 'POST', {
        recipient: { id: senderId },
        sender_action: 'mark_seen',
      });

      return true;
    } catch (error) {
      logger.error('[Facebook Messenger] Failed to mark as read', { senderId, error });
      return false;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(recipientId: string, on = true): Promise<boolean> {
    try {
      const pageId = this.config.facebook?.pageId;
      if (!pageId) return false;

      await this.callMetaAPI(`/${pageId}/messages`, 'POST', {
        recipient: { id: recipientId },
        sender_action: on ? 'typing_on' : 'typing_off',
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<{ name?: string; profilePic?: string } | null> {
    try {
      const response = await this.callMetaAPI(`/${userId}`, 'GET', {
        fields: 'first_name,last_name,profile_pic',
      });

      return {
        name: `${response.first_name || ''} ${response.last_name || ''}`.trim(),
        profilePic: response.profile_pic,
      };
    } catch (error) {
      logger.error('[Facebook Messenger] Failed to get user profile', { userId, error });
      return null;
    }
  }

  /**
   * Health check
   */
  protected async performHealthCheck(): Promise<boolean> {
    try {
      const pageId = this.config.facebook?.pageId;
      if (!pageId) return false;

      const response = await this.callMetaAPI(`/${pageId}`, 'GET', {
        fields: 'id,name',
      });
      return !!response.id;
    } catch {
      return false;
    }
  }
}

export default FacebookMessengerChannel;
