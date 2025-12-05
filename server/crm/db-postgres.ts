/**
 * PostgreSQL Database Layer for CRM - OPTIMIZED VERSION
 * High-performance implementation with proper indexing, transactions, and query optimization
 */
import { Pool, PoolClient } from 'pg';
import type { Conversation, Message, Attachment, MessageType, MessageStatus } from './models';
import { randomUUID } from 'crypto';

// ============================================================================
// OPTIMIZED CONNECTION POOL - Using environment variables
// ============================================================================
export const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  max: 20,                        // Max connections
  min: 2,                         // Min connections always ready
  idleTimeoutMillis: 30000,       // Close idle connections after 30s
  connectionTimeoutMillis: 2000,   // Fail fast if can't connect
  statement_timeout: 10000,        // 10s timeout for queries
});

// Graceful shutdown
pool.on('error', (err) => {
  console.error('[PostgresCRM] Unexpected pool error:', err);
});

// ============================================================================
// OPTIMIZED QUERIES - Only select necessary columns
// ============================================================================
const CONVERSATION_COLUMNS = `
  id, phone, contact_name, bitrix_id, bitrix_document, autoriza_publicidad,
  avatar_url, last_message_at, last_message_preview, unread,
  status, assigned_to, assigned_at, queued_at, queue_id,
  channel, channel_connection_id, phone_number_id, display_number,
  attended_by, ticket_number, bot_started_at, bot_flow_id,
  read_at, transferred_from, transferred_at, active_advisors,
  category, is_favorite, pinned, pinned_at, assigned_to_advisor, assigned_to_advisor_at,
  campaign_id, campaign_ids, closed_reason,
  bounce_count, last_bounce_at, metadata, ai_analysis, created_at, updated_at
`.trim();

const MESSAGE_COLUMNS = `
  id, conversation_id, direction, type, text,
  media_url, media_thumb, replied_to_id, status,
  timestamp as created_at, metadata, sent_by, event_type
`.trim();

export class PostgresCRMDatabase {
  // Expose pool for direct queries in metrics and other services
  public pool = pool;

  // ==================== CONVERSATIONS ====================

  /**
   * Get conversation by ID (synchronous stub for compatibility)
   */
  getConversationById(id: string): Promise<Conversation | null> {
    return this.getConversationByIdAsync(id);
  }

