/**
 * API Routes
 *
 * Endpoints adicionales para monitoreo, validación, simulación y testing.
 */

import type { Router } from "express";
import { Router as createRouter } from "express";
import { validateFlow } from "../src/flow/validation";
import { ConversationSimulator } from "../src/runtime/simulator";
import { botLogger, metricsTracker } from "../src/runtime/monitoring";
import type { FlowProvider } from "../src/runtime/engine";
import type { SessionStore } from "../src/runtime/session";
import { Bitrix24Client } from "../src/integrations/bitrix24";
import { sendWspTestMessage } from "./services/wsp";
import { createConnectionsRouter } from "./routes/connections";
import { realtimeMetrics } from "./crm/realtime-metrics";

export interface ApiRoutesOptions {
  flowProvider: FlowProvider;
  sessionStore: SessionStore;
}

export function createApiRoutes(options: ApiRoutesOptions): Router {
  const router = createRouter();

  // ============================================
  // VALIDATION ENDPOINTS
  // ============================================

  /**
   * Validar un flujo antes de publicarlo
   * POST /api/validate
   */
  router.post("/validate", async (req, res) => {
    try {
      const flow = req.body;

      if (!flow) {
        res.status(400).json({ error: "Flow is required" });
        return;
      }

      const result = validateFlow(flow);

      res.json({
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        issues: result.issues,
      });
    } catch (error) {
      console.error("[API] Validation error:", error);
      res.status(500).json({ error: "Validation failed" });
    }
  });

  // ============================================
  // SIMULATION ENDPOINTS
  // ============================================

  // Store active simulators
  const activeSimulators = new Map<string, ConversationSimulator>();

  /**
   * Iniciar una nueva simulación
   * POST /api/simulate/start
   */
  router.post("/simulate/start", async (req, res) => {
    try {
      const { flowId } = req.body;

      if (!flowId) {
        res.status(400).json({ error: "flowId is required" });
        return;
      }

      const simulator = new ConversationSimulator({
        flowProvider: options.flowProvider,
      });

      const state = await simulator.start(flowId);

      // Store simulator
      activeSimulators.set(state.sessionId, simulator);

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error("[API] Simulation start error:", error);
      res.status(500).json({ error: "Failed to start simulation" });
    }
  });

  /**
   * Enviar un mensaje en la simulación
   * POST /api/simulate/message
   */
  router.post("/simulate/message", async (req, res) => {
    try {
      const { sessionId, text } = req.body;

      if (!sessionId || !text) {
        res.status(400).json({ error: "sessionId and text are required" });
        return;
      }

      const simulator = activeSimulators.get(sessionId);

      if (!simulator) {
        res.status(404).json({ error: "Simulation not found" });
        return;
      }

      const state = await simulator.sendText(text);

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error("[API] Simulation message error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  /**
   * Hacer clic en un botón en la simulación
   * POST /api/simulate/click
   */
  router.post("/simulate/click", async (req, res) => {
    try {
      const { sessionId, buttonId, buttonText } = req.body;

      if (!sessionId || !buttonId || !buttonText) {
        res.status(400).json({ error: "sessionId, buttonId, and buttonText are required" });
        return;
      }

      const simulator = activeSimulators.get(sessionId);

      if (!simulator) {
        res.status(404).json({ error: "Simulation not found" });
        return;
      }

      const state = await simulator.clickButton(buttonId, buttonText);

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error("[API] Simulation click error:", error);
      res.status(500).json({ error: "Failed to click button" });
    }
  });

  /**
   * Reiniciar una simulación
   * POST /api/simulate/reset
   */
  router.post("/simulate/reset", async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const simulator = activeSimulators.get(sessionId);

      if (!simulator) {
        res.status(404).json({ error: "Simulation not found" });
        return;
      }

      const state = await simulator.reset();

      // Update simulator reference
      activeSimulators.delete(sessionId);
      activeSimulators.set(state.sessionId, simulator);

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error("[API] Simulation reset error:", error);
      res.status(500).json({ error: "Failed to reset simulation" });
    }
  });

  router.use("/connections", createConnectionsRouter());

  router.post("/wsp/test", async (req, res) => {
    try {
      const { to, text } = req.body ?? {};
      if (typeof to !== "string" || typeof text !== "string") {
        res.status(400).json({ ok: false, reason: "invalid_payload" });
        return;
      }
      const result = await sendWspTestMessage({ to, text });
      if (!result.ok) {
        const status = result.providerStatus || 500;
        res
          .status(status >= 400 ? status : 502)
          .json({ ok: false, reason: result.error ?? "provider_error", providerStatus: status, echo: { to, text } });
        return;
      }
      res.json({ ok: true, providerStatus: result.providerStatus, echo: { to, text }, body: result.body });
    } catch (error) {
      console.error("[API] WSP test error:", error);
      res.status(500).json({ ok: false, reason: "unexpected_error" });
    }
  });

  // ============================================
  // MONITORING ENDPOINTS
  // ============================================

  /**
   * Obtener logs del sistema
   * GET /api/logs
   */
  router.get("/logs", (req, res) => {
    try {
      const { level, type, sessionId, flowId, limit } = req.query;

      const logs = botLogger.getLogs({
        level: level as any,
        type: type as any,
        sessionId: sessionId as string,
        flowId: flowId as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });

      res.json({ logs });
    } catch (error) {
      console.error("[API] Logs error:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  /**
   * Obtener estadísticas de monitoreo
   * GET /api/stats
   * Query params: ?source=crm to get CRM stats
   */
  router.get("/stats", async (req, res) => {
    try {
      const source = (req.query.source as string) ?? 'crm';
      const channel = req.query.channel as string | undefined;
      const phoneNumberId = req.query.phoneNumberId as string | undefined;
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;

      if (source === 'crm') {
        // Get real CRM stats from database
        const stats = await realtimeMetrics.getStats({ channel, phoneNumberId, startDate, endDate });
        res.json(stats);
      } else {
        // Get bot flow stats (legacy)
        const stats = botLogger.getStats();
        res.json(stats);
      }
    } catch (error) {
      console.error("[API] Stats error:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  /**
   * Obtener métricas de conversaciones
   * GET /api/metrics
   * Query params: ?source=crm to get CRM metrics
   */
  router.get("/metrics", async (req, res) => {
    try {
      const { sessionId } = req.query;
      const source = (req.query.source as string) ?? 'crm';
      const channel = req.query.channel as string | undefined;
      const phoneNumberId = req.query.phoneNumberId as string | undefined;
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;

      if (source === 'crm') {
        // Get real CRM metrics from database
        const metrics = await realtimeMetrics.getConversationMetrics({ channel, phoneNumberId, startDate, endDate });
        res.json({ metrics });
      } else if (sessionId) {
        const metrics = metricsTracker.getMetrics(sessionId as string);
        if (!metrics) {
          res.status(404).json({ error: "Metrics not found" });
          return;
        }
        res.json(metrics);
      } else {
        const allMetrics = metricsTracker.getAllMetrics();
        res.json({ metrics: allMetrics });
      }
    } catch (error) {
      console.error("[API] Metrics error:", error);
      res.status(500).json({ error: "Failed to get metrics" });
    }
  });

  /**
   * Obtener conversaciones activas
   * GET /api/conversations/active
   * Query params: ?source=crm to get CRM conversations
   */
  router.get("/conversations/active", async (req, res) => {
    try {
      const source = (req.query.source as string) ?? 'crm';
      const channel = req.query.channel as string | undefined;
      const phoneNumberId = req.query.phoneNumberId as string | undefined;
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;

      if (source === 'crm') {
        // Get real CRM active conversations
        const activeConversations = await realtimeMetrics.getActiveConversations({ channel, phoneNumberId, startDate, endDate });
        res.json({ conversations: activeConversations });
      } else {
        const activeConversations = metricsTracker.getActiveConversations();
        res.json({ conversations: activeConversations });
      }
    } catch (error) {
      console.error("[API] Active conversations error:", error);
      res.status(500).json({ error: "Failed to get active conversations" });
    }
  });

  /**
   * Obtener estadísticas de opciones de menú seleccionadas
   * GET /api/metrics/menu-stats
   */
  router.get("/metrics/menu-stats", async (req, res) => {
    try {
      // Import dynamically to avoid circular dependencies
      const { getMenuOptionStats } = await import("./menu-analytics-db");

      // Parse date filters from query params
      const startDate = req.query.startDate ? parseInt(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? parseInt(req.query.endDate as string) : undefined;

      const statsArray = await getMenuOptionStats({ startDate, endDate });
      res.json({ stats: statsArray, total: statsArray.length });
    } catch (error) {
      console.error("[API] Menu stats error:", error);
      res.status(500).json({ error: "Failed to get menu statistics" });
    }
  });

  // ============================================
  // SESSION MANAGEMENT ENDPOINTS
  // ============================================

  /**
   * Obtener una sesión
   * GET /api/sessions/:sessionId
   */
  router.get("/sessions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await options.sessionStore.getSession(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.json(session);
    } catch (error) {
      console.error("[API] Session error:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  /**
   * Eliminar una sesión
   * DELETE /api/sessions/:sessionId
   */
  router.delete("/sessions/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      await options.sessionStore.deleteSession(sessionId);

      res.json({ success: true });
    } catch (error) {
      console.error("[API] Session delete error:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // ============================================
  // BITRIX24 ENDPOINTS
  // ============================================

  /**
   * Buscar entidad en Bitrix24
   * POST /api/bitrix/search
   */
  router.post("/bitrix/search", async (req, res) => {
    try {
      const { webhookUrl, entityType, filter, select } = req.body;

      if (!webhookUrl || !entityType || !filter) {
        res.status(400).json({ error: "webhookUrl, entityType, and filter are required" });
        return;
      }

      const bitrixClient = new Bitrix24Client({ webhookUrl });
      const entity = await bitrixClient.findEntity(entityType, { filter, select });

      if (!entity) {
        res.status(404).json({ error: "Entity not found" });
        return;
      }

      res.json(entity);
    } catch (error) {
      console.error("[API] Bitrix search error:", error);
      res.status(500).json({ error: "Failed to search entity" });
    }
  });

  /**
   * Obtener valor de campo en Bitrix24
   * POST /api/bitrix/field
   */
  router.post("/bitrix/field", async (req, res) => {
    try {
      const { webhookUrl, entityType, identifier, fieldName } = req.body;

      if (!webhookUrl || !entityType || !identifier || !fieldName) {
        res.status(400).json({ error: "webhookUrl, entityType, identifier, and fieldName are required" });
        return;
      }

      const bitrixClient = new Bitrix24Client({ webhookUrl });
      const value = await bitrixClient.getFieldValue(
        entityType,
        identifier,
        fieldName
      );

      if (value === null) {
        res.status(404).json({ error: "Field not found" });
        return;
      }

      res.json({ value });
    } catch (error) {
      console.error("[API] Bitrix field error:", error);
      res.status(500).json({ error: "Failed to get field value" });
    }
  });

  /**
   * Crear lead en Bitrix24
   * POST /api/bitrix/leads
   */
  router.post("/bitrix/leads", async (req, res) => {
    try {
      const { webhookUrl, fields } = req.body;

      if (!webhookUrl || !fields) {
        res.status(400).json({ error: "webhookUrl and fields are required" });
        return;
      }

      const bitrixClient = new Bitrix24Client({ webhookUrl });
      const leadId = await bitrixClient.createLead(fields);

      if (!leadId) {
        res.status(500).json({ error: "Failed to create lead" });
        return;
      }

      res.json({ leadId });
    } catch (error) {
      console.error("[API] Bitrix create lead error:", error);
      res.status(500).json({ error: "Failed to create lead" });
    }
  });

  /**
   * Actualizar lead en Bitrix24
   * PUT /api/bitrix/leads/:leadId
   */
  router.put("/bitrix/leads/:leadId", async (req, res) => {
    try {
      const { leadId } = req.params;
      const { webhookUrl, fields } = req.body;

      if (!webhookUrl || !fields) {
        res.status(400).json({ error: "webhookUrl and fields are required" });
        return;
      }

      const bitrixClient = new Bitrix24Client({ webhookUrl });
      const success = await bitrixClient.updateLead(leadId, fields);

      if (!success) {
        res.status(500).json({ error: "Failed to update lead" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[API] Bitrix update lead error:", error);
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  return router;
}
