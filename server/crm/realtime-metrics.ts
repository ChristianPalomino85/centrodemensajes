/**
 * Real-time CRM Metrics Service
 * Provides live metrics from PostgreSQL database
 */

import { crmDb } from './db-postgres';
import { errorTracker } from './error-tracker';

export interface CRMStats {
  activeConversations: number;
  totalConversations: number;
  totalMessages: number;
  messagesLast24h: number;
  messagesPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  uptime: number;

  // Additional CRM stats
  archivedConversations: number;
  closedConversations: number;
  unreadCount: number;
  queuedConversations: number;
}

export type MetricsFilters = {
  channel?: string;
  phoneNumberId?: string;
  startDate?: number;
  endDate?: number;
};

export interface ConversationMetric {
  sessionId: string;
  flowId: string;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  messagesReceived: number;
  messagesSent: number;
  nodesExecuted: number;
  webhooksCalled: number;
  errors: number;
  status: 'active' | 'ended' | 'error';
  channelType?: string;
  whatsappNumberId?: string;
}

class RealtimeMetricsService {
  private startTime: number = Date.now();
  private messageCountCache: Map<string, { count: number; timestamp: number }> = new Map();
  private cacheTimeout = 30000; // 30 seconds cache

  /**
   * Get comprehensive CRM statistics
   */
  async getStats(filters: MetricsFilters = {}): Promise<CRMStats> {
    try {
      const conversations = await crmDb.listConversations();
      const filteredConvs = conversations.filter((c) => {
        if (filters.channel && c.channel !== filters.channel) return false;
        if (filters.phoneNumberId && c.channelConnectionId !== filters.phoneNumberId) return false;
        if (filters.startDate && c.lastMessageAt < filters.startDate) return false;
        if (filters.endDate && c.lastMessageAt > filters.endDate) return false;
        return true;
      });

      const now = Date.now();
      const last24h = now - (24 * 60 * 60 * 1000);

      // Count by status
      const active = filteredConvs.filter(c => c.status === 'active').length;
      const closed = filteredConvs.filter(c => c.status === 'closed').length;
      const queued = filteredConvs.filter(c => c.queueId && c.status === 'active').length;

      // Unread messages
      const unread = filteredConvs.reduce((sum, c) => sum + (c.unread || 0), 0);

      // Messages - get real counts from crm_messages table
      let messagesLast24h = 0;
      let totalMessages = 0;
      let messagesPerMinute = 0;

      try {
        // Query real message counts from database
        const whereClauses: string[] = [];
        const params: any[] = [];

        // Filters for channel/phoneNumberId
        if (filters.channel) {
          params.push(filters.channel);
          whereClauses.push(`c.channel = $${params.length}`);
        }
        if (filters.phoneNumberId) {
          params.push(filters.phoneNumberId);
          whereClauses.push(`c.channel_connection_id = $${params.length}`);
        }
        if (filters.startDate) {
          params.push(filters.startDate);
          whereClauses.push(`m.timestamp >= $${params.length}`);
        }
        if (filters.endDate) {
          params.push(filters.endDate);
          whereClauses.push(`m.timestamp <= $${params.length}`);
        }

        const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        params.push(last24h);
        const last24hParam = params.length;
        params.push(now - (60 * 60 * 1000));
        const lastHourParam = params.length;

        const messageStats = await crmDb.pool.query(
          `
          SELECT
            COUNT(*) as total_messages,
            COUNT(*) FILTER (WHERE m.timestamp > $${last24hParam}) as last_24h,
            COUNT(*) FILTER (WHERE m.timestamp > $${lastHourParam}) as last_hour
          FROM crm_messages m
          INNER JOIN crm_conversations c ON c.id = m.conversation_id
          ${where}
          `,
          params
        );

        if (messageStats.rows.length > 0) {
          totalMessages = parseInt(messageStats.rows[0].total_messages) || 0;
          messagesLast24h = parseInt(messageStats.rows[0].last_24h) || 0;
          const messagesLastHour = parseInt(messageStats.rows[0].last_hour) || 0;
          messagesPerMinute = Math.round(messagesLastHour / 60);
        }
      } catch (error) {
        console.error('[RealtimeMetrics] Error counting messages:', error);
        // Fallback to 0 if query fails
        totalMessages = 0;
        messagesLast24h = 0;
        messagesPerMinute = 0;
      }

      // Response time - TIEMPO QUE TARDA ASESOR EN RESPONDER DESPUÉS DE TRANSFERENCIA DEL BOT
      let avgResponseTime = 0;
      try {
        // Get conversations where advisor responded after bot transfer (last 24h)
        const responseWhere: string[] = [];
        const responseParams: any[] = [];

        if (filters.channel) {
          responseParams.push(filters.channel);
          responseWhere.push(`c.channel = $${responseParams.length}`);
        }
        if (filters.phoneNumberId) {
          responseParams.push(filters.phoneNumberId);
          responseWhere.push(`c.channel_connection_id = $${responseParams.length}`);
        }
        responseParams.push(last24h);
        const last24Param = responseParams.length;

        const responseWhereSql = responseWhere.length ? `AND ${responseWhere.join(' AND ')}` : '';

        const advisorResponseTimes = await crmDb.pool.query(`
          SELECT
            (m.timestamp - c.assigned_at) as response_time_ms
          FROM crm_conversations c
          JOIN crm_messages m ON m.conversation_id = c.id
          WHERE c.assigned_to_advisor IS NOT NULL
            AND c.assigned_at IS NOT NULL
            AND m.direction = 'outgoing'
            AND m.type != 'system'
            AND m.timestamp > c.assigned_at
            AND c.assigned_at > $${last24Param}
            AND (m.timestamp - c.assigned_at) > 0
            AND (m.timestamp - c.assigned_at) < 600000
            ${responseWhereSql}
          ORDER BY c.id, m.timestamp
        `, responseParams);

        // Get first response per conversation
        const conversationFirstResponse = new Map<string, number>();
        for (const row of advisorResponseTimes.rows) {
          const responseTime = parseInt(row.response_time_ms);
          // We only want the first response (smallest time) per conversation
          // Since we ordered by timestamp, first occurrence is the first response
          if (!conversationFirstResponse.has(row.conversation_id)) {
            conversationFirstResponse.set(row.conversation_id, responseTime);
          }
        }

        const responseTimes = Array.from(conversationFirstResponse.values());

        if (responseTimes.length > 0) {
          avgResponseTime = Math.round(
            responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
          );
        }
      } catch (error) {
        console.error('[RealtimeMetrics] Error calculating advisor response time:', error);
        avgResponseTime = 0;
      }

      // Error rate - get real error rate from error tracker (last 24h)
      let errorRate = 0;
      try {
        errorRate = await errorTracker.getErrorRate(last24h, now);
      } catch (error) {
        console.error('[RealtimeMetrics] Error calculating error rate:', error);
        errorRate = 0;
      }

      return {
        activeConversations: active,
        totalConversations: filteredConvs.length,
        totalMessages,
        messagesLast24h,
        messagesPerMinute,
        averageResponseTime: avgResponseTime,
        errorRate, // Real error rate from error_logs table
        uptime: (now - this.startTime) / 1000,
        closedConversations: closed,
        unreadCount: unread,
        queuedConversations: queued,
      };
    } catch (error) {
      console.error('[RealtimeMetrics] Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Get message count for a conversation (with caching and direction breakdown)
   */
  private async getMessageCount(conversationId: string): Promise<{ total: number; incoming: number; outgoing: number }> {
    const cached = this.messageCountCache.get(conversationId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.count as any;
    }

    try {
      // Query real message counts with direction from database
      const result = await crmDb.pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE direction = 'incoming') as incoming,
          COUNT(*) FILTER (WHERE direction = 'outgoing') as outgoing
        FROM crm_messages
        WHERE conversation_id = $1
      `, [conversationId]);

      const counts = {
        total: parseInt(result.rows[0]?.total) || 0,
        incoming: parseInt(result.rows[0]?.incoming) || 0,
        outgoing: parseInt(result.rows[0]?.outgoing) || 0,
      };

      this.messageCountCache.set(conversationId, { count: counts as any, timestamp: now });

      return counts;
    } catch (error) {
      console.error('[RealtimeMetrics] Error counting messages for conversation:', error);
      return { total: 0, incoming: 0, outgoing: 0 };
    }
  }

  /**
   * Get conversation metrics (compatible with MetricsPanel interface)
   */
  async getConversationMetrics(filters: MetricsFilters = {}): Promise<ConversationMetric[]> {
    try {
      const conversations = await crmDb.listConversations();
      const filteredConvs = conversations.filter((c) => {
        if (filters.channel && c.channel !== filters.channel) return false;
        if (filters.phoneNumberId && c.channelConnectionId !== filters.phoneNumberId) return false;
        if (filters.startDate && c.lastMessageAt < filters.startDate) return false;
        if (filters.endDate && c.lastMessageAt > filters.endDate) return false;
        return true;
      });
      const metrics: ConversationMetric[] = [];

      // Process all filtered conversations (no artificial limit)
      for (const conv of filteredConvs) {
        const messageCounts = await this.getMessageCount(conv.id);

        let duration: number | undefined;
        let endedAt: string | undefined;

        if (conv.status === 'closed') {
          // Calculate real duration from first to last message
          duration = conv.lastMessageAt - (conv.queuedAt || conv.lastMessageAt);
          endedAt = new Date(conv.lastMessageAt).toISOString();
        }

        metrics.push({
          sessionId: conv.id,
          flowId: conv.botFlowId || 'crm',
          startedAt: new Date(conv.queuedAt || conv.lastMessageAt).toISOString(),
          endedAt,
          duration,
          messagesReceived: messageCounts.incoming,
          messagesSent: messageCounts.outgoing,
          nodesExecuted: 0,
          webhooksCalled: 0,
          errors: 0,
          status: conv.status === 'active' ? 'active' : 'ended',
          channelType: conv.channel,
          whatsappNumberId: conv.channelConnectionId,
        });
      }

      return metrics;
    } catch (error) {
      console.error('[RealtimeMetrics] Error getting conversation metrics:', error);
      return [];
    }
  }

  /**
   * Get active conversations
   */
  async getActiveConversations(filters: MetricsFilters = {}): Promise<ConversationMetric[]> {
    const allMetrics = await this.getConversationMetrics(filters);
    return allMetrics.filter(m => m.status === 'active');
  }

  /**
   * Clear old cache entries
   */
  clearCache(): void {
    const now = Date.now();
    for (const [key, value] of this.messageCountCache.entries()) {
      if ((now - value.timestamp) > this.cacheTimeout) {
        this.messageCountCache.delete(key);
      }
    }
  }
}

export const realtimeMetrics = new RealtimeMetricsService();

// Clean cache every 5 minutes
setInterval(() => {
  realtimeMetrics.clearCache();
}, 5 * 60 * 1000);
