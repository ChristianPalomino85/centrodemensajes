import type { Application } from "express";
import { Router } from "express";
import type { ChangeValue, WhatsAppMessage } from "../../src/api/whatsapp-webhook";
import type { Bitrix24Client } from "../../src/integrations/bitrix24";
import { createAttachmentsRouter, createPublicAttachmentsRouter } from "./routes/attachments";
import { createMessagesRouter } from "./routes/messages";
import { createConversationsRouter } from "./routes/conversations";
import { createTemplatesRouter } from "./routes/templates";
import { createMetricsRouter } from "./routes/metrics";
import { createSessionsRouter } from "./routes/sessions";
import { createErrorsRouter } from "./routes/errors";
import mediaRouter from "./routes/media";
import { createBitrixService } from "./services/bitrix";
import { handleIncomingWhatsAppMessage } from "./inbound";
import type { CrmRealtimeManager } from "./ws";
import { requireAuth } from "../auth/middleware";
import type { LocalStorageFlowProvider } from "../flow-provider";
import type { SessionStore } from "../../src/runtime/session";
import { errorTracker } from "./error-tracker";

export interface RegisterCrmOptions {
  app: Application;
  socketManager: CrmRealtimeManager;
  bitrixClient?: Bitrix24Client;
  flowProvider: LocalStorageFlowProvider;
  botSessionStore: SessionStore;
}

export function registerCrmModule(options: RegisterCrmOptions) {
  const router = Router();
  const realtime = options.socketManager;
  const bitrixService = createBitrixService(options.bitrixClient);

  // Health check - NO REQUIERE AUTENTICACIÓN (para monitoreo)
  router.get("/health", (_req, res) => {
    const status = realtime.getStatus();
    res.json({ ok: true, ws: status.clients >= 0, clients: status.clients });
  });

  // Attachments GET - NO requiere auth (para que WhatsApp/bot pueda descargar)
  router.use("/attachments", createPublicAttachmentsRouter());

  // TODOS los demás endpoints del CRM REQUIEREN AUTENTICACIÓN
  router.use(requireAuth);

  // Attachments POST (upload) - SI requiere auth
  router.use("/attachments", createAttachmentsRouter());

  // Upload media endpoint - para subir imágenes a WhatsApp desde templates
  router.post("/upload-media", async (req, res) => {
    try {
      const multer = await import('multer');
      const upload = multer.default({ storage: multer.memoryStorage() }).single('file');

      upload(req as any, res as any, async (err: any) => {
        if (err) {
          console.error('[UploadMedia] Multer error:', err);
          return res.status(400).json({ error: 'Error al procesar el archivo' });
        }

        const file = (req as any).file;
        const phoneNumberId = req.body.phoneNumberId;

        if (!file) {
          return res.status(400).json({ error: 'No se recibió ningún archivo' });
        }

        if (!phoneNumberId) {
          return res.status(400).json({ error: 'phoneNumberId es requerido' });
        }

        // Importar función de subida
        const { uploadToWhatsAppMedia } = await import('../services/whatsapp');
        const { Readable } = await import('stream');

        // Crear stream desde buffer
        const stream = Readable.from(file.buffer);

        // Subir a WhatsApp
        const result = await uploadToWhatsAppMedia({
          stream,
          filename: file.originalname,
          mimeType: file.mimetype,
          channelConnectionId: phoneNumberId
        });

        if (!result.ok) {
          return res.status(500).json({ error: result.error || 'Error al subir a WhatsApp' });
        }

        // WhatsApp devuelve un media_id
        res.json({ id: result.mediaId, url: result.mediaId });
      });
    } catch (error) {
      console.error('[UploadMedia] Error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.use("/messages", createMessagesRouter(realtime, bitrixService));
  router.use("/conversations", createConversationsRouter(realtime, bitrixService, options.flowProvider, options.botSessionStore));
  router.use("/templates", createTemplatesRouter(realtime));
  router.use("/metrics", createMetricsRouter());
  router.use("/sessions", createSessionsRouter());
  router.use("/errors", createErrorsRouter());
  router.use(mediaRouter); // Media proxy endpoint: /api/crm/media/:id

  options.app.use("/api/crm", router);

  // BounceService removed - using equitable distribution on advisor connection instead

  return {
    socketManager: realtime,
    bitrixService,
    errorTracker, // Export for global error logging
    handleIncomingWhatsApp: (payload: { entryId: string; value: ChangeValue; message: WhatsAppMessage }) =>
      handleIncomingWhatsAppMessage({
        entryId: payload.entryId,
        value: payload.value,
        message: payload.message,
        socketManager: realtime,
        bitrixService,
      }),
  };
}
