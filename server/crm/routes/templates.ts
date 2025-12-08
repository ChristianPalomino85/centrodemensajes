import { Router } from "express";
import { fetchMessageTemplates, sendTemplateMessage, type WhatsAppTemplate } from "../../../src/api/whatsapp-sender";
import { getWhatsAppEnv } from "../../utils/env";
import { crmDb } from "../db-postgres";
import type { CrmRealtimeManager } from "../ws";
import { getWhatsAppCredentials, getWhatsAppConnection } from "../../services/whatsapp-connections";
import { registerTemplateUsage } from "../template-usage-tracker";
import { adminDb } from "../../admin-db";
import { formatEventTimestamp } from "../../utils/file-logger";

export function createTemplatesRouter(socketManager: CrmRealtimeManager) {
  const router = Router();

  /**
   * GET /templates
   * Fetch available WhatsApp message templates for the configured WABA
   * Query params:
   *   - phoneNumberId: Optional. Filter templates by specific WhatsApp connection
   */
  router.get("/", async (req, res) => {
    try {
      const { phoneNumberId } = req.query;

      // Load connections from PostgreSQL
      let accessToken: string;
      let wabaId: string;

      if (phoneNumberId && typeof phoneNumberId === "string") {
        // Find specific connection by phoneNumberId
        try {
          const connection = await getWhatsAppConnection(phoneNumberId);

          if (connection && connection.accessToken) {
            accessToken = connection.accessToken;
            // For templates, we need the WABA ID (Business Account ID)
            wabaId = connection.wabaId || connection.phoneNumberId;
          } else {
            // Fallback to env config
            const config = getWhatsAppEnv();
            accessToken = config.accessToken;
            wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || config.phoneNumberId;
          }
        } catch (error) {
          console.error('[Templates] Error reading connections:', error);
          // Fallback to env config if connection lookup fails
          const config = getWhatsAppEnv();
          accessToken = config.accessToken;
          wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || config.phoneNumberId;
        }
      } else {
        // Use env config (default)
        const config = getWhatsAppEnv();
        accessToken = config.accessToken;
        wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || config.phoneNumberId;
      }

      if (!wabaId || !accessToken) {
        res.status(400).json({
          error: "whatsapp_not_configured",
          message: "WhatsApp Business Account ID or Access Token not configured"
        });
        return;
      }

      const result = await fetchMessageTemplates(wabaId, accessToken);

      if (!result.ok) {
        res.status(500).json({
          error: "fetch_failed",
          message: "Failed to fetch templates from WhatsApp"
        });
        return;
      }

      res.json({ templates: result.templates });
    } catch (error) {
      console.error("[Templates] Error fetching templates:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * POST /send
   * Send a template message to a phone number
   * This now:
   * 1. Gets or creates conversation
   * 2. Saves template message to database
   * 3. Emits via WebSocket
   * 4. Sends to WhatsApp API
   * 5. Updates message status based on API response
   */
  router.post("/send", async (req, res) => {
    try {
      const { phone, templateName, language = "es", components, channelConnectionId } = req.body;

      if (!phone || !templateName) {
        res.status(400).json({
          error: "missing_parameters",
          message: "phone and templateName are required"
        });
        return;
      }

      // Get WhatsApp configuration for this connection
      let config = getWhatsAppEnv();

      if (channelConnectionId) {
        const credentials = await getWhatsAppCredentials(channelConnectionId);
        if (credentials) {
          config = {
            phoneNumberId: credentials.phoneNumberId,
            accessToken: credentials.accessToken,
          };
        }
      }

      if (!config.accessToken || !config.phoneNumberId) {
        res.status(400).json({
          error: "whatsapp_not_configured",
          message: "WhatsApp not configured"
        });
        return;
      }

      // 1. Get or create conversation
      // IMPORTANTE: Buscar por teléfono Y channelConnectionId para evitar duplicados
      const phoneNumberIdToUse = channelConnectionId || config.phoneNumberId;

      // Buscar conversación existente con el mismo teléfono y canal
      // INCLUIR conversaciones archived para reutilizarlas cuando se envía plantilla
      const allConversations = await crmDb.getAllConversations();
      let conversation = allConversations.find(conv =>
        conv.phone === phone &&
        conv.channel === "whatsapp" &&
        conv.channelConnectionId === phoneNumberIdToUse
      );

      // Obtener ID del asesor que envía la plantilla
      const advisorId = (req as any).user?.userId || null;
      const advisorName = (req as any).user?.name || (req as any).user?.username || 'Sistema';

      // LOOKUP displayNumber from PostgreSQL connections
      let displayNumber: string | null = null;
      try {
        const connection = await getWhatsAppConnection(phoneNumberIdToUse);
        if (connection?.displayNumber) {
          displayNumber = connection.displayNumber;
        }
      } catch (err) {
        console.error('[Templates] Error loading displayNumber from connections:', err);
      }

      if (!conversation) {
        // NUEVA CONVERSACIÓN (SIN HISTORIAL)
        // Crear conversación que irá a TRABAJANDO (attending) y asignada al asesor
        conversation = await crmDb.createConversation(
          phone,
          null,  // contactName
          null,  // avatarUrl
          "whatsapp",  // channel
          phoneNumberIdToUse,  // phoneNumberId
          displayNumber  // displayNumber from connections file
        );
        console.log(`[Templates] Created new conversation for ${phone} with phoneNumberId ${phoneNumberIdToUse}: ${conversation.id}`);

        // IMPORTANTE: Las plantillas unitarias van a TRABAJANDO y se asignan al asesor que las envía
        await crmDb.updateConversationMeta(conversation.id, {
          status: 'attending',
          assignedTo: advisorId,
          assignedToAdvisor: advisorId,
          queueId: null
        });

        // Crear evento del sistema
        if (advisorId) {
          const timestamp = formatEventTimestamp();
          await crmDb.createSystemEvent(
            conversation.id,
            'conversation_assigned',
            `✅ Conversación asignada a ${advisorName} al enviar plantilla (${timestamp})`
          );
        }

        conversation = (await crmDb.getConversationById(conversation.id))!;
        console.log(`[Templates] Marked as TRABAJANDO (attending) and assigned to ${advisorName} - template sent to ${phone}`);
      } else {
        // CONVERSACIÓN EXISTENTE (CON HISTORIAL)
        // Si la conversación estaba cerrada, reactivarla como TRABAJANDO y asignar al asesor
        if (conversation.status === 'closed') {
          await crmDb.updateConversationMeta(conversation.id, {
            status: 'attending',
            queueId: null,
            assignedTo: advisorId,
            assignedToAdvisor: advisorId
          });

          // Crear evento del sistema
          if (advisorId) {
            const timestamp = formatEventTimestamp();
            await crmDb.createSystemEvent(
              conversation.id,
              'conversation_reopened',
              `🔓 Conversación reabierta y asignada a ${advisorName} al enviar plantilla (${timestamp})`
            );
          }

          conversation = (await crmDb.getConversationById(conversation.id))!;
          console.log(`[Templates] Reactivated ${conversation.status} conversation as TRABAJANDO and assigned to ${advisorName} for ${phone}: ${conversation.id}`);
        } else {
          console.log(`[Templates] Using existing conversation for ${phone}: ${conversation.id}`);
        }
      }

      // 2. Fetch template details to get full structure for display
      let templateDefinition: WhatsAppTemplate | null = null;
      try {
        const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || config.phoneNumberId;
        const templatesResult = await fetchMessageTemplates(wabaId, config.accessToken);
        if (templatesResult.ok) {
          templateDefinition = templatesResult.templates.find(
            (t) => t.name === templateName && t.language === language
          ) || null;
        }
      } catch (error) {
        console.error(`[Templates] Error fetching template definition:`, error);
      }

      // 3. Build template data for storage with full template structure
      // This allows the frontend to render the template content
      const templateData = {
        templateName,
        language,
        components: templateDefinition?.components || components || []
      };

      // 4. Save template message to database with "pending" status
      // Store template data as JSON in the text field
      const message = await crmDb.appendMessage({
        convId: conversation.id,
        direction: "outgoing",
        type: "template",
        text: JSON.stringify(templateData),
        mediaUrl: null,
        mediaThumb: null,
        repliedToId: null,
        status: "pending",
      });

      console.log(`[Templates] Saved template message to DB: ${message.id}`);

      // 5. Emit message via WebSocket so it appears in advisor's chat immediately
      socketManager.emitNewMessage({ message, attachment: null });

      // 6. Send template to WhatsApp API
      console.log(`[Templates] Sending template to WhatsApp:`, {
        phone,
        templateName,
        language,
        config: {
          phoneNumberId: config.phoneNumberId,
          hasAccessToken: !!config.accessToken,
        },
      });

      const result = await sendTemplateMessage(
        config,
        phone,
        templateName,
        language,
        components
      );

      console.log(`[Templates] WhatsApp API response:`, {
        ok: result.ok,
        status: result.status,
        body: result.body,
        error: result.error,
      });

      // 7. Update message status based on WhatsApp API response
      if (result.ok) {
        // Update message with WhatsApp message ID and "sent" status
        const waMessageId = typeof result.body === 'object' && result.body?.messages?.[0]?.id
          ? result.body.messages[0].id
          : String(result.body);

        await crmDb.updateMessageStatus(message.id, "sent", waMessageId);

        // Emit message update via WebSocket
        const updatedMessage = { ...message, status: "sent" as const, waMessageId };
        socketManager.emitMessageUpdate({
          message: updatedMessage,
          attachment: null,
        });

        console.log(`[Templates] Template sent successfully: ${waMessageId}`);

        // Register template usage for cost tracking
        try {
          const category = templateDefinition?.category || 'UTILITY';
          let advisorId = conversation.assignedTo || 'system';
          let advisorName = 'Sistema';

          // Get advisor information if conversation is assigned
          if (conversation.assignedTo) {
            const advisor = await adminDb.getUserById(conversation.assignedTo);
            if (advisor) {
              advisorId = advisor.id;
              advisorName = advisor.name || advisor.username;
            }
          }

          await registerTemplateUsage({
            templateName,
            templateCategory: category,
            advisorId,
            advisorName,
            conversationId: conversation.id,
            customerPhone: phone,
            customerName: conversation.contactName || undefined,
            sendingPhoneNumberId: config.phoneNumberId || phoneNumberIdToUse,
            sendingDisplayNumber: conversation.displayNumber || undefined,
            status: 'sent'
          });
        } catch (trackError) {
          console.error('[Templates] Error registering template usage:', trackError);
          // Don't fail the request if tracking fails
        }

        res.json({ success: true, messageId: waMessageId, dbMessageId: message.id });
      } else {
        // Update message status to "failed"
        await crmDb.updateMessageStatus(message.id, "failed");

        // Emit message update via WebSocket
        const failedMessage = { ...message, status: "failed" as const };
        socketManager.emitMessageUpdate({
          message: failedMessage,
          attachment: null,
        });

        // Register failed template usage for cost tracking
        try {
          const category = templateDefinition?.category || 'UTILITY';
          let advisorId = conversation.assignedTo || 'system';
          let advisorName = 'Sistema';

          // Get advisor information if conversation is assigned
          if (conversation.assignedTo) {
            const advisor = await adminDb.getUserById(conversation.assignedTo);
            if (advisor) {
              advisorId = advisor.id;
              advisorName = advisor.name || advisor.username;
            }
          }

          // Extract error message from result
          const errorMessage = typeof result.body === 'string'
            ? result.body
            : JSON.stringify(result.body);

          await registerTemplateUsage({
            templateName,
            templateCategory: category,
            advisorId,
            advisorName,
            conversationId: conversation.id,
            customerPhone: phone,
            customerName: conversation.contactName || undefined,
            sendingPhoneNumberId: config.phoneNumberId || phoneNumberIdToUse,
            sendingDisplayNumber: conversation.displayNumber || undefined,
            status: 'failed',
            errorMessage
          });
        } catch (trackError) {
          console.error('[Templates] Error registering failed template usage:', trackError);
          // Don't fail the request if tracking fails
        }

        console.error(`[Templates] Failed to send template:`, result.body);
        res.status(result.status).json({
          error: "send_failed",
          message: "Failed to send template message",
          details: result.body,
          dbMessageId: message.id
        });
      }
    } catch (error) {
      console.error("[Templates] Error sending template:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  /**
   * DELETE /:templateName
   * Delete a message template from Meta
   */
  router.delete("/:templateName", async (req, res) => {
    try {
      const { templateName } = req.params;

      if (!templateName) {
        res.status(400).json({
          error: "missing_parameters",
          message: "templateName is required"
        });
        return;
      }

      // Load connections from PostgreSQL to get access token and WABA ID
      // Get first active connection (or use phoneNumberId from query if provided)
      const { phoneNumberId } = req.query;
      let connection;

      if (phoneNumberId && typeof phoneNumberId === "string") {
        connection = await getWhatsAppConnection(phoneNumberId);
      } else {
        // Get any active connection
        const { Pool } = await import('pg');
        const pool = new Pool({
          user: process.env.POSTGRES_USER || 'whatsapp_user',
          host: process.env.POSTGRES_HOST || 'localhost',
          database: process.env.POSTGRES_DB || 'flowbuilder_crm',
          password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
          port: parseInt(process.env.POSTGRES_PORT || '5432'),
        });

        const result = await pool.query(
          'SELECT id, alias, phone_number_id, display_number, access_token, waba_id FROM whatsapp_connections WHERE is_active = true LIMIT 1'
        );

        await pool.end();

        if (result.rows.length > 0) {
          const row = result.rows[0];
          connection = {
            id: row.id,
            alias: row.alias,
            phoneNumberId: row.phone_number_id,
            displayNumber: row.display_number,
            accessToken: row.access_token,
            wabaId: row.waba_id,
          };
        }
      }

      if (!connection || !connection.accessToken || !connection.wabaId) {
        res.status(400).json({
          error: "whatsapp_not_configured",
          message: "WhatsApp not configured"
        });
        return;
      }

      const { accessToken, wabaId } = connection;

      // Delete template from Meta
      const deleteUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;
      const deleteResponse = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json();
        console.error('[Templates] Error deleting template:', errorData);
        res.status(deleteResponse.status).json({
          error: "delete_failed",
          message: "Failed to delete template from Meta",
          details: errorData
        });
        return;
      }

      const result = await deleteResponse.json();
      console.log(`[Templates] Template "${templateName}" deleted successfully`);
      res.json({ success: true, result });

    } catch (error) {
      console.error("[Templates] Error deleting template:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
