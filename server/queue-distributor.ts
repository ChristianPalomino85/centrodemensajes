import { crmDb } from "./crm/db-postgres";
import { adminDb } from "./admin-db";
import { advisorPresence } from "./crm/advisor-presence";
import type { CrmRealtimeManager } from "./crm/ws";
import { formatEventTimestamp } from "./utils/file-logger";
import { metricsTracker } from "./crm/metrics-tracker";
import { canBeAutoAssigned } from "../shared/conversation-rules";
import { Pool } from "pg";

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

/**
 * QueueDistributor
 *
 * Distribuye automáticamente chats en cola a asesores disponibles
 * Corre cada X segundos de forma continua
 *
 * LÓGICA ESPECIAL - PRIMER ASESOR DEL DÍA:
 * - Horario: 9am - 6pm
 * - Primer asesor "Disponible" después de 6pm → recibe TODOS los chats acumulados
 * - Asesores siguientes → solo reciben chats NUEVOS (distribución normal)
 */
export class QueueDistributor {
  private intervalId: NodeJS.Timeout | null = null;
  private socketManager: CrmRealtimeManager | null = null;
  private isRunning = false;
  private dailyResetTimestamps: Map<string, number> = new Map(); // queueId -> timestamp of last reset

  constructor(socketManager?: CrmRealtimeManager) {
    this.socketManager = socketManager || null;
  }

  setSocketManager(socketManager: CrmRealtimeManager): void {
    this.socketManager = socketManager;
  }

  /**
   * Iniciar distribución automática
   * @param intervalMs Intervalo en milisegundos (default: 10 segundos)
   */
  start(intervalMs: number = 10000): void {
    if (this.intervalId) {
      console.log("[QueueDistributor] ⚠️  Ya está en ejecución");
      return;
    }

    console.log(`[QueueDistributor] 🚀 Iniciando distribución automática cada ${intervalMs}ms`);

    // Ejecutar inmediatamente y luego cada intervalo
    this.distribute();

    this.intervalId = setInterval(() => {
      this.distribute();
    }, intervalMs);
  }

