import { randomUUID } from "crypto";
import type { Server } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { crmDb } from "./db";
import type { CRMEmitConversation, CRMEmitMessage } from "./models";
import { botLogger } from "../../src/runtime/monitoring";
import { verifyToken } from "../auth/jwt";
import { advisorPresence } from "./advisor-presence";
import { adminDb } from "../admin-db";

/**
 * Helper function to build complete presence payload with user info, status, and active conversations
 * EXPORTED for use in admin routes
 */
export async function buildPresencePayload(userId: string): Promise<any | null> {
  try {
    // Get user info
    const user = await adminDb.getUserById(userId);
     if(!user) {
      botLogger.warn(`[CRM WS] buildPresencePayload: User ${userId} not found`);
      return null;
    }

    // Get advisor status
    const assignment = await adminDb.getAdvisorStatus(userId);
    const status = assignment?.status || null;

    // Count active conversations
    const allConversations = await crmDb.listConversations();
    const activeConversations = allConversations.filter(
      conv => conv.assignedTo === userId && conv.status === "attending"
    ).length;

    // Get online status from presence tracker
    const isOnline = advisorPresence.isOnline(userId);

    return {
      userId,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role
      },
      status,
      isOnline,
      activeConversations
    };
  } catch (error) {
    botLogger.error(`[CRM WS] Error building presence payload for ${userId}:`, error);
    return null;
  }
}

const WS_PATH = "/api/crm/ws";
const HEARTBEAT_INTERVAL = 120_000; // 2 minutes - more tolerant for browsers in background
const MAX_FRAME_SIZE = 2 * 1024 * 1024; // 2MB