  /**
   * Get conversation by ID (async - optimized)
   */
  async getConversationByIdAsync(id: string): Promise<Conversation | null> {
    try {
      const result = await pool.query(
        `SELECT ${CONVERSATION_COLUMNS},
         (SELECT MAX(timestamp)
          FROM crm_messages
          WHERE conversation_id = crm_conversations.id
            AND direction = 'incoming'
            AND type != 'system'
            AND type != 'event') as last_client_message_at
         FROM crm_conversations WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) return null;

      return this.rowToConversation(result.rows[0]);
    } catch (error) {
      console.error('[PostgresCRM] Error getting conversation:', error);
      return null;
    }
  }

  /**
   * Get conversation by phone and channel (uses idx_conv_phone_channel)
   * FIXED: Now prioritizes active conversations and orders by most recent to prevent duplicates
   */
  async getConversationByPhoneAndChannel(
    phone: string,
    channel: string = 'whatsapp',
    phoneNumberId?: string | null
  ): Promise<Conversation | null> {
    try {
      let query = `SELECT ${CONVERSATION_COLUMNS} FROM crm_conversations WHERE phone = $1 AND channel = $2`;
      const params: any[] = [phone, channel];

      if (phoneNumberId) {
        query += ' AND channel_connection_id = $3';
        params.push(phoneNumberId);
      }

      // CRITICAL FIX: Prioritize active conversations and order by OLDEST first
      // When merging conversations, ALWAYS keep the OLDEST one to preserve history
      query += ` ORDER BY
                 CASE status
                   WHEN 'attending' THEN 1
                   WHEN 'active' THEN 2
                   WHEN 'closed' THEN 3
                 END,
                 created_at ASC
                 LIMIT 1`;

      const result = await pool.query(query, params);

      if (result.rows.length === 0) return null;

      return this.rowToConversation(result.rows[0]);
    } catch (error) {
      console.error('[PostgresCRM] Error getting conversation by phone:', error);
      return null;
    }
  }

  /**
   * Get conversation by phone (stub for compatibility)
   */
  getConversationByPhone(phone: string): Conversation | undefined {
    console.warn('[PostgresCRM] getConversationByPhone called synchronously - not implemented');
    return undefined;
  }

  /**
   * List all conversations (returns Promise for compatibility)
   */
  listConversations(): Promise<Conversation[]> {
    return this.getAllConversations();
  }

  /**
   * List all conversations (async - optimized)
   * Uses idx_conv_last_message_desc for fast sorting
   * Returns ALL conversations including archived (frontend handles filtering)
   */
  async getAllConversations(): Promise<Conversation[]> {
    try {
      console.log('[PostgresCRM] ⚡ EXECUTING NEW CODE - NO FILTER VERSION');
      const result = await pool.query(
        `SELECT ${CONVERSATION_COLUMNS},
         (SELECT MAX(timestamp)
          FROM crm_messages
          WHERE conversation_id = crm_conversations.id
            AND direction = 'incoming'
            AND type != 'system'
            AND type != 'event') as last_client_message_at
         FROM crm_conversations
         ORDER BY pinned DESC NULLS LAST, last_message_at DESC NULLS LAST`
      );

      console.log(`[PostgresCRM] ✅ getAllConversations returned ${result.rows.length} total conversations`);

      // Log breakdown by status
      const byStatus: Record<string, number> = {};
      result.rows.forEach((row: any) => {
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      });
      console.log('[PostgresCRM] 📊 By status:', byStatus);

      const conversations = result.rows.map(row => this.rowToConversation(row));

      // DEBUG: Check if lastClientMessageAt is present
      const sampleConv = conversations.find(c => c.phone === '51936872528');
      if (sampleConv) {
        console.log('[PostgresCRM] 🔍 Sample conversation 51936872528:', {
          phone: sampleConv.phone,
          lastClientMessageAt: sampleConv.lastClientMessageAt,
          lastMessageAt: sampleConv.lastMessageAt,
          hasField: 'lastClientMessageAt' in sampleConv
        });
      }

      return conversations;
    } catch (error) {
      console.error('[PostgresCRM] Error getting all conversations:', error);
      return [];
    }
  }

  /**
   * Create conversation with transaction
   */
  async createConversation(
    phone: string,
    contactName: string | null = null,
    avatarUrl: string | null = null,
    channel: string = 'whatsapp',
    phoneNumberId?: string | null,
    displayNumber?: string | null,
    adReferralData?: any | null
  ): Promise<Conversation> {
    const id = randomUUID();
    const now = Date.now();

    const conv: Conversation = {
      id,
      phone,
      contactName,
      bitrixId: null,
      bitrixDocument: null,
      avatarUrl,
      lastMessageAt: now,
      unread: 0,
      status: 'active',
      lastMessagePreview: '',
      assignedTo: null,
      assignedAt: null,
      queuedAt: null,
      queueId: null,
      channel,
      channelConnectionId: phoneNumberId || null,
      phoneNumberId: phoneNumberId || null,
      displayNumber: displayNumber || null,
      attendedBy: [],
      ticketNumber: await this.getNextTicketNumber(),
      botStartedAt: null,
      botFlowId: null,
      readAt: null,
      transferredFrom: null,
      transferredAt: null,
      activeAdvisors: [],
      category: null,
      campaignIds: [],
      isFavorite: false,
      metadata: null,
      assignedToAdvisor: null,
      assignedToAdvisorAt: null,
      bounceCount: 0,
      lastBounceAt: null,
      adReferral: adReferralData || undefined,
    };

    try {
      await pool.query(`
        INSERT INTO crm_conversations (
          id, phone, contact_name, avatar_url, last_message_at, unread, status,
          channel, channel_connection_id, phone_number_id, display_number,
          attended_by, ticket_number, active_advisors, category, is_favorite,
          assigned_to_advisor, assigned_to_advisor_at, bounce_count, last_bounce_at,
          metadata, created_at, updated_at,
          ad_source_url, ad_source_id, ad_source_type, ad_headline, ad_body,
          ad_media_type, ad_image_url, ad_video_url, ad_thumbnail_url, ad_ctwa_clid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
      `, [
        conv.id, conv.phone, conv.contactName, conv.avatarUrl, conv.lastMessageAt,
        conv.unread, conv.status, conv.channel, conv.channelConnectionId,
        conv.phoneNumberId, conv.displayNumber, JSON.stringify(conv.attendedBy),
        conv.ticketNumber, JSON.stringify(conv.activeAdvisors),
        conv.category, conv.isFavorite,
        conv.assignedToAdvisor, conv.assignedToAdvisorAt, conv.bounceCount, conv.lastBounceAt,
        conv.metadata, now, now,
        // Ad tracking fields
        adReferralData?.sourceUrl || null,
        adReferralData?.sourceId || null,
        adReferralData?.sourceType || null,
        adReferralData?.headline || null,
        adReferralData?.body || null,
        adReferralData?.mediaType || null,
        adReferralData?.imageUrl || null,
        adReferralData?.videoUrl || null,
        adReferralData?.thumbnailUrl || null,
        adReferralData?.ctwaClid || null
      ]);

      return conv;
    } catch (error: any) {
      // Handle unique constraint violation (duplicate conversation)
      if (error.code === '23505' && error.constraint === 'idx_unique_active_conversation') {
        console.log(`[PostgresCRM] 🔄 Duplicate conversation detected for ${phone}, fetching existing one...`);

        // Fetch the existing active conversation
        const existing = await this.getConversationByPhoneAndChannel(phone, channel, phoneNumberId);

        if (existing) {
          console.log(`[PostgresCRM] ✅ Reusing existing conversation ${existing.id} (ticket #${existing.ticketNumber})`);
          return existing;
        }

        // If somehow we still don't find it, retry the query with relaxed filters
        console.warn('[PostgresCRM] ⚠️  Could not find existing conversation, retrying...');
        const retry = await pool.query(
          `SELECT ${CONVERSATION_COLUMNS} FROM crm_conversations
           WHERE phone = $1 AND channel = $2 AND status IN ('active', 'attending')
           ORDER BY created_at DESC LIMIT 1`,
          [phone, channel]
        );

        if (retry.rows.length > 0) {
          return this.rowToConversation(retry.rows[0]);
        }
      }

      console.error('[PostgresCRM] Error creating conversation:', error);
      throw error;
    }
  }

  /**
   * Update conversation metadata (ASYNC - CRITICAL: Must use await to prevent race conditions)
   */
  async updateConversationMeta(convId: string, update: Partial<Omit<Conversation, "id">>): Promise<void> {
    // Call async version directly
    await this.updateConversationMetaAsync(convId, update);
  }

  /**
   * Update conversation metadata (async - optimized with partial updates)
   */
  async updateConversationMetaAsync(
    convId: string,
    update: Partial<Omit<Conversation, "id">>
  ): Promise<void> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build dynamic UPDATE query with only provided fields
      Object.entries(update).forEach(([key, value]) => {
        const snakeKey = this.toSnakeCase(key);

        // Handle JSON fields
        if (['attendedBy', 'activeAdvisors', 'bitrixDocument', 'metadata', 'aiAnalysis'].includes(key)) {
          fields.push(`${snakeKey} = $${paramIndex++}`);
          values.push(value ? JSON.stringify(value) : null);
        } else if (key === 'isFavorite') {
          fields.push(`is_favorite = $${paramIndex++}`);
          values.push(value);
        } else {
          fields.push(`${snakeKey} = $${paramIndex++}`);
          values.push(value);
        }
      });

      if (fields.length === 0) return;

      // Always update updated_at
      fields.push(`updated_at = $${paramIndex++}`);
      values.push(Date.now());

      // Add conversation ID
      values.push(convId);

      const query = `
        UPDATE crm_conversations
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
      `;

      await pool.query(query, values);
    } catch (error) {
      console.error('[PostgresCRM] Error updating conversation meta:', error);
      throw error;
    }
  }

  /**
   * Mark conversation as read (ASYNC - CRITICAL: Must use await to prevent race conditions)
   */
  async markConversationRead(convId: string): Promise<void> {
    // Call async version directly
    await this.markConversationReadAsync(convId);
  }

  /**
   * Mark conversation as read (async version)
   */
  async markConversationReadAsync(convId: string): Promise<void> {
    try {
      // Update conversation unread count
      await pool.query(
        'UPDATE crm_conversations SET unread = 0, updated_at = $1 WHERE id = $2',
        [Date.now(), convId]
      );

      // Mark all messages in conversation as read
      await pool.query(`
        UPDATE crm_messages
        SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"read": true}'::jsonb
        WHERE conversation_id = $1
          AND direction = 'incoming'
          AND (metadata->>'read' IS NULL OR (metadata->>'read')::boolean = false)
      `, [convId]);

      console.log(`[PostgresCRM] ✓ Marked conversation ${convId} as read`);
    } catch (error) {
      console.error('[PostgresCRM] Error marking conversation as read:', error);
      throw error;
    }
  }

  /**
   * Update conversation queue
   */
  async updateConversationQueue(convId: string, queueId: string): Promise<void> {
    await this.updateConversationMetaAsync(convId, { queueId });
  }

  /**
   * Append message with transaction (ACID guarantee)
   */
  async appendMessage(data: {
    convId: string;
    direction: 'incoming' | 'outgoing';
    type: MessageType;
    text?: string | null;
    mediaUrl?: string | null;
    mediaThumb?: string | null;
    repliedToId?: string | null;
    status: MessageStatus;
    providerMetadata?: Record<string, unknown> | null;
    sentBy?: string | null;
  }): Promise<Message> {
    const id = randomUUID();
    const now = Date.now();

    const message: Message = {
      id,
      convId: data.convId,
      direction: data.direction,
      type: data.type,
      text: data.text || null,
      mediaUrl: data.mediaUrl || null,
      mediaThumb: data.mediaThumb || null,
      repliedToId: data.repliedToId || null,
      status: data.status,
      createdAt: now,
      providerMetadata: data.providerMetadata || null,
      metadata: data.providerMetadata || undefined,  // Frontend expects 'metadata' field
      sentBy: data.sentBy || null,
    };

    // Use transaction to ensure atomicity
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert message with sentBy in both metadata and dedicated column
      const metadata = {
        ...(message.providerMetadata || {}),
      };

      await client.query(`
        INSERT INTO crm_messages (
          id, conversation_id, direction, type, text, media_url,
          media_thumb, replied_to_id, status, timestamp, metadata, created_at, sent_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        message.id, message.convId, message.direction, message.type,
        message.text, message.mediaUrl, message.mediaThumb, message.repliedToId,
        message.status, now, Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null, now, message.sentBy
      ]);

      // Update conversation's last message ONLY if it's NOT a system message
      // System messages are purely informative and don't represent real interactions
      if (data.type !== 'system') {
        // Generate preview based on message type
        let preview = '';
        if (data.type === 'template' && message.text) {
          // Parse template JSON to extract readable content
          try {
            const templateData = JSON.parse(message.text);
            const bodyComponent = templateData.components?.find((c: any) => c.type === 'BODY');
            if (bodyComponent?.text) {
              preview = bodyComponent.text.substring(0, 100);
            } else {
              preview = `📋 Plantilla: ${templateData.templateName}`;
            }
          } catch (e) {
            preview = message.text.substring(0, 100);
          }
        } else {
          preview = message.text?.substring(0, 100) || '';
        }

        // Incrementar unread SOLO si es mensaje entrante (del cliente)
        // Los mensajes salientes (del asesor/bot) no incrementan el contador
        if (data.direction === 'incoming') {
          await client.query(`
            UPDATE crm_conversations
            SET last_message_at = $1,
                last_message_preview = $2,
                unread = unread + 1,
                updated_at = $3
            WHERE id = $4
          `, [now, preview, now, data.convId]);
        } else {
          await client.query(`
            UPDATE crm_conversations
            SET last_message_at = $1,
                last_message_preview = $2,
                updated_at = $3
            WHERE id = $4
          `, [now, preview, now, data.convId]);
        }
      } else {
        // For system messages, only update the updated_at field (not last_message_at)
        await client.query(`
          UPDATE crm_conversations
          SET updated_at = $1
          WHERE id = $2
        `, [now, data.convId]);
      }

      await client.query('COMMIT');
      return message;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PostgresCRM] Error appending message:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List messages for conversation (uses idx_msg_conv_timestamp)
   */
  async listMessages(conversationId: string): Promise<Message[]> {
    try {
      const result = await pool.query(
        `SELECT ${MESSAGE_COLUMNS}
         FROM crm_messages
         WHERE conversation_id = $1
         ORDER BY timestamp ASC`,
        [conversationId]
      );

      return result.rows.map(row => this.rowToMessage(row));
    } catch (error) {
      console.error('[PostgresCRM] Error listing messages:', error);
      return [];
    }
  }

  /**
   * Get messages by conversation ID
   */
  async getMessagesByConversationId(convId: string): Promise<Message[]> {
    try {
      const result = await pool.query(
        `SELECT ${MESSAGE_COLUMNS}
         FROM crm_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [convId]
      );
      return result.rows.map(row => this.rowToMessage(row));
    } catch (error) {
      console.error('[PostgresCRM] Error getting messages for conversation:', error);
      return [];
    }
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    try {
      const result = await pool.query(
        `SELECT ${MESSAGE_COLUMNS}
         FROM crm_messages
         WHERE id = $1`,
        [messageId]
      );

      if (result.rows.length === 0) return null;
      return this.rowToMessage(result.rows[0]);
    } catch (error) {
      console.error('[PostgresCRM] Error getting message by ID:', error);
      return null;
    }
  }

  /**
   * Delete message (for system messages only)
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      await pool.query('DELETE FROM crm_messages WHERE id = $1', [messageId]);
      console.log(`[PostgresCRM] ✅ Message ${messageId} deleted`);
    } catch (error) {
      console.error('[PostgresCRM] Error deleting message:', error);
      throw error;
    }
  }

  /**
   * Update message status and optionally provider metadata
   */
  async updateMessageStatus(messageId: string, status: MessageStatus, providerMetadata?: Record<string, unknown> | null): Promise<void> {
    try {
      if (providerMetadata !== undefined) {
        // Update both status and metadata
        await pool.query(
          `UPDATE crm_messages
           SET status = $1, metadata = $2
           WHERE id = $3`,
          [status, providerMetadata ? JSON.stringify(providerMetadata) : null, messageId]
        );
      } else {
        // Update only status
        await pool.query(
          `UPDATE crm_messages
           SET status = $1
           WHERE id = $2`,
          [status, messageId]
        );
      }
    } catch (error) {
      console.error('[PostgresCRM] Error updating message status:', error);
      throw error;
    }
  }

  /**
   * List attachments by message IDs (uses idx_att_message_id)
   */
  async listAttachmentsByMessageIds(messageIds: string[]): Promise<Attachment[]> {
    if (messageIds.length === 0) return [];

    try {
      const result = await pool.query(
        `SELECT id, message_id, type, url, thumbnail, filename, mimetype, size, created_at
         FROM crm_attachments
         WHERE message_id = ANY($1)
         ORDER BY created_at ASC`,
        [messageIds]
      );

      return result.rows.map(row => ({
        id: row.id,
        msgId: row.message_id,
        filename: row.filename || 'attachment',
        mime: row.mimetype || 'application/octet-stream',
        size: parseInt(row.size) || 0,
        url: row.url,
        thumbUrl: row.thumbnail,
        createdAt: parseInt(row.created_at) || Date.now(),
      }));
    } catch (error) {
      console.error('[PostgresCRM] Error listing attachments:', error);
      return [];
    }
  }

  /**
   * Get single attachment by ID
   */
  async getAttachment(attachmentId: string): Promise<Attachment | undefined> {
    try {
      const result = await pool.query(
        `SELECT id, message_id, type, url, thumbnail, filename, mimetype, size, created_at
         FROM crm_attachments
         WHERE id = $1
         LIMIT 1`,
        [attachmentId]
      );

      if (result.rows.length === 0) return undefined;

      const row = result.rows[0];
      return {
        id: row.id,
        msgId: row.message_id,
        filename: row.filename || 'attachment',
        mime: row.mimetype || 'application/octet-stream',
        size: parseInt(row.size) || 0,
        url: row.url,
        thumbUrl: row.thumbnail,
        createdAt: parseInt(row.created_at) || Date.now(),
      };
    } catch (error) {
      console.error('[PostgresCRM] Error getting attachment:', error);
      return undefined;
    }
  }

  /**
   * Link an attachment to a message
   */
  async linkAttachmentToMessage(attachmentId: string, messageId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_attachments SET message_id = $1 WHERE id = $2`,
        [messageId, attachmentId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error linking attachment to message:', error);
      throw error;
    }
  }

  /**
   * Get attachments by IDs (for loading attachments from media_url)
   */
  async getAttachmentsByIds(attachmentIds: string[]): Promise<Attachment[]> {
    if (attachmentIds.length === 0) return [];

    try {
      const result = await pool.query(
        `SELECT id, message_id, type, url, thumbnail, filename, mimetype, size, created_at
         FROM crm_attachments
         WHERE id = ANY($1)
         ORDER BY created_at ASC`,
        [attachmentIds]
      );

      return result.rows.map(row => ({
        id: row.id,
        msgId: row.message_id,
        filename: row.filename || 'attachment',
        mime: row.mimetype || 'application/octet-stream',
        size: parseInt(row.size) || 0,
        url: row.url,
        thumbUrl: row.thumbnail,
        createdAt: parseInt(row.created_at) || Date.now(),
      }));
    } catch (error) {
      console.error('[PostgresCRM] Error getting attachments by IDs:', error);
      return [];
    }
  }

  /**
   * List queued conversations (uses idx_conv_queue_status)
   * Optimized to filter by specific queue and unassigned status directly in DB
   */
  async listQueuedConversations(queueId?: string): Promise<Conversation[]> {
    try {
      let query = `SELECT ${CONVERSATION_COLUMNS}
         FROM crm_conversations
         WHERE queue_id IS NOT NULL
           AND status = 'active'
           AND assigned_to IS NULL`; // Only get unassigned chats

      const params: any[] = [];

      if (queueId) {
        query += ` AND queue_id = $1`;
        params.push(queueId);
      }

      query += ` ORDER BY queued_at ASC NULLS LAST`;

      const result = await pool.query(query, params);

      return result.rows.map(row => this.rowToConversation(row));
    } catch (error) {
      console.error('[PostgresCRM] Error listing queued conversations:', error);
      return [];
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Convert DB row to Conversation object (INCLUDES ALL NEW FIELDS)
   */
  private rowToConversation(row: any): Conversation {
    return {
      id: row.id,
      phone: row.phone,
      contactName: row.contact_name,
      bitrixId: row.bitrix_id,
      bitrixDocument: row.bitrix_document,
      autorizaPublicidad: row.autoriza_publicidad || null,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at ? parseInt(row.created_at) : 0,
      lastMessageAt: row.last_message_at ? parseInt(row.last_message_at) : 0,
      lastClientMessageAt: row.last_client_message_at ? parseInt(row.last_client_message_at) : null,
      unread: row.unread || 0,
      status: row.status || 'active',
      lastMessagePreview: row.last_message_preview || '',
      assignedTo: row.assigned_to,
      assignedAt: row.assigned_at ? parseInt(row.assigned_at) : null,
      queuedAt: row.queued_at ? parseInt(row.queued_at) : null,
      queueId: row.queue_id,
      channel: row.channel || 'whatsapp',
      channelConnectionId: row.channel_connection_id,
      phoneNumberId: row.phone_number_id,
      displayNumber: row.display_number,
      attendedBy: row.attended_by || [],
      ticketNumber: row.ticket_number,
      botStartedAt: row.bot_started_at ? parseInt(row.bot_started_at) : null,
      botFlowId: row.bot_flow_id,
      readAt: row.read_at ? parseInt(row.read_at) : null,
      transferredFrom: row.transferred_from,
      transferredAt: row.transferred_at ? parseInt(row.transferred_at) : null,
      activeAdvisors: row.active_advisors || [],

      // NEW FIELDS - OPTIMIZED
      category: row.category || null,
      campaignIds: row.campaign_ids || [],
      isFavorite: row.is_favorite || false,
      pinned: row.pinned || false,
      pinnedAt: row.pinned_at ? parseInt(row.pinned_at) : null,
      metadata: row.metadata || null,
      campaignId: row.campaign_id || null,
      closedReason: row.closed_reason || null,

      // BOUNCE SYSTEM FIELDS
      assignedToAdvisor: row.assigned_to_advisor || null,
      assignedToAdvisorAt: row.assigned_to_advisor_at ? parseInt(row.assigned_to_advisor_at) : null,
      bounceCount: row.bounce_count || 0,
      lastBounceAt: row.last_bounce_at ? parseInt(row.last_bounce_at) : null,

      // AI ANALYSIS FIELD
      aiAnalysis: row.ai_analysis || undefined,
    };

    // DEBUG: Log specific chat for troubleshooting
    if (row.phone === '51936872528') {
      console.log('[PostgresCRM] 🔍 DEBUG chat 51936872528:', {
        phone: row.phone,
        last_client_message_at_raw: row.last_client_message_at,
        lastClientMessageAt: row.last_client_message_at ? parseInt(row.last_client_message_at) : null,
        status: row.status,
        queue_id: row.queue_id
      });
    }

    return conv;
  }

  /**
   * Convert DB row to Message object
   */
  private rowToMessage(row: any): Message {
    const metadata = row.metadata || {};

    return {
      id: row.id,
      convId: row.conversation_id,
      direction: row.direction,
      type: row.type,
      text: row.text,
      mediaUrl: row.media_url,
      mediaThumb: row.media_thumb,
      repliedToId: row.replied_to_id,
      status: row.status,
      createdAt: row.created_at ? parseInt(row.created_at) : 0,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      sentBy: row.sent_by || null,
      eventType: row.event_type || undefined,
    };
  }

  /**
   * Get next ticket number (uses index for fast MAX)
   */
  private async getNextTicketNumber(): Promise<number> {
    try {
      const result = await pool.query(
        'SELECT COALESCE(MAX(ticket_number), 0) + 1 as next FROM crm_conversations'
      );
      return result.rows[0].next;
    } catch (error) {
      console.error('[PostgresCRM] Error getting next ticket number:', error);
      return 1;
    }
  }

  /**
   * Archive conversation
   */
  async archiveConversation(convId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET status = 'closed',
             closed_reason = 'manual',
             assigned_to = NULL,
             assigned_at = NULL,
             assigned_to_advisor = NULL,
             assigned_to_advisor_at = NULL,
             active_advisors = '[]'::jsonb,
             transferred_from = NULL,
             transferred_at = NULL,
             updated_at = $1
         WHERE id = $2`,
        [Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error archiving conversation:', error);
      throw error;
    }
  }

  /**
   * Unarchive conversation (ASYNC - CRITICAL: Must use await)
   */
  async unarchiveConversation(convId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET status = 'active',
             updated_at = $1
         WHERE id = $2`,
        [Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error unarchiving conversation:', error);
      throw error;
    }
  }

  /**
   * Assign conversation to advisor (ASYNC - CRITICAL: Must use await)
   */
  async assignConversation(convId: string, advisorId: string): Promise<boolean> {
    return await this.assignConversationAsync(convId, advisorId);
  }

  /**
   * Assign conversation to advisor (async version)
   * IMPORTANT: This only ASSIGNS the conversation (status stays 'active' = POR TRABAJAR)
   * The advisor still needs to ACCEPT it (acceptConversation) to change status to 'attending'
   */
  async assignConversationAsync(convId: string, advisorId: string): Promise<boolean> {
    try {
      const now = Date.now();
      const result = await pool.query(
        `UPDATE crm_conversations
         SET assigned_to = $1,
             assigned_at = $2,
             assigned_to_advisor = $1,
             assigned_to_advisor_at = $2,
             updated_at = $2
         WHERE id = $3 AND status = 'active'`,
        [advisorId, now, convId]
      );

      if (result.rowCount === 0) {
        console.warn('[PostgresCRM] Failed to assign conversation - not active or not found');
        return false;
      }
      return true;
    } catch (error) {
      console.error('[PostgresCRM] Error assigning conversation:', error);
      return false;
    }
  }

  /**
   * Accept conversation (advisor clicks "Aceptar")
   */
  async acceptConversation(convId: string, advisorId: string): Promise<boolean> {
    const now = Date.now();
    try {
      const result = await pool.query(
        `UPDATE crm_conversations
         SET status = 'attending',
             assigned_to = $1,
             assigned_at = $2,
             assigned_to_advisor = $1,
             assigned_to_advisor_at = $2,
             attended_by = COALESCE(attended_by, '[]'::jsonb) || $3::jsonb,
             updated_at = $2
         WHERE id = $4 AND status = 'active'`,
        [advisorId, now, JSON.stringify([advisorId]), convId]
      );

      // CRITICAL: Record when advisor accepted in conversation_metrics for accurate first response time
      if (result.rowCount > 0) {
        try {
          await pool.query(
            `UPDATE conversation_metrics
             SET session_start_time = $1
             WHERE conversation_id = $2 AND advisor_id = $3 AND session_start_time IS NULL`,
            [now, convId, advisorId]
          );
          console.log(`[PostgresCRM] ✅ Recorded advisor acceptance time for metrics: ${convId}`);
        } catch (metricsError) {
          // Don't fail the accept operation if metrics update fails
          console.error('[PostgresCRM] Warning: Failed to update metrics on accept:', metricsError);
        }
      }

      return result.rowCount > 0;
    } catch (error) {
      console.error('[PostgresCRM] Error accepting conversation:', error);
      return false;
    }
  }

  /**
   * Release conversation (ASYNC - CRITICAL: Must use await)
   * Libera tanto chats "TRABAJANDO" (attending) como "POR TRABAJAR" (active asignados)
   */
  async releaseConversation(convId: string): Promise<boolean> {
    try {
      // Liberar si está en 'attending' O 'active' con assignedTo
      await pool.query(
        `UPDATE crm_conversations
         SET status = 'active',
             assigned_to = NULL,
             assigned_at = NULL,
             updated_at = $1
         WHERE id = $2 AND (status = 'attending' OR (status = 'active' AND assigned_to IS NOT NULL))`,
        [Date.now(), convId]
      );
      return true;
    } catch (error) {
      console.error('[PostgresCRM] Error releasing conversation:', error);
      throw error;
    }
  }

  /**
   * Join advisor to conversation (ASYNC - CRITICAL: Must use await)
   */
  async joinAdvisorToConversation(convId: string, advisorId: string): Promise<boolean> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET active_advisors = CASE
             WHEN active_advisors ? $1 THEN active_advisors
             ELSE COALESCE(active_advisors, '[]'::jsonb) || $2::jsonb
           END,
           attended_by = CASE
             WHEN attended_by ? $1 THEN attended_by
             ELSE COALESCE(attended_by, '[]'::jsonb) || $2::jsonb
           END,
           updated_at = $3
         WHERE id = $4 AND status != 'closed'`,
        [advisorId, JSON.stringify([advisorId]), Date.now(), convId]
      );
      return true;
    } catch (error) {
      console.error('[PostgresCRM] Error joining advisor to conversation:', error);
      throw error;
    }
  }

  /**
   * Add advisor to attendedBy array (ASYNC - CRITICAL: Must use await)
   */
  async addAdvisorToAttendedBy(convId: string, advisorId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET attended_by = CASE
             WHEN attended_by ? $1 THEN attended_by
             ELSE COALESCE(attended_by, '[]'::jsonb) || $2::jsonb
           END,
           updated_at = $3
         WHERE id = $4`,
        [advisorId, JSON.stringify([advisorId]), Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error adding advisor to attendedBy:', error);
      throw error;
    }
  }

  /**
   * Remove advisor from attendedBy array (ASYNC - CRITICAL: Must use await)
   */
  async removeAdvisorFromAttendedBy(convId: string, advisorId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET attended_by = attended_by - $1,
             updated_at = $2
         WHERE id = $3`,
        [advisorId, Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error removing advisor from attendedBy:', error);
      throw error;
    }
  }

  /**
   * Remove advisor from activeAdvisors array (ASYNC - CRITICAL: Must use await)
   */
  async removeAdvisorFromActiveAdvisors(convId: string, advisorId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET active_advisors = active_advisors - $1,
             updated_at = $2
         WHERE id = $3`,
        [advisorId, Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error removing advisor from activeAdvisors:', error);
      throw error;
    }
  }

  /**
   * Add campaign ID to campaignIds array (ASYNC - CRITICAL: Must use await)
   */
  async addCampaignToConversation(convId: string, campaignId: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE crm_conversations
         SET campaign_ids = CASE
             WHEN campaign_ids ? $1 THEN campaign_ids
             ELSE COALESCE(campaign_ids, '[]'::jsonb) || $2::jsonb
           END,
           updated_at = $3
         WHERE id = $4`,
        [campaignId, JSON.stringify([campaignId]), Date.now(), convId]
      );
    } catch (error) {
      console.error('[PostgresCRM] Error adding campaign to campaignIds:', error);
      throw error;
    }
  }

  /**
   * Store attachment (async - CRITICAL FIX for race condition)
   * MUST complete DB insert BEFORE returning to prevent WebSocket race condition
   */
  async storeAttachment(params: {
    id: string;
    msgId: string;
    filename?: string;
    mime?: string;
    size?: number;
    url: string;
    thumbUrl?: string;
  }): Promise<Attachment> {
    try {
      // CRITICAL: Wait for DB insert to complete BEFORE returning
      await pool.query(
        `INSERT INTO crm_attachments (
          id, message_id, type, url, thumbnail, filename, mimetype, size
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          url = EXCLUDED.url,
          thumbnail = EXCLUDED.thumbnail,
          filename = EXCLUDED.filename,
          mimetype = EXCLUDED.mimetype,
          size = EXCLUDED.size`,
        [
          params.id,
          params.msgId,
          params.mime?.startsWith('image/') ? 'image' :
          params.mime?.startsWith('video/') ? 'video' :
          params.mime?.startsWith('audio/') ? 'audio' : 'document',
          params.url,
          params.thumbUrl || null,
          params.filename || null,
          params.mime || null,
          params.size || null,
        ]
      );

      // Return full attachment object after successful insert
      return {
        id: params.id,
        msgId: params.msgId,
        filename: params.filename || params.id,
        mime: params.mime || 'application/octet-stream',
        size: params.size || 0,
        url: params.url,
        thumbUrl: params.thumbUrl || params.url,
        createdAt: Date.now(),
      };
    } catch (error) {
      console.error('[PostgresCRM] Error storing attachment:', error);
      throw error;
    }
  }

  /**
   * Check timeouts and reassign conversations back to queue (ASYNC - CRITICAL: Must use await)
   */
  async checkTimeoutsAndReassign(timeoutMinutes: number): Promise<Conversation[]> {
    const now = Date.now();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    try {
      const result = await pool.query(
        `UPDATE crm_conversations
         SET status = 'closed',
             assigned_to = NULL,
             assigned_at = NULL,
             updated_at = $1
         WHERE status = 'attending'
           AND assigned_at IS NOT NULL
           AND assigned_at < $2
           AND last_message_at < $2
         RETURNING id`,
        [now, now - timeoutMs]
      );

      const timedOutIds = result.rows.map((r) => r.id as string);

      if (timedOutIds.length > 0) {
        console.log(`[Queue] ${timedOutIds.length} conversations timed out and were closed after ${timeoutMinutes} minutes`);

        // Insert system message per conversation to avisar al cliente
        for (const convId of timedOutIds) {
          try {
            await this.createSystemEvent(
              convId,
              'conversation_timeout',
              `⏱️ Por inactividad el chat se cerró. Escríbenos cuando gustes y retomamos la atención.`
            );
          } catch (err) {
            console.error(`[Queue] Error creando mensaje de timeout para ${convId}:`, err);
          }
        }
      }

      // Return empty for compatibility (scheduler no espera la lista actualmente)
      return [];
    } catch (error) {
      console.error('[PostgresCRM] Error checking timeouts:', error);
      return [];
    }
  }

  /**
   * Create system event message (conversation_transferred, conversation_accepted, etc.)
   * UPDATED: Now creates type='event' for consistent EventBubble rendering
   */
  async createSystemEvent(convId: string, eventType: string, text: string): Promise<Message> {
    const messageId = randomUUID();
    const now = Date.now();

    try {
      await pool.query(
        `INSERT INTO crm_messages (
          id, conversation_id, direction, type, text, event_type, timestamp, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [messageId, convId, 'outgoing', 'event', text, eventType, now, now]
      );

      console.log(`[PostgresCRM] ✅ System event created: ${eventType} in conversation ${convId}`);

      return {
        id: messageId,
        convId: convId,  // FIXED: Was "conversationId" - must be "convId" to match frontend type
        direction: 'outgoing',
        type: 'event',
        text,
        mediaUrl: null,
        mediaThumb: null,
        repliedToId: null,
        status: 'sent',
        createdAt: now,
        providerMetadata: null,
        sentBy: null,
        eventType,
      };
    } catch (error) {
      console.error('[PostgresCRM] Error creating system event:', error);
      throw error;
    }
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  /**
   * Close pool (for graceful shutdown)
   */
  async close(): Promise<void> {
    await pool.end();
  }
}

export const postgresCrmDb = new PostgresCRMDatabase();
export const crmDb = postgresCrmDb; // Alias for compatibility
