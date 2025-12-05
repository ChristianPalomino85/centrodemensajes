/**
 * QueueAssignmentService - Event-Driven Queue Assignment
 *
 * Reemplaza al QueueDistributor con un sistema basado en eventos.
 * NO usa polling - reacciona instantáneamente a eventos del sistema.
 *
 * Eventos que maneja:
 * 1. onChatQueued - Cuando un chat entra a cola
 * 2. onAdvisorOnline - Cuando un asesor se loguea
 * 3. onAdvisorStatusChange - Cuando cambia status a "Disponible" (futuro)
 */

import { crmDb } from "./db-postgres";
import { adminDb } from "../admin-db";
import { advisorPresence } from "./advisor-presence";
import type { CrmRealtimeManager } from "./ws";
import { formatEventTimestamp } from "../utils/file-logger";
import { metricsTracker } from "./metrics-tracker";
import { canBeAutoAssigned } from "../../shared/conversation-rules";

export class QueueAssignmentService {
  private socketManager: CrmRealtimeManager | null = null;

  constructor(socketManager?: CrmRealtimeManager) {
    this.socketManager = socketManager || null;
  }

  setSocketManager(socketManager: CrmRealtimeManager): void {
    this.socketManager = socketManager;
  }

  /**
   * EVENTO 1: Cuando un chat entra a cola
   * Trigger: Bot transfiere chat a cola
   * Acción: Buscar asesor ONLINE disponible → Asignar inmediatamente
   */
  async onChatQueued(conversationId: string, queueId: string): Promise<void> {
    try {
      console.log(`[QueueAssignment] 📥 Chat ${conversationId} entró a cola ${queueId}`);

      // 1. Verificar que el chat realmente pueda ser auto-asignado
      const conversation = await crmDb.getConversationById(conversationId);
      if (!conversation) {
        console.warn(`[QueueAssignment] ⚠️  Conversación ${conversationId} no encontrada`);
        return;
      }

      if (!canBeAutoAssigned({
        status: conversation.status,
        assignedTo: conversation.assignedTo,
        botFlowId: conversation.botFlowId,
        queueId: conversation.queueId,
        campaignId: null,
      })) {
        console.log(`[QueueAssignment] ⏭️  Chat ${conversationId} no puede ser auto-asignado`);
        return;
      }

      // 2. Buscar asesor disponible ONLINE en esta cola
      const advisorId = await this.findAvailableAdvisor(queueId);

      if (!advisorId) {
        console.log(`[QueueAssignment] ⚠️  No hay asesores ONLINE disponibles en cola ${queueId}`);
        return;
      }

      // 3. Asignar chat inmediatamente
      await this.assignChatToAdvisor(conversationId, advisorId, queueId, 'chat_queued');

    } catch (error) {
      console.error(`[QueueAssignment] ❌ Error en onChatQueued:`, error);
    }
  }

  /**
   * EVENTO 2: Cuando un asesor se loguea
   * Trigger: AdvisorPresence.markOnline()
   * Acción: Buscar chats pendientes en sus colas → Asignar
   */
  async onAdvisorOnline(advisorId: string): Promise<void> {
    try {
      console.log(`[QueueAssignment] 👤 Asesor ${advisorId} está ONLINE - buscando chats pendientes`);

      // 🐛 FIX #1: Verificar que REALMENTE está ONLINE (no deslogueado)
      if (!advisorPresence.isOnline(advisorId)) {
        console.log(`[QueueAssignment] ⚠️  Asesor ${advisorId} NO está online (deslogueado) - NO asignar chats`);
        return;
      }

      // 🐛 FIX #2: Verificar que el asesor PUEDE recibir chats (no está en refrigerio, pausa, etc.)
      const canReceive = await this.canAdvisorReceiveChats(advisorId);
      if (!canReceive) {
        console.log(`[QueueAssignment] ⚠️  Asesor ${advisorId} está online pero NO DISPONIBLE (refrigerio/pausa) - NO asignar chats`);
        return;
      }

      // 1. Obtener colas del asesor
      const queues = await adminDb.getAllQueues();
      const advisorQueues = queues.filter(q =>
        q.assignedAdvisors && q.assignedAdvisors.includes(advisorId)
      );

      if (advisorQueues.length === 0) {
        console.log(`[QueueAssignment] ℹ️  Asesor ${advisorId} no tiene colas asignadas`);
        return;
      }

      // 2. Para cada cola, buscar chats sin asignar
      let totalAssigned = 0;

      for (const queue of advisorQueues) {
        const unassignedChats = await this.getUnassignedChats(queue.id);

        if (unassignedChats.length === 0) {
          continue;
        }

        // 3. CASO 2: Asignar TODOS los chats pendientes de sus colas
        console.log(`[QueueAssignment] 📊 Cola "${queue.name}": ${unassignedChats.length} chats pendientes para ${advisorId}`);

        for (const chat of unassignedChats) {
          const success = await this.assignChatToAdvisor(
            chat.id,
            advisorId,
            queue.id,
            'advisor_online'
          );

          if (success) {
            totalAssigned++;
          }
        }
      }

      if (totalAssigned > 0) {
        console.log(`[QueueAssignment] ✅ Asignados ${totalAssigned} chats a ${advisorId}`);
      }

    } catch (error) {
      console.error(`[QueueAssignment] ❌ Error en onAdvisorOnline:`, error);
    }
  }

