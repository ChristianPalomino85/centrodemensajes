/**
 * Sales-WhatsApp Conversions API Routes
 * Enhanced with filters, campaign tracking, sorting and pagination
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { syncSalesWithWhatsApp } from '../../services/sales-whatsapp-sync';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

// Helper to build common filters
function buildFilters(query: any, params: any[], baseQuery: string): string {
  let sql = baseQuery;

  // Date range filter
  if (query.dateFrom) {
    params.push(query.dateFrom);
    sql += ` AND sale_date >= $${params.length}::timestamp`;
  }
  if (query.dateTo) {
    params.push(query.dateTo);
    sql += ` AND sale_date <= $${params.length}::timestamp + interval '1 day'`;
  }

  // Seller filter
  if (query.seller && query.seller !== 'all') {
    params.push(query.seller);
    sql += ` AND seller_name = $${params.length}`;
  }

  // Area filter
  if (query.area && query.area !== 'all') {
    params.push(query.area);
    sql += ` AND area = $${params.length}`;
  }

  // WhatsApp number filter
  if (query.whatsappNumberId && query.whatsappNumberId !== 'all') {
    params.push(query.whatsappNumberId);
    sql += ` AND whatsapp_number_id = $${params.length}`;
  }

  return sql;
}

export function createSalesConversionsRouter() {
  const router = Router();

  /**
   * GET /sales-conversions/filters
   * Get available filter options (sellers, areas, date range)
   */
  router.get('/filters', async (req, res) => {
    try {
      // Get distinct sellers
      const sellersResult = await pool.query(`
        SELECT DISTINCT seller_name
        FROM sales_whatsapp_conversions
        WHERE seller_name IS NOT NULL
        ORDER BY seller_name
      `);

      // Get distinct areas
      const areasResult = await pool.query(`
        SELECT DISTINCT area
        FROM sales_whatsapp_conversions
        WHERE area IS NOT NULL
        ORDER BY area
      `);

      // Get date range
      const dateRangeResult = await pool.query(`
        SELECT
          MIN(sale_date) as min_date,
          MAX(sale_date) as max_date,
          COUNT(*) as total_records
        FROM sales_whatsapp_conversions
      `);

      // Get campaign date range
      const campaignDateResult = await pool.query(`
        SELECT
          MIN(to_timestamp(sent_at/1000)) as min_campaign_date,
          MAX(to_timestamp(sent_at/1000)) as max_campaign_date,
          COUNT(DISTINCT campaign_id) as total_campaigns
        FROM campaign_message_details
        WHERE sent_at IS NOT NULL
      `);

      res.json({
        sellers: sellersResult.rows.map(r => r.seller_name),
        areas: areasResult.rows.map(r => r.area),
        dateRange: {
          minDate: dateRangeResult.rows[0].min_date,
          maxDate: dateRangeResult.rows[0].max_date,
          totalRecords: parseInt(dateRangeResult.rows[0].total_records || '0'),
        },
        campaignDateRange: {
          minDate: campaignDateResult.rows[0].min_campaign_date,
          maxDate: campaignDateResult.rows[0].max_campaign_date,
          totalCampaigns: parseInt(campaignDateResult.rows[0].total_campaigns || '0'),
        },
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching filters:', error);
      res.status(500).json({ error: 'Failed to fetch filters' });
    }
  });

  /**
   * GET /sales-conversions/stats
   * Get overall conversion statistics with filters
   */
  router.get('/stats', async (req, res) => {
    try {
      const params: any[] = [];
      let query = buildFilters(req.query, params, `
        SELECT
          COUNT(*) as total_sales,
          COUNT(*) FILTER (WHERE contacted_via_whatsapp = true) as with_whatsapp,
          COUNT(*) FILTER (WHERE contacted_via_whatsapp = false) as without_whatsapp,
          SUM(sale_amount) as total_amount,
          SUM(sale_amount) FILTER (WHERE contacted_via_whatsapp = true) as amount_with_whatsapp,
          AVG(days_to_conversion) FILTER (WHERE days_to_conversion IS NOT NULL) as avg_days_to_conversion,
          MAX(last_sync_at) as last_sync
        FROM sales_whatsapp_conversions
        WHERE 1=1
      `);

      const result = await pool.query(query, params);
      const stats = result.rows[0];

      const conversionRate = stats.total_sales > 0
        ? (parseInt(stats.with_whatsapp) / parseInt(stats.total_sales)) * 100
        : 0;

      res.json({
        totalSales: parseInt(stats.total_sales || '0'),
        withWhatsApp: parseInt(stats.with_whatsapp || '0'),
        withoutWhatsApp: parseInt(stats.without_whatsapp || '0'),
        conversionRate: conversionRate.toFixed(1),
        totalAmount: parseFloat(stats.total_amount || '0'),
        amountWithWhatsApp: parseFloat(stats.amount_with_whatsapp || '0'),
        avgDaysToConversion: stats.avg_days_to_conversion ? parseFloat(stats.avg_days_to_conversion).toFixed(1) : null,
        lastSync: stats.last_sync,
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  });

  /**
   * GET /sales-conversions/by-whatsapp-number
   * Get conversions grouped by WhatsApp number with filters
   */
  router.get('/by-whatsapp-number', async (req, res) => {
    try {
      const params: any[] = [];
      let baseQuery = `
        SELECT
          COALESCE(whatsapp_number_id, 'Sin WhatsApp') as whatsapp_number_id,
          COALESCE(
            REPLACE(MAX(whatsapp_display_name), ' ', ''),
            'Sin WhatsApp'
          ) as whatsapp_display_name,
          COUNT(*) as total_sales,
          SUM(sale_amount) as total_amount,
          AVG(days_to_conversion) FILTER (WHERE days_to_conversion IS NOT NULL) as avg_days_to_conversion
        FROM sales_whatsapp_conversions
        WHERE contacted_via_whatsapp = true
          AND whatsapp_number_id IS NOT NULL
      `;

      // Apply filters (except whatsappNumberId since we're grouping by it)
      if (req.query.dateFrom) {
        params.push(req.query.dateFrom);
        baseQuery += ` AND sale_date >= $${params.length}::timestamp`;
      }
      if (req.query.dateTo) {
        params.push(req.query.dateTo);
        baseQuery += ` AND sale_date <= $${params.length}::timestamp + interval '1 day'`;
      }
      if (req.query.seller && req.query.seller !== 'all') {
        params.push(req.query.seller);
        baseQuery += ` AND seller_name = $${params.length}`;
      }
      if (req.query.area && req.query.area !== 'all') {
        params.push(req.query.area);
        baseQuery += ` AND area = $${params.length}`;
      }

      baseQuery += ` GROUP BY whatsapp_number_id ORDER BY total_sales DESC`;

      const result = await pool.query(baseQuery, params);

      res.json({
        data: result.rows.map(row => ({
          whatsappNumberId: row.whatsapp_number_id,
          whatsappDisplayName: row.whatsapp_display_name,
          totalSales: parseInt(row.total_sales),
          totalAmount: parseFloat(row.total_amount),
          avgDaysToConversion: row.avg_days_to_conversion ? parseFloat(row.avg_days_to_conversion).toFixed(1) : null,
        })),
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching by WhatsApp number:', error);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  /**
   * GET /sales-conversions/by-seller
   * Get conversions grouped by seller with filters
   */
  router.get('/by-seller', async (req, res) => {
    try {
      const params: any[] = [];
      let baseQuery = `
        SELECT
          COALESCE(seller_name, 'Sin Vendedor') as seller_name,
          COUNT(*) as total_sales,
          COUNT(*) FILTER (WHERE contacted_via_whatsapp = true) as with_whatsapp,
          SUM(sale_amount) as total_amount,
          SUM(sale_amount) FILTER (WHERE contacted_via_whatsapp = true) as amount_with_whatsapp,
          AVG(days_to_conversion) FILTER (WHERE days_to_conversion IS NOT NULL) as avg_days_to_conversion
        FROM sales_whatsapp_conversions
        WHERE 1=1
      `;

      // Apply filters (except seller since we're grouping by it)
      if (req.query.dateFrom) {
        params.push(req.query.dateFrom);
        baseQuery += ` AND sale_date >= $${params.length}::timestamp`;
      }
      if (req.query.dateTo) {
        params.push(req.query.dateTo);
        baseQuery += ` AND sale_date <= $${params.length}::timestamp + interval '1 day'`;
      }
      if (req.query.whatsappNumberId && req.query.whatsappNumberId !== 'all') {
        params.push(req.query.whatsappNumberId);
        baseQuery += ` AND whatsapp_number_id = $${params.length}`;
      }
      if (req.query.area && req.query.area !== 'all') {
        params.push(req.query.area);
        baseQuery += ` AND area = $${params.length}`;
      }

      baseQuery += ` GROUP BY seller_name ORDER BY total_sales DESC`;

      const result = await pool.query(baseQuery, params);

      res.json({
        data: result.rows.map(row => ({
          sellerName: row.seller_name,
          totalSales: parseInt(row.total_sales),
          withWhatsApp: parseInt(row.with_whatsapp),
          conversionRate: ((parseInt(row.with_whatsapp) / parseInt(row.total_sales)) * 100).toFixed(1),
          totalAmount: parseFloat(row.total_amount),
          amountWithWhatsApp: parseFloat(row.amount_with_whatsapp || '0'),
          avgDaysToConversion: row.avg_days_to_conversion ? parseFloat(row.avg_days_to_conversion).toFixed(1) : null,
        })),
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching by seller:', error);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  /**
   * GET /sales-conversions/by-area
   * Get conversions grouped by sales area with filters
   */
  router.get('/by-area', async (req, res) => {
    try {
      const params: any[] = [];
      let baseQuery = `
        SELECT
          area,
          COUNT(*) as total_sales,
          COUNT(*) FILTER (WHERE contacted_via_whatsapp = true) as with_whatsapp,
          SUM(sale_amount) as total_amount,
          SUM(sale_amount) FILTER (WHERE contacted_via_whatsapp = true) as amount_with_whatsapp
        FROM sales_whatsapp_conversions
        WHERE 1=1
      `;

      // Apply filters (except area since we're grouping by it)
      if (req.query.dateFrom) {
        params.push(req.query.dateFrom);
        baseQuery += ` AND sale_date >= $${params.length}::timestamp`;
      }
      if (req.query.dateTo) {
        params.push(req.query.dateTo);
        baseQuery += ` AND sale_date <= $${params.length}::timestamp + interval '1 day'`;
      }
      if (req.query.seller && req.query.seller !== 'all') {
        params.push(req.query.seller);
        baseQuery += ` AND seller_name = $${params.length}`;
      }
      if (req.query.whatsappNumberId && req.query.whatsappNumberId !== 'all') {
        params.push(req.query.whatsappNumberId);
        baseQuery += ` AND whatsapp_number_id = $${params.length}`;
      }

      baseQuery += ` GROUP BY area ORDER BY total_sales DESC`;

      const result = await pool.query(baseQuery, params);

      res.json({
        data: result.rows.map(row => ({
          area: row.area,
          totalSales: parseInt(row.total_sales),
          withWhatsApp: parseInt(row.with_whatsapp),
          conversionRate: ((parseInt(row.with_whatsapp) / parseInt(row.total_sales)) * 100).toFixed(1),
          totalAmount: parseFloat(row.total_amount),
          amountWithWhatsApp: parseFloat(row.amount_with_whatsapp || '0'),
        })),
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching by area:', error);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  /**
   * GET /sales-conversions/campaigns
   * Get campaign conversion metrics
   */
  router.get('/campaigns', async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      const params: any[] = [];

      let dateFilter = '';
      if (dateFrom) {
        params.push(dateFrom);
        dateFilter += ` AND s.sale_date >= $${params.length}::timestamp`;
      }
      if (dateTo) {
        params.push(dateTo);
        dateFilter += ` AND s.sale_date <= $${params.length}::timestamp + interval '1 day'`;
      }

      const query = `
        SELECT
          c.id as campaign_id,
          c.name as campaign_name,
          c.template_name,
          to_timestamp(c.started_at/1000) as started_at,
          COUNT(DISTINCT cmd.phone) as total_recipients,
          COUNT(DISTINCT CASE WHEN cmd.delivered_at IS NOT NULL THEN cmd.phone END) as delivered,
          COUNT(DISTINCT CASE WHEN cmd.read_at IS NOT NULL THEN cmd.phone END) as read,
          COUNT(DISTINCT CASE WHEN cmd.responded = true THEN cmd.phone END) as responded,
          COUNT(DISTINCT CASE WHEN s.customer_phone IS NOT NULL THEN cmd.phone END) as converted,
          COALESCE(SUM(DISTINCT CASE WHEN s.customer_phone IS NOT NULL THEN s.sale_amount END), 0) as total_revenue
        FROM campaigns c
        JOIN campaign_message_details cmd ON cmd.campaign_id = c.id
        LEFT JOIN sales_whatsapp_conversions s ON s.customer_phone = cmd.phone
          AND s.sale_date >= to_timestamp(cmd.sent_at/1000)
          ${dateFilter}
        WHERE c.status IN ('completed', 'running', 'paused')
        GROUP BY c.id, c.name, c.template_name, c.started_at
        ORDER BY c.started_at DESC
      `;

      const result = await pool.query(query, params);

      res.json({
        data: result.rows.map(row => ({
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          templateName: row.template_name,
          startedAt: row.started_at,
          totalRecipients: parseInt(row.total_recipients || '0'),
          delivered: parseInt(row.delivered || '0'),
          read: parseInt(row.read || '0'),
          responded: parseInt(row.responded || '0'),
          converted: parseInt(row.converted || '0'),
          conversionRate: row.total_recipients > 0
            ? ((parseInt(row.converted || '0') / parseInt(row.total_recipients)) * 100).toFixed(2)
            : '0.00',
          totalRevenue: parseFloat(row.total_revenue || '0'),
        })),
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching campaigns:', error);
      res.status(500).json({ error: 'Failed to fetch campaign data' });
    }
  });

  /**
   * GET /sales-conversions/recent
   * Get recent conversions with sorting and pagination
   */
  router.get('/recent', async (req, res) => {
    try {
      const {
        page = '1',
        limit = '20',
        sortBy = 'sale_date',
        sortOrder = 'desc'
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
      const offset = (pageNum - 1) * limitNum;

      // Validate sort column to prevent SQL injection
      const allowedSortColumns = ['sale_date', 'sale_amount', 'customer_name', 'seller_name', 'area', 'days_to_conversion'];
      const sortColumn = allowedSortColumns.includes(sortBy as string) ? sortBy : 'sale_date';
      const order = (sortOrder as string).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      const params: any[] = [];
      let baseQuery = `
        FROM sales_whatsapp_conversions s
        LEFT JOIN (
          SELECT DISTINCT ON (phone)
            phone,
            campaign_id
          FROM campaign_message_details
          WHERE sent_at IS NOT NULL
          ORDER BY phone, sent_at DESC
        ) cmd ON cmd.phone = s.customer_phone
        LEFT JOIN campaigns c ON c.id = cmd.campaign_id
        WHERE 1=1
      `;

      baseQuery = buildFilters(req.query, params, baseQuery);

      // Get total count
      const countResult = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
      const total = parseInt(countResult.rows[0].total);

      // Get paginated data
      const dataQuery = `
        SELECT
          s.customer_phone,
          s.customer_name,
          s.sale_date,
          s.sale_amount,
          s.area,
          s.seller_name,
          s.first_whatsapp_contact_date,
          s.whatsapp_display_name,
          s.days_to_conversion,
          s.contacted_via_whatsapp,
          c.name as campaign_name,
          CASE
            WHEN c.id IS NOT NULL THEN 'campaign'
            WHEN s.contacted_via_whatsapp = true THEN 'chat'
            ELSE 'direct'
          END as source_type
        ${baseQuery}
        ORDER BY s.${sortColumn} ${order} NULLS LAST
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      params.push(limitNum, offset);
      const result = await pool.query(dataQuery, params);

      res.json({
        data: result.rows.map(row => ({
          customerPhone: row.customer_phone,
          customerName: row.customer_name,
          saleDate: row.sale_date,
          saleAmount: parseFloat(row.sale_amount),
          area: row.area,
          sellerName: row.seller_name,
          firstWhatsAppContact: row.first_whatsapp_contact_date,
          whatsappDisplayName: row.whatsapp_display_name,
          daysToConversion: row.days_to_conversion,
          contactedViaWhatsApp: row.contacted_via_whatsapp,
          campaignName: row.campaign_name,
          sourceType: row.source_type,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching recent conversions:', error);
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  });

  /**
   * GET /sales-conversions/campaigns/:campaignId/details
   * Get detailed conversion info for a specific campaign
   */
  router.get('/campaigns/:campaignId/details', async (req, res) => {
    try {
      const { campaignId } = req.params;

      // Get campaign info
      const campaignResult = await pool.query(`
        SELECT id, name, template_name, to_timestamp(started_at/1000) as started_at
        FROM campaigns
        WHERE id = $1
      `, [campaignId]);

      if (campaignResult.rows.length === 0) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      const campaign = campaignResult.rows[0];

      // Get all recipients with their conversion status
      const recipientsQuery = `
        SELECT
          cmd.phone,
          cmd.status as message_status,
          to_timestamp(cmd.sent_at/1000) as sent_at,
          to_timestamp(cmd.delivered_at/1000) as delivered_at,
          to_timestamp(cmd.read_at/1000) as read_at,
          cmd.responded,
          s.customer_name,
          s.sale_date,
          s.sale_amount,
          s.area,
          s.seller_name,
          CASE WHEN s.id IS NOT NULL THEN true ELSE false END as converted
        FROM campaign_message_details cmd
        LEFT JOIN sales_whatsapp_conversions s ON s.customer_phone = cmd.phone
          AND s.sale_date >= to_timestamp(cmd.sent_at/1000)
        WHERE cmd.campaign_id = $1
        ORDER BY s.sale_amount DESC NULLS LAST, cmd.sent_at DESC
      `;

      const recipientsResult = await pool.query(recipientsQuery, [campaignId]);

      // Separate converted and non-converted
      const converted = recipientsResult.rows.filter(r => r.converted);
      const notConverted = recipientsResult.rows.filter(r => !r.converted);

      // Calculate summary stats
      const totalRecipients = recipientsResult.rows.length;
      const totalConverted = converted.length;
      const totalRevenue = converted.reduce((sum, r) => sum + (parseFloat(r.sale_amount) || 0), 0);
      const conversionRate = totalRecipients > 0 ? ((totalConverted / totalRecipients) * 100).toFixed(2) : '0.00';

      res.json({
        campaign: {
          id: campaign.id,
          name: campaign.name,
          templateName: campaign.template_name,
          startedAt: campaign.started_at,
        },
        summary: {
          totalRecipients,
          totalConverted,
          totalRevenue,
          conversionRate,
        },
        converted: converted.map(r => ({
          phone: r.phone,
          customerName: r.customer_name,
          saleDate: r.sale_date,
          saleAmount: parseFloat(r.sale_amount),
          area: r.area,
          sellerName: r.seller_name,
          sentAt: r.sent_at,
          deliveredAt: r.delivered_at,
          readAt: r.read_at,
        })),
        notConverted: notConverted.slice(0, 50).map(r => ({
          phone: r.phone,
          messageStatus: r.message_status,
          sentAt: r.sent_at,
          deliveredAt: r.delivered_at,
          readAt: r.read_at,
          responded: r.responded,
        })),
        notConvertedTotal: notConverted.length,
      });

    } catch (error) {
      console.error('[SalesConversions] Error fetching campaign details:', error);
      res.status(500).json({ error: 'Failed to fetch campaign details' });
    }
  });

  /**
   * POST /sales-conversions/sync
   * Force manual sync
   */
  router.post('/sync', async (req, res) => {
    try {
      console.log('[SalesConversions] Manual sync triggered by:', req.user?.email);

      const result = await syncSalesWithWhatsApp();

      res.json({
        success: true,
        ...result,
      });

    } catch (error) {
      console.error('[SalesConversions] Error during manual sync:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }
  });

  return router;
}