  /**
   * Detener distribución automática
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[QueueDistributor] 🛑 Distribución automática detenida");
    }
  }

  /**
   * Distribución principal - ejecutada cada intervalo
   */
  private async distribute(): Promise<void> {
    // Prevenir ejecuciones concurrentes
    if (this.isRunning) {
      console.log("[QueueDistributor] ⏭️  Saltando ejecución - otra en progreso");
      return;
    }

    this.isRunning = true;

    try {
      // 1. Obtener todas las colas (no hay campo status en PostgreSQL)
      const queues = await adminDb.getAllQueues();

      if (queues.length === 0) {
        return;
      }

      // 2. Para cada cola, distribuir chats
      for (const queue of queues) {
        // Usar "least-busy" por defecto (distribución equitativa)
        await this.distributeQueue(queue.id, queue.name, queue.distributionMode || "least-busy");
      }

    } catch (error) {
      console.error("[QueueDistributor] ❌ Error en distribución:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Verificar si es el inicio del día (después de las 6pm del día anterior)
   * Horario: 9am - 6pm (América/Lima UTC-5)
   */
  private isStartOfDay(queueId: string): boolean {
    const now = new Date();
    const peruTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const currentHour = peruTime.getHours();

    // Verificar si estamos en horario laboral (9am - 6pm)
    if (currentHour < 9 || currentHour >= 18) {
      return false; // Fuera de horario
    }

    // Verificar si ya hubo reset hoy
    const lastReset = this.dailyResetTimestamps.get(queueId);
    if (!lastReset) {
      return true; // Nunca se ha hecho reset
    }

    const lastResetDate = new Date(lastReset);
    const lastResetPeru = new Date(lastResetDate.toLocaleString('en-US', { timeZone: 'America/Lima' }));

    // Si el último reset fue antes de las 6pm de ayer, es inicio de día
    const yesterdayEndOfDay = new Date(peruTime);
    yesterdayEndOfDay.setDate(yesterdayEndOfDay.getDate() - 1);
    yesterdayEndOfDay.setHours(18, 0, 0, 0);

    return lastResetPeru < yesterdayEndOfDay;
  }

  /**
   * Marcar que ya se hizo la asignación inicial del día
   */
  private markDailyReset(queueId: string): void {
    this.dailyResetTimestamps.set(queueId, Date.now());
  }

  /**
   * Distribuir chats de una cola específica
   */
  private async distributeQueue(queueId: string, queueName: string, distributionMode: string): Promise<void> {
    try {
      // 1. Obtener chats en cola sin asignar (OPTIMIZADO)
      // Usamos listQueuedConversations que filtra por DB (status=active, queueId=X, assignedTo=NULL)
      // Esto reduce la carga de memoria dramáticamente
      const unassignedChats = await crmDb.listQueuedConversations(queueId);

      if (unassignedChats.length === 0) {
        return; // No hay chats que distribuir
      }

      // 2. Obtener asesores disponibles en esta cola
      const queue = await adminDb.getQueueById(queueId);
      if (!queue) return;

      const availableAdvisors = await this.getAvailableAdvisorsInQueue(queue);

      if (availableAdvisors.length === 0) {
        console.log(`[QueueDistributor] ⚠️  Cola "${queueName}": ${unassignedChats.length} chats esperando, pero no hay asesores disponibles`);
        return;
      }

      console.log(`[QueueDistributor] 📊 Cola "${queueName}": ${unassignedChats.length} chats → ${availableAdvisors.length} asesores disponibles`);

      // 3. LÓGICA ESPECIAL: Si es el inicio del día Y solo hay 1 asesor disponible
      //    → Asignar TODOS los chats a ese asesor (primer asesor del día)
      if (this.isStartOfDay(queueId) && availableAdvisors.length === 1) {
        console.log(`[QueueDistributor] 🌅 Cola "${queueName}": INICIO DE DÍA - Asignando TODOS los chats al primer asesor`);
        await this.assignAllChatsToFirstAdvisor(unassignedChats, availableAdvisors[0], queueName);
        this.markDailyReset(queueId);
        return;
      }

      // 4. Distribución normal (round-robin o least-busy)
      if (distributionMode === "round-robin") {
        await this.distributeRoundRobin(unassignedChats, availableAdvisors, queueName);
      } else if (distributionMode === "least-busy") {
        await this.distributeLeastBusy(unassignedChats, availableAdvisors, queueName);
      } else {
        console.log(`[QueueDistributor] ⚠️  Cola "${queueName}" en modo manual - sin distribución automática`);
      }

    } catch (error) {
      console.error(`[QueueDistributor] ❌ Error distribuyendo cola "${queueName}":`, error);
    }
  }

  /**
   * Asignar TODOS los chats acumulados al primer asesor del día
   */
  private async assignAllChatsToFirstAdvisor(chats: any[], advisorId: string, queueName: string): Promise<void> {
    let assigned = 0;

    // Obtener nombre del asesor
    const user = await adminDb.getUserById(advisorId);
    const advisorName = user?.name || user?.username || advisorId;

    console.log(`[QueueDistributor] 🌅 PRIMER ASESOR DEL DÍA: ${advisorName} recibirá ${chats.length} chats acumulados`);

    for (const chat of chats) {
      try {
        const assignSuccess = await crmDb.assignConversation(chat.id, advisorId);

        if (!assignSuccess) {
          console.warn(`[QueueDistributor] ⚠️  Cola "${queueName}": Chat ${chat.phone} NO pudo ser asignado`);
          continue;
        }

        console.log(`[QueueDistributor] ✅ Cola "${queueName}": Chat ${chat.phone} → ${advisorName} (INICIAL)`);

        // METRICS ONLY: Detect if chat came from another advisor (Asesor → Cola → Asesor)
        if (chat.transferredFrom) {
          // Register as transfer in metrics (Trans OUT for previous, Trans IN for new)
          console.log(`[QueueDistributor METRICS] 📊 Transfer detected: ${chat.transferredFrom} → ${advisorId}`);
          await metricsTracker.transferConversation(chat.id, chat.transferredFrom, advisorId, {
            queueId: chat.queueId || null,
          });
        } else {
          // Register as new assignment in metrics
          const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          metricsTracker.startConversation(metricId, chat.id, advisorId, {
            queueId: chat.queueId || undefined,
            channelType: chat.channel as any,
            channelId: chat.channelConnectionId || undefined,
          });
        }

        // Create system message
        const timestamp = formatEventTimestamp();
        const assignMessage = await crmDb.createSystemEvent(
          chat.id,
          'conversation_assigned',
          `🌅 Asignado a ${advisorName} - PRIMER ASESOR DEL DÍA (${timestamp})`
        );

        // Emit WebSocket events
        if (this.socketManager) {
          this.socketManager.emitNewMessage({ message: assignMessage, attachment: null });

          const updated = await crmDb.getConversationById(chat.id);
          if (updated) {
            this.socketManager.emitConversationUpdate({ conversation: updated });
          }
        }

        assigned++;

      } catch (error) {
        console.error(`[QueueDistributor] ❌ Error asignando chat ${chat.id}:`, error);
      }
    }

    console.log(`[QueueDistributor] 🎯 INICIO DE DÍA - Cola "${queueName}": ${assigned}/${chats.length} chats asignados a ${advisorName}`);
  }

  /**
   * Obtener asesores disponibles en una cola
   */
  private async getAvailableAdvisorsInQueue(queue: any): Promise<string[]> {
    const advisors = queue.assignedAdvisors || [];

    const availableAdvisors: string[] = [];

    for (const advisorId of advisors) {
      // 1. Excluir supervisores (no reciben chats automáticamente)
      if (queue.supervisors && queue.supervisors.includes(advisorId)) {
        continue;
      }

      // 2. Verificar que esté online (logueado)
      if (!advisorPresence.isOnline(advisorId)) {
        continue;
      }

      // 3. NUEVO: Verificar que NO esté en estado de "redirect" (como "En Refrigerio")
      const canReceive = await this.canAdvisorReceiveChats(advisorId);
      if (!canReceive) {
        console.log(`[QueueDistributor] ⏸️  Asesor ${advisorId} está en refrigerio/pausa - no se le asignan chats`);
        continue;
      }

      // 4. Verificar que no esté en su límite de chats (futuro)
      // TODO: Implementar verificación de maxConcurrent

      availableAdvisors.push(advisorId);
    }

    return availableAdvisors;
  }

  /**
   * Verifica si un asesor puede recibir chats automáticamente
   * Retorna false si está en un estado con acción "redirect" (ej: En Refrigerio, En Capacitación, etc)
   */
  private async canAdvisorReceiveChats(advisorId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT s.action
         FROM crm_advisor_status_assignments asa
         INNER JOIN crm_advisor_statuses s ON s.id = asa.status_id
         WHERE asa.user_id = $1`,
        [advisorId]
      );

      // Si no tiene status asignado, asumimos que puede recibir chats
      if (result.rows.length === 0) {
        return true;
      }

      const action = result.rows[0].action;

      // Si el status tiene acción "redirect", NO puede recibir chats automáticos
      // Esto incluye: "En Refrigerio", "En Capacitación", "Reunión", etc.
      if (action === 'redirect') {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`[QueueDistributor] Error checking advisor status for ${advisorId}:`, error);
      // En caso de error, permitimos la asignación para no bloquear el sistema
      return true;
    }
  }

  /**
   * Distribución round-robin (equitativa)
   */
  private async distributeRoundRobin(chats: any[], advisors: string[], queueName: string): Promise<void> {
    let advisorIndex = 0;
    let assigned = 0;

    for (const chat of chats) {
      const advisorId = advisors[advisorIndex];

      try {
        // IMPORTANTE: Solo ASIGNAR (no aceptar) para que quede en categoría "POR TRABAJAR"
        // El asesor deberá presionar "Aceptar" para pasar a "TRABAJANDO"
        const assignSuccess = await crmDb.assignConversation(chat.id, advisorId);

        // CRITICAL FIX: Only continue if assignment was successful
        if (!assignSuccess) {
          console.warn(`[QueueDistributor] ⚠️  Cola "${queueName}": Chat ${chat.phone} NO pudo ser asignado (status no es 'active')`);
          continue; // Skip to next chat
        }

        // Obtener nombre del asesor
        const user = await adminDb.getUserById(advisorId);
        const advisorName = user?.name || user?.username || advisorId;

        console.log(`[QueueDistributor] ✅ Cola "${queueName}": Chat ${chat.phone} → ${advisorName} (POR TRABAJAR)`);

        // METRICS ONLY: Detect if chat came from another advisor (Asesor → Cola → Asesor)
        if (chat.transferredFrom) {
          // Register as transfer in metrics (Trans OUT for previous, Trans IN for new)
          console.log(`[QueueDistributor METRICS] 📊 Transfer detected: ${chat.transferredFrom} → ${advisorId}`);
          await metricsTracker.transferConversation(chat.id, chat.transferredFrom, advisorId, {
            queueId: chat.queueId || null,
          });
        } else {
          // Register as new assignment in metrics
          const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          metricsTracker.startConversation(metricId, chat.id, advisorId, {
            queueId: chat.queueId || undefined,
            channelType: chat.channel as any,
            channelId: chat.channelConnectionId || undefined,
          });
        }

        // Create system message for automatic assignment
        const timestamp = formatEventTimestamp();
        const assignMessage = await crmDb.createSystemEvent(
          chat.id,
          'conversation_assigned',
          `🎯 Asignado automáticamente a ${advisorName} (${timestamp})`
        );

        // Emit system message via WebSocket
        if (this.socketManager) {
          this.socketManager.emitNewMessage({ message: assignMessage, attachment: null });

          // Emit conversation update
          const updated = await crmDb.getConversationById(chat.id);
          if (updated) {
            this.socketManager.emitConversationUpdate({ conversation: updated });
          }
        }

        assigned++;

        // Siguiente asesor (round-robin)
        advisorIndex = (advisorIndex + 1) % advisors.length;

      } catch (error) {
        console.error(`[QueueDistributor] ❌ Error asignando chat ${chat.id}:`, error);
      }
    }

    if (assigned > 0) {
      console.log(`[QueueDistributor] 🎯 Cola "${queueName}": ${assigned}/${chats.length} chats distribuidos`);
    }
  }

  /**
   * Distribución least-busy (al menos ocupado)
   */
  private async distributeLeastBusy(chats: any[], advisors: string[], queueName: string): Promise<void> {
    let assigned = 0;

    for (const chat of chats) {
      try {
        // Contar chats activos por asesor
        const allConversations = await crmDb.listConversations();
        const advisorChatCounts = advisors.map(advisorId => ({
          advisorId,
          count: allConversations.filter(conv =>
            conv.assignedTo === advisorId &&
            (conv.status === "active" || conv.status === "attending")
          ).length
        }));

        // Ordenar por cantidad (ascendente) y tomar el menos ocupado
        advisorChatCounts.sort((a, b) => a.count - b.count);
        const leastBusyAdvisorId = advisorChatCounts[0].advisorId;

        // IMPORTANTE: Solo ASIGNAR (no aceptar) para que quede en categoría "POR TRABAJAR"
        // El asesor deberá presionar "Aceptar" para pasar a "TRABAJANDO"
        const assignSuccess = await crmDb.assignConversation(chat.id, leastBusyAdvisorId);

        // CRITICAL FIX: Only continue if assignment was successful
        if (!assignSuccess) {
          console.warn(`[QueueDistributor] ⚠️  Cola "${queueName}": Chat ${chat.phone} NO pudo ser asignado (status no es 'active')`);
          continue; // Skip to next chat
        }

        // Obtener nombre del asesor
        const user = await adminDb.getUserById(leastBusyAdvisorId);
        const advisorName = user?.name || user?.username || leastBusyAdvisorId;

        console.log(`[QueueDistributor] ✅ Cola "${queueName}": Chat ${chat.phone} → ${advisorName} (${advisorChatCounts[0].count} chats) (POR TRABAJAR)`);

        // METRICS ONLY: Detect if chat came from another advisor (Asesor → Cola → Asesor)
        if (chat.transferredFrom) {
          // Register as transfer in metrics (Trans OUT for previous, Trans IN for new)
          console.log(`[QueueDistributor METRICS] 📊 Transfer detected: ${chat.transferredFrom} → ${leastBusyAdvisorId}`);
          await metricsTracker.transferConversation(chat.id, chat.transferredFrom, leastBusyAdvisorId, {
            queueId: chat.queueId || null,
          });
        } else {
          // Register as new assignment in metrics
          const metricId = `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          metricsTracker.startConversation(metricId, chat.id, leastBusyAdvisorId, {
            queueId: chat.queueId || undefined,
            channelType: chat.channel as any,
            channelId: chat.channelConnectionId || undefined,
          });
        }

        // Create system message for automatic assignment
        const timestamp = formatEventTimestamp();
        const assignMessage = await crmDb.createSystemEvent(
          chat.id,
          'conversation_assigned',
          `🎯 Asignado automáticamente a ${advisorName} (${timestamp})`
        );

        // Emit system message via WebSocket
        if (this.socketManager) {
          this.socketManager.emitNewMessage({ message: assignMessage, attachment: null });

          // Emit conversation update
          const updated = await crmDb.getConversationById(chat.id);
          if (updated) {
            this.socketManager.emitConversationUpdate({ conversation: updated });
          }
        }

        assigned++;

      } catch (error) {
        console.error(`[QueueDistributor] ❌ Error asignando chat ${chat.id}:`, error);
      }
    }

    if (assigned > 0) {
      console.log(`[QueueDistributor] 🎯 Cola "${queueName}": ${assigned}/${chats.length} chats distribuidos`);
    }
  }

  /**
   * Estado actual del distribuidor
   */
  getStatus(): { active: boolean; isRunning: boolean } {
    return {
      active: this.intervalId !== null,
      isRunning: this.isRunning,
    };
  }
}
