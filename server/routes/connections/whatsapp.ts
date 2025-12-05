import { Router } from "express";
import { saveWhatsAppSecrets, readWhatsAppSecrets } from "../../services/whatsapp-secrets";
import {
  checkWhatsAppConnection,
  sendWhatsAppMessage,
  type WhatsAppCheckResult,
} from "../../services/whatsapp";
import { Pool } from 'pg';

interface SavePayload {
  phoneNumberId?: unknown;
  displayNumber?: unknown;
  accessToken?: unknown;
  verifyToken?: unknown;
}

interface TestPayload {
  to?: unknown;
  text?: unknown;
}

function formatCheckResponse(result: WhatsAppCheckResult) {
  return {
    ok: result.ok,
    phoneNumberId: result.phoneNumberId ?? null,
    displayNumber: result.displayNumber ?? null,
    displayPhoneNumber: result.displayPhoneNumber ?? null,
    verifiedName: result.verifiedName ?? null,
    reason: result.reason ?? null,
    status: result.status ?? null,
    details: result.details ?? null,
  };
}

export function createWhatsAppConnectionsRouter() {
  const router = Router();

  router.post("/save", (req, res) => {
    const body = req.body as SavePayload;
    const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
    const displayNumber = typeof body.displayNumber === "string" ? body.displayNumber.trim() : undefined;
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const verifyToken = typeof body.verifyToken === "string" ? body.verifyToken.trim() : undefined;

    if (!phoneNumberId || !accessToken) {
      res.status(400).json({ ok: false, reason: "missing_fields" });
      return;
    }

    saveWhatsAppSecrets({ phoneNumberId, displayNumber, accessToken, verifyToken });

    res.json({ ok: true });
  });

  router.get("/check", async (_req, res) => {
    try {
      const stored = readWhatsAppSecrets();
      if (!stored?.phoneNumberId || !stored.accessToken) {
        res.json({ ok: false, reason: "not_configured" });
        return;
      }

      const status = await checkWhatsAppConnection();
      res.status(status.ok ? 200 : 200).json(formatCheckResponse(status));
    } catch (error) {
      console.error("[Connections] WhatsApp check failed", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, reason: "unknown_error" });
    }
  });

  router.post("/test", async (req, res) => {
    const body = req.body as TestPayload;
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!to || !text) {
      res.status(400).json({ ok: false, reason: "invalid_payload" });
      return;
    }

    const stored = readWhatsAppSecrets();
    if (!stored?.phoneNumberId || !stored.accessToken) {
      res.status(412).json({ ok: false, reason: "not_configured" });
      return;
    }

    try {
      const result = await sendWhatsAppMessage({ phone: to, text });
      if (!result.ok) {
        res
          .status(result.status >= 400 ? result.status : 502)
          .json({ ok: false, reason: result.error ?? "provider_error", status: result.status });
        return;
      }

      const providerBody = result.body as
        | { messages?: Array<{ id?: string }>; messaging_product?: string }
        | null
        | undefined;
      const messageId = providerBody?.messages?.[0]?.id ?? null;

      res.json({ ok: true, id: messageId, status: result.status });
    } catch (error) {
      console.error("[Connections] WhatsApp test failed", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, reason: "network_error" });
    }
  });

  /**
   * GET /api/connections/whatsapp/list
   * Get all WhatsApp number connections configured in the system
   * Used by ConversationList to filter by specific WhatsApp number
   */
  router.get("/list", async (_req, res) => {
    try {
      // Read from PostgreSQL
      const pool = new Pool({
        user: process.env.POSTGRES_USER || 'whatsapp_user',
        host: process.env.POSTGRES_HOST || 'localhost',
        database: process.env.POSTGRES_DB || 'flowbuilder_crm',
        password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
      });

      const result = await pool.query(
        'SELECT id, alias, phone_number_id, display_number, is_active FROM whatsapp_connections WHERE is_active = true ORDER BY created_at'
      );

      await pool.end();

      // Return in expected format
      res.json({
        ok: true,
        connections: result.rows.map((conn: any) => ({
          id: conn.id,
          alias: conn.alias,
          phoneNumberId: conn.phone_number_id,
          displayNumber: conn.display_number,
          isActive: conn.is_active,
        }))
      });
    } catch (error) {
      console.error("[Connections] WhatsApp list failed", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, reason: "unknown_error", connections: [] });
    }
  });

  return router;
}
