import { Router } from "express";
import { crmDb } from "../db-postgres";
import { metricsTracker } from "../metrics-tracker";
import type { CrmRealtimeManager } from "../ws";
import type { BitrixService } from "../services/bitrix";
import { sendOutboundMessage } from "../services/whatsapp";
import { type WspTestResult } from "../../services/wsp";
import type { MessageType } from "../models";
import { uploadToWhatsAppMedia } from "../../services/whatsapp";
import { attachmentStorage } from "../storage";
import { errorTracker } from "../error-tracker";

interface SendPayload {
  convId?: string;
  phone?: string;
  text?: string;
  attachmentId?: string;
  replyToId?: string;
  type?: MessageType;
  isInternal?: boolean;
}

export function createMessagesRouter(socketManager: CrmRealtimeManager, bitrixService: BitrixService) {
  const router = Router();

  router.post("/send", async (req, res) => {
    const payload = req.body as SendPayload;
    if (!payload.convId && !payload.phone) {
      res.status(400).json({ error: "missing_destination" });
      return;
    }

    let conversation = payload.convId ? await crmDb.getConversationById(payload.convId) : undefined;
    if (!conversation && payload.phone) {
      conversation = await crmDb.createConversation(payload.phone);
    }
    if (!conversation) {
      res.status(404).json({ error: "conversation_not_found" });
      return;
    }

    const attachments = payload.attachmentId ? [await crmDb.getAttachment(payload.attachmentId)].filter(Boolean) : [];
    const type: MessageType = payload.type
      ? payload.type
      : payload.isInternal
      ? "system"
      : attachments.length > 0
      ? inferTypeFromMime(attachments[0]!.mime)
      : "text";

    // Obtener nombre del asesor para mensajes salientes
    const sentBy = req.user?.username ?? null;

    const message = await crmDb.appendMessage({
      convId: conversation.id,
      direction: "outgoing",
      type,
      text: payload.isInternal ? `🔒 NOTA INTERNA: ${payload.text ?? ""}` : payload.text ?? null,
      mediaUrl: attachments[0]?.url ?? null,
      mediaThumb: attachments[0]?.thumbUrl ?? null,
      repliedToId: payload.replyToId ?? null,
      status: payload.isInternal ? "sent" : "pending",
      sentBy,  // Guardar nombre del asesor (no se envía al cliente, solo visible internamente)
    });

    // Link attachment and re-fetch to get updated msgId
    let linkedAttachment = attachments[0] ?? null;
    if (attachments.length > 0 && payload.attachmentId) {
      await crmDb.linkAttachmentToMessage(payload.attachmentId, message.id);
      // Re-fetch to get the attachment with msgId set
      linkedAttachment = await crmDb.getAttachment(payload.attachmentId) ?? linkedAttachment;
    }

    socketManager.emitNewMessage({ message, attachment: linkedAttachment });

    // Track message for metrics (only outgoing non-internal messages)
    if (!payload.isInternal) {
      metricsTracker.recordMessage(conversation.id, true);
    }

    // Auto-cambiar a "attending" cuando el asesor responde (excepto notas internas)
    // Y asignar al asesor si la conversación estaba en cola
    if (!payload.isInternal && conversation.status === "active") {
      const advisorId = req.user?.userId || "unknown";
      const now = Date.now();

      console.log(`[CRM Send] 🚨 AUTO-ASSIGNMENT TRIGGERED:`);
      console.log(`  - Conversation: ${conversation.id}`);
      console.log(`  - req.user: ${JSON.stringify(req.user)}`);
      console.log(`  - advisorId: ${advisorId}`);
      console.log(`  - conversation.status: ${conversation.status}`);
      console.log(`  - payload.isInternal: ${payload.isInternal}`);

      await crmDb.updateConversationMeta(conversation.id, {
        status: "attending",
        assignedTo: advisorId,
        assignedAt: now,
      });

      // Add advisor to attendedBy list
      await crmDb.addAdvisorToAttendedBy(conversation.id, advisorId);

      // Start tracking metrics for this conversation with full context
      const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      metricsTracker.startConversation(metricId, conversation.id, advisorId, {
        queueId: conversation.queueId || undefined,
        channelType: conversation.channel as any,
        channelId: conversation.channelConnectionId || undefined,
      });
    }

    // Mark conversation as active when advisor sends a message
    if (!payload.isInternal && conversation.status === "attending") {
      metricsTracker.markConversationActive(conversation.id);
    }

    // If advisor sends a message while attending, add to attendedBy (if not already there)
    if (!payload.isInternal && req.user?.userId) {
      await crmDb.addAdvisorToAttendedBy(conversation.id, req.user.userId);
    }

    socketManager.emitConversationUpdate({ conversation: (await crmDb.getConversationById(conversation.id))! });

    let providerResult: WspTestResult | null = null;
    // Solo enviar a WhatsApp si NO es una nota interna
    if (conversation.phone && !payload.isInternal) {
      // Get WhatsApp message ID from replied-to message if replying
      let replyToWhatsAppMessageId: string | null = null;
      if (payload.replyToId) {
        const repliedToMessages = await crmDb.listMessages(conversation.id);
        const repliedToMessage = repliedToMessages.find(m => m.id === payload.replyToId);
        if (repliedToMessage?.providerMetadata && typeof repliedToMessage.providerMetadata === 'object') {
          const metadata = repliedToMessage.providerMetadata as Record<string, unknown>;
          replyToWhatsAppMessageId = metadata.whatsapp_message_id as string ?? null;
        }
      }

      if (!attachments.length && payload.text) {
        // Send text message (with reply context if available)
        const outbound = await sendOutboundMessage({
          phone: conversation.phone,
          text: payload.text,
          replyToWhatsAppMessageId,
          channelConnectionId: conversation.channelConnectionId, // Use the conversation's WhatsApp number
        });
        providerResult = {
          ok: outbound.ok,
          providerStatus: outbound.status,
          body: outbound.body,
          error: outbound.error,
        };
      } else if (attachments.length > 0) {
        // Si hay adjunto, subirlo a WhatsApp Media API primero
        let mediaId: string | undefined;
        const attachment = attachments[0]!;

        try {
          const stream = await attachmentStorage.getStream(attachment.id);
          if (stream) {
            const uploadResult = await uploadToWhatsAppMedia({
              stream,
              filename: attachment.filename,
              mimeType: attachment.mime,
              channelConnectionId: conversation.channelConnectionId, // Use the conversation's WhatsApp number
            });

            if (uploadResult.ok && uploadResult.mediaId) {
              mediaId = uploadResult.mediaId;
              console.log(`[CRM] Archivo subido a WhatsApp Media API: ${mediaId}`);
            } else {
              console.error(`[CRM] Error subiendo archivo a WhatsApp: ${uploadResult.error}`);
            }
          }
        } catch (error) {
          console.error("[CRM] Error obteniendo stream del archivo:", error);
          // Log error to error tracker
          await errorTracker.logErrorObject(
            error as Error,
            'attachment_stream_error',
            { conversationId: payload.convId, severity: 'error' }
          );
        }

        // Enviar mensaje con mediaId o fallar
        if (mediaId) {
          // Get WhatsApp message ID from replied-to message if replying
          let replyToWhatsAppMessageId: string | null = null;
          if (payload.replyToId) {
            const repliedToMessages = await crmDb.listMessages(conversation.id);
            const repliedToMessage = repliedToMessages.find(m => m.id === payload.replyToId);
            if (repliedToMessage?.providerMetadata && typeof repliedToMessage.providerMetadata === 'object') {
              const metadata = repliedToMessage.providerMetadata as Record<string, unknown>;
              replyToWhatsAppMessageId = metadata.whatsapp_message_id as string ?? null;
            }
          }

          const outbound = await sendOutboundMessage({
            phone: conversation.phone,
            text: payload.text ?? undefined,
            mediaId,
            mediaType: inferTypeFromMime(attachment.mime),
            caption: payload.text ?? undefined,
            filename: attachment.filename ?? undefined,
            replyToWhatsAppMessageId,
            channelConnectionId: conversation.channelConnectionId, // Use the conversation's WhatsApp number
          });
          providerResult = {
            ok: outbound.ok,
            providerStatus: outbound.status,
            body: outbound.body,
            error: outbound.error,
          };
        } else {
          providerResult = {
            ok: false,
            providerStatus: 500,
            body: null,
            error: "Failed to upload media to WhatsApp",
          };
        }
      }
    }

    // Si es nota interna, ya está marcada como "sent", sino actualizar según resultado del proveedor
    let status = message.status;
    if (!payload.isInternal) {
      status = providerResult?.ok ? "sent" : "failed";

      // Extract whatsapp_message_id from WhatsApp API response
      let providerMetadata: Record<string, unknown> | undefined;
      if (providerResult?.body && typeof providerResult.body === "object") {
        const body = providerResult.body as any;
        // WhatsApp API returns: { messages: [{ id: "wamid.xxx" }] }
        const whatsappMessageId = body.messages?.[0]?.id;
        if (whatsappMessageId) {
          providerMetadata = {
            whatsapp_message_id: whatsappMessageId,
            full_response: body,
          };
        } else {
          providerMetadata = body as Record<string, unknown>;
        }
      }

      await crmDb.updateMessageStatus(
        message.id,
        status,
        providerMetadata,
      );

      // SIEMPRE emitir update (sent o failed) para que el frontend actualice el mensaje
      const updatedMsg = { ...message, status };
      socketManager.emitMessageUpdate({ message: updatedMsg, attachment: linkedAttachment });
    }

    if (!conversation.bitrixId && conversation.phone) {
      bitrixService
        .upsertContactByPhone(conversation.phone)
        .then(async (result) => {
          if (result.contactId) {
            await bitrixService.attachConversation(conversation!, result.contactId);
            const refreshed = await crmDb.getConversationById(conversation!.id);
            if (refreshed) {
              socketManager.emitConversationUpdate({ conversation: refreshed });
            }
          }
        })
        .catch((error) => {
          console.warn("[CRM] Bitrix sync failed", error);
        });
    }

    res.json({
      ok: payload.isInternal ? true : (providerResult?.ok ?? false),
      providerStatus: providerResult?.providerStatus ?? 0,
      echo: { convId: conversation.id, phone: conversation.phone, text: payload.text ?? null },
      message: { ...message, status },
      attachment: linkedAttachment,
      error: providerResult?.error ?? null,
    });
  });

  // DELETE /messages/:messageId - Delete system message (admin only)
  router.delete("/:messageId", async (req, res) => {
    try {
      const { messageId } = req.params;
      const user = (req as any).user;

      // Check if user is admin
      if (!user || user.role !== 'admin') {
        res.status(403).json({ error: "forbidden", message: "Solo administradores pueden eliminar mensajes" });
        return;
      }

      // Get message to verify it's a system or event message
      const message = await crmDb.getMessageById(messageId);
      if (!message) {
        res.status(404).json({ error: "message_not_found" });
        return;
      }

      if (message.type !== 'system' && message.type !== 'event') {
        res.status(403).json({ error: "forbidden", message: "Solo se pueden eliminar mensajes del sistema o eventos" });
        return;
      }

      // Delete message
      await crmDb.deleteMessage(messageId);

      // Emit WebSocket update to remove message from UI
      socketManager.emitMessageDeleted({ messageId, convId: message.convId });

      res.json({ success: true });
    } catch (error) {
      console.error("[Messages] Error deleting message:", error);
      // Log error to error tracker
      await errorTracker.logErrorObject(
        error as Error,
        'message_delete_error',
        { severity: 'error' }
      );
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

function inferTypeFromMime(mime: string): MessageType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || mime.startsWith("application/")) return "document";
  return "document";
}
