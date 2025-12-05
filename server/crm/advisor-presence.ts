/**
 * Advisor Presence Tracker
 *
 * Tracks real-time online/offline status of advisors
 * Integrates with WebSocket and session management
 */

import { crmDb } from "./db";
import { adminDb } from "../admin-db";
import { sessionsStorageDB } from "./sessions-db";
import pg from 'pg';

const { Pool } = pg;

export interface AdvisorPresence {
  userId: string;
  isOnline: boolean;
  lastSeen: number;
  sessionId?: string;
  connectedAt?: number;
  activeConnections: number; // Track number of active WebSocket connections
}

export class AdvisorPresenceTracker {
  private pool: Pool;
  private sessionToUser = new Map<string, string>(); // sessionId -> userId mapping (in-memory for performance)
  private offlineTimeouts = new Map<string, NodeJS.Timeout>(); // Delayed offline marking
  private onlineCache = new Map<string, boolean>(); // In-memory cache for fast isOnline() checks

  constructor() {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      password: process.env.POSTGRES_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Sync cache from PostgreSQL every 5 seconds
    setInterval(() => {
      this.syncCacheFromPostgres().catch(err =>
        console.error('[AdvisorPresence] Error syncing cache:', err)
      );
    }, 5000);

    // 🐛 BUG FIX: Clean up ghost connections every 60 seconds
    // If a user is marked as online but hasn't been seen for 10+ minutes, mark them offline
    setInterval(() => {
      this.cleanupGhostConnections().catch(err =>
        console.error('[AdvisorPresence] Error cleaning up ghost connections:', err)
      );
    }, 60000); // Run every 60 seconds
  }

  /**
   * 🐛 BUG FIX: Clean up ghost connections
   * Users marked as online but without activity for 10+ minutes are marked offline
   */
  private async cleanupGhostConnections(): Promise<void> {
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000); // 10 minutes

