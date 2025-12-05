/**
 * Instagram Comments Channel Handler
 * Handles comments on Instagram posts and reels
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseChannel } from '../base-channel';
import type {
  UnifiedMessage,
  OutboundMessage,
  SendMessageResult,
  ChannelConfig,
} from '../../types';
import { logger } from '../../services/logger';

export class InstagramCommentsChannel extends BaseChannel {
  constructor(config: ChannelConfig) {
    super('instagram', config);
  }

  /**
   * Parse Instagram comment webhook event
   */
  parseIncomingMessage(event: any): UnifiedMessage | null {
    try {
      // Instagram comments webhook structure
      // entry[].changes[].value (field = 'comments')
      const entry = event.entry?.[0];
      const change = entry?.changes?.find((c: any) => c.field === 'comments');

      if (!change?.value) {
        return null;
      }

      const comment = change.value;

      // Check if this is a comment on our content
      if (!comment.id || !comment.text) {
        return null;
      }

      const unified: UnifiedMessage = {
        id: uuidv4(),
        externalId: comment.id,
        channel: 'instagram',
        source: 'instagram_comment',
        timestamp: new Date(comment.timestamp || Date.now()),

        from: {
          id: comment.from?.id,
          name: comment.from?.username,
          username: comment.from?.username,
        },

        to: {
          id: this.config.instagram?.igUserId || '',
          pageId: this.config.instagram?.pageId,
        },

        type: 'comment',
        content: {
          text: comment.text,
        },

        context: {
          postId: comment.media?.id,
          commentId: comment.parent_id, // If this is a reply to another comment
        },

        metadata: {
          raw: comment,
          mediaType: comment.media?.media_type, // IMAGE, VIDEO, CAROUSEL_ALBUM
          mediaUrl: comment.media?.media_url,
        },
      };

      this.logIncoming(unified);
      return unified;
    } catch (error) {
      logger.error('[Instagram Comments] Failed to parse', { error, event });
      return null;
    }
  }

  /**
   * Reply to Instagram comment
   */
  async sendMessage(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      // Check if this should be a private reply (DM) or public reply
      if (message.context?.isPrivateReply) {
        return this.sendPrivateReply(message);
      }

      return this.sendPublicReply(message);
    } catch (error: any) {
      const result: SendMessageResult = {
        success: false,
        error: error.message,
      };
      this.logOutgoing(message, result);
      return result;
    }
  }

  /**
   * Send public reply to comment
   */
  private async sendPublicReply(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const commentId = message.context?.commentId;
      if (!commentId) {
        return { success: false, error: 'Comment ID required for reply' };
      }

      // Reply to comment
      const response = await this.callMetaAPI(
        `/${commentId}/replies`,
        'POST',
        { message: message.content.text }
      );

      const result: SendMessageResult = {
        success: true,
        messageId: response.id,
        externalId: response.id,
      };

      this.logOutgoing(message, result);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Send private reply (DM) to commenter
   */
  private async sendPrivateReply(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const commentId = message.context?.commentId;
      if (!commentId) {
        return { success: false, error: 'Comment ID required for private reply' };
      }

      const pageId = this.config.instagram?.pageId;
      if (!pageId) {
        return { success: false, error: 'Page ID not configured' };
      }

      // Send private reply via DM
      const response = await this.callMetaAPI(
        `/${pageId}/messages`,
        'POST',
        {
          recipient: { comment_id: commentId },
          message: { text: message.content.text },
        }
      );

      const result: SendMessageResult = {
        success: true,
        messageId: response.message_id,
        externalId: response.message_id,
      };

      this.logOutgoing(message, result);
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Hide a comment (moderation)
   */
  async hideComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}`, 'POST', { hide: true });
      logger.info('[Instagram Comments] Comment hidden', { commentId });
      return true;
    } catch (error) {
      logger.error('[Instagram Comments] Failed to hide comment', { commentId, error });
      return false;
    }
  }

  /**
   * Delete a comment (moderation)
   */
  async deleteComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}`, 'DELETE');
      logger.info('[Instagram Comments] Comment deleted', { commentId });
      return true;
    } catch (error) {
      logger.error('[Instagram Comments] Failed to delete comment', { commentId, error });
      return false;
    }
  }

  /**
   * Like a comment
   */
  async likeComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}/likes`, 'POST');
      return true;
    } catch (error) {
      logger.error('[Instagram Comments] Failed to like comment', { commentId, error });
      return false;
    }
  }

  /**
   * Get recent comments on a media
   */
  async getMediaComments(mediaId: string, limit = 50): Promise<any[]> {
    try {
      const response = await this.callMetaAPI(`/${mediaId}/comments`, 'GET', {
        fields: 'id,text,timestamp,username,from',
        limit,
      });
      return response.data || [];
    } catch (error) {
      logger.error('[Instagram Comments] Failed to get comments', { mediaId, error });
      return [];
    }
  }

  /**
   * Mark as read - not applicable for comments
   */
  async markAsRead(_messageId: string, _senderId: string): Promise<boolean> {
    // Comments don't have read receipts
    return true;
  }

  /**
   * Health check
   */
  protected async performHealthCheck(): Promise<boolean> {
    try {
      const igUserId = this.config.instagram?.igUserId;
      if (!igUserId) return false;

      const response = await this.callMetaAPI(`/${igUserId}`, 'GET', {
        fields: 'id,username',
      });
      return !!response.id;
    } catch {
      return false;
    }
  }
}

export default InstagramCommentsChannel;
