import { Router } from "express";
import { metricsTrackerDB as metricsTracker, MetricsTrackerDB } from "../metrics-tracker-db";
import { adminDb } from "../../admin-db";
import { getTemplateUsageStats } from "../template-usage-tracker";
import { getKeywordUsageStats } from "../keyword-usage-tracker";
import { getRagUsageStats } from "../rag-usage-tracker";
import { getCampaignStats } from "../campaign-tracker";
// @ts-ignore
import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

export function createMetricsRouter() {
  const router = Router();

  /**
   * GET /metrics/advisor/:advisorId
   * Get metrics for a specific advisor with optional date filters
   */
  router.get("/advisor/:advisorId", async (req, res) => {
    try {
      const { advisorId } = req.params;
      const { startDate, endDate } = req.query;

      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const metrics = metricsTracker.getAdvisorMetrics(advisorId, start, end);
      const kpis = await metricsTracker.calculateKPIs(advisorId, start, end);

      res.json({ metrics, kpis });
    } catch (error) {
      console.error("[Metrics] Error fetching advisor metrics:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/kpis
   * Get KPIs for current user (advisor) or all advisors (admin)
   */
  router.get("/kpis", async (req, res) => {
    try {
      const { startDate, endDate, advisorId, phoneNumberId } = req.query;

      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;
      const advisor = advisorId as string | undefined;
      const phoneNumId = phoneNumberId as string | undefined;

      // For superior roles (admin, supervisor, gerencia), show ALL metrics by default
      // For asesores, show only their own metrics
      // Also check for custom gerencia role (role-1761832887172 = Amanda's Gerencia role)
      const isSuperiorRole = req.user?.role === 'admin' ||
                             req.user?.role === 'supervisor' ||
                             req.user?.role === 'gerencia' ||
                             req.user?.role === 'role-1761832887172'; // Custom Gerencia role

      let targetAdvisor: string | undefined;
      if (advisor) {
        // If advisorId is explicitly provided, use it
        targetAdvisor = advisor;
      } else if (isSuperiorRole) {
        // Superior roles see ALL metrics (undefined = all)
        targetAdvisor = undefined;
      } else {
        // Asesores see only their own metrics
        targetAdvisor = req.user?.userId || "unknown";
      }

      const kpis = await metricsTracker.calculateKPIs(targetAdvisor, start, end, phoneNumId);

      res.json({ kpis, advisorId: targetAdvisor, showingAll: targetAdvisor === undefined });
    } catch (error) {
      console.error("[Metrics] Error calculating KPIs:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/trend
   * Get conversation trend data for charts
   */
  router.get("/trend", async (req, res) => {
    try {
      const { days = "7", advisorId } = req.query;

      const daysNum = parseInt(days as string, 10);
      const advisor = advisorId as string | undefined;

      // For superior roles (admin, supervisor, gerencia), show ALL metrics by default
      const isSuperiorRole = req.user?.role === 'admin' ||
                             req.user?.role === 'supervisor' ||
                             req.user?.role === 'gerencia' ||
                             req.user?.role === 'role-1761832887172'; // Custom Gerencia role

      let targetAdvisor: string | undefined;
      if (advisor) {
        targetAdvisor = advisor;
      } else if (isSuperiorRole) {
        targetAdvisor = undefined; // Show all
      } else {
        targetAdvisor = req.user?.userId;
      }

      const trend = await metricsTracker.getConversationTrend(targetAdvisor, daysNum);

      res.json({ trend, days: daysNum, showingAll: targetAdvisor === undefined });
    } catch (error) {
      console.error("[Metrics] Error fetching trend data:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/all
   * Get all metrics with optional filters (admin only)
   */
  router.get("/all", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const metrics = await metricsTracker.getAllMetrics(start, end);

      // Group by advisor
      const advisorIds = [...new Set(metrics.map(m => m.advisorId))];

      // Calculate KPIs for all advisors in parallel
      const advisorKPIs = await Promise.all(
        advisorIds.map(async (advisorId) => {
          const kpis = await metricsTracker.calculateKPIs(advisorId, start, end);
          const conversations = metrics.filter(m => m.advisorId === advisorId).length;
          return {
            advisorId,
            conversations,
            kpis,
          };
        })
      );

      res.json({
        total: metrics.length,
        advisors: advisorKPIs,
      });
    } catch (error) {
      console.error("[Metrics] Error fetching all metrics:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /metrics/:conversationId/satisfaction
   * Record satisfaction score for a conversation
   */
  router.post("/:conversationId/satisfaction", (req, res) => {
    try {
      const { conversationId } = req.params;
      const { score } = req.body;

      if (typeof score !== "number" || score < 1 || score > 5) {
        res.status(400).json({
          error: "invalid_score",
          message: "Score must be a number between 1 and 5",
        });
        return;
      }

      metricsTracker.recordSatisfaction(conversationId, score);

      res.json({ success: true });
    } catch (error) {
      console.error("[Metrics] Error recording satisfaction:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/:conversationId/tags
   * Get tags for a conversation
   */
  router.get("/:conversationId/tags", (req, res) => {
    try {
      const { conversationId } = req.params;
      const tags = metricsTracker.getConversationTags(conversationId);

      res.json({ tags });
    } catch (error) {
      console.error("[Metrics] Error fetching tags:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /metrics/:conversationId/tags
   * Add tags to a conversation
   */
  router.post("/:conversationId/tags", (req, res) => {
    try {
      const { conversationId } = req.params;
      const { tags } = req.body;

      if (!Array.isArray(tags)) {
        res.status(400).json({
          error: "invalid_tags",
          message: "Tags must be an array",
        });
        return;
      }

      metricsTracker.addTags(conversationId, tags);

      res.json({ success: true });
    } catch (error) {
      console.error("[Metrics] Error adding tags:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /metrics/:conversationId/tags
   * Remove tags from a conversation
   */
  router.delete("/:conversationId/tags", (req, res) => {
    try {
      const { conversationId } = req.params;
      const { tags } = req.body;

      if (!Array.isArray(tags)) {
        res.status(400).json({
          error: "invalid_tags",
          message: "Tags must be an array",
        });
        return;
      }

      metricsTracker.removeTags(conversationId, tags);

      res.json({ success: true });
    } catch (error) {
      console.error("[Metrics] Error removing tags:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /metrics/reset
   * Reset ALL metrics data (ADMIN ONLY - destructive operation)
   */
  router.post("/reset", (req, res) => {
    try {
      // Verify user is admin
      if (!req.user || req.user.role !== "admin") {
        res.status(403).json({
          error: "forbidden",
          message: "Only administrators can reset metrics",
        });
        return;
      }

      const { confirmText } = req.body;

      // Require confirmation text to prevent accidental resets
      if (confirmText !== "RESET_ALL_METRICS") {
        res.status(400).json({
          error: "confirmation_required",
          message: "Please provide confirmText: 'RESET_ALL_METRICS'",
        });
        return;
      }

      metricsTracker.resetAllMetrics();

      console.log(`[Metrics] ⚠️  ALL METRICS RESET by ${req.user.email}`);

      res.json({
        success: true,
        message: "All metrics have been reset",
        resetBy: req.user.email,
        resetAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Metrics] Error resetting metrics:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/dashboard
   * Get comprehensive dashboard data (all KPIs, trends, comparisons)
   */
  router.get("/dashboard", async (req, res) => {
    try {
      const { days = "7" } = req.query;
      const daysNum = parseInt(days as string, 10);

      // Get all metrics for the period
      const startDate = Date.now() - daysNum * 24 * 60 * 60 * 1000;
      const allMetrics = await metricsTracker.getAllMetrics(startDate);

      // Group by advisor and calculate KPIs
      const advisorIds = [...new Set(allMetrics.map(m => m.advisorId))];
      const advisorKPIs = await Promise.all(
        advisorIds.map(async (advisorId) => {
          const kpis = await metricsTracker.calculateKPIs(advisorId, startDate);
          return { advisorId, ...kpis };
        })
      );

      // Get trends
      const trend = metricsTracker.getConversationTrend(undefined, daysNum);

      // Overall KPIs (all advisors combined)
      const overallKPIs = {
        totalConversations: allMetrics.length,
        avgFirstResponseTime: 0,
        avgResolutionTime: 0,
        avgSatisfactionScore: 0,
        totalMessages: 0,
        avgMessagesPerConversation: 0,
      };

      if (advisorKPIs.length > 0) {
        overallKPIs.avgFirstResponseTime = advisorKPIs.reduce((sum, a) => sum + a.avgFirstResponseTime, 0) / advisorKPIs.length;
        overallKPIs.avgResolutionTime = advisorKPIs.reduce((sum, a) => sum + a.avgResolutionTime, 0) / advisorKPIs.length;
        const scoresWithValues = advisorKPIs.filter(a => a.avgSatisfactionScore > 0);
        overallKPIs.avgSatisfactionScore = scoresWithValues.length > 0
          ? scoresWithValues.reduce((sum, a) => sum + a.avgSatisfactionScore, 0) / scoresWithValues.length
          : 0;
        overallKPIs.totalMessages = advisorKPIs.reduce((sum, a) => sum + a.totalMessages, 0);
        overallKPIs.avgMessagesPerConversation = overallKPIs.totalConversations > 0
          ? overallKPIs.totalMessages / overallKPIs.totalConversations
          : 0;
      }

      res.json({
        period: {
          days: daysNum,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date().toISOString(),
        },
        overall: overallKPIs,
        advisors: advisorKPIs,
        trend,
      });
    } catch (error) {
      console.error("[Metrics] Error fetching dashboard data:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/queues
   * Get queue statistics
   */
  router.get("/queues", (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const queueStats = metricsTracker.getQueueStats(start, end);

      res.json({ queues: queueStats });
    } catch (error) {
      console.error("[Metrics] Error fetching queue stats:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/advisors/ranking
   * Get advisor ranking with names and complete stats
   */
  router.get("/advisors/ranking", async (req, res) => {
    try {
      const { startDate, endDate, phoneNumberId } = req.query;

      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;
      const phoneNumId = phoneNumberId as string | undefined;

      // Get all metrics (optionally filtered by WhatsApp business number ID)
      const allMetrics = phoneNumId
        ? await metricsTracker.getMetricsByPhoneNumberId(phoneNumId, start, end)
        : await metricsTracker.getAllMetrics(start, end);

      // Get all users first to avoid multiple DB calls
      const allUsers = await adminDb.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      // Group by advisor and calculate KPIs
      const advisorIds = [...new Set(allMetrics.map(m => m.advisorId))];
      const advisorData = await Promise.all(
        advisorIds.map(async (advisorId) => {
          const kpis = await metricsTracker.calculateKPIs(advisorId, start, end);
          const user = userMap.get(advisorId);

          return {
            advisorId,
            advisorName: user?.name || user?.username || advisorId,
            advisorEmail: user?.email || null,
            advisorRole: user?.role || null,
            ...kpis,
          };
        })
      );

      // Sort by total conversations (descending) and add rank
      const ranking = advisorData
        .sort((a, b) => b.totalConversations - a.totalConversations)
        .map((advisor, index) => ({
          rank: index + 1,
          ...advisor,
        }));

      res.json({ ranking, total: ranking.length });
    } catch (error) {
      console.error("[Metrics] Error fetching advisor ranking:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/template-usage
   * Get template usage statistics with cost tracking
   * Query params:
   *   - startDate: ISO date string for start of period
   *   - endDate: ISO date string for end of period
   *   - advisorId: Filter by specific advisor
   *   - status: Filter by status ('sent' or 'failed')
   *   - limit: Number of records to return (default 100)
   *   - offset: Number of records to skip (default 0)
   */
  router.get("/template-usage", async (req, res) => {
    try {
      const { startDate, endDate, advisorId, status, limit, offset } = req.query;

      const filters: any = {};

      if (startDate && typeof startDate === 'string') {
        filters.startDate = new Date(startDate);
      }

      if (endDate && typeof endDate === 'string') {
        filters.endDate = new Date(endDate);
      }

      if (advisorId && typeof advisorId === 'string') {
        filters.advisorId = advisorId;
      }

      if (status && typeof status === 'string') {
        filters.status = status;
      }

      if (limit && typeof limit === 'string') {
        filters.limit = parseInt(limit, 10);
      }

      if (offset && typeof offset === 'string') {
        filters.offset = parseInt(offset, 10);
      }

      const result = await getTemplateUsageStats(filters);

      res.json(result);
    } catch (error) {
      console.error("[Metrics] Error fetching template usage:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/keyword-usage
   * Get keyword usage statistics
   * Query params:
   *   - startDate: ISO date string for start of period
   *   - endDate: ISO date string for end of period
   *   - flowId: Filter by specific flow
   *   - keywordGroupId: Filter by specific keyword group
   *   - limit: Number of records to return (default 100)
   *   - offset: Number of records to skip (default 0)
   */
  router.get("/keyword-usage", async (req, res) => {
    try {
      const { startDate, endDate, flowId, keywordGroupId, limit, offset } = req.query;

      const filters: any = {};

      if (startDate && typeof startDate === 'string') {
        filters.startDate = new Date(startDate);
      }

      if (endDate && typeof endDate === 'string') {
        filters.endDate = new Date(endDate);
      }

      if (flowId && typeof flowId === 'string') {
        filters.flowId = flowId;
      }

      if (keywordGroupId && typeof keywordGroupId === 'string') {
        filters.keywordGroupId = keywordGroupId;
      }

      if (limit && typeof limit === 'string') {
        filters.limit = parseInt(limit, 10);
      }

      if (offset && typeof offset === 'string') {
        filters.offset = parseInt(offset, 10);
      }

      const result = await getKeywordUsageStats(filters);

      res.json(result);
    } catch (error) {
      console.error("[Metrics] Error fetching keyword usage:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/rag-usage
   * Get RAG (Retrieval-Augmented Generation) usage statistics with cost tracking
   * Query params:
   *   - startDate: ISO date string for start of period
   *   - endDate: ISO date string for end of period
   *   - advisorId: Filter by specific advisor
   *   - category: Filter by category
   *   - found: Filter by whether results were found (true/false)
   *   - limit: Number of records to return (default 100)
   *   - offset: Number of records to skip (default 0)
   */
  router.get("/rag-usage", async (req, res) => {
    try {
      const { startDate, endDate, advisorId, category, found, limit, offset } = req.query;

      const filters: any = {};

      if (startDate && typeof startDate === 'string') {
        filters.startDate = new Date(startDate);
      }

      if (endDate && typeof endDate === 'string') {
        filters.endDate = new Date(endDate);
      }

      if (advisorId && typeof advisorId === 'string') {
        filters.advisorId = advisorId;
      }

      if (category && typeof category === 'string') {
        filters.category = category;
      }

      if (found && typeof found === 'string') {
        filters.found = found === 'true';
      }

      if (limit && typeof limit === 'string') {
        filters.limit = parseInt(limit, 10);
      }

      if (offset && typeof offset === 'string') {
        filters.offset = parseInt(offset, 10);
      }

      const result = await getRagUsageStats(filters);

      res.json(result);
    } catch (error) {
      console.error("[Metrics] Error fetching RAG usage:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/campaign-tracking
   * Get campaign tracking statistics
   * Query params:
   *   - startDate: ISO date string for start of period
   *   - endDate: ISO date string for end of period
   *   - campaignSource: Filter by campaign source
   *   - campaignName: Filter by campaign name
   *   - keyword: Filter by detected keyword
   *   - limit: Number of records to return (default 100)
   *   - offset: Number of records to skip (default 0)
   */
  router.get("/campaign-tracking", async (req, res) => {
    try {
      const { startDate, endDate, campaignSource, campaignName, keyword, limit, offset } = req.query;

      const filters: any = {};

      if (startDate && typeof startDate === 'string') {
        filters.startDate = new Date(startDate);
      }

      if (endDate && typeof endDate === 'string') {
        filters.endDate = new Date(endDate);
      }

      if (campaignSource && typeof campaignSource === 'string') {
        filters.campaignSource = campaignSource;
      }

      if (campaignName && typeof campaignName === 'string') {
        filters.campaignName = campaignName;
      }

      if (keyword && typeof keyword === 'string') {
        filters.keyword = keyword;
      }

      if (limit && typeof limit === 'string') {
        filters.limit = parseInt(limit, 10);
      }

      if (offset && typeof offset === 'string') {
        filters.offset = parseInt(offset, 10);
      }

      const result = await getCampaignStats(filters);

      res.json(result);
    } catch (error) {
      console.error("[Metrics] Error fetching campaign tracking:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/campaign-costs
   * Calcula costos estimados de campañas masivas a partir de campaign_message_details
   * Query params (opcionales):
   *  - startDate / endDate: epoch millis
   *  - costPerMessage: override costo unitario (USD)
   */
  router.get("/campaign-costs", async (req, res) => {
    try {
      const now = new Date();
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const start = req.query.startDate ? parseInt(req.query.startDate as string, 10) : defaultStart;
      const end = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;
      // Defaults para Perú: MARKETING 0.0703 USD, otros 0.02 USD
      const defaultMarketing = 0.0703;
      const defaultOther = 0.02;
      const costPerMessage = req.query.costPerMessage ? parseFloat(req.query.costPerMessage as string) : defaultOther; // usa fallback si no se envía
      const templateName = req.query.templateName ? String(req.query.templateName) : undefined;

      const where: string[] = ["cmd.status IN ('sent','delivered','read','failed')"];
      const params: any[] = [];

      if (start) {
        params.push(start);
        where.push(`cmd.sent_at >= $${params.length}`);
      }
      if (end) {
        params.push(end);
        where.push(`cmd.sent_at <= $${params.length}`);
      }
      if (templateName) {
        params.push(`%${templateName}%`);
        where.push(`c.template_name ILIKE $${params.length}`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const query = `
        SELECT
          cmd.campaign_id,
          c.name AS campaign_name,
          c.template_name AS template_name,
          COUNT(*) AS total_messages,
          COUNT(*) FILTER (WHERE cmd.status = 'sent') AS sent_count,
          COUNT(*) FILTER (WHERE cmd.delivered_at IS NOT NULL) AS delivered_count,
          COUNT(*) FILTER (WHERE cmd.read_at IS NOT NULL) AS read_count
        FROM campaign_message_details cmd
        LEFT JOIN campaigns c ON c.id = cmd.campaign_id
        ${whereSql}
        GROUP BY cmd.campaign_id, c.name, c.template_name
        ORDER BY total_messages DESC
      `;

      const result = await pool.query(query, params);

      const campaigns = result.rows.map((row) => {
        const totalMessages = parseInt(row.total_messages || 0);
        // Si se conoce la categoría de la plantilla, se podría ajustar; hoy usamos defaultMarketing solo si el nombre sugiere marketing
        const isMarketing = (row.campaign_name || '').toLowerCase().includes('mkt') || (row.campaign_name || '').toLowerCase().includes('marketing');
        const unitCost = req.query.costPerMessage ? costPerMessage : (isMarketing ? defaultMarketing : defaultOther);
        return {
          campaignId: row.campaign_id,
          campaignName: row.campaign_name || row.campaign_id,
          templateName: row.template_name || null,
          totalMessages,
          sent: parseInt(row.sent_count || 0),
          delivered: parseInt(row.delivered_count || 0),
          read: parseInt(row.read_count || 0),
          cost: totalMessages * unitCost,
        };
      });

      const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);
      const totalMessages = campaigns.reduce((sum, c) => sum + c.totalMessages, 0);

      res.json({
        costPerMessage,
        totalCost,
        totalMessages,
        campaigns,
      });
    } catch (error) {
      console.error("[Metrics] Error fetching campaign costs:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/ads-tracking
   * Get Meta Ads (Facebook/Instagram) tracking statistics
   * Only shows conversations from Click-to-WhatsApp ads
   */
  router.get("/ads-tracking", async (req, res) => {
    console.log("[Metrics] ===== ADS-TRACKING ENDPOINT CALLED =====");
    try {
      const { limit, offset } = req.query;
      const limitNum = limit ? parseInt(limit as string, 10) : 100;
      const offsetNum = offset ? parseInt(offset as string, 10) : 0;
      console.log("[Metrics] Params:", { limitNum, offsetNum });

      // Get total count of ad conversions
      const countQuery = `
        SELECT COUNT(*) as total_count
        FROM crm_conversations
        WHERE ad_ctwa_clid IS NOT NULL
          AND phone NOT IN (SELECT phone_number FROM excluded_phone_numbers)
      `;
      const countResult = await pool.query(countQuery);

      // Get keyword stats from ads
      const keywordStatsQuery = `
        SELECT
          ku.matched_keyword as detected_keyword,
          ku.keyword_group_label as keyword_group_name,
          COUNT(*) as count
        FROM keyword_usage ku
        INNER JOIN crm_conversations c ON ku.conversation_id = c.id
        WHERE c.ad_ctwa_clid IS NOT NULL
          AND c.phone NOT IN (SELECT phone_number FROM excluded_phone_numbers)
          AND ku.matched_keyword IS NOT NULL
          AND array_length(string_to_array(ku.matched_keyword, ' '), 1) >= 3
        GROUP BY ku.matched_keyword, ku.keyword_group_label
        ORDER BY count DESC
        LIMIT 20
      `;
      const keywordStatsResult = await pool.query(keywordStatsQuery);

      // Get ad aggregations
      const adsQuery = `
        SELECT
          MAX(c.ad_source_type) as referral_source_type,
          c.ad_source_id as referral_source_id,
          MAX(c.ad_source_url) as referral_source_url,
          MAX(c.ad_headline) as referral_headline,
          MAX(c.ad_body) as referral_body,
          MAX(c.ad_media_type) as referral_media_type,
          MAX(c.ad_image_url) as referral_image_url,
          MAX(c.ad_video_url) as referral_video_url,
          MAX(c.ad_thumbnail_url) as referral_thumbnail_url,
          MAX(c.ad_ctwa_clid) as ctwa_clid,
          COUNT(DISTINCT c.id) as count,
          json_agg(DISTINCT jsonb_build_object(
            'keyword', ku.matched_keyword,
            'group', ku.keyword_group_label
          ) ORDER BY jsonb_build_object('keyword', ku.matched_keyword, 'group', ku.keyword_group_label))
          FILTER (WHERE ku.matched_keyword IS NOT NULL) as detected_keywords
        FROM crm_conversations c
        LEFT JOIN keyword_usage ku ON ku.conversation_id = c.id
        WHERE c.ad_ctwa_clid IS NOT NULL
          AND c.phone NOT IN (SELECT phone_number FROM excluded_phone_numbers)
        GROUP BY c.ad_source_id
        ORDER BY count DESC
        LIMIT 20
      `;
      const adsResult = await pool.query(adsQuery);

      // Get recent conversations
      const recordsQuery = `
        SELECT
          c.id,
          c.id::text as conversation_id,
          c.phone as customer_phone,
          c.contact_name as customer_name,
          c.last_message_preview as initial_message,
          NULL as detected_keyword,
          NULL as keyword_group_name,
          c.ad_source_url as referral_source_url,
          c.ad_source_id as referral_source_id,
          c.ad_source_type as referral_source_type,
          c.ad_headline as referral_headline,
          c.ad_body as referral_body,
          c.ad_media_type as referral_media_type,
          c.ad_image_url as referral_image_url,
          c.ad_video_url as referral_video_url,
          c.ad_thumbnail_url as referral_thumbnail_url,
          c.ad_ctwa_clid as ctwa_clid,
          to_timestamp(c.created_at / 1000.0) AT TIME ZONE 'America/Lima' as created_at
        FROM crm_conversations c
        WHERE c.ad_ctwa_clid IS NOT NULL
          AND c.phone NOT IN (SELECT phone_number FROM excluded_phone_numbers)
        ORDER BY c.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      const recordsResult = await pool.query(recordsQuery, [limitNum, offsetNum]);

      res.json({
        records: recordsResult.rows,
        totalCount: parseInt(countResult.rows[0].total_count),
        keywordStats: keywordStatsResult.rows,
        campaignStats: [],
        referralStats: adsResult.rows,
      });
    } catch (error) {
      console.error("[Metrics] Error fetching ads tracking:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/response-time-by-hour
   * Get average response time by hour of day
   */
  router.get("/response-time-by-hour", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const data = await metricsTracker.getResponseTimeByHour(start, end);
      res.json({ data });
    } catch (error) {
      console.error("[Metrics] Error fetching response time by hour:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/channel-distribution
   * Get distribution of conversations by channel
   */
  router.get("/channel-distribution", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const data = await metricsTracker.getChannelDistribution(start, end);
      res.json({ data });
    } catch (error) {
      console.error("[Metrics] Error fetching channel distribution:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/advisor-workload
   * Get current workload by advisor
   */
  router.get("/advisor-workload", async (req, res) => {
    try {
      const workload = await metricsTracker.getAdvisorWorkload();

      // Get user names
      const allUsers = await adminDb.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enrichedWorkload = workload.map(w => ({
        ...w,
        advisorName: userMap.get(w.advisorId)?.name || w.advisorId,
      }));

      res.json({ data: enrichedWorkload });
    } catch (error) {
      console.error("[Metrics] Error fetching advisor workload:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/completion-rates
   * Get completion, abandonment, and transfer rates
   */
  router.get("/completion-rates", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const data = await metricsTracker.getCompletionRates(start, end);
      res.json(data);
    } catch (error) {
      console.error("[Metrics] Error fetching completion rates:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/peak-hours
   * Get peak hours for conversations
   */
  router.get("/peak-hours", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? parseInt(startDate as string, 10) : undefined;
      const end = endDate ? parseInt(endDate as string, 10) : undefined;

      const data = await metricsTracker.getPeakHours(start, end);
      res.json({ data });
    } catch (error) {
      console.error("[Metrics] Error fetching peak hours:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /metrics/reliable-since
   * Get the date since which first response time metrics are reliable
   */
  router.get("/reliable-since", (req, res) => {
    try {
      const reliableSince = MetricsTrackerDB.getReliableMetricsSince();
      res.json({
        reliableSince,
        reliableSinceDate: new Date(reliableSince).toISOString(),
        reliableSinceDateLocal: new Date(reliableSince).toLocaleDateString('es-PE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'America/Lima'
        })
      });
    } catch (error) {
      console.error("[Metrics] Error fetching reliable since date:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return router;
}