    try {
      const result = await this.pool.query(
        `UPDATE advisor_presence
         SET is_online = FALSE, active_connections = 0, session_id = NULL, connected_at = NULL
         WHERE is_online = TRUE AND last_seen < $1
         RETURNING user_id`,
        [tenMinutesAgo]
      );

      if (result.rows.length > 0) {
        console.log(`[AdvisorPresence] 🧹 Cleaned up ${result.rows.length} ghost connection(s):`,
          result.rows.map(r => r.user_id).join(', '));

        // Update cache and emit presence updates
        for (const row of result.rows) {
          this.updateCache(row.user_id, false);
          this.emitPresenceUpdate(row.user_id);
        }
      }
    } catch (error) {
      console.error('[AdvisorPresence] Error cleaning up ghost connections:', error);
    }
  }

  /**
   * Sync in-memory cache from PostgreSQL
   */
  private async syncCacheFromPostgres(): Promise<void> {
    try {
      const result = await this.pool.query(
        `SELECT user_id, is_online FROM advisor_presence`
      );

      this.onlineCache.clear();
      for(const row of result.rows) {
        this.onlineCache.set(row.user_id, row.is_online);
      }
    } catch (error) {
      console.error('[AdvisorPresence] Error syncing cache from PostgreSQL:', error);
    }
  }

  /**
   * Update cache after changing presence
   */
  private updateCache(userId: string, isOnline: boolean): void {
    this.onlineCache.set(userId, isOnline);
  }

  /**
   * Initialize presence for all known advisors (set them as offline)
   * Call this on server startup
   */
   async initializeAdvisors(userIds: string[]): void {
    const now = Date.now();
    for(const userId of userIds) {
      try {
        await this.pool.query(
          `INSERT INTO advisor_presence (user_id, is_online, last_seen, active_connections)
           VALUES ($1, FALSE, $2, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId, now]
        );
      } catch (error) {
        console.error(`[AdvisorPresence] Error initializing advisor ${userId}:`, error);
      }
    }
    console.log(`[AdvisorPresence] Initialized ${userIds.length} advisors in PostgreSQL`);
  }

  /**
   * Mark advisor as online when they login or connect via WebSocket
   * Increments active connections counter
   */
   async markOnline(userId: string, sessionId?: string): void {
    console.log(`[AdvisorPresence] 🔵 ${userId} coming online - sessionId: ${sessionId?.substring(0, 10)}...`);

    const now = Date.now();

    // Get current presence from PostgreSQL
    const result = await this.pool.query(
      `SELECT * FROM advisor_presence WHERE user_id = $1`,
      [userId]
    );

    const existing = result.rows.length > 0 ? {
      userId: result.rows[0].user_id,
      isOnline: result.rows[0].is_online,
      lastSeen: parseInt(result.rows[0].last_seen),
      sessionId: result.rows[0].session_id,
      connectedAt: result.rows[0].connected_at ? parseInt(result.rows[0].connected_at) : null,
      activeConnections: parseInt(result.rows[0].active_connections) || 0,
    } : null;

    const wasOffline = !existing || !existing.isOnline;

    // Cancel any pending offline timeout (in case of reconnection)
    const timeout = this.offlineTimeouts.get(userId);
    if(timeout) {
      clearTimeout(timeout);
      this.offlineTimeouts.delete(userId);
      console.log(`[AdvisorPresence] ✅ ${userId} reconnected - offline timeout cancelled`);
    }

    const newActiveConnections = (existing?.activeConnections || 0) + 1;
    const connectedAt = existing?.connectedAt || now;

    // Update presence in PostgreSQL
    await this.pool.query(
      `INSERT INTO advisor_presence (user_id, is_online, last_seen, session_id, connected_at, active_connections)
       VALUES ($1, TRUE, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         is_online = TRUE,
         last_seen = $2,
         session_id = $3,
         connected_at = COALESCE(advisor_presence.connected_at, $4),
         active_connections = advisor_presence.active_connections + 1`,
      [userId, now, sessionId, connectedAt, newActiveConnections]
    );

    if(sessionId) {
      this.sessionToUser.set(sessionId, userId);
    }

    console.log(`[AdvisorPresence] ✅ ${userId} is now ONLINE (${newActiveConnections} connections)`);

    // Update cache
    this.updateCache(userId, true);

    // CRITICAL: Emit presence update to all clients
    this.emitPresenceUpdate(userId);

    // CRITICAL: Assign queue chats when advisor goes from offline to online
    if(wasOffline) {
      console.log(`[AdvisorPresence] 🔄 ${userId} came online - triggering event-driven assignment`);
      // Use setTimeout to avoid blocking the connection
      setTimeout(async () => {
        try {
          const { getQueueAssignmentService } = await import('./queue-assignment-service');
          const assignmentService = getQueueAssignmentService();
          await assignmentService.onAdvisorOnline(userId);
        } catch (error) {
          console.error(`[AdvisorPresence] Error triggering onAdvisorOnline for ${userId}:`, error);
        }
      }, 1000);
    }
  }

  /**
   * Mark advisor as offline when they logout or disconnect
   * Decrements active connections counter - uses 5s delay before marking offline
   * This prevents flickering during page refreshes
   */
   async markOffline(userId: string, immediate: boolean = false): Promise<void> {
    const now = Date.now();

    // Get current presence from PostgreSQL
    const result = await this.pool.query(
      `SELECT * FROM advisor_presence WHERE user_id = $1`,
      [userId]
    );

    if(result.rows.length === 0) {
      console.warn(`[AdvisorPresence] ⚠️ ${userId} not found in presence table`);
      return;
    }

    const current = {
      userId: result.rows[0].user_id,
      isOnline: result.rows[0].is_online,
      lastSeen: parseInt(result.rows[0].last_seen),
      sessionId: result.rows[0].session_id,
      connectedAt: result.rows[0].connected_at ? parseInt(result.rows[0].connected_at) : null,
      activeConnections: parseInt(result.rows[0].active_connections) || 0,
    };

    // 🐛 BUG FIX: When immediate=true (manual logout), ALWAYS mark offline
    // Don't just decrement - the user explicitly logged out
    if (immediate) {
      console.log(`[AdvisorPresence] 🔴 ${userId} logging out - marking offline immediately (was ${current.activeConnections} connections)`);

      await this.pool.query(
        `UPDATE advisor_presence
         SET is_online = FALSE, last_seen = $1, session_id = NULL, connected_at = NULL, active_connections = 0
         WHERE user_id = $2`,
        [now, userId]
      );

      // Remove session mapping
      if (current.sessionId) {
        this.sessionToUser.delete(current.sessionId);
      }

      // Cancel any pending timeout
      const existingTimeout = this.offlineTimeouts.get(userId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.offlineTimeouts.delete(userId);
      }

      // Update cache
      this.updateCache(userId, false);

      // Emit presence update immediately
      this.emitPresenceUpdate(userId);

      // Close all open database sessions for this advisor
      console.log(`[AdvisorPresence] 🔒 Closing all open sessions for ${userId}`);
      this.closeAdvisorSessions(userId).catch(error => {
        console.error(`[AdvisorPresence] ❌ Error closing sessions for ${userId}:`, error);
      });

      // POR TRABAJAR (active) → vuelven a cola para otros asesores
      // TRABAJANDO (attending) → se quedan con el asesor hasta que vuelva
      console.log(`[AdvisorPresence] 🔄 LOGOUT - POR TRABAJAR van a cola, TRABAJANDO quedan con asesor`);
      this.returnActiveChatsToQueue(userId).catch(error => {
        console.error(`[AdvisorPresence] ❌ Error returning active chats to queue for ${userId}:`, error);
      });

      return; // Exit early - we're done
    }

    // Normal flow for WebSocket disconnections (not manual logout)
    const newConnectionCount = Math.max(0, current.activeConnections - 1);
    const shouldScheduleOffline = newConnectionCount === 0;

    // Update connection count immediately in PostgreSQL
    await this.pool.query(
      `UPDATE advisor_presence
       SET active_connections = $1, last_seen = $2
       WHERE user_id = $3`,
      [newConnectionCount, now, userId]
    );

    if(shouldScheduleOffline) {
      // All WebSocket connections closed - schedule offline after 5 second delay
      // This prevents flickering during page refreshes
      console.log(`[AdvisorPresence] ⚠️ ${userId} all connections closed - scheduling offline in 5s...`);

      // Cancel any existing timeout
      const existingTimeout = this.offlineTimeouts.get(userId);
      if(existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Schedule offline marking after 5 seconds (gives time for reconnection)
      const timeout = setTimeout(async () => {
        // Re-fetch to check if reconnected
        const checkResult = await this.pool.query(
          `SELECT active_connections, session_id FROM advisor_presence WHERE user_id = $1`,
          [userId]
        );

        if(checkResult.rows.length === 0) return;

        const latest = {
          activeConnections: parseInt(checkResult.rows[0].active_connections) || 0,
          sessionId: checkResult.rows[0].session_id,
        };

        // Double-check: only mark offline if still at 0 connections
        if(latest.activeConnections === 0) {
          await this.pool.query(
            `UPDATE advisor_presence
             SET is_online = FALSE, session_id = NULL, connected_at = NULL
             WHERE user_id = $1`,
            [userId]
          );

          // Remove session mapping
          if(latest.sessionId) {
            this.sessionToUser.delete(latest.sessionId);
          }

          this.offlineTimeouts.delete(userId);
          console.log(`[AdvisorPresence] 🔴 ${userId} is now OFFLINE (timeout expired, no reconnection)`);

          // Update cache
          this.updateCache(userId, false);

          // CRITICAL FIX: Emit presence update after marking offline
          this.emitPresenceUpdate(userId);

          // 🐛 BUG FIX #1: Close all open database sessions for this advisor
          console.log(`[AdvisorPresence] 🔒 Closing all open sessions for ${userId} (timeout)`);
          this.closeAdvisorSessions(userId).catch(error => {
            console.error(`[AdvisorPresence] ❌ Error closing sessions for ${userId}:`, error);
          });

          // POR TRABAJAR (active) → vuelven a cola para otros asesores
          // TRABAJANDO (attending) → se quedan con el asesor hasta que vuelva
          console.log(`[AdvisorPresence] 🔄 OFFLINE - POR TRABAJAR van a cola, TRABAJANDO quedan con asesor`);
          this.returnActiveChatsToQueue(userId).catch(error => {
            console.error(`[AdvisorPresence] ❌ Error returning active chats to queue for ${userId}:`, error);
          });
        } else {
          console.log(`[AdvisorPresence] ✅ ${userId} reconnected before timeout - staying ONLINE`);
          this.offlineTimeouts.delete(userId);
        }
      }, 5000); // 5 second grace period

      this.offlineTimeouts.set(userId, timeout);
    } else {
      console.log(`[AdvisorPresence] ⚠️ ${userId} connection closed (${newConnectionCount} remaining)`);
    }
  }

  /**
   * Mark advisor as offline by session ID (for WebSocket disconnections)
   */
   async markOfflineBySession(sessionId: string): void {
    const userId = this.sessionToUser.get(sessionId);
    if(userId) {
      this.markOffline(userId);
    }
  }

  /**
   * Update last seen timestamp (heartbeat)
   * 🐛 BUG FIX: Updated to use PostgreSQL instead of in-memory cache
   */
  async updateLastSeen(userId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE advisor_presence SET last_seen = $1 WHERE user_id = $2 AND is_online = TRUE`,
        [Date.now(), userId]
      );
    } catch (error) {
      console.error(`[AdvisorPresence] Error updating last_seen for ${userId}:`, error);
    }
  }

  /**
   * Check if advisor is online
   * Uses in-memory cache for fast synchronous access
   * Cache is synced from PostgreSQL every 5 seconds
   */
   isOnline(userId: string): boolean {
    return this.onlineCache.get(userId) ?? false;
  }

  /**
   * Get presence info for a specific advisor
   */
   async getPresence(userId: string): Promise<AdvisorPresence | null> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM advisor_presence WHERE user_id = $1`,
        [userId]
      );

      if(result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        userId: row.user_id,
        isOnline: row.is_online,
        lastSeen: parseInt(row.last_seen),
        sessionId: row.session_id,
        connectedAt: row.connected_at ? parseInt(row.connected_at) : undefined,
        activeConnections: parseInt(row.active_connections) || 0,
      };
    } catch (error) {
      console.error(`[AdvisorPresence] Error getting presence for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Get all advisors presence (for dashboard)
   */
   async getAllPresence(): Promise<AdvisorPresence[]> {
    try {
      const result = await this.pool.query(`SELECT * FROM advisor_presence`);

      return result.rows.map(row => ({
        userId: row.user_id,
        isOnline: row.is_online,
        lastSeen: parseInt(row.last_seen),
        sessionId: row.session_id,
        connectedAt: row.connected_at ? parseInt(row.connected_at) : undefined,
        activeConnections: parseInt(row.active_connections) || 0,
      }));
    } catch (error) {
      console.error('[AdvisorPresence] Error getting all presence:', error);
      return [];
    }
  }

  /**
   * Get only online advisors
   */
   async getOnlineAdvisors(): Promise<AdvisorPresence[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM advisor_presence WHERE is_online = TRUE`
      );

      return result.rows.map(row => ({
        userId: row.user_id,
        isOnline: row.is_online,
        lastSeen: parseInt(row.last_seen),
        sessionId: row.session_id,
        connectedAt: row.connected_at ? parseInt(row.connected_at) : undefined,
        activeConnections: parseInt(row.active_connections) || 0,
      }));
    } catch (error) {
      console.error('[AdvisorPresence] Error getting online advisors:', error);
      return [];
    }
  }

  /**
   * Get count of online advisors
   */
   async getOnlineCount(): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM advisor_presence WHERE is_online = TRUE`
      );
      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      console.error('[AdvisorPresence] Error getting online count:', error);
      return 0;
    }
  }

  /**
   * Clean up stale presence (advisors offline for more than X time)
   */
   async cleanupStale(maxOfflineMs: number = 24 * 60 * 60 * 1000): void {
    const cutoffTime = Date.now() - maxOfflineMs;

    try {
      const result = await this.pool.query(
        `DELETE FROM advisor_presence
         WHERE is_online = FALSE AND last_seen < $1
         RETURNING user_id`,
        [cutoffTime]
      );

      if(result.rows.length > 0) {
        console.log(`[AdvisorPresence] 🗑️  Cleaned up ${result.rows.length} stale presence records`);
      }
    } catch (error) {
      console.error('[AdvisorPresence] Error cleaning up stale presence:', error);
    }
  }

  /**
   * Get statistics
   */
   async getStats() {
    try {
      const result = await this.pool.query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_online = TRUE) as online,
          COUNT(*) FILTER (WHERE is_online = FALSE) as offline
         FROM advisor_presence`
      );

      const row = result.rows[0];

      return {
        total: parseInt(row.total) || 0,
        online: parseInt(row.online) || 0,
        offline: parseInt(row.offline) || 0,
        sessions: this.sessionToUser.size,
      };
    } catch (error) {
      console.error('[AdvisorPresence] Error getting stats:', error);
      return {
        total: 0,
        online: 0,
        offline: 0,
        sessions: this.sessionToUser.size,
      };
    }
  }

  /**
   * Redistribute queue chats when an advisor comes online
   * This ensures chats assigned to offline advisors get reassigned to online ones
   */
  async redistributeQueueChats(userId: string): Promise<void> {
    console.log(`[QueueRedistribution] 🔄 Starting redistribution for ${userId}`);

    try {
      // 1. Get all queues where this advisor is assigned
      const allQueues = await adminDb.getAllQueues();
      const advisorQueues = allQueues.filter(queue =>
        queue.status === "active" &&
        queue.assignedAdvisors.includes(userId)
      );

      if(advisorQueues.length === 0) {
        console.log(`[QueueRedistribution] ⚠️  ${userId} is not assigned to any active queues`);
        return;
      }

      console.log(`[QueueRedistribution] 📋 ${userId} is in ${advisorQueues.length} queue(s): ${advisorQueues.map(q => q.name).join(", ")}`);

      // 2. For each queue, redistribute chats
      for(const queue of advisorQueues) {
        await this.redistributeQueueChatsForQueue(queue.id, queue.name);
      }

    } catch (error) {
      console.error(`[QueueRedistribution] ❌ Error redistributing chats for ${userId}:`, error);
    }
  }

  /**
   * Redistribute chats for a specific queue
   */
  private async redistributeQueueChatsForQueue(queueId: string, queueName: string): Promise<void> {
    try {
      const queue = await adminDb.getQueueById(queueId);
      if(!queue || queue.status !== "active") {
        return;
      }

      // 1. Get all conversations in this queue
      const allConversations = await crmDb.listConversations();
      const queueConversations = allConversations.filter(conv =>
        conv.queueId === queueId &&
        conv.status === "active"
      );

      if(queueConversations.length === 0) {
        console.log(`[QueueRedistribution] ✅ Queue "${queueName}" has no active conversations`);
        return;
      }

      // 2. Get online advisors in this queue (excluding supervisors)
      const onlineAdvisorsInQueue = queue.assignedAdvisors.filter(advisorId => {
        // Only include if advisor is online
        if (!this.isOnline(advisorId)) return false;

        // Exclude if advisor is in supervisors list (supervisors don't receive chats)
        if (queue.supervisors && queue.supervisors.includes(advisorId)) return false;

        // Also exclude by role - supervisors, admins, gerencia don't receive chats
        const user = adminDb.getUserById(advisorId);
        if (user && (user.role === 'supervisor' || user.role === 'admin' || user.role === 'gerencia')) {
          return false;
        }

        return true;
      });

      if(onlineAdvisorsInQueue.length === 0) {
        console.log(`[QueueRedistribution] ⚠️  Queue "${queueName}" has no online advisors - keeping chats in queue`);
        return;
      }

      console.log(`[QueueRedistribution] 📊 Queue "${queueName}": ${queueConversations.length} chats, ${onlineAdvisorsInQueue.length} online advisors`);

      // 3. Get chats that need redistribution (ONLY unassigned chats)
      // CRITICAL: Never redistribute chats already assigned to advisors (even if offline)
      // Those chats stay with their advisor until they close them or come back online
      const chatsToRedistribute = queueConversations.filter(conv => !conv.assignedTo);

      if(chatsToRedistribute.length === 0) {
        console.log(`[QueueRedistribution] ✅ Queue "${queueName}" - all chats already assigned to online advisors`);
        return;
      }

      console.log(`[QueueRedistribution] 🔄 Redistributing ${chatsToRedistribute.length} chats in queue "${queueName}"`);

      // 4. Redistribute based on queue distribution mode
      if(queue.distributionMode === "round-robin") {
        await this.redistributeRoundRobin(chatsToRedistribute, onlineAdvisorsInQueue, queueName);
      } else if (queue.distributionMode === "least-busy") {
        await this.redistributeLeastBusy(chatsToRedistribute, onlineAdvisorsInQueue, queueName);
      } else {
        // Manual mode - don't auto-redistribute
        console.log(`[QueueRedistribution] ⚠️  Queue "${queueName}" is in manual mode - skipping redistribution`);
      }

    } catch (error) {
      console.error(`[QueueRedistribution] ❌ Error redistributing queue "${queueName}":`, error);
    }
  }

  /**
   * Distribute ONLY unassigned chats to advisors with fewer active chats
   * NEVER removes chats from advisors who already have them
   */
  private async redistributeRoundRobin(chats: any[], advisors: string[], queueName: string): Promise<void> {
    console.log(`[QueueRedistribution] 🔄 Starting distribution for queue "${queueName}"`);

    // Only distribute chats that are NOT assigned yet (assignedTo === null)
    const unassignedChats = chats.filter(chat => !chat.assignedTo);

    if(unassignedChats.length === 0) {
      console.log(`[QueueRedistribution] ✅ No unassigned chats to distribute in queue "${queueName}"`);
      return;
    }

    console.log(`[QueueRedistribution] 📊 Unassigned chats to distribute: ${unassignedChats.length}`);
    console.log(`[QueueRedistribution] 📊 Online advisors: ${advisors.length}`);

    // Get current chat counts for each advisor (to know who has less)
    const allConversations = await crmDb.listConversations();
    const advisorChatCounts = advisors.map(advisorId => ({
      advisorId,
      count: allConversations.filter(conv =>
        conv.assignedTo === advisorId &&
        (conv.status === "active" || conv.status === "attending")
      ).length
    }));

    // Sort by count (ascending) - advisors with fewer chats first
    advisorChatCounts.sort((a, b) => a.count - b.count);

    console.log(`[QueueRedistribution] 📊 Current load:`, advisorChatCounts.map(a => `${a.advisorId}: ${a.count} chats`).join(', '));

    let distributed = 0;

    // Distribute each unassigned chat to the advisor with LEAST chats
    for(const chat of unassignedChats) {
      // Always pick the advisor with fewest chats (re-sort after each assignment)
      advisorChatCounts.sort((a, b) => a.count - b.count);
      const targetAdvisor = advisorChatCounts[0].advisorId;

      try {
        await crmDb.assignConversation(chat.id, targetAdvisor);
        console.log(`[QueueRedistribution] ✅ Assigned chat ${chat.id} to ${targetAdvisor} (now has ${advisorChatCounts[0].count + 1} chats)`);
        distributed++;

        // Update count for this advisor
        advisorChatCounts[0].count++;
      } catch (error) {
        console.error(`[QueueRedistribution] ❌ Failed to assign chat ${chat.id}:`, error);
      }
    }

    const finalDistribution = advisors.map(adv => ({
      advisor: adv,
      count: advisorChatCounts.find(a => a.advisorId === adv)?.count || 0
    }));

    console.log(`[QueueRedistribution] ✅ Distribution complete: ${distributed}/${unassignedChats.length} chats assigned`);
    console.log(`[QueueRedistribution] 📊 Final load:`, finalDistribution.map(a => `${a.advisor}: ${a.count} chats`).join(', '));
  }

  /**
   * Redistribute using least-busy (assign to advisor with fewest active chats)
   */
  private async redistributeLeastBusy(chats: any[], advisors: string[], queueName: string): Promise<void> {
    let redistributed = 0;

    for(const chat of chats) {
      // Count active chats for each advisor
      const allConversations = await crmDb.listConversations();
      const advisorChatCounts = advisors.map(advisorId => ({
        advisorId,
        count: allConversations.filter(conv =>
          conv.assignedTo === advisorId &&
          (conv.status === "active" || conv.status === "attending")
        ).length
      }));

      // Sort by count (ascending) and pick the advisor with fewest chats
      advisorChatCounts.sort((a, b) => a.count - b.count);
      const leastBusyAdvisor = advisorChatCounts[0].advisorId;

      try {
        await crmDb.assignConversation(chat.id, leastBusyAdvisor);
        console.log(`[QueueRedistribution] ✅ Assigned chat ${chat.id} to ${leastBusyAdvisor} (least busy with ${advisorChatCounts[0].count} chats)`);
        redistributed++;
      } catch (error) {
        console.error(`[QueueRedistribution] ❌ Failed to assign chat ${chat.id}:`, error);
      }
    }

    console.log(`[QueueRedistribution] ✅ Least-busy: Redistributed ${redistributed}/${chats.length} chats in queue "${queueName}"`);
  }

  /**
   * Return chats in 'active' status back to queue when advisor goes offline
   * Only affects chats that haven't been accepted yet (status='active')
   * Chats that are being worked on (status='attending') stay with the advisor
   */
  private async returnActiveChatsToQueue(userId: string): Promise<void> {
    try {
      console.log(`[AdvisorPresence] 🔄 Returning active chats to queue for offline advisor ${userId}`);

      // Get all conversations assigned to this advisor
      const allConversations = await crmDb.listConversations();
      const advisorChats = allConversations.filter(conv => conv.assignedTo === userId);

      if (advisorChats.length === 0) {
        console.log(`[AdvisorPresence] ✅ No chats assigned to ${userId}`);
        return;
      }

      // Separate chats by status
      const activeChats = advisorChats.filter(conv => conv.status === 'active');
      const attendingChats = advisorChats.filter(conv => conv.status === 'attending');

      console.log(`[AdvisorPresence] 📊 ${userId} has ${activeChats.length} active chats (will return to queue) and ${attendingChats.length} attending chats (will stay with advisor)`);

      // Return only 'active' chats to queue
      for (const chat of activeChats) {
        try {
          await crmDb.updateConversationMeta(chat.id, {
            assignedTo: null,  // Clear assignment
            assignedAt: null   // Clear assignment timestamp
            // status stays as 'active' - no need to change
          });
          console.log(`[AdvisorPresence] ✅ Returned chat ${chat.id} (${chat.phone}) to queue ${chat.queueId}`);
        } catch (error) {
          console.error(`[AdvisorPresence] ❌ Failed to return chat ${chat.id} to queue:`, error);
        }
      }

      if (activeChats.length > 0) {
        console.log(`[AdvisorPresence] ✅ Returned ${activeChats.length} active chats to queue for ${userId}`);
      }
      if (attendingChats.length > 0) {
        console.log(`[AdvisorPresence] 📌 Kept ${attendingChats.length} attending chats with ${userId} (will see them when they return)`);
      }

    } catch (error) {
      console.error(`[AdvisorPresence] ❌ Error in returnActiveChatsToQueue for ${userId}:`, error);
    }
  }

  /**
   * 🐛 BUG FIX #4: Return ALL chats (both active and attending) to queue
   * Used when advisor changes ESTADO (manual status change)
   * Unlike returnActiveChatsToQueue, this returns TRABAJANDO chats too
   */
  async returnAllChatsToQueue(userId: string): Promise<void> {
    try {
      console.log(`[AdvisorPresence] 🔄 Returning ALL chats to queue for ${userId} (status change)`);

      // Get all conversations assigned to this advisor
      const allConversations = await crmDb.listConversations();
      const advisorChats = allConversations.filter(conv => conv.assignedTo === userId);

      if (advisorChats.length === 0) {
        console.log(`[AdvisorPresence] ✅ No chats assigned to ${userId}`);
        return;
      }

      // Separate chats by status for logging
      const activeChats = advisorChats.filter(conv => conv.status === 'active');
      const attendingChats = advisorChats.filter(conv => conv.status === 'attending');

      console.log(`[AdvisorPresence] 📊 ${userId} has ${activeChats.length} POR_TRABAJAR + ${attendingChats.length} TRABAJANDO = ${advisorChats.length} total chats (returning ALL to queue)`);

      // Return ALL chats to queue (both active AND attending)
      let returned = 0;
      for (const chat of advisorChats) {
        // Only return chats that are still active or attending
        if (chat.status === 'active' || chat.status === 'attending') {
          try {
            await crmDb.updateConversationMeta(chat.id, {
              assignedTo: null,  // Clear assignment
              assignedAt: null,  // Clear assignment timestamp
              status: 'active'   // 🐛 FIX: Change status to active (was staying as 'attending')
            });
            console.log(`[AdvisorPresence] ✅ Returned chat ${chat.id} (${chat.phone}) [${chat.status}→active] to queue ${chat.queueId}`);
            returned++;
          } catch (error) {
            console.error(`[AdvisorPresence] ❌ Failed to return chat ${chat.id} to queue:`, error);
          }
        }
      }

      console.log(`[AdvisorPresence] ✅ Returned ${returned} chat(s) to queue for ${userId} (status change)`);

    } catch (error) {
      console.error(`[AdvisorPresence] ❌ Error in returnAllChatsToQueue for ${userId}:`, error);
    }
  }

  /**
   * 🐛 BUG FIX #1: Close all open database sessions for an advisor
   * This prevents accumulating unclosed sessions in the database
   */
  private async closeAdvisorSessions(userId: string): Promise<void> {
    try {
      // Get all sessions for this advisor
      const allSessions = await sessionsStorageDB.getAdvisorSessions(userId);

      // Filter for sessions that are still open (endTime IS NULL)
      const openSessions = allSessions.filter(session => session.endTime === null);

      if (openSessions.length === 0) {
        console.log(`[AdvisorPresence] ✅ ${userId} has no open sessions to close`);
        return;
      }

      console.log(`[AdvisorPresence] 🔒 Found ${openSessions.length} open session(s) for ${userId} - closing them...`);

      // Close each open session
      let closed = 0;
      for (const session of openSessions) {
        try {
          await sessionsStorageDB.endSession(session.id);
          closed++;
        } catch (error) {
          console.error(`[AdvisorPresence] ❌ Failed to close session ${session.id}:`, error);
        }
      }

      console.log(`[AdvisorPresence] ✅ Closed ${closed}/${openSessions.length} session(s) for ${userId}`);

    } catch (error) {
      console.error(`[AdvisorPresence] ❌ Error in closeAdvisorSessions for ${userId}:`, error);
    }
  }

  /**
   * Emit presence update via WebSocket
   * This is called after presence changes to notify all connected clients
   */
  private async emitPresenceUpdate(userId: string): Promise<void> {
    try {
      // Import getCrmGateway lazily to avoid circular dependency (using ES dynamic import)
      const { getCrmGateway, buildPresencePayload } = await import("./ws");
      const gateway = getCrmGateway();

      if (gateway) {
        // Build and emit presence payload asynchronously
        const payload = await buildPresencePayload(userId);
        if (payload) {
          gateway.emitAdvisorPresenceUpdate(payload);
          console.log(`[AdvisorPresence] 📡 Emitted presence update for ${userId}`);
        }
      } else {
        console.warn(`[AdvisorPresence] ⚠️ Cannot emit presence update - WebSocket gateway not available`);
      }
    } catch (error: any) {
      console.error(`[AdvisorPresence] ❌ Error emitting presence update for ${userId}:`, error);
    }
  }
}

// Singleton instance
export const advisorPresence = new AdvisorPresenceTracker();
