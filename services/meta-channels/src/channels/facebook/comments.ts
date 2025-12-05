/**
 * Facebook Comments Channel Handler
 * Handles comments on Facebook Page posts and ads
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

export class FacebookCommentsChannel extends BaseChannel {
  constructor(config: ChannelConfig) {
    super('facebook', config);
  }

  /**
   * Parse Facebook comment webhook event
   */
  parseIncomingMessage(event: any): UnifiedMessage | null {
    try {
      const entry = event.entry?.[0];
      const change = entry?.changes?.find((c: any) => c.field === 'feed');

      if (!change?.value) {
        return null;
      }

      const value = change.value;

      // Check if this is a comment (not a post or other feed item)
      if (value.item !== 'comment') {
        return null;
      }

      // Ignore comments from our own page
      if (value.from?.id === this.config.facebook?.pageId) {
        return null;
      }

      const unified: UnifiedMessage = {
        id: uuidv4(),
        externalId: value.comment_id,
        channel: 'facebook',
        source: 'facebook_comment',
        timestamp: new Date(value.created_time * 1000),

        from: {
          id: value.from?.id,
          name: value.from?.name,
        },

        to: {
          id: this.config.facebook?.pageId || '',
          pageId: this.config.facebook?.pageId,
        },

        type: value.parent_id ? 'comment_reply' : 'comment',
        content: {
          text: value.message,
          mediaUrl: value.photo || value.video,
        },

        context: {
          postId: value.post_id,
          commentId: value.parent_id, // Parent comment if this is a reply
          adId: value.ad_id, // If comment is on an ad
        },

        metadata: {
          raw: value,
          verb: value.verb, // 'add', 'edit', 'remove'
          isReply: !!value.parent_id,
          postUrl: value.post?.permalink_url,
        },
      };

      this.logIncoming(unified);
      return unified;
    } catch (error) {
      logger.error('[Facebook Comments] Failed to parse', { error, event });
      return null;
    }
  }

  /**
   * Reply to Facebook comment
   */
  async sendMessage(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      // Check if private reply
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
        return { success: false, error: 'Comment ID required' };
      }

      const payload: any = {
        message: message.content.text,
      };

      // Attach image if provided
      if (message.content.mediaUrl) {
        payload.attachment_url = message.content.mediaUrl;
      }

      const response = await this.callMetaAPI(
        `/${commentId}/comments`,
        'POST',
        payload
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
   * Send private reply (Messenger) to commenter
   */
  private async sendPrivateReply(message: OutboundMessage): Promise<SendMessageResult> {
    try {
      const commentId = message.context?.commentId;
      if (!commentId) {
        return { success: false, error: 'Comment ID required for private reply' };
      }

      const pageId = this.config.facebook?.pageId;
      if (!pageId) {
        return { success: false, error: 'Page ID not configured' };
      }

      // Send private reply via Messenger
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
   * Hide a comment
   */
  async hideComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}`, 'POST', { is_hidden: true });
      logger.info('[Facebook Comments] Comment hidden', { commentId });
      return true;
    } catch (error) {
      logger.error('[Facebook Comments] Failed to hide', { commentId, error });
      return false;
    }
  }

  /**
   * Unhide a comment
   */
  async unhideComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}`, 'POST', { is_hidden: false });
      logger.info('[Facebook Comments] Comment unhidden', { commentId });
      return true;
    } catch (error) {
      logger.error('[Facebook Comments] Failed to unhide', { commentId, error });
      return false;
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<boolean> {
    try {
      await this.callMetaAPI(`/${commentId}`, 'DELETE');
      logger.info('[Facebook Comments] Comment deleted', { commentId });
      return true;
    } catch (error) {
      logger.error('[Facebook Comments] Failed to delete', { commentId, error });
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
      logger.error('[Facebook Comments] Failed to like', { commentId, error });
      return false;
    }
  }

  /**
   * Get comments on a post
   */
  async getPostComments(postId: string, limit = 50): Promise<any[]> {
    try {
      const response = await this.callMetaAPI(`/${postId}/comments`, 'GET', {
        fields: 'id,message,created_time,from,attachment,comment_count',
        limit,
      });
      return response.data || [];
    } catch (error) {
      logger.error('[Facebook Comments] Failed to get comments', { postId, error });
      return [];
    }
  }

  /**
   * Mark as read - not applicable for comments
   */
  async markAsRead(_messageId: string, _senderId: string): Promise<boolean> {
    return true;
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

export default FacebookCommentsChannel;