const allowedOrigins = (process.env.CRM_WS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

async function isOriginAllowed(originHeader: string | undefined): boolean {
  // Reject if no origin header provided
   if(!originHeader) {
    console.warn('[CRM WS] Connection rejected: No origin header');
    return false;
  }

  // If no allowed origins configured, warn but allow (backward compatibility for development)
   if(allowedOrigins.length === 0) {
    console.warn('[CRM WS] CRM_WS_ALLOWED_ORIGINS not configured. This is insecure in production!');
    // In production, require configuration
     if(process.env.NODE_ENV === 'production') {
      console.error('[CRM WS] Connection rejected: CRM_WS_ALLOWED_ORIGINS must be set in production');
      return false;
    }
    return true; // Allow in development only
  }

  // Check if origin is in whitelist
  const trimmedOrigin = originHeader.trim();
  const allowed = allowedOrigins.includes(trimmedOrigin);

   if(!allowed) {
    console.warn(`[CRM WS] Connection rejected: Origin '${trimmedOrigin}' not in whitelist: ${allowedOrigins.join(', ')}`);
  }

  return allowed;
}

interface ClientContext {
  id: string;
  socket: WebSocket;
  isAlive: boolean;
  userId?: string; // Set after authentication
}

interface IncomingFrame {
  type?: unknown;
  payload?: unknown;
}

interface ReadPayload {
  convId?: unknown;
}

export class CrmRealtimeGateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<string, ClientContext>();
  private readonly heartbeat: NodeJS.Timeout;

   constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: WS_PATH });

    this.wss.on("connection", (socket, req) => {
      const origin = req.headers.origin;
       if(!isOriginAllowed(origin)) {
        botLogger.warn("[CRM] WS connection rejected", {
          origin: origin ?? null,
          remoteAddress: req.socket.remoteAddress,
        });
        socket.close(1008, "origin_not_allowed");
        return;
      }

      const clientId = randomUUID();
      const client: ClientContext = { id: clientId, socket, isAlive: true };
      this.clients.set(clientId, client);

      botLogger.info("[CRM] WS client connected", {
        clientId,
        totalClients: this.clients.size,
        remoteAddress: req.socket.remoteAddress,
      });

      socket.once("close", (code, reason) => {
        const reasonText = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason ?? "");
        this.dropClient(clientId, code, reasonText);
      });
      socket.on("error", (error) => {
        botLogger.warn("[CRM] WS client error", { clientId, error: error instanceof Error ? error.message : String(error) });
      });
      socket.on("pong", () => {
        client.isAlive = true;
        // 🐛 BUG FIX: Update last_seen on heartbeat to prevent ghost connections
        if (client.userId) {
          advisorPresence.updateLastSeen(client.userId);
        }
      });
      socket.on("message", (data) => {
        this.handleClientMessage(client, data);
      });

      this.sendFrame(client, {
        type: "welcome",
        serverTime: Date.now(),
        clientId,
      });
    });

    this.wss.on("error", (error) => {
      botLogger.error("[CRM] WS server error", error instanceof Error ? error : new Error(String(error)));
    });

    this.heartbeat = setInterval(() => {
       for(const client of this.clients.values()) {
         if(!client.isAlive) {
          botLogger.warn("[CRM] WS heartbeat timeout", { clientId: client.id, userId: client.userId });
          // BUGFIX: Use dropClient instead of directly terminating to properly notify advisorPresence
          this.dropClient(client.id, 1000, "heartbeat_timeout");
          continue;
        }
        client.isAlive = false;
        try {
          client.socket.ping();
        } catch (error) {
          botLogger.warn("[CRM] WS ping failed", { clientId: client.id, error: error instanceof Error ? error.message : String(error) });
          // BUGFIX: Use dropClient instead of directly terminating
          this.dropClient(client.id, 1001, "ping_failed");
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

   async emitNewMessage(payload: CRMEmitMessage) {
    console.log(`[CRM WS] Emitting new message to ${this.clients.size} clients:`, {
      messageId: payload.message.id,
      direction: payload.message.direction,
      text: payload.message.text?.substring(0, 50),
      isBot: payload.message.providerMetadata?.bot
    });
    this.broadcast("crm:msg:new", payload);
  }

   async emitMessageUpdate(payload: CRMEmitMessage) {
    console.log(`[CRM WS] Emitting message UPDATE to ${this.clients.size} clients:`, {
      messageId: payload.message.id,
      status: payload.message.status,
      convId: payload.message.convId,
    });
    this.broadcast("crm:msg:update", payload);
  }

   async emitMessageDeleted(payload: { messageId: string; convId: string }) {
    console.log(`[CRM WS] Emitting message deleted: ${payload.messageId}`);
    this.broadcast("crm:msg:deleted", payload);
  }

   async emitConversationUpdate(payload: CRMEmitConversation) {
    console.log(`[CRM WS] 📡 Broadcasting conversation update for ${payload.conversation?.id?.substring(0, 8)}... to ${this.clients.size} clients`);
    this.broadcast("crm:conv:update", payload);
  }

   async emitAdvisorPresenceUpdate(payload: unknown) {
    console.log(`[CRM WS] Broadcasting advisor presence update to ${this.clients.size} clients:`, JSON.stringify(payload, null, 2));
    this.broadcast("crm:advisor:presence", payload);
  }

   async getClientCount(): number {
    return this.clients.size;
  }

   async close() {
     clearInterval(this.heartbeat);
     for(const client of this.clients.values()) {
      client.socket.close();
    }
    this.clients.clear();
    this.wss.close();
  }

   async getStatus() {
    return {
      path: WS_PATH,
      clients: this.clients.size,
      allowedOrigins,
    };
  }

  private async handleClientMessage(client: ClientContext, raw: RawData) {
     if(this.isFrameTooLarge(raw)) {
      botLogger.warn("[CRM] WS payload demasiado grande", { clientId: client.id });
      return;
    }

    let parsed: IncomingFrame;
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      parsed = JSON.parse(text) as IncomingFrame;
    } catch (error) {
      botLogger.warn("[CRM] WS frame inválido", { clientId: client.id });
      this.sendFrame(client, { type: "error", message: "invalid_frame" });
      return;
    }

     if(!parsed || typeof parsed.type !== "string") {
      this.sendFrame(client, { type: "error", message: "invalid_type" });
      return;
    }

     switch(parsed.type) {
      case "hello": {
        console.log('[CRM WS] 📨 Received HELLO from client:', client.id);
        this.sendFrame(client, { type: "welcome", serverTime: Date.now(), clientId: client.id });
        break;
      }
      case "auth": {
        console.log('[CRM WS] 🔐 Received AUTH from client:', client.id);
        await this.handleAuthCommand(client, parsed.payload);
        break;
      }
      case "typing": {
         if(parsed.payload && typeof parsed.payload === "object") {
          this.broadcast("crm:typing", parsed.payload, client.id);
        }
        break;
      }
      case "read": {
        this.handleReadCommand(client, parsed.payload as ReadPayload);
        break;
      }
      case "message": {
        this.sendFrame(client, {
          type: "ack",
          event: "message",
          serverTime: Date.now(),
          payload: parsed.payload ?? null,
        });
        break;
      }
      default: {
        this.sendFrame(client, { type: "error", message: "unknown_type" });
        break;
      }
    }
  }

  private isFrameTooLarge(raw: RawData): boolean {
     if(typeof raw === "string") {
      return Buffer.byteLength(raw, "utf8") > MAX_FRAME_SIZE;
    }
     if(Buffer.isBuffer(raw)) {
      return raw.byteLength > MAX_FRAME_SIZE;
    }
     if(Array.isArray(raw)) {
      const total = raw.reduce((sum, chunk) => sum + chunk.length, 0);
      return total > MAX_FRAME_SIZE;
    }
     if(raw instanceof ArrayBuffer) {
      return raw.byteLength > MAX_FRAME_SIZE;
    }
    return false;
  }

  private async handleAuthCommand(client: ClientContext, payload: unknown) {
     if(!payload || typeof payload !== "object" || !("token" in payload)) {
      botLogger.warn("[CRM] WS auth failed: invalid payload", { clientId: client.id });
      this.sendFrame(client, { type: "error", message: "invalid_auth_payload" });
      return;
    }

    const token = (payload as { token: unknown }).token;
     if(typeof token !== "string") {
      botLogger.warn("[CRM] WS auth failed: token not a string", { clientId: client.id });
      this.sendFrame(client, { type: "error", message: "invalid_token_format" });
      return;
    }

    const decoded = verifyToken(token);
     if(!decoded) {
      botLogger.warn("[CRM] WS auth failed: invalid token", { clientId: client.id });
      this.sendFrame(client, { type: "error", message: "invalid_token" });
      return;
    }

    // Store userId in client context
    client.userId = decoded.userId;

    // Mark advisor as online
    advisorPresence.markOnline(decoded.userId, client.id);

    // CRITICAL: Auto-assign default status if advisor doesn't have one
    try {
      const statusAssignment = await adminDb.getAdvisorStatus(decoded.userId);
       if(!statusAssignment || !statusAssignment.status) {
        // Assign default "Disponible" status
        const defaultStatusId = "status-available";
        await adminDb.setAdvisorStatus(decoded.userId, defaultStatusId);
        botLogger.info(`[CRM] Auto-assigned default status "${defaultStatusId}" to advisor ${decoded.userId}`);
      }
    } catch (error) {
      botLogger.error(`[CRM] Error auto-assigning status to advisor ${decoded.userId}:`, error);
    }

    botLogger.info("[CRM] WS client authenticated", {
      clientId: client.id,
      userId: decoded.userId,
      username: decoded.username,
    });

    // Send ACK to this client
    this.sendFrame(client, {
      type: "ack",
      event: "auth",
      serverTime: Date.now(),
      payload: { userId: decoded.userId },
    });

    // Broadcast presence update to ALL clients with full user data
    const presencePayload = await buildPresencePayload(decoded.userId);
     if(presencePayload) {
      this.emitAdvisorPresenceUpdate(presencePayload);
    }
  }

  private async handleReadCommand(client: ClientContext, payload: ReadPayload) {
     if(!payload || typeof payload.convId !== "string") {
      this.sendFrame(client, { type: "error", message: "invalid_read_payload" });
      return;
    }

    await crmDb.markConversationRead(payload.convId);
    const conversation = await crmDb.getConversationById(payload.convId);
    if (conversation) {
      this.emitConversationUpdate({ conversation });
    }

    this.sendFrame(client, {
      type: "ack",
      event: "read",
      serverTime: Date.now(),
      payload: { convId: payload.convId },
    });
  }

  private broadcast(event: string, payload: unknown, skipClientId?: string) {
    for (const client of this.clients.values()) {
      if (skipClientId && client.id === skipClientId) continue;
      if (client.socket.readyState !== WebSocket.OPEN) continue;
      this.sendFrame(client, { type: "event", event, payload });
    }
  }

  private sendFrame(client: ClientContext, frame: Record<string, unknown>) {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      client.socket.send(JSON.stringify(frame));
    } catch (error) {
      botLogger.warn("[CRM] WS send failed", {
        clientId: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private dropClient(clientId: string, code: number, reason: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const userId = client.userId;
    const wasAuthenticated = !!userId;

    // Mark advisor as offline if they were authenticated
    if (userId) {
      advisorPresence.markOffline(userId);
    }

    this.clients.delete(clientId);
    botLogger.info("[CRM] WS client disconnected", {
      clientId,
      userId,
      code,
      reason,
      totalClients: this.clients.size,
    });

    // Broadcast presence update to ALL clients after disconnect
    if (wasAuthenticated && userId) {
      // Use setTimeout to ensure markOffline completed its delayed logic
      setTimeout(async () => {
        const presencePayload = await buildPresencePayload(userId);
        if (presencePayload) {
          this.emitAdvisorPresenceUpdate(presencePayload);
        }
      }, 100);
    }
  }
}

const gateways = new WeakMap<Server, CrmRealtimeGateway>();
let singletonGateway: CrmRealtimeGateway | null = null;

export function initCrmWSS(server: Server): CrmRealtimeGateway {
  const existing = gateways.get(server);
  if (existing) {
    return existing;
  }
  const gateway = new CrmRealtimeGateway(server);
  gateways.set(server, gateway);
  singletonGateway = gateway; // Store singleton reference
  return gateway;
}

/**
 * Get the CRM WebSocket gateway instance (if initialized)
 * Used to emit events from other modules (e.g., admin routes)
 */
export function getCrmGateway(): CrmRealtimeGateway | null {
  return singletonGateway;
}

export type CrmRealtimeManager = CrmRealtimeGateway;
