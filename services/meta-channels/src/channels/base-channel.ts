/**
 * Base Channel Handler
 * Abstract class for all channel implementations
 */

import axios from 'axios';
import type {
  ChannelType,
  UnifiedMessage,
  OutboundMessage,
  SendMessageResult,
  ChannelHealth,
  ChannelConfig,
} from '../types';
import { logger } from '../services/logger';

export abstract class BaseChannel {
  protected readonly channel: ChannelType;
  protected readonly config: ChannelConfig;
  protected lastHealthCheck: Date = new Date();
  protected healthStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

  constructor(channel: ChannelType, config: ChannelConfig) {
    this.channel = channel;
    this.config = config;
  }

  /**
   * Check if channel is enabled
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Parse incoming webhook event into unified message format
   */
  abstract parseIncomingMessage(event: any): UnifiedMessage | null;

  /**
   * Send outbound message
   */
  abstract sendMessage(message: OutboundMessage): Promise<SendMessageResult>;

  /**
   * Mark message as read/seen
   */
  abstract markAsRead(messageId: string, senderId: string): Promise<boolean>;

  /**
   * Check channel health
   */
  async checkHealth(): Promise<ChannelHealth> {
    const startTime = Date.now();

    try {
      // Simple API check - different for each channel
      const healthy = await this.performHealthCheck();
      const latencyMs = Date.now() - startTime;

      this.healthStatus = healthy ? 'healthy' : 'degraded';
      this.lastHealthCheck = new Date();

      return {
        channel: this.channel,
        status: this.healthStatus,
        lastCheck: this.lastHealthCheck,
        latencyMs,
      };
    } catch (error) {
      this.healthStatus = 'down';
      this.lastHealthCheck = new Date();

      return {
        channel: this.channel,
        status: 'down',
        lastCheck: this.lastHealthCheck,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Perform channel-specific health check
   */
  protected abstract performHealthCheck(): Promise<boolean>;

  /**
   * Make API call to Meta Graph API
   */
  protected async callMetaAPI(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    data?: any
  ): Promise<any> {
    const baseUrl = 'https://graph.facebook.com/v18.0';
    const url = `${baseUrl}${endpoint}`;

    try {
      const response = await axios({
        method,
        url,
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        data,
        params: method === 'GET' ? data : undefined,
      });

      return response.data;
    } catch (error: any) {
      logger.error(`[${this.channel}] Meta API error`, {
        endpoint,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  /**
   * Download media from Meta servers
   */
  protected async downloadMedia(mediaId: string): Promise<{ url: string; mimeType: string }> {
    try {
      // First get the media URL
      const mediaInfo = await this.callMetaAPI(`/${mediaId}`);
      const mediaUrl = mediaInfo.url;

      // For WhatsApp, we need to download with auth header
      // For IG/FB, the URL is usually public
      return {
        url: mediaUrl,
        mimeType: mediaInfo.mime_type || 'application/octet-stream',
      };
    } catch (error) {
      logger.error(`[${this.channel}] Failed to download media ${mediaId}`, { error });
      throw error;
    }
  }

  /**
   * Log incoming message
   */
  protected logIncoming(message: UnifiedMessage): void {
    logger.info(`[${this.channel}] Incoming message`, {
      id: message.id,
      source: message.source,
      type: message.type,
      from: message.from.id,
      hasText: !!message.content.text,
      hasMedia: !!message.content.mediaUrl,
    });
  }

  /**
   * Log outgoing message
   */
  protected logOutgoing(message: OutboundMessage, result: SendMessageResult): void {
    logger.info(`[${this.channel}] Outgoing message`, {
      recipientId: message.recipientId,
      type: message.type,
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    });
  }
}
