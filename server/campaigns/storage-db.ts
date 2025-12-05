/**
 * CampaignStorage - PostgreSQL Implementation
 * Migrated from JSON file storage to PostgreSQL
 */

import pg from 'pg';
import type { Campaign, CampaignMetrics, CampaignMessageDetail } from './models';

const { Pool } = pg;

export class CampaignStorageDB {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      password: process.env.POSTGRES_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  // ============================================
  // CAMPAIGNS CRUD
  // ============================================

  async createCampaign(campaign: Campaign): Promise<Campaign> {
    const client = await this.pool.connect();
    try {
      console.log('[CampaignStorage] 🔵 Creating campaign:', campaign.id);
      await client.query('BEGIN');

      // Insert campaign
      console.log('[CampaignStorage] 🔵 Step 1: Inserting into campaigns table');
      await client.query(
        `INSERT INTO campaigns (
          id, name, whatsapp_number_id, template_name, language, recipients,
          variables, status, created_at, created_by, throttle_rate, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          campaign.id,
          campaign.name,
          campaign.whatsappNumberId,
          campaign.templateName,
          campaign.language || 'es',
          JSON.stringify(campaign.recipients),
          JSON.stringify(campaign.variables || {}),
          campaign.status,
          campaign.createdAt,
          campaign.createdBy,
          campaign.throttleRate,
          campaign.startedAt || null,
          campaign.completedAt || null,
        ]
      );

      // Initialize campaign message details for all recipients
      console.log(`[CampaignStorage] 🔵 Step 2: Inserting ${campaign.recipients.length} recipients into campaign_message_details`);
      for (const phone of campaign.recipients) {
        console.log(`[CampaignStorage] 🔵 Inserting recipient: ${phone}`);
        await client.query(
          `INSERT INTO campaign_message_details (
            campaign_id, phone, status
          ) VALUES ($1, $2, $3)`,
          [campaign.id, phone, 'pending']
        );
      }

      console.log('[CampaignStorage] 🔵 Step 3: Committing transaction');
      await client.query('COMMIT');
      console.log(`[CampaignStorage] ✅ Created campaign: ${campaign.id} - ${campaign.name}`);
      return campaign;
    } catch (error) {
      console.error('[CampaignStorage] ❌ Error creating campaign:', error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM campaigns WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    return this.mapRowToCampaign(result.rows[0]);
  }

  async getAllCampaigns(): Promise<Campaign[]> {
    const result = await this.pool.query(
      `SELECT * FROM campaigns ORDER BY created_at DESC`
    );

    return result.rows.map(row => this.mapRowToCampaign(row));
  }

  async updateCampaignStatus(id: string, status: Campaign['status']): Promise<void> {
    const campaign = await this.getCampaign(id);
    if (!campaign) return;

    let startedAt = campaign.startedAt;
    let completedAt = campaign.completedAt;

    if (status === 'sending' && !startedAt) {
      startedAt = Date.now();
    }

    if ((status === 'completed' || status === 'failed' || status === 'cancelled') && !completedAt) {
      completedAt = Date.now();
    }

    await this.pool.query(
      `UPDATE campaigns
       SET status = $1, started_at = $2, completed_at = $3, db_updated_at = NOW()
       WHERE id = $4`,
      [status, startedAt, completedAt, id]
    );
  }

  async deleteCampaign(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM campaigns WHERE id = $1`,
      [id]
    );

    return (result.rowCount || 0) > 0;
  }

  // ============================================
  // METRICS
  // ============================================

  async getCampaignMetrics(id: string): Promise<CampaignMetrics | undefined> {
    // Get campaign info
    const campaign = await this.getCampaign(id);
    if (!campaign) return undefined;

    // Get aggregated metrics from view
    const statsResult = await this.pool.query(
      `SELECT * FROM campaign_stats WHERE campaign_id = $1`,
      [id]
    );

    // Get detailed message statuses
    const detailsResult = await this.pool.query(
      `SELECT phone, status, sent_at, delivered_at, read_at, responded, clicked_button, error_message
       FROM campaign_message_details
       WHERE campaign_id = $1
       ORDER BY phone`,
      [id]
    );

    const stats = statsResult.rows[0] || {
      total_sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      responded: 0,
      clicked: 0,
    };

    const details: CampaignMessageDetail[] = detailsResult.rows.map(row => ({
      phone: row.phone,
      status: row.status,
      sentAt: row.sent_at ? parseInt(row.sent_at) : undefined,
      deliveredAt: row.delivered_at ? parseInt(row.delivered_at) : undefined,
      readAt: row.read_at ? parseInt(row.read_at) : undefined,
      responded: row.responded || false,
      clickedButton: row.clicked_button || undefined,
      failReason: row.error_message || undefined,
    }));

    return {
      campaignId: id,
      campaignName: campaign.name,
      totalRecipients: campaign.recipients.length,
      sent: parseInt(stats.total_sent) || 0,
      delivered: parseInt(stats.delivered) || 0,
      read: parseInt(stats.read) || 0,
      failed: parseInt(stats.failed) || 0,
      responded: parseInt(stats.responded) || 0,
      clicked: parseInt(stats.clicked) || 0,
      details,
    };
  }

  async updateMessageStatus(
    campaignId: string,
    phone: string,
    status: CampaignMessageDetail['status'],
    extraData?: Partial<CampaignMessageDetail>
  ): Promise<void> {
    const now = Date.now();
    let sentAt: number | null = null;
    let deliveredAt: number | null = null;
    let readAt: number | null = null;

    // Set timestamps based on status
    if (status === 'sent') {
      sentAt = now;
    } else if (status === 'delivered') {
      deliveredAt = now;
    } else if (status === 'read') {
      readAt = now;
    }

    // Build update query (updated_at is handled automatically by trigger)
    console.log('[CampaignStorage] 🔥 FIXED VERSION - updated_at handled by trigger');
    let query = `
      UPDATE campaign_message_details
      SET status = $1
    `;
    const params: any[] = [status];
    let paramCount = 1;

    if (sentAt !== null) {
      paramCount++;
      query += `, sent_at = COALESCE(sent_at, $${paramCount})`;
      params.push(sentAt);
    }

    if (deliveredAt !== null) {
      paramCount++;
      query += `, delivered_at = COALESCE(delivered_at, $${paramCount})`;
      params.push(deliveredAt);
    }

    if (readAt !== null) {
      paramCount++;
      query += `, read_at = COALESCE(read_at, $${paramCount})`;
      params.push(readAt);
    }

    if (extraData?.responded !== undefined) {
      paramCount++;
      query += `, responded = $${paramCount}`;
      params.push(extraData.responded);
    }

    if (extraData?.clickedButton !== undefined) {
      paramCount++;
      query += `, clicked_button = $${paramCount}`;
      params.push(extraData.clickedButton);
    }

    if (extraData?.messageId) {
      paramCount++;
      query += `, message_id = COALESCE(message_id, $${paramCount})`;
      params.push(extraData.messageId);
    }

    if (extraData?.failReason !== undefined) {
      paramCount++;
      query += `, error_message = $${paramCount}`;
      params.push(extraData.failReason);
    }

    paramCount++;
    query += ` WHERE campaign_id = $${paramCount}`;
    params.push(campaignId);

    paramCount++;
    query += ` AND phone = $${paramCount}`;
    params.push(phone);

    await this.pool.query(query, params);
  }

  async getAllMetrics(): Promise<CampaignMetrics[]> {
    const campaigns = await this.getAllCampaigns();
    const metrics: CampaignMetrics[] = [];

    for (const campaign of campaigns) {
      const metric = await this.getCampaignMetrics(campaign.id);
      if (metric) {
        metrics.push(metric);
      }
    }

    return metrics;
  }

  /**
   * Find campaign by message ID (for webhook processing)
   */
  async findCampaignByMessageId(messageId: string, recipientPhone: string): Promise<{ id: string } | null> {
    try {
      // Clean phone for comparison
      const cleanPhone = recipientPhone.replace(/^\+/, '');

      const result = await this.pool.query(
        `SELECT campaign_id
         FROM campaign_message_details
         WHERE message_id = $1
           AND (phone = $2 OR phone = $3 OR phone LIKE $4)
         LIMIT 1`,
        [messageId, cleanPhone, `+${cleanPhone}`, `%${cleanPhone}`]
      );

      if (result.rows.length > 0) {
        return { id: result.rows[0].campaign_id };
      }

      return null;
    } catch (error) {
      console.error('[CampaignStorageDB] Error finding campaign by message ID:', error);
      return null;
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private mapRowToCampaign(row: any): Campaign {
    return {
      id: row.id,
      name: row.name,
      whatsappNumberId: row.whatsapp_number_id,
      templateName: row.template_name,
      language: row.language,
      recipients: row.recipients || [],
      variables: row.variables || {},
      status: row.status,
      createdAt: parseInt(row.created_at),
      createdBy: row.created_by,
      throttleRate: parseInt(row.throttle_rate),
      startedAt: row.started_at ? parseInt(row.started_at) : undefined,
      completedAt: row.completed_at ? parseInt(row.completed_at) : undefined,
    };
  }

  /**
   * Close pool connection
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Export singleton instance
export const campaignStorageDB = new CampaignStorageDB();

// Export with both names for backward compatibility
export const campaignStorage = campaignStorageDB;
