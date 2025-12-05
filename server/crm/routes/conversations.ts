import { Router } from "express";
import { crmDb } from "../db-postgres";
import { metricsTracker } from "../metrics-tracker";
import type { CrmRealtimeManager } from "../ws";
import type { BitrixService } from "../services/bitrix";
import { adminDb } from "../../admin-db";
import type { LocalStorageFlowProvider } from "../../flow-provider";
import { sessionsStorage } from "../sessions";
import type { SessionStore } from "../../src/runtime/session";
import { formatEventTimestamp } from "../../utils/file-logger";
import { promises as fs } from 'fs';
import path from 'path';

// Helper function to get advisor name from ID
async function getAdvisorName(advisorId: string): Promise<string> {
  try {
    const user = await adminDb.getUserById(advisorId);
    return user?.name || user?.username || advisorId;
  } catch (error) {
    console.error("[CRM] Error getting advisor name:", error);
    return advisorId;
  }
}

// Helper function to get bot/flow name from ID
async function getBotName(botId: string, flowProvider: LocalStorageFlowProvider): Promise<string> {
  try {
    const flow = await flowProvider.getFlow(botId);
    return flow?.name || botId;
  } catch (error) {
    console.error("[CRM] Error getting bot name:", error);
    return botId;
  }
}

export function createConversationsRouter(socketManager: CrmRealtimeManager, bitrixService: BitrixService, flowProvider: LocalStorageFlowProvider, botSessionStore: SessionStore) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const conversations = await crmDb.listConversations();
    res.json(
      conversations.map((conversation) => ({
        id: conversation.id,
        phone: conversation.phone,
        contactName: conversation.contactName ?? null,
        lastMessageAt: conversation.lastMessageAt,
        lastClientMessageAt: conversation.lastClientMessageAt ?? null,  // Para ventana de 24h de WhatsApp
        lastMessagePreview: conversation.lastMessagePreview ?? null,
        unread: conversation.unread,
        status: conversation.status,
        bitrixId: conversation.bitrixId ?? null,
        bitrixDocument: conversation.bitrixDocument ?? null,
        avatarUrl: conversation.avatarUrl ?? null,
        assignedTo: conversation.assignedTo ?? null,
        assignedAt: conversation.assignedAt ?? null,
        queuedAt: conversation.queuedAt ?? null,
        queueId: conversation.queueId ?? null,
        channel: conversation.channel ?? "whatsapp",
        channelConnectionId: conversation.channelConnectionId ?? null,
        displayNumber: conversation.displayNumber ?? null,
        attendedBy: conversation.attendedBy ?? null,
        ticketNumber: conversation.ticketNumber ?? null,
        // CRITICAL FIX: Enviar campos necesarios para categorización dinámica
        botFlowId: conversation.botFlowId ?? null,
        campaignId: conversation.campaignId ?? null,
        closedReason: conversation.closedReason ?? null,
      })),
    );
  });

  // GET /api/crm/conversations/search-by-phone?phone=XXXX
  // Search all conversations for a specific contact phone number
  router.get("/search-by-phone", async (req, res) => {
    try {
      const { phone } = req.query;

      if (!phone || typeof phone !== 'string') {
        res.status(400).json({ error: 'missing_phone', message: 'Phone parameter is required' });
        return;
      }

      // Clean phone number for comparison
      const cleanPhone = phone.replace(/[^0-9]/g, '');

      // Get all conversations
      const allConversations = await crmDb.listConversations();

      // Filter by phone number (clean comparison)
      const matchingConversations = allConversations.filter(conv => {
        const convPhone = conv.phone.replace(/[^0-9]/g, '');
        return convPhone === cleanPhone || convPhone.includes(cleanPhone) || cleanPhone.includes(convPhone);
      });

      // Get WhatsApp numbers to resolve display names
      const whatsappNumbers = await adminDb.getAllWhatsAppNumbers();

      // Map conversations with display info
      const results = matchingConversations.map(conv => {
        // Find WhatsApp number config
        const numberConfig = whatsappNumbers.find(num =>
          num.phoneNumberId === conv.channelConnectionId
        );

        return {
          id: conv.id,
          phone: conv.phone,
          contactName: conv.contactName ?? null,
          channelConnectionId: conv.channelConnectionId,
          displayNumber: conv.displayNumber ?? null,
          numberAlias: numberConfig?.alias ?? null,
          lastMessageAt: conv.lastMessageAt,
          status: conv.status,
        };
      });

      res.json({ conversations: results });
    } catch (error) {
      console.error('[CRM] Error searching conversations by phone:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to search conversations' });
    }
  });

  // GET /api/crm/conversations/stats - Get conversation statistics
  router.get("/stats", async (req, res) => {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    const allConversations = await crmDb.listConversations();

    // Filter conversations for asesor role
    let personalConversations = allConversations;
    if (userRole === "asesor" && userId) {
      personalConversations = allConversations.filter(conv => {
        // 1. Chats asignados directamente a este asesor
        if (conv.assignedTo === userId) return true;

        // 2. Chats en estado "attending" donde el asesor está en attendedBy
        if (conv.status === "attending" && conv.attendedBy && conv.attendedBy.includes(userId)) return true;

        // 3. Chats cerrados donde el asesor atendió
        if (conv.status === "closed" && conv.attendedBy && conv.attendedBy.includes(userId)) return true;

        return false;
      });
    }

    // Calculate personal stats
    const personalStats = {
      unread: personalConversations.filter(c => c.unread > 0).length,
      queued: personalConversations.filter(c => c.status === "active" && !c.assignedTo).length,
      attending: personalConversations.filter(c => c.status === "attending").length,
      total: personalConversations.length,
    };

    // Calculate global stats (for supervisors and admins)
    const globalStats = {
      unread: allConversations.filter(c => c.unread > 0).length,
      queued: allConversations.filter(c => c.status === "active" && !c.assignedTo).length,
      attending: allConversations.filter(c => c.status === "attending").length,
      total: allConversations.length,
    };

    res.json({
      userRole,
      personal: personalStats,
      global: globalStats,
    });
  });

  router.get("/:id/messages", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const messages = await crmDb.listMessages(conversation.id);
    const attachments = await crmDb.listAttachmentsByMessageIds(messages.map((message) => message.id));
    res.json({ messages, attachments });
  });

  router.post("/:id/mark-read", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    await crmDb.markConversationRead(conversation.id);
    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true });
  });

  router.get("/:id/bitrix", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!bitrixService.isAvailable) {
      res.json({ contact: null, bitrixId: conversation.bitrixId, status: "bitrix_not_configured" });
      return;
    }
    try {
      let contact = conversation.bitrixId ? await bitrixService.fetchContact(conversation.bitrixId) : null;
      if (!contact) {
        contact = await bitrixService.lookupByPhone(conversation.phone);
        if (contact?.ID) {
          await bitrixService.attachConversation(conversation, contact.ID.toString());
        }
      }

      // IMPORTANTE: Sincronizar nombre del contacto desde Bitrix
      if (contact && (contact.NAME || contact.LAST_NAME)) {
        const fullName = [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim();
        if (fullName && fullName !== conversation.contactName) {
          await crmDb.updateConversationMeta(conversation.id, { contactName: fullName });
          console.log(`[CRM] ✅ Nombre sincronizado desde Bitrix: ${fullName} para conversación ${conversation.id}`);

          // Emit WebSocket update for real-time UI sync
          const updated = await crmDb.getConversationById(conversation.id);
          if (updated) {
            socketManager.emitConversationUpdate({ conversation: updated });
          }
        }
      }

      res.json({ contact, bitrixId: contact?.ID ?? conversation.bitrixId ?? null });
    } catch (error) {
      console.error("[CRM] bitrix fetch error", error);
      res.status(500).json({ error: "bitrix_lookup_failed" });
    }
  });

  /**
   * POST /:id/bitrix/create
   * Crea manualmente un contacto/lead en Bitrix24 desde el CRM
   */
  router.post("/:id/bitrix/create", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!bitrixService.isAvailable) {
      res.status(503).json({ error: "bitrix_not_configured" });
      return;
    }
    try {
      const { phone, name } = req.body;
      const result = await bitrixService.createContactWithCustomFields({
        phone: phone || conversation.phone,
        profileName: name || conversation.contactName || undefined,
      });

      if (result.contactId) {
        await bitrixService.attachConversation(conversation, result.contactId);
        const contact = await bitrixService.fetchContact(result.contactId);

        // IMPORTANTE: Sincronizar nombre del contacto desde Bitrix
        if (contact && (contact.NAME || contact.LAST_NAME)) {
          const fullName = [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ").trim();
          if (fullName && fullName !== conversation.contactName) {
            await crmDb.updateConversationMeta(conversation.id, { contactName: fullName });
            console.log(`[CRM] ✅ Nombre sincronizado desde Bitrix (creado): ${fullName} para conversación ${conversation.id}`);

            // Emit WebSocket update for real-time UI sync
            const updated = await crmDb.getConversationById(conversation.id);
            if (updated) {
              socketManager.emitConversationUpdate({ conversation: updated });
            }
          }
        }

        res.json({ success: true, contact, bitrixId: result.contactId, entityType: result.entityType });
      } else {
        res.status(500).json({ error: "create_failed", reason: result.reason });
      }
    } catch (error) {
      console.error("[CRM] bitrix create error", error);
      res.status(500).json({ error: "bitrix_create_failed" });
    }
  });

  router.post("/:id/archive", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // CRITICAL: Terminate bot flow when archiving/closing conversation
    if (conversation.phone) {
      try {
        // CRITICAL FIX: Include channelConnectionId to prevent session conflicts
        const botSessionId = `whatsapp_${conversation.phone}_${conversation.channelConnectionId || 'default'}`;
        await botSessionStore.deleteSession(botSessionId);
        console.log(`[CRM] ✅ Bot flow TERMINATED for ${conversation.phone} (conversation archived/closed)`);
      } catch (error) {
        console.error(`[CRM] Error terminating bot flow:`, error);
      }
    }

    // Get advisor name if closing from advisor session
    const closedByAdvisorId = req.user?.userId;
    const advisorName = closedByAdvisorId ? await getAdvisorName(closedByAdvisorId) : null;
    const timestamp = formatEventTimestamp();

    // Create system event for archiving with advisor name if available
    const archiveText = advisorName
      ? `📁 Conversación cerrada por ${advisorName} (${timestamp})`
      : `📁 Conversación cerrada (${timestamp})`;

    const archiveMessage = await crmDb.createSystemEvent(
      conversation.id,
      'conversation_closed',
      archiveText
    );

    // Emit the system message via WebSocket
    socketManager.emitNewMessage({ message: archiveMessage, attachment: null });

    await crmDb.archiveConversation(conversation.id);

    // End metrics tracking for this conversation with 'completed' status
    metricsTracker.endConversation(conversation.id, 'completed');

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }
    res.json({ success: true });
  });

  router.post("/:id/unarchive", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // CRITICAL: Terminate bot flow when reopening/unarchiving conversation
    if (conversation.phone) {
      try {
        // CRITICAL FIX: Include channelConnectionId to prevent session conflicts
        const botSessionId = `whatsapp_${conversation.phone}_${conversation.channelConnectionId || 'default'}`;
        await botSessionStore.deleteSession(botSessionId);
        console.log(`[CRM] ✅ Bot flow TERMINATED for ${conversation.phone} (conversation reopened)`);
      } catch (error) {
        console.error(`[CRM] Error terminating bot flow:`, error);
      }
    }

    // Get advisor ID from auth (user ID) - who is reopening the conversation
    const advisorId = req.user?.userId || "unknown";
    const advisorName = await getAdvisorName(advisorId);
    const timestamp = formatEventTimestamp();

    console.log(`[CRM Unarchive] 🔓 Advisor ${advisorName} (${advisorId}) reopening conversation ${conversation.id}`);

    // Cambiar el estado a "attending" y asignar automáticamente al asesor que reabre
    const now = Date.now();
    await crmDb.updateConversationMeta(conversation.id, {
      status: "attending",
      assignedTo: advisorId,
      assignedAt: now,
      readAt: now,
      closedReason: null  // CRITICAL: Clear closed_reason when reopening
    });

    // Add advisor to attendedBy list if not already present
    const attendedBy = conversation.attendedBy || [];
    if (!attendedBy.includes(advisorId)) {
      attendedBy.push(advisorId);
      await crmDb.updateConversationMeta(conversation.id, { attendedBy });
    }

    // Create system event for reopening
    const reopenMessage = await crmDb.createSystemEvent(
      conversation.id,
      'conversation_reopened',
      `🔓 Conversación reabierta por ${advisorName} (${timestamp})`
    );

    // Emit the system message via WebSocket
    socketManager.emitNewMessage({ message: reopenMessage, attachment: null });

    // Start metrics tracking for this conversation
    const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    metricsTracker.startConversation(metricId, conversation.id, advisorId, {
      queueId: conversation.queueId || undefined,
      channelType: conversation.channel as any,
      channelId: conversation.channelConnectionId || undefined,
    });

    // Start a session for this conversation
    try {
      const session = await sessionsStorage.startSession(advisorId, conversation.id);
      console.log(`[CRM Unarchive] 📊 Session started: ${session.id} for advisor ${advisorId}`);
    } catch (error) {
      console.error('[CRM Unarchive] Error starting session:', error);
    }

    console.log(`[CRM Unarchive] ✅ Conversation ${conversation.id} reopened and assigned to ${advisorName}`);

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }
    res.json({ success: true });
  });

  router.post("/:id/transfer", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const { type, targetId } = req.body;

    if (!type || !targetId) {
      res.status(400).json({ error: "missing_parameters" });
      return;
    }

    if (type !== "advisor" && type !== "bot" && type !== "queue") {
      res.status(400).json({ error: "invalid_type" });
      return;
    }

    // Get current advisor info (who is transferring)
    const currentAdvisorId = req.user?.userId || "unknown";
    const currentAdvisorName = await getAdvisorName(currentAdvisorId);

    // Update conversation metadata with transfer info
    const metadata = conversation.metadata || {};
    metadata.transferredTo = targetId;
    metadata.transferType = type;
    metadata.transferredAt = Date.now();

    // Get display names for system message
    let displayName = targetId;
    const timestamp = formatEventTimestamp();
    if (type === "advisor") {
      displayName = await getAdvisorName(targetId);

      // CRITICAL: If transferring to an advisor, assign the conversation and reset to "active"
      // This ensures the chat goes to "POR TRABAJAR" and the new advisor must accept it
      await crmDb.updateConversationMeta(conversation.id, {
        assignedTo: targetId,
        assignedAt: Date.now(),
        status: "active",  // IMPORTANTE: Forzar a "active" para que vaya a POR TRABAJAR
      });
      // Add advisor to attendedBy list
      await crmDb.addAdvisorToAttendedBy(conversation.id, targetId);
      console.log(`[CRM] ✅ Conversation ${conversation.id} transferred to advisor: ${displayName} (${targetId}) (awaiting response)`);
    } else if (type === "queue") {
      // Transferring to queue: remove assignedTo and set queueId
      const queue = await adminDb.getQueueById(targetId);
      displayName = queue?.name || "Cola";

      await crmDb.updateConversationMeta(conversation.id, {
        assignedTo: null,  // Quitar el asesor asignado
        queueId: targetId, // Asignar a la cola
        status: "active",  // Estado activo (EN COLA)
        transferredFrom: currentAdvisorId, // Marcar origen para métricas (trans out/in)
      });
      console.log(`[CRM] ✅ Conversation ${conversation.id} transferred to queue: ${displayName} (${targetId})`);
    } else {
      displayName = await getBotName(targetId, flowProvider);
      // For bot transfers, just update metadata
      console.log(`[CRM] ✅ Conversation ${conversation.id} transferred to bot: ${displayName} (${targetId})`);
    }

    // Create system event for the transfer with detailed information
    let transferText = "";
    if (type === "advisor") {
      transferText = `🔀 ${currentAdvisorName} transfirió a ${displayName} (${timestamp})`;
    } else if (type === "queue") {
      transferText = `📋 ${currentAdvisorName} transfirió a cola ${displayName} (${timestamp})`;
    } else {
      transferText = `🤖 ${currentAdvisorName} transfirió a bot ${displayName} (${timestamp})`;
    }

    const transferMessage = await crmDb.createSystemEvent(
      conversation.id,
      'conversation_transferred',
      transferText
    );

    // Emit the system message via WebSocket
    socketManager.emitNewMessage({ message: transferMessage, attachment: null });

    // Track conversation transfer in metrics (only for advisor transfers)
    // This will create TWO metrics: transfer_out (current advisor) and transfer_in (receiving advisor)
    if (type === "advisor") {
      await metricsTracker.transferConversation(conversation.id, currentAdvisorId, targetId, {
        queueId: conversation.queueId || null,
      });
    }

    // Optionally archive the conversation after transfer
    // await crmDb.archiveConversation(conversation.id);

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true, transferred: { type, targetId } });
  });

  // Queue management endpoints
  router.get("/queue", async (_req, res) => {
    const queuedConversations = await crmDb.listQueuedConversations();
    res.json({ conversations: queuedConversations });
  });

  router.post("/:id/accept", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Get advisor ID from auth (user ID)
    const advisorId = req.user?.userId || "unknown";

    console.log(`[CRM Accept] 🎯 Advisor ${advisorId} accepting conversation ${conversation.id}`);

    const accepted = await crmDb.acceptConversation(conversation.id, advisorId);
    if (!accepted) {
      res.status(400).json({ error: "cannot_accept", reason: "Conversation is not in queue" });
      return;
    }

    console.log(`[CRM Accept] ✅ Conversation ${conversation.id} accepted in database`);

    // CRITICAL: Terminate bot flow when advisor accepts conversation
    if (conversation.phone) {
      try {
        // CRITICAL FIX: Include channelConnectionId to prevent session conflicts
        const botSessionId = `whatsapp_${conversation.phone}_${conversation.channelConnectionId || 'default'}`;
        await botSessionStore.deleteSession(botSessionId);
        console.log(`[CRM] ✅ Bot flow TERMINATED for ${conversation.phone} (advisor accepted conversation)`);
      } catch (error) {
        console.error(`[CRM] Error terminating bot flow:`, error);
      }
    }

    // Start tracking metrics for this conversation with full context
    const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    metricsTracker.startConversation(metricId, conversation.id, advisorId, {
      queueId: conversation.queueId || undefined,
      channelType: conversation.channel as any,
      channelId: conversation.channelConnectionId || undefined,
    });

    // Get advisor display name
    const advisorName = await getAdvisorName(advisorId);
    const timestamp = formatEventTimestamp();

    // Create system event for accepting the conversation
    const acceptMessage = await crmDb.createSystemEvent(
      conversation.id,
      'conversation_accepted',
      `✅ ${advisorName} aceptó la conversación (${timestamp})`
    );

    console.log(`[CRM Accept] 📝 System message created: ${acceptMessage.id}`);

    // Emit the system message via WebSocket
    socketManager.emitNewMessage({ message: acceptMessage, attachment: null });

    // Start a session for this conversation
    try {
      const session = await sessionsStorage.startSession(advisorId, conversation.id);
      console.log(`[CRM] Session started: ${session.id} for advisor ${advisorId}`);
    } catch (error) {
      console.error('[CRM] Error starting session:', error);
    }

    // CRITICAL: Add small delay to ensure PostgreSQL has committed all changes
    await new Promise(resolve => setTimeout(resolve, 50));

    const updated = await crmDb.getConversationById(conversation.id);
    console.log(`[CRM Accept] 📊 Refreshed conversation state:`, {
      id: updated?.id,
      status: updated?.status,
      assignedTo: updated?.assignedTo,
      queueId: updated?.queueId
    });

    if (updated) {
      console.log(`[CRM Accept] 📡 Broadcasting conversation update to ${socketManager.getClientCount ? socketManager.getClientCount() : 'unknown'} clients`);
      socketManager.emitConversationUpdate({ conversation: updated });
      console.log(`[CRM Accept] ✅ WebSocket event emitted for conversation ${updated.id}`);
    }

    res.json({ success: true, conversation: updated });
  });

  // Take over conversation (apoderarse de un chat)
  router.post("/:id/takeover", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    // Get new advisor ID from auth
    const newAdvisorId = req.user?.userId || "unknown";
    const newAdvisorName = await getAdvisorName(newAdvisorId);

    // Get previous advisor info (if any)
    const previousAdvisorId = conversation.assignedTo;
    let previousAdvisorName = "Sin asignar";
    if (previousAdvisorId) {
      previousAdvisorName = await getAdvisorName(previousAdvisorId);
    }

    // Can't take over your own chat
    if (previousAdvisorId === newAdvisorId) {
      res.status(400).json({ error: "cannot_takeover", reason: "Ya eres el asesor asignado a este chat" });
      return;
    }

    // Update conversation - assign to new advisor and change status to attending
    await crmDb.updateConversationMeta(conversation.id, {
      assignedTo: newAdvisorId,
      status: "attending",
      transferredFrom: null, // Clear any transfer indicators
      botStartedAt: null, // Clear bot state when advisor takes over - bot exits
      botFlowId: null,
    });
    console.log(`[CRM] 🤖 Bot exited conversation ${conversation.id} - Advisor ${newAdvisorId} took over`);

    // Add new advisor to attendedBy history if not already there
    if (!conversation.attendedBy || !conversation.attendedBy.includes(newAdvisorId)) {
      const attendedBy = [...(conversation.attendedBy || []), newAdvisorId];
      await crmDb.updateConversationMeta(conversation.id, { attendedBy });
    }

    // End metrics for previous advisor (if any)
    if (previousAdvisorId) {
      metricsTracker.endConversation(conversation.id, previousAdvisorId, 'taken_over');
    }

    // Start tracking metrics for new advisor
    const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    metricsTracker.startConversation(metricId, conversation.id, newAdvisorId, {
      queueId: conversation.queueId || undefined,
      channelType: conversation.channel as any,
      channelId: conversation.channelConnectionId || undefined,
    });

    // Create system message and event
    const takeoverMessage = await crmDb.appendMessage({
      convId: conversation.id,
      direction: "outgoing",
      type: "system",
      text: `🔄 CHAT TOMADO\n━━━━━━━━━━━━━━━━━━━━━\nAnterior: ${previousAdvisorName}\nNuevo: ${newAdvisorName}\n━━━━━━━━━━━━━━━━━━━━━`,
      mediaUrl: null,
      mediaThumb: null,
      repliedToId: null,
      status: "sent",
    });

    const takeoverEvent = await crmDb.appendMessage({
      convId: conversation.id,
      direction: "outgoing",
      type: "event",
      text: `${newAdvisorName} tomó el chat de ${previousAdvisorName}`,
      mediaUrl: null,
      mediaThumb: null,
      repliedToId: null,
      status: "sent",
      eventType: "conversation_taken_over",
    });

    // Emit messages via WebSocket
    socketManager.emitNewMessage({ message: takeoverMessage, attachment: null });
    socketManager.emitNewMessage({ message: takeoverEvent, attachment: null });

    // Start a new session for the new advisor
    try {
      const session = await sessionsStorage.startSession(newAdvisorId, conversation.id);
      console.log(`[CRM] Session started after takeover: ${session.id} for advisor ${newAdvisorId}`);
    } catch (error) {
      console.error('[CRM] Error starting session after takeover:', error);
    }

    const finalConversation = await crmDb.getConversationById(conversation.id);
    if (finalConversation) {
      socketManager.emitConversationUpdate({ conversation: finalConversation });
    }

    res.json({ success: true, conversation: finalConversation });
  });

  // Reject conversation (return to queue)
  router.post("/:id/reject", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const advisorId = req.user?.userId || "unknown";
    const advisorName = await getAdvisorName(advisorId);

    const released = await crmDb.releaseConversation(conversation.id);
    if (!released) {
      res.status(400).json({ error: "cannot_reject", reason: "Conversation is not being attended" });
      return;
    }

    // Create system event for rejecting/returning to queue
    const rejectMessage = await crmDb.createSystemEvent(
      conversation.id,
      'conversation_rejected',
      `⚠️ ${advisorName} devolvió la conversación a la cola`
    );

    socketManager.emitNewMessage({ message: rejectMessage, attachment: null });

    // Track conversation rejection in metrics
    const reason = req.body.reason || "Advisor returned conversation to queue";
    metricsTracker.rejectConversation(conversation.id, advisorId, reason);

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true, conversation: updated });
  });

  router.post("/:id/release", async (req, res) => {
    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const released = await crmDb.releaseConversation(conversation.id);
    if (!released) {
      res.status(400).json({ error: "cannot_release", reason: "Conversation is not being attended" });
      return;
    }

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true, conversation: updated });
  });

  // Update contact name
  router.patch("/:id/contact-name", async (req, res) => {
    const { contactName } = req.body;

    if (!contactName || typeof contactName !== 'string') {
      res.status(400).json({ error: "invalid_contact_name" });
      return;
    }

    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    await crmDb.updateConversationMeta(conversation.id, { contactName: contactName.trim() });

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true, conversation: updated });
  });

  // Toggle favorite status
  router.patch("/:id/favorite", async (req, res) => {
    const { isFavorite } = req.body;

    if (typeof isFavorite !== 'boolean') {
      res.status(400).json({ error: "invalid_favorite_status" });
      return;
    }

    const conversation = await crmDb.getConversationById(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    await crmDb.updateConversationMeta(conversation.id, { isFavorite });

    const updated = await crmDb.getConversationById(conversation.id);
    if (updated) {
      socketManager.emitConversationUpdate({ conversation: updated });
    }

    res.json({ success: true, conversation: updated });
  });

  // GET /api/crm/conversations/analytics - Get conversations grouped by day for AI analytics
  router.get("/analytics", async (req, res) => {
    try {
      console.log("[CRM Analytics] 🔍 Request from user:", req.user?.userId, "role:", req.user?.role);
      const { from, to } = req.query;

      if (!from || !to) {
        res.status(400).json({ error: "missing_params", message: "from and to dates are required (YYYY-MM-DD)" });
        return;
      }

      console.log("[CRM Analytics] 📅 Date range:", from, "to", to);

      // Parse dates in local timezone (not UTC)
      // When user sends "2025-11-12", we want 2025-11-12 00:00 LOCAL time, not UTC
      const fromDate = new Date(from as string + 'T00:00:00');
      const toDate = new Date(to as string + 'T23:59:59');

      // Get all conversations in date range
      const allConversations = await crmDb.listConversations();
      console.log("[CRM Analytics] 📊 Total conversations:", allConversations.length);

      // Helper function to get local date string (YYYY-MM-DD) in server timezone
      const getLocalDateKey = (timestamp: number): string => {
        const date = new Date(timestamp);
        // Get local date components (uses server's timezone)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      // Filter by date range using local date comparison
      // IMPORTANT: Use createdAt instead of lastMessageAt to ensure conversations
      // stay in their original day and don't move when new messages arrive
      const conversationsInRange = allConversations.filter(conv => {
        const localDateKey = getLocalDateKey(conv.createdAt);
        const fromKey = from as string;
        const toKey = to as string;
        const isInRange = localDateKey >= fromKey && localDateKey <= toKey;

        // Debug: log first few conversations to understand the issue
        if (allConversations.indexOf(conv) < 3) {
          console.log(`[CRM Analytics] 🔍 Sample conv ${conv.id}:`, {
            createdAt: conv.createdAt,
            localDateKey,
            fromKey,
            toKey,
            isInRange
          });
        }

        return isInRange;
      });

      console.log("[CRM Analytics] 🎯 Conversations in range:", conversationsInRange.length);

      // Group by day (using server's local timezone, not UTC)
      // Use createdAt to group conversations by the day they were created
      const dayMap = new Map<string, any[]>();

      for (const conv of conversationsInRange) {
        const dayKey = getLocalDateKey(conv.createdAt);

        if (!dayMap.has(dayKey)) {
          dayMap.set(dayKey, []);
        }

        // Get message count for this conversation
        const messages = await crmDb.listMessages(conv.id);

        // Calculate duration (from first to last message)
        let duration = "0m";
        if (messages.length > 1) {
          const firstMsg = new Date(messages[0].createdAt).getTime();
          const lastMsg = new Date(messages[messages.length - 1].createdAt).getTime();
          const durationMs = lastMsg - firstMsg;
          const minutes = Math.floor(durationMs / 60000);
          duration = minutes > 0 ? `${minutes}m` : "< 1m";
        }

        // Get AI analysis if exists (stored in conversation metadata)
        const aiAnalysis = (conv as any).aiAnalysis || null;

        dayMap.get(dayKey)!.push({
          id: conv.id,
          phone: conv.phone,
          contactName: conv.contactName,
          date: conv.lastMessageAt,
          messageCount: messages.length,
          duration,
          summary: aiAnalysis?.summary,
          sentiment: aiAnalysis?.sentiment,
          topics: aiAnalysis?.topics,
          keywords: aiAnalysis?.keywords,
          analyzing: false
        });
      }

      // Build day groups with stats
      const dayGroups = Array.from(dayMap.entries()).map(([date, conversations]) => {
        // Calculate sentiment distribution
        const sentimentDist = {
          positive: conversations.filter(c => c.sentiment === 'positive').length,
          negative: conversations.filter(c => c.sentiment === 'negative').length,
          neutral: conversations.filter(c => c.sentiment === 'neutral').length
        };

        // Calculate average duration
        const totalMinutes = conversations.reduce((sum, c) => {
          const match = c.duration.match(/(\d+)m/);
          return sum + (match ? parseInt(match[1]) : 0);
        }, 0);
        const avgMinutes = Math.floor(totalMinutes / conversations.length);

        return {
          date,
          conversations,
          totalConversations: conversations.length,
          avgDuration: `${avgMinutes}m`,
          sentimentDistribution: sentimentDist
        };
      });

      // Sort by date descending (newest first)
      dayGroups.sort((a, b) => b.date.localeCompare(a.date));

      console.log("[CRM Analytics] ✅ Returning", dayGroups.length, "day groups");

      res.json({ dayGroups });
    } catch (error) {
      console.error("[CRM] Error fetching analytics:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // POST /api/crm/conversations/:id/analyze - Analyze conversation with AI
  router.post("/:id/analyze", async (req, res) => {
    try {
      const conversationId = req.params.id;

      // Get conversation
      const conversation = await crmDb.getConversationById(conversationId);
      if (!conversation) {
        res.status(404).json({ error: "not_found", message: "Conversation not found" });
        return;
      }

      // Get all messages
      const messages = await crmDb.listMessages(conversationId);

      if (messages.length === 0) {
        res.status(400).json({ error: "no_messages", message: "Conversation has no messages to analyze" });
        return;
      }

      // Build conversation text for AI
      const conversationText = messages
        .map(msg => {
          const role = msg.direction === 'incoming' ? 'Cliente' : 'Empresa';
          return `${role}: ${msg.text || '[mensaje sin texto]'}`;
        })
        .join('\n');

      // Get AI service
      const { getRagService } = await import('../../ai/rag-service');
      const ragService = await getRagService();

      // Check if any provider is available
      const availableProviders = ragService.getAvailableProviders();
      if (availableProviders.length === 0) {
        res.status(503).json({
          error: "no_ai_provider",
          message: "No AI provider is configured. Please configure OpenAI, Anthropic, Gemini or Ollama in the AI settings."
        });
        return;
      }

      // Use the first available provider (prioritize OpenAI if available)
      const provider = availableProviders.includes('openai')
        ? 'openai'
        : availableProviders.includes('anthropic')
        ? 'anthropic'
        : availableProviders.includes('gemini')
        ? 'gemini'
        : availableProviders[0];

      // Determine model based on provider
      let model: string;
      if (provider === 'openai') {
        model = 'gpt-4o-mini'; // Fast and cheap
      } else if (provider === 'anthropic') {
        model = 'claude-3-5-haiku-20241022'; // Fast and cheap
      } else if (provider === 'gemini') {
        model = 'gemini-1.5-flash';
      } else {
        model = 'llama3.2'; // Ollama default
      }

      // Load custom analytics config
      let analyticsConfig: any;
      try {
        const configPath = path.join(process.cwd(), 'data', 'ai-analytics-config.json');
        const configData = await fs.readFile(configPath, 'utf-8');
        analyticsConfig = JSON.parse(configData);
        console.log(`[CRM Analytics] Loaded custom config - prompt length: ${analyticsConfig.systemPrompt.length}, temp: ${analyticsConfig.temperature}, maxTokens: ${analyticsConfig.maxTokens}`);
      } catch (error) {
        console.log('[CRM Analytics] Using default config');
        // Use default if config file doesn't exist
        analyticsConfig = {
          systemPrompt: `Eres un asistente que analiza conversaciones de servicio al cliente.
Analiza la siguiente conversación y proporciona:
1. Un resumen breve (máximo 2 frases)
2. El sentimiento general (positive, negative, o neutral)
3. Hasta 3 temas principales mencionados
4. Hasta 5 palabras clave relevantes

Responde SOLO en formato JSON con esta estructura exacta:
{
  "summary": "resumen aquí",
  "sentiment": "positive|negative|neutral",
  "topics": ["tema1", "tema2", "tema3"],
  "keywords": ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5"]
}`,
          temperature: 0.3,
          maxTokens: 500
        };
      }

      console.log(`[CRM Analytics] Starting AI analysis with provider: ${provider}, model: ${model}`);
      console.log(`[CRM Analytics] Conversation text length: ${conversationText.length} chars`);

      // Call AI to analyze
      const response = await ragService.complete({
        provider: provider as any,
        model: model as any,
        messages: [
          {
            role: 'system',
            content: analyticsConfig.systemPrompt
          },
          {
            role: 'user',
            content: `Conversación:\n\n${conversationText}`
          }
        ],
        temperature: analyticsConfig.temperature || 0.3,
        maxTokens: analyticsConfig.maxTokens || 500
      });

      console.log(`[CRM Analytics] AI response received - length: ${response.content.length} chars`);

      // Log token usage if available
      if (response.usage) {
        console.log(`[CRM Analytics] 📊 Token usage:`, {
          prompt: response.usage.prompt_tokens || response.usage.input_tokens,
          completion: response.usage.completion_tokens || response.usage.output_tokens,
          total: response.usage.total_tokens
        });
      } else {
        console.log(`[CRM Analytics] ℹ️ Token usage information not available from provider`);
      }

      console.log(`[CRM Analytics] AI response preview: ${response.content.substring(0, 200)}...`);

      // Parse AI response
      let analysis;
      try {
        // Try to extract JSON from response (sometimes AI adds markdown code blocks)
        let jsonText = response.content.trim();

        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

        analysis = JSON.parse(jsonText);
        console.log('[CRM Analytics] Successfully parsed AI response');
      } catch (parseError) {
        console.error("[CRM Analytics] Failed to parse AI response:", response.content);
        console.error("[CRM Analytics] Parse error:", parseError);
        res.status(500).json({
          error: "ai_parse_error",
          message: "Failed to parse AI response",
          details: response.content.substring(0, 500)
        });
        return;
      }

      // Store analysis in conversation metadata
      await crmDb.updateConversationMeta(conversationId, {
        aiAnalysis: analysis
      });

      console.log('[CRM Analytics] Analysis completed successfully');
      res.json(analysis);
    } catch (error) {
      console.error("[CRM Analytics] ❌ Error analyzing conversation:", error);
      console.error("[CRM Analytics] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
}
