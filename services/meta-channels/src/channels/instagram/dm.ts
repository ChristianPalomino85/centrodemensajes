/**
 * Instagram DM Channel Handler
 * Handles Instagram Direct Messages
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

export class InstagramDMChannel extends BaseChannel {
  constructor(config: ChannelConfig) {
    super('instagram', config);
  }

  /**
   * Parse Instagram DM webhook event
   */
  parseIncomingMessage(event: any): UnifiedMessage | null {
    try {
      // Instagram messaging webhook structure
      const entry = event.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (!messaging?.message) {
        return null;
      }

      const msg = messaging.message;
      const senderId = messaging.sender?.id;
      const recipientId = messaging.recipient?.id;

      // Determine message type and source
      let source: UnifiedMessage['source'] = 'instagram_dm';
      let messageType: MessageType = 'text';
      const content: UnifiedMessage['content'] = {};
      const context: UnifiedMessage['context'] = {};

      // Check for story reply
      if (msg.reply_to?.story) {
        source = 'instagram_story_reply';
        messageType = 'story_reply';
        context.storyId = msg.reply_to.story.id;
        content.storyUrl = msg.reply_to.story.url;
      }

      // Check for story mention
      if (msg.attachments?.[0]?.type === 'story_mention') {
        source = 'instagram_story_mention';
        messageType = 'story_mention';
        context.storyId = msg.attachments[0].payload?.story_id;
        content.storyUrl = msg.attachments[0].payload?.url;
      }

      // Extract text content
      if (msg.text) {
        content.text = msg.text;
        if (messageType === 'text') messageType = 'text';
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
          case 'share':
            // Shared post/reel
            content.mediaUrl = attachment.payload?.url;
            content.text = content.text || 'Shared a post';
            break;
        }
      }

      // Handle reactions
      if (msg.reaction) {
        messageType = 'reaction';
        content.reaction = {
          emoji: msg.reaction.emoji,
          targetMessageId: msg.reaction.mid,
        };
      }

      const unified: UnifiedMessage = {
        id: uuidv4(),
        externalId: msg.mid,
        channel: 'instagram',
        source,
        timestamp: new Date(messaging.timestamp),

        from: {
          id: senderId,
          // Note: Need to fetch user info separately for name/username
        },

        to: {
          id: recipientId,
          pageId: this.config.instagram?.pageId,
        },

        type: messageType,
        content,

        context: Object.keys(context).length > 0 ? context : undefined,

        metadata: {
          raw: messaging,
        },
      };

      this.logIncoming(unified);
      return unified;
    } catch (error) {
      logger.error('[Instagram DM] Failed to parse message', { error, event });
      return null;
    }
  }

  /**
   * Send Instagram DM
   */
  async sendMessage(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const pageId = this.config.instagram?.pageId;
      if (!pageId) {
        return { success: false, error: 'Instagram page ID not configured' };
      }

      let payload: any = {
        recipient: { id: message.recipientId },
      };

      switch (message.type) {
        case 'text':
          payload.message = { text: message.content.text };
          break;

        case 'image':
          payload.message = {
            attachment: {
              type: 'image',
              payload: { url: message.content.mediaUrl },
            },
          };
          break;

        case 'video':
          payload.message = {
            attachment: {
              type: 'video',
              payload: { url: message.content.mediaUrl },
            },
          };
          break;

        case 'reaction':
          payload.sender_action = 'react';
          payload.payload = {
            message_id: message.context?.commentId,
            reaction: message.content.reaction,
          };
          break;

        default:
          // For unsupported types, send as text with link
          payload.message = {
            text: message.content.text || message.content.caption || 'Media attachment',
          };
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
  async markAsRead(messageId: string, senderId: string): Promise<boolean> {
    try {
      const pageId = this.config.instagram?.pageId;
      if (!pageId) return false;

      await this.callMetaAPI(`/${pageId}/messages`, 'POST', {
        recipient: { id: senderId },
        sender_action: 'mark_seen',
      });

      return true;
    } catch (error) {
      logger.error('[Instagram DM] Failed to mark as read', { messageId, error });
      return false;
    }
  }

  /**
   * Get user profile info
   */
  async getUserProfile(userId: string): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
    try {
      const response = await this.callMetaAPI(`/${userId}`, 'GET', {
        fields: 'name,username,profile_pic',
      });

      return {
        name: response.name,
        username: response.username,
        profilePic: response.profile_pic,
      };
    } catch (error) {
      logger.error('[Instagram DM] Failed to get user profile', { userId, error });
      return null;
    }
  }

  /**
   * Health check
   */
  protected async performHealthCheck(): Promise<boolean> {
    try {
      const pageId = this.config.instagram?.pageId;
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

export default InstagramDMChannel;