  /**
   * Buscar asesor disponible ONLINE en una cola
   * Estrategia: least-busy (el que tiene menos chats activos)
   */
  private async findAvailableAdvisor(queueId: string): Promise<string | null> {
    try {
      const queue = await adminDb.getQueueById(queueId);
      if (!queue || !queue.assignedAdvisors || queue.assignedAdvisors.length === 0) {
        return null;
      }

      const advisors = queue.assignedAdvisors;
      const availableAdvisors: Array<{ id: string; activeChats: number }> = [];

      for (const advisorId of advisors) {
        // 1. Excluir supervisores
        if (queue.supervisors && queue.supervisors.includes(advisorId)) {
          continue;
        }

        // 2. CRÍTICO: Verificar que esté ONLINE
        if (!advisorPresence.isOnline(advisorId)) {
          continue;
        }

        // 3. Verificar estado de asesor (no en refrigerio/pausa)
        const canReceive = await this.canAdvisorReceiveChats(advisorId);
        if (!canReceive) {
          continue;
        }

        // 4. Contar chats activos del asesor
        const activeChats = await this.getAdvisorActiveChatsCount(advisorId);

        availableAdvisors.push({ id: advisorId, activeChats });
      }

      if (availableAdvisors.length === 0) {
        return null;
      }

      // Estrategia least-busy: ordenar por menor cantidad de chats
      availableAdvisors.sort((a, b) => a.activeChats - b.activeChats);

      return availableAdvisors[0].id;

    } catch (error) {
      console.error(`[QueueAssignment] ❌ Error buscando asesor disponible:`, error);
      return null;
    }
  }

  /**
   * Obtener chats sin asignar de una cola
   */
  private async getUnassignedChats(queueId: string): Promise<any[]> {
    const allConversations = await crmDb.listConversations();

    return allConversations.filter(conv =>
      conv.queueId === queueId &&
      canBeAutoAssigned({
        status: conv.status,
        assignedTo: conv.assignedTo,
        botFlowId: conv.botFlowId,
        queueId: conv.queueId,
        campaignId: null,
      })
    );
  }

  /**
   * Verificar si un asesor puede recibir chats
   * (no está en refrigerio, pausa, etc.)
   */
  private async canAdvisorReceiveChats(advisorId: string): Promise<boolean> {
    try {
      const user = await adminDb.getUserById(advisorId);
      if (!user) return false;

      // Verificar que tenga un status que permita recibir chats
      // Estados que NO permiten: "En Refrigerio", "En Pausa", etc.
      const statusInfo = user.advisorStatus;
      if (statusInfo && statusInfo.action === 'redirect') {
        return false; // No puede recibir chats
      }

      return true;
    } catch (error) {
      console.error(`[QueueAssignment] Error verificando status de ${advisorId}:`, error);
      return false;
    }
  }

  /**
   * Contar chats activos de un asesor
   * Incluye tanto chats 'active' (POR TRABAJAR) como 'attending' (TRABAJANDO)
   */
  private async getAdvisorActiveChatsCount(advisorId: string): Promise<number> {
    const allConversations = await crmDb.listConversations();

    return allConversations.filter(conv =>
      conv.assignedTo === advisorId &&
      (conv.status === 'attending' || conv.status === 'active') // POR TRABAJAR + TRABAJANDO
    ).length;
  }

  /**
   * Asignar un chat a un asesor
   */
  private async assignChatToAdvisor(
    conversationId: string,
    advisorId: string,
    queueId: string,
    reason: 'chat_queued' | 'advisor_online'
  ): Promise<boolean> {
    try {
      // 1. Asignar en DB
      const success = await crmDb.assignConversation(conversationId, advisorId);

      if (!success) {
        console.warn(`[QueueAssignment] ⚠️  No se pudo asignar ${conversationId} a ${advisorId}`);
        return false;
      }

      // 2. Obtener info del asesor
      const user = await adminDb.getUserById(advisorId);
      const advisorName = user?.name || user?.username || advisorId;

      // 3. Obtener info del chat
      const conversation = await crmDb.getConversationById(conversationId);
      if (!conversation) return false;

      console.log(`[QueueAssignment] ✅ Chat ${conversation.phone} → ${advisorName} (${reason})`);

      // 4. Start tracking metrics
      const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      metricsTracker.startConversation(metricId, conversationId, advisorId, {
        queueId: queueId,
        channelType: conversation.channel as any,
        channelId: conversation.channelConnectionId || undefined,
      });

      // 5. Create system message
      const timestamp = formatEventTimestamp();
      const reasonText = reason === 'chat_queued'
        ? 'nuevo en cola'
        : 'asesor disponible';

      const assignMessage = await crmDb.createSystemEvent(
        conversationId,
        'conversation_assigned',
        `🎯 Asignado automáticamente a ${advisorName} (${timestamp})`
      );

      // 6. Emit WebSocket events
      if (this.socketManager) {
        this.socketManager.emitNewMessage({
          message: assignMessage,
          conversationId: conversationId
        });

        const updated = await crmDb.getConversationById(conversationId);
        if (updated) {
          this.socketManager.emitConversationUpdate({ conversation: updated });
        }
      }

      return true;

    } catch (error) {
      console.error(`[QueueAssignment] ❌ Error asignando ${conversationId}:`, error);
      return false;
    }
  }
}

// Singleton instance
let queueAssignmentService: QueueAssignmentService | null = null;

export function initQueueAssignmentService(socketManager?: CrmRealtimeManager): QueueAssignmentService {
  if (!queueAssignmentService) {
    queueAssignmentService = new QueueAssignmentService(socketManager);
    console.log('[QueueAssignment] ✅ Service initialized (event-driven)');
  } else if (socketManager) {
    queueAssignmentService.setSocketManager(socketManager);
  }
  return queueAssignmentService;
}

export function getQueueAssignmentService(): QueueAssignmentService {
  if (!queueAssignmentService) {
    throw new Error('[QueueAssignment] Service not initialized. Call initQueueAssignmentService() first.');
  }
  return queueAssignmentService;
}
