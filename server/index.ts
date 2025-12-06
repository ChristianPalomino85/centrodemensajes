// MUST be first import to load environment variables before any other modules
import "./load-env";

// Handle unhandled promise rejections and uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Promise Rejection:", reason);
  console.error("Promise:", promise);
  // Don't exit - just log the error
});

process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  // Don't exit - just log the error
});

import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import { createServer } from "http";
import { promises as fs } from "fs";
import path from "path";
import { RuntimeEngine } from "../src/runtime/engine";
import { NodeExecutor, setKeywordUsageHandler } from "../src/runtime/executor";
import { WhatsAppWebhookHandler } from "../src/api/whatsapp-webhook";
import { LocalStorageFlowProvider } from "./flow-provider";
import { HttpWebhookDispatcher } from "./webhook-dispatcher";
import { createSessionStore } from "./session-store";
import { canBotTakeControl } from "../shared/conversation-rules";
import { Bitrix24Client } from "../src/integrations/bitrix24";
import { botLogger, metricsTracker } from "../src/runtime/monitoring";
import { createApiRoutes } from "./api-routes";
import { registerCrmModule } from "./crm";
import { initCrmWSS } from "./crm/ws";
import { CrmStatusWebhookHandler } from "./crm/status-webhook-handler";
import { CampaignWebhookHandler } from "./campaigns/webhook-handler";
import { ensureStorageSetup } from "./utils/storage";
import { getWhatsAppEnv, getWhatsAppVerifyToken, getBitrixClientConfig } from "./utils/env";
import whatsappConnectionsRouter from "./connections/whatsapp-routes";
import { registerReloadCallback } from "./whatsapp-handler-manager";
import { createAdminRouter } from "./routes/admin";
import { createAuthRouter } from "./routes/auth";
import { createBitrixRouter } from "./routes/bitrix";
import { getBitrixClientManager } from "./bitrix-client-manager";
import { createCampaignsRouter } from "./campaigns/routes";
import aiConfigRouter from "./routes/ai-config";
import aiAnalyticsConfigRouter from "./routes/ai-analytics-config";
import iaAgentConfigRouter from "./routes/ia-agent-config";
import iaAgentFilesRouter from "./routes/ia-agent-files";
import ragAdminRouter from "./routes/rag-admin";
import templateImagesRouter from "./routes/template-images";
import templateCreatorRouter from "./routes/template-creator";
import userProfileRouter from "./routes/user-profile";
import ticketsRouter from "./routes/tickets";
import maintenanceRouter from "./routes/maintenance";
import channelConfigRouter from "./routes/channel-config";
import { createMetricsRouter } from "./crm/routes/metrics";
import { createSalesConversionsRouter } from "./crm/routes/sales-conversions";
import quickActionsRouter from "./crm/routes/quick-actions";
import { createImageProxyRouter } from "./routes/image-proxy";
import { requireAuth } from "./auth/middleware";
import { adminDb } from "./admin-db";
import { crmDb } from "./crm/db-postgres";
import { registerKeywordUsage } from "./crm/keyword-usage-tracker";
import { registerCampaignTracking } from "./crm/campaign-tracker";
import { advisorPresence } from "./crm/advisor-presence";
import { logDebug, logError, formatEventTimestamp } from "./utils/file-logger";
import { roundRobinTracker } from "./crm/round-robin-tracker";
import { TimerScheduler } from "./timer-scheduler";
import { QueueDistributor } from "./queue-distributor";
import { BotTimeoutScheduler } from "./bot-timeout-scheduler";
import { apiLimiter, webhookLimiter, flowLimiter, metricsLimiter } from "./middleware/rate-limit";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import logger from "./utils/logger";
import { validateParams } from "./middleware/validate";
import { flowIdSchema } from "./schemas/validation";
import { validateEnv } from "./utils/validate-env";
import { MessageGroupingService } from './services/message-grouping';
import { readConfig as readAgentConfig } from './routes/ia-agent-config';

// Load environment variables
dotenv.config();

// Validate environment variables (exits if validation fails)
validateEnv();

ensureStorageSetup();

const app = express();
const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Initialize advisor presence tracking with all advisors as offline
// NOTE: Must use setTimeout to ensure adminDb has finished loading its data
setTimeout(async () => {
  console.log("[Init] Starting advisor presence initialization...");
  const allUsers = await adminDb.getAllUsers();
  console.log(`[Init] Got ${allUsers.length} total users from adminDb`);
  const advisors = allUsers.filter(u => u.role === "asesor" || u.role === "supervisor");
  console.log(`[Init] Found ${advisors.length} advisors/supervisors`);
  const advisorIds = advisors.map(u => u.id);
  await advisorPresence.initializeAdvisors(advisorIds);
  console.log(`[AdvisorPresence] ✅ Initialized ${advisorIds.length} advisors as offline`);
}, 2000); // Wait 2 seconds for adminDb to finish loading

// Set up keyword usage tracking handler
setKeywordUsageHandler(async (data) => {
  try {
    // Find conversation by phone (indexed query instead of full scan)
    const conversation = await crmDb.getConversationByPhoneAndChannel(data.phone, 'whatsapp', data.phoneNumberId);
    const conversationId = conversation?.id || data.conversationId;

    // Register keyword usage
    await registerKeywordUsage({
      flowId: data.flowId,
      flowName: data.flowName,
      nodeId: data.nodeId,
      keywordGroupId: data.keywordGroupId,
      keywordGroupLabel: data.keywordGroupLabel,
      matchedKeyword: data.matchedKeyword,
      customerPhone: data.phone,
      customerName: conversation?.contactName,
      conversationId: conversationId,
    });

    // Also register in campaign tracking (only for first message)
    // Check if this conversation already has a campaign tracking record
    const existingTracking = await crmDb.pool.query(
      'SELECT id FROM campaign_tracking WHERE conversation_id = $1',
      [conversationId]
    );

    if (existingTracking.rows.length === 0) {
      // This is the first keyword detected for this conversation
      await registerCampaignTracking({
        conversationId: conversationId,
        customerPhone: data.phone,
        customerName: conversation?.contactName,
        initialMessage: data.matchedKeyword, // Using matched keyword as initial message placeholder
        detectedKeyword: data.matchedKeyword,
        keywordGroupId: data.keywordGroupId,
        keywordGroupName: data.keywordGroupLabel,
        flowId: data.flowId,
        flowName: data.flowName,
      });
    }
  } catch (error) {
    console.error('[KeywordTracking] Error in handler:', error);
  }
});

// Trust proxy - CRITICAL for rate limiting behind nginx/load balancer
// This allows Express to correctly identify client IPs from X-Forwarded-For header
app.set('trust proxy', 1);

// Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:", "https://graph.facebook.com", "https://*.bitrix24.es", "https://*.bitrix24.com"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

// Request ID middleware (for log correlation and debugging)
app.use(requestIdMiddleware);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true, // Permitir envío de cookies
}));
app.use(cookieParser()); // Cookie parser ANTES de las rutas

// Body size limits based on WhatsApp limits and use case
// Flows: 500MB (supports 15 PDFs × 20MB each in base64 ~400MB)
app.use('/api/flows', express.json({ limit: '500mb' }));
app.use('/api/flows', express.urlencoded({ extended: true, limit: '500mb' }));

// CRM attachments: 40MB per file (base64 overhead handled by 60MB body limit)
app.use('/api/crm/attachments/upload', express.json({ limit: '60mb' }));
app.use('/api/crm/attachments/upload', express.urlencoded({ extended: true, limit: '60mb' }));

// CRM general: 10MB (messages, conversations, etc.)
app.use('/api/crm', express.json({ limit: '10mb' }));
app.use('/api/crm', express.urlencoded({ extended: true, limit: '10mb' }));

// Default for other routes: 10MB (auth, admin, campaigns, etc.)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Runtime Engine
const flowProvider = new LocalStorageFlowProvider();

// Create session store based on configuration
const sessionStore = createSessionStore({
  type: (process.env.SESSION_STORAGE_TYPE as "memory" | "file") || "file",
  fileStorageDir: process.env.SESSION_STORAGE_PATH || "./data/sessions",
});

// Initialize Bitrix24 client if configured (OAuth o webhook)
const bitrixConfig = getBitrixClientConfig();
let bitrix24Client: Bitrix24Client | undefined;

if (bitrixConfig) {
  // Initialize BitrixClientManager with token refresh callback
  const manager = getBitrixClientManager();

  // Create onTokenRefresh callback
  const onTokenRefresh = async (): Promise<string> => {
    const { refreshBitrixTokens, readTokens } = await import("./routes/bitrix");
    await refreshBitrixTokens();
    const tokens = readTokens();

    if (!tokens?.access_token) {
      throw new Error("Failed to refresh Bitrix tokens");
    }

    // Refresh the client instance with new token
    await manager.refreshClient(tokens.access_token);

    return tokens.access_token;
  };

  // Initialize manager with config and callback
  manager.initialize(bitrixConfig, onTokenRefresh);

  // Get client from manager
  bitrix24Client = manager.getClient() ?? undefined;

  console.log("[Bitrix] BitrixClientManager initialized successfully");
}

// Initialize TimerScheduler (callback will be set later after whatsappHandler is created)
const timerScheduler = new TimerScheduler("./data");

const webhookDispatcher = new HttpWebhookDispatcher();
const executor = new NodeExecutor({
  webhookDispatcher,
  bitrix24Client,
  timerScheduler,
});

const runtimeEngine = new RuntimeEngine({
  flowProvider,
  sessionStore,
  executor,
});

// Connect TimerScheduler to RuntimeEngine
timerScheduler.setEngine(runtimeEngine);

// Conversational CRM module
const crmSocketManager = initCrmWSS(server);
const crmStatusWebhookHandler = new CrmStatusWebhookHandler(crmSocketManager);
const campaignWebhookHandler = new CampaignWebhookHandler();
const crmModule = registerCrmModule({
  app,
  socketManager: crmSocketManager,
  bitrixClient: bitrix24Client,
  flowProvider,
  botSessionStore: sessionStore,
});

// Initialize Queue Scheduler for automatic conversation reassignment
// ⚠️ DESACTIVADO POR SOLICITUD DEL USUARIO - NO USAR TIMEOUT AUTOMÁTICO
// const queueScheduler = new QueueScheduler(crmSocketManager);

// Start queue timeout checking (every minute)
// queueScheduler.startChecking(60000);

// Set timeout rules: 10m, 30m, 1h, 2h, 4h, 8h, 12h
// queueScheduler.setTimeoutRules([10, 30, 60, 120, 240, 480, 720]);

// Initialize Bot Timeout Scheduler for automatic bot timeout transfers
const botTimeoutScheduler = new BotTimeoutScheduler(crmSocketManager, sessionStore);

// Start bot timeout checking (every minute)
botTimeoutScheduler.startChecking(60000);

console.log("[Server] 🤖⏱️ Bot Timeout Scheduler started - checking bot timeouts every 60 seconds");

// Initialize Queue Distributor for automatic chat assignment
const queueDistributor = new QueueDistributor(crmSocketManager);

// Start automatic distribution every 10 seconds
queueDistributor.start(10000);

console.log("[Server] 🎯 Queue Distributor started - distributing chats every 10 seconds");

// Initialize NEW Event-Driven Queue Assignment Service
// Running IN PARALLEL with QueueDistributor for now (safe deployment)
import { initQueueAssignmentService } from "./crm/queue-assignment-service";
const queueAssignmentService = initQueueAssignmentService(crmSocketManager);
console.log("[Server] ⚡ Event-Driven Queue Assignment Service initialized (running in parallel)");

// Initialize Message Grouping Service for IA Agent
// This service groups multiple messages from the same user before sending to AI
let messageGroupingService: MessageGroupingService | undefined;

async function initializeMessageGroupingService() {
  try {
    const agentConfig = await readAgentConfig();
    const groupingConfig = agentConfig?.advancedSettings?.messageGrouping;

    if (groupingConfig?.enabled) {
      messageGroupingService = new MessageGroupingService(
        groupingConfig.timeoutSeconds || 6,
        groupingConfig.enabled
      );
      console.log(`[Server] 📦 Message Grouping Service initialized - timeout: ${groupingConfig.timeoutSeconds}s`);
    } else {
      console.log('[Server] ℹ️  Message Grouping disabled in config');
    }
  } catch (error) {
    console.error('[Server] Failed to initialize Message Grouping Service:', error);
  }
}

// Initialize WhatsApp Webhook Handler
async function createWhatsAppHandler() {
  // IMPORTANT: Initialize message grouping service BEFORE creating webhook handler
  await initializeMessageGroupingService();

  const whatsappEnv = getWhatsAppEnv();

  return new WhatsAppWebhookHandler({
    verifyToken: getWhatsAppVerifyToken() || "default_verify_token",
    engine: runtimeEngine,
    apiConfig: {
      accessToken: whatsappEnv.accessToken || "",
      phoneNumberId: whatsappEnv.phoneNumberId || "",
      apiVersion: whatsappEnv.apiVersion || "v20.0",
      baseUrl: whatsappEnv.baseUrl,
    },
    messageGroupingService: messageGroupingService, // Pass message grouping service for IA Agent
    resolveApiConfig: async (phoneNumberId: string) => {
      // CRITICAL: Find correct WhatsApp connection by phoneNumberId from PostgreSQL
      try {
        const { getWhatsAppConnection } = await import('./services/whatsapp-connections');
        const connection = await getWhatsAppConnection(phoneNumberId);

        if (connection) {
          logger.info(`[WhatsApp] ✅ Resolved API config for phoneNumberId: ${phoneNumberId} (${connection.displayNumber})`);
          return {
            accessToken: connection.accessToken,
            phoneNumberId: connection.phoneNumberId,
            apiVersion: whatsappEnv.apiVersion || "v20.0",
            baseUrl: whatsappEnv.baseUrl,
          };
        } else {
          logger.warn(`[WhatsApp] ⚠️  No connection found for phoneNumberId: ${phoneNumberId}, using default config`);
        }
      } catch (error) {
        logger.error(`[WhatsApp] Error resolving API config:`, error);
      }
      return null; // Use default config
    },
    resolveFlow: async (context) => {
      const phoneNumber = context.message.from;
      const phoneNumberId = context.value.metadata?.phone_number_id;

      // 🐛 FIX: NO activar bot con mensajes pasivos (reacciones, ubicaciones, contactos, etc.)
      // Estos mensajes se guardan en CRM para que el asesor los vea, pero NO activan el bot
      const passiveMessageTypes = ['reaction', 'contacts', 'location', 'order', 'unsupported'];
      if (passiveMessageTypes.includes(context.message.type)) {
        logger.info(`[WhatsApp] ⏭️ Bot skipped: passive message type "${context.message.type}" from ${phoneNumber} - message saved to CRM only`);
        return null; // Don't execute bot, but message will be saved to CRM
      }

      // CRITICAL: Check if conversation is being attended by an advisor
      const existingConversation = await crmDb.getConversationByPhoneAndChannel(phoneNumber, 'whatsapp', phoneNumberId);

      if (existingConversation) {
        logger.info(`[WhatsApp] [DEBUG] Existing conversation found: id=${existingConversation.id}, status=${existingConversation.status}, assignedTo=${existingConversation.assignedTo || 'null'}, queueId=${existingConversation.queueId || 'null'}`);

        // ✅ USAR FUNCIÓN COMPARTIDA: Verificar si el bot puede tomar control
        // La lógica está en /shared/conversation-rules.ts
        if (!canBotTakeControl({
          status: existingConversation.status,
          assignedTo: existingConversation.assignedTo,
          botFlowId: existingConversation.botFlowId,
          queueId: existingConversation.queueId,
          campaignId: null,
        })) {
          logger.info(`[WhatsApp] 🚫 Bot skipped: conversation ${existingConversation.id} is being attended by advisor ${existingConversation.assignedTo}`);
          return null; // Human agent is handling this conversation
        }

        // CRITICAL FIX: Check if bot is awaiting user input before skipping due to queueId
        // When bot sends a menu and waits for selection, conversation might have queueId already assigned
        // but we MUST let the bot process the user's response
        if (existingConversation.status === 'active' && existingConversation.queueId) {
          // CRITICAL FIX: Include phoneNumberId to prevent session conflicts with multiple connections
          const sessionId = `whatsapp_${phoneNumber}_${phoneNumberId || 'default'}`;
          const botSession = await sessionStore.getSession(sessionId);

          if (botSession && botSession.awaitingNodeId) {
            logger.info(`[WhatsApp] ✅ Bot is awaiting user input at node ${botSession.awaitingNodeId} - allowing execution despite queueId ${existingConversation.queueId}`);
            // Continue to flow resolution - bot needs to process user's response
          } else {
            logger.info(`[WhatsApp] 🚫 Bot skipped: conversation ${existingConversation.id} is waiting in queue ${existingConversation.queueId}`);
            return null; // Conversation is waiting for human agent
          }
        }
      } else {
        logger.info(`[WhatsApp] [DEBUG] No existing conversation found for ${phoneNumber}`);
      }

      // Try to find flow assigned to this WhatsApp number
      if (phoneNumberId && flowProvider instanceof LocalStorageFlowProvider) {
        const assignedFlow = await flowProvider.findFlowByWhatsAppNumber(phoneNumberId);
        if (assignedFlow) {
          const flowId = assignedFlow.id;
          logger.info(`[WhatsApp] ✅ Flow assigned: ${flowId} for number ${phoneNumberId}`);

          // CRITICAL: Assign conversation to bot IMMEDIATELY to prevent QueueDistributor from assigning to advisor
          // Rule: First to process (bot or advisor) owns the conversation
          if (existingConversation && !existingConversation.assignedTo) {
            await crmDb.updateConversationMeta(existingConversation.id, {
              assignedTo: 'bot',
              bot_flow_id: flowId,
              bot_started_at: Date.now(),
              queueId: null,  // CRITICAL: Clear any fallback queue set by inbound.ts
              queuedAt: null
            });
            logger.info(`[WhatsApp] 🤖 Bot claimed conversation ${existingConversation.id} - assigned to bot with flow ${flowId}, cleared fallback queue`);

            // Create system message for bot start
            const timestamp = formatEventTimestamp();
            const botStartMessage = await crmDb.createSystemEvent(
              existingConversation.id,
              'bot_started',
              `🤖 Bot inició atención automática (${timestamp})`
            );

            // Emit WebSocket for bot start message
            crmSocketManager.emitNewMessage({ message: botStartMessage, attachment: null });
            logger.info(`[WhatsApp] 📨 System message created: Bot started attending conversation ${existingConversation.id}`);
          }

          // Log conversation start
          // CRITICAL FIX: Include phoneNumberId to prevent session conflicts
          const sessionId = `whatsapp_${phoneNumber}_${phoneNumberId || 'default'}`;
          botLogger.logConversationStarted(sessionId, flowId);
          metricsTracker.startConversation(sessionId, flowId);

          return {
            sessionId,
            flowId,
            contactId: phoneNumber,
            channel: "whatsapp",
          };
        } else {
          logger.info(`[WhatsApp] ℹ️  No flow assigned for number ${phoneNumberId} - message forwarded to CRM only`);
          return null; // No bot execution, message goes to CRM for human agent
        }
      }

      // If no phoneNumberId available, skip bot execution
      logger.warn(`[WhatsApp] ⚠️  No phone number ID in metadata - skipping bot execution`);
      return null;
    },
    logger: {
      info: (message, meta) => botLogger.info(message, meta),
      warn: (message, meta) => botLogger.warn(message, meta),
      error: (message, meta) => botLogger.error(message, undefined, meta),
    },
    onIncomingMessage: async (payload) => {
      logDebug(`[WEBHOOK] onIncomingMessage llamado - Mensaje tipo: ${payload.message.type}, From: ${payload.message.from}`);
      try {
        await crmModule.handleIncomingWhatsApp(payload);
        logDebug(`[WEBHOOK] CRM procesó mensaje exitosamente`);
      } catch (error) {
        logError(`[WEBHOOK] Error en CRM handleIncomingWhatsApp:`, error);
      }
    },
    onBotTransfer: async (payload) => {
      // CRITICAL: Handle bot transfer to queue/advisor/bot
      try {
        console.log('[Bot Transfer] 🔵 onBotTransfer callback START:', JSON.stringify(payload, null, 2));
        const conversation = await crmDb.getConversationByPhoneAndChannel(payload.phone, 'whatsapp', payload.phoneNumberId);

        if (!conversation) {
          console.log('[Bot Transfer] ❌ Conversation NOT found for phone:', payload.phone);
          logger.warn(`[Bot Transfer] Conversation not found for phone: ${payload.phone}`);
          return;
        }

        console.log('[Bot Transfer] ✅ Conversation found:', conversation.id);
        const transferTarget = payload.transferTarget || "queue";
        const transferDestination = payload.transferDestination || "";
        console.log('[Bot Transfer] Target:', transferTarget, 'Destination:', transferDestination);

        switch (transferTarget) {
          case "queue": {
            console.log('[Bot Transfer] 📋 Entering QUEUE case...');
            // Transfer to queue - assign to next available advisor
            const queueId = transferDestination || payload.queueId;
            console.log('[Bot Transfer] queueId:', queueId);

            if (queueId) {
              console.log('[Bot Transfer] 1/7 Updating conversation queue...');
              await crmDb.updateConversationQueue(conversation.id, queueId);
              logger.info(`[Bot Transfer] ✅ Conversation ${conversation.id} assigned to queue: ${queueId}`);

              // Create system message for bot transfer to queue
              const targetQueue = await adminDb.getQueueById(queueId);
              const queueName = targetQueue?.name || queueId;
              const timestamp = formatEventTimestamp();
              const transferMessage = await crmDb.createSystemEvent(
                conversation.id,
                'bot_transferred',
                `🤖 Bot transfirió a cola ${queueName} (${timestamp})`
              );

              // Emit WebSocket for transfer message
              crmSocketManager.emitNewMessage({ message: transferMessage });
              logger.info(`[Bot Transfer] 📨 System message created: Bot transferred to queue ${queueName}`);

              console.log('[Bot Transfer] 2/7 Deleting bot session...');
              // CRITICAL: Terminate bot session when transferring to queue
              // CRITICAL FIX: Include phoneNumberId to prevent session conflicts with multiple connections
              const sessionId = `whatsapp_${payload.phone}_${payload.phoneNumberId || 'default'}`;
              await sessionStore.deleteSession(sessionId);
              logger.info(`[Bot Transfer] 🛑 Bot session TERMINATED - conversation transferred to queue ${queueId}`);

              // CRITICAL: Clear bot fields AND assignedTo to allow QueueDistributor to assign
              await crmDb.updateConversationMeta(conversation.id, {
                botStartedAt: null,
                botFlowId: null,
                assignedTo: null  // CRITICAL: Clear assignedTo so QueueDistributor can pick it up
              });
              logger.info(`[Bot Transfer] ✅ Bot fields cleared (botStartedAt, botFlowId, assignedTo) - ready for QueueDistributor`);

              console.log('[Bot Transfer] 3/7 Getting queue info...');
              // Try to auto-assign to available advisor in queue
              const queue = await adminDb.getQueueById(queueId);
              let assignedToAdvisor = false;

              if (queue && queue.assignedAdvisors && queue.assignedAdvisors.length > 0) {
                console.log('[Bot Transfer DEBUG] Cola:', queue.name, '('+queue.id+') - Asesores asignados:', queue.assignedAdvisors);

                // Get available advisors (those with status action = "accept" AND online)
                const availableAdvisors = [];
                for (const advisorId of queue.assignedAdvisors) {
                  const statusAssignment = await adminDb.getAdvisorStatus(advisorId);
                  if (statusAssignment) {
                    const status = await adminDb.getAdvisorStatusById(statusAssignment.statusId);
                    // ✅ CRITICAL FIX: Check BOTH status AND isOnline()
                    const isOnline = advisorPresence.isOnline(advisorId);
                    console.log('[Bot Transfer DEBUG] Asesor', advisorId, '- Status action:', status?.action, '- Online:', isOnline);
                    if (status?.action === "accept" && isOnline) {
                      availableAdvisors.push(advisorId);
                      console.log('[Bot Transfer DEBUG] Asesor', advisorId, 'agregado a availableAdvisors');
                    }
                  }
                }
                console.log('[Bot Transfer DEBUG] Asesores disponibles para asignación:', availableAdvisors);

                if (availableAdvisors.length > 0) {
                  // Use round-robin to select next advisor
                  const selectedAdvisor = await roundRobinTracker.getNextAdvisor(queueId, availableAdvisors);

                  if (selectedAdvisor) {
                    const assigned = await crmDb.assignConversation(conversation.id, selectedAdvisor);
                    if (assigned) {
                      logger.info(`[Bot Transfer] 🎯 Auto-assigned conversation ${conversation.id} to advisor: ${selectedAdvisor} (round-robin)`);
                      console.log(`[Bot Transfer] ✅ Assignment successful - advisor ${selectedAdvisor} should now see this chat`);
                      assignedToAdvisor = true;

                      // CRITICAL: Get advisor name and create system message about assignment
                      const advisorUser = adminDb.getUserById(selectedAdvisor);
                      const advisorName = advisorUser?.name || selectedAdvisor;
                      const timestamp = formatEventTimestamp();
                      const assignmentMessage = await crmDb.createSystemEvent(
                        conversation.id,
                        'conversation_assigned',
                        `🎯 Asignado automáticamente a ${advisorName} (${timestamp})`
                      );

                      // CRITICAL: Emit WebSocket update AFTER assignment with latest conversation state
                      const assignedConversation = await crmDb.getConversationById(conversation.id);
                      crmSocketManager.emitConversationUpdate({
                        conversation: assignedConversation!
                      });
                      crmSocketManager.emitNewMessage({ message: assignmentMessage });
                      console.log(`[Bot Transfer] 📡 WebSocket update sent for assignment to ${advisorName}`);
                    } else {
                      logger.error(`[Bot Transfer] ❌ Failed to assign conversation ${conversation.id} to advisor: ${selectedAdvisor}`);
                      console.log('[Bot Transfer] ⚠️ Assignment returned false - conversation may not be in correct state');
                    }
                  }
                } else {
                  console.log('[Bot Transfer] ⏳ No advisors available for auto-assignment');
                  logger.info(`[Bot Transfer] ⏳ No available advisors in queue ${queueId} - conversation waiting`);
                }
              } else {
                console.log('[Bot Transfer] ℹ️ Queue has no assigned advisors or queue not found');
              }

              // Only create "queued" message if NOT assigned to advisor
              if (!assignedToAdvisor) {
                console.log('[Bot Transfer] 5/7 Creating system event (conversation in queue)...');
                const queueName = queue?.name || queueId;
                const timestamp = formatEventTimestamp();
                const systemMessage = await crmDb.createSystemEvent(
                  conversation.id,
                  'conversation_queued',
                  `⏳ En cola ${queueName} - Esperando asignación (${timestamp})`
                );
                console.log('[Bot Transfer] System message created:', systemMessage.id);

                console.log('[Bot Transfer] 6/7 Emitting WebSocket events...');
                const updatedConversation = await crmDb.getConversationById(conversation.id);
                crmSocketManager.emitConversationUpdate({
                  conversation: updatedConversation!
                });
                crmSocketManager.emitNewMessage({ message: systemMessage });
                console.log('[Bot Transfer] ✅ emitConversationUpdate() called for queued conversation');
              } else {
                console.log('[Bot Transfer] 5/7 Skipping queue message (already assigned to advisor)');
              }

              logger.info(`[Bot Transfer] 📡 WebSocket updates completed for conversation ${conversation.id}`);
              console.log('[Bot Transfer] 7/7 ✅ All WebSocket events emitted successfully!');
            } else {
              console.log('[Bot Transfer] ⚠️ No queueId provided!');
              logger.warn(`[Bot Transfer] ⚠️ No queueId provided - conversation ${conversation.id} may go to limbo`);
            }
            break;
          }

          case "advisor": {
            // Transfer directly to specific advisor
            if (transferDestination) {
              await crmDb.assignConversation(conversation.id, transferDestination);
              logger.info(`[Bot Transfer] 🎯 Conversation ${conversation.id} assigned to advisor: ${transferDestination}`);

              // CRITICAL: Terminate bot session when transferring to advisor
              // CRITICAL FIX: Include phoneNumberId to prevent session conflicts with multiple connections
              const sessionId = `whatsapp_${payload.phone}_${payload.phoneNumberId || 'default'}`;
              await sessionStore.deleteSession(sessionId);
              logger.info(`[Bot Transfer] 🛑 Bot session TERMINATED - conversation transferred to advisor ${transferDestination}`);

              // CRITICAL: Clear bot fields AND assignedTo to allow QueueDistributor to assign
              await crmDb.updateConversationMeta(conversation.id, {
                botStartedAt: null,
                botFlowId: null,
                assignedTo: null  // CRITICAL: Clear assignedTo so QueueDistributor can pick it up
              });
              logger.info(`[Bot Transfer] ✅ Bot fields cleared (botStartedAt, botFlowId, assignedTo) - ready for QueueDistributor`);

              // Get advisor name for system event
              const advisorUser = adminDb.getUserById(transferDestination);
              const advisorName = advisorUser?.name || advisorUser?.username || transferDestination;
              const timestamp = formatEventTimestamp();

              // Create system event
              const systemMessage = await crmDb.createSystemEvent(
                conversation.id,
                'conversation_assigned',
                `🎯 Asignado automáticamente a ${advisorName} (${timestamp})`
              );

              // Emit WebSocket updates
              crmSocketManager.emitConversationUpdate({
                conversation: (await crmDb.getConversationById(conversation.id))!
              });
              crmSocketManager.emitNewMessage({ message: systemMessage });
            } else {
              logger.warn(`[Bot Transfer] ⚠️ No advisor ID provided for direct transfer`);
            }
            break;
          }

          case "bot": {
            // Transfer to another bot/flow - restart conversation with new flow
            if (transferDestination) {
              logger.info(`[Bot Transfer] 🤖 Transferring conversation ${conversation.id} to bot: ${transferDestination}`);
              // Clear session to restart from beginning
              // CRITICAL FIX: Include phoneNumberId to prevent session conflicts with multiple connections
              const sessionId = `whatsapp_${payload.phone}_${payload.phoneNumberId || 'default'}`;
              await sessionStore.deleteSession(sessionId);
              logger.info(`[Bot Transfer] ✅ Session cleared for fresh start with flow: ${transferDestination}`);
              // Note: The next message will trigger the new flow automatically
            } else {
              logger.warn(`[Bot Transfer] ⚠️ No bot/flow ID provided for bot transfer`);
            }
            break;
          }

          default:
            logger.warn(`[Bot Transfer] ⚠️ Unknown transfer target: ${transferTarget}`);
        }
      } catch (error) {
        logError(`[Bot Transfer] Error:`, error);
      }
    },
    onFlowEnd: async (payload) => {
      // CRITICAL: Handle flow end - archive conversation and clean up bot session
      try {
        console.log('[Flow End] 🏁 onFlowEnd callback START:', JSON.stringify(payload, null, 2));
        const conversation = await crmDb.getConversationByPhoneAndChannel(payload.phone, 'whatsapp', payload.phoneNumberId);

        if (!conversation) {
          console.log('[Flow End] ❌ Conversation NOT found for phone:', payload.phone);
          logger.warn(`[Flow End] Conversation not found for phone: ${payload.phone}`);
          return;
        }

        console.log('[Flow End] ✅ Conversation found:', conversation.id);

        // Delete bot session
        // CRITICAL FIX: Include phoneNumberId to prevent session conflicts with multiple connections
        const sessionId = `whatsapp_${payload.phone}_${payload.phoneNumberId || 'default'}`;
        await sessionStore.deleteSession(sessionId);
        logger.info(`[Flow End] 🛑 Bot session TERMINATED - flow ended`);

        // Clear bot fields
        await crmDb.updateConversationMeta(conversation.id, {
          botStartedAt: null,
          botFlowId: null
        });
        logger.info(`[Flow End] ✅ Bot fields cleared (botStartedAt, botFlowId)`);

        // CRITICAL: ALWAYS close conversation when END node is executed
        // The END node explicitly terminates the conversation, regardless of queue/assignment status
        await crmDb.updateConversationMeta(conversation.id, { status: 'closed' });
        logger.info(`[Flow End] 📦 Conversation ${conversation.id} closed - END node executed`);

        // Also clear queue assignment since conversation is now closed
        await crmDb.updateConversationQueue(conversation.id, null);
        await crmDb.assignConversation(conversation.id, null);
        logger.info(`[Flow End] 🧹 Cleared queue and advisor assignment - conversation fully closed`);

        // Create system event for conversation closure
        const timestamp = formatEventTimestamp();
        const systemMessage = await crmDb.createSystemEvent(
          conversation.id,
          'conversation_closed',
          `📁 Conversación cerrada automáticamente (${timestamp})`
        );

        // Emit WebSocket updates
        crmSocketManager.emitConversationUpdate({
          conversation: (await crmDb.getConversationById(conversation.id))!
        });
        crmSocketManager.emitNewMessage({ message: systemMessage });

        console.log('[Flow End] ✅ Flow end completed successfully');
      } catch (error) {
        logError(`[Flow End] Error:`, error);
      }
    },
    onBotMessage: async (payload) => {
      // Register bot messages in CRM
      try {
        const { crmDb } = await import('./crm/db-postgres');

        // CRITICAL FIX: First try to find ANY active conversation for this phone
        // This prevents creating duplicate conversations when bot responds from different number
        const phoneNumberId = payload.phoneNumberId;
        let conversation = await crmDb.getConversationByPhoneAndChannel(payload.phone, 'whatsapp', phoneNumberId);

        if (!conversation) {
          // Try to find active conversation with ANY phoneNumberId (prevent duplicates)
          const allConversations = await crmDb.getAllConversations();
          conversation = allConversations.find(c =>
            c.phone === payload.phone &&
            c.channel === 'whatsapp' &&
            c.status !== 'closed'
          ) || null;

          if (!conversation) {
            // No active conversation found - create new one
            conversation = await crmDb.createConversation(payload.phone, null, null, 'whatsapp', phoneNumberId);
            logger.info(`[Bot Message] ✅ Created NEW conversation ${conversation.id} for ${payload.phone}`);
          } else {
            logger.info(`[Bot Message] ✅ Using existing conversation ${conversation.id} (channelConnectionId: ${conversation.channelConnectionId}) for bot response`);
          }
        }

        // CRITICAL: If bot is sending messages and conversation is not assigned, claim it
        // This handles NEW conversations and conversations where fallback queue was set by inbound.ts
        if (!conversation.assignedTo) {
          const updates: any = {
            assignedTo: 'bot',
            botFlowId: payload.flowId,
            botStartedAt: Date.now()
          };

          // Clear queue if it was set
          if (conversation.queueId) {
            updates.queueId = null;
            updates.queuedAt = null;
            logger.info(`[Bot Message] 🤖 Bot claimed NEW conversation ${conversation.id} - cleared fallback queue ${conversation.queueId}`);
          } else {
            logger.info(`[Bot Message] 🤖 Bot claimed NEW conversation ${conversation.id}`);
          }

          await crmDb.updateConversationMeta(conversation.id, updates);

          // Create system message for bot start
          const timestamp = formatEventTimestamp();
          const botStartMessage = await crmDb.createSystemEvent(
            conversation.id,
            'bot_started',
            `🤖 Bot inició atención automática (${timestamp})`
          );

          // Emit WebSocket for bot start message
          crmSocketManager.emitNewMessage({ message: botStartMessage, attachment: null });

          // Refresh conversation object
          conversation = (await crmDb.getConversationById(conversation.id))!;
        }

        // Extract text from bot message
        let text = '';
        let mediaUrl: string | null = null;
        let type: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';

        if (payload.message.type === 'text') {
          text = payload.message.text;
        } else if (payload.message.type === 'buttons') {
          // Extract text and buttons for interactive messages
          console.log('[Bot Message DEBUG] Buttons message:', JSON.stringify(payload.message, null, 2));
          text = payload.message.text || '';
          if (payload.message.header) text = `${payload.message.header}\n\n${text}`;
          // NO append button text to message - buttons will be rendered separately in UI
          if (payload.message.footer) text = `${text}\n\n${payload.message.footer}`;
          console.log('[Bot Message DEBUG] Extracted text:', text);
        } else if (payload.message.type === 'menu') {
          text = payload.message.text || '';
          if (payload.message.header) text = `${payload.message.header}\n\n${text}`;
          if (payload.message.footer) text = `${text}\n\n${payload.message.footer}`;
        } else if (payload.message.type === 'media') {
          text = payload.message.caption || payload.message.filename || '';
          mediaUrl = payload.message.url;
          type = payload.message.mediaType === 'image' ? 'image' :
                 payload.message.mediaType === 'video' ? 'video' :
                 payload.message.mediaType === 'audio' ? 'audio' : 'document';
        }

        // Build metadata with bot info and interactive elements (buttons/menu)
        const metadata: any = { bot: true };
        if (payload.message.type === 'buttons' && payload.message.buttons) {
          metadata.buttons = payload.message.buttons.map((btn: any) => ({
            label: btn.label || btn.title || btn.text || btn
          }));
        } else if (payload.message.type === 'menu' && payload.message.options) {
          metadata.menuOptions = payload.message.options.map((opt: any) => ({
            label: opt.label || opt.title || opt.text || opt
          }));
        }

        // Append bot message to CRM
        const botMessage = await crmDb.appendMessage({
          convId: conversation.id,
          direction: 'outgoing',
          type,
          text: text || '🤖 [Bot]',
          mediaUrl,
          mediaThumb: null,
          repliedToId: null,
          status: payload.result.ok ? 'sent' : 'failed',
          providerMetadata: metadata,
        });

        // CRITICAL: If this is a media message, create attachment record so frontend can display it
        let attachment = null;
        if (mediaUrl && type !== 'text') {
          try {
            const { randomUUID } = await import('crypto');
            attachment = await crmDb.storeAttachment({
              id: randomUUID(),
              msgId: botMessage.id,
              url: mediaUrl,
              filename: text || 'archivo',
              mime: type === 'image' ? 'image/jpeg' :
                    type === 'video' ? 'video/mp4' :
                    type === 'audio' ? 'audio/mpeg' : 'application/pdf',
              size: 0,
            });
            console.log(`[Bot Message] ✅ Created attachment record for ${attachment.filename}`);
          } catch (error) {
            console.error(`[Bot Message] Error creating attachment:`, error);
          }
        }

        // CRITICAL: Emit message via WebSocket so advisors can see bot responses in real-time
        console.log(`[Bot Message] 🔔 EMITTING WebSocket event for message ID ${botMessage.id} in conversation ${conversation.id}`);
        crmSocketManager.emitNewMessage({
          message: botMessage,
          attachment: attachment
        });
        console.log(`[Bot Message] ✅ WebSocket emission completed`);

        logDebug(`[Bot Message] Registered in CRM for ${payload.phone}`);
      } catch (error) {
        logError(`[Bot Message] Failed to register in CRM:`, error);
      }
    },
  });
}

// IMPORTANT: whatsappHandler will be initialized asynchronously
let whatsappHandler: WhatsAppWebhookHandler;

(async () => {
  whatsappHandler = await createWhatsAppHandler();
  console.log('[Server] ✅ WhatsApp Handler initialized with Message Grouping');
})();

// CRITICAL: Connect TimerScheduler callback to send timer responses via WhatsApp
timerScheduler.setOnTimerComplete(async ({ timer, executionResult }) => {
  logger.info(`[Timer Callback] Sending ${executionResult.responses.length} timer responses for contact ${timer.contactId}`);

  // Send each response via WhatsApp
  for (let i = 0; i < executionResult.responses.length; i++) {
    const response = executionResult.responses[i];
    try {
      await (whatsappHandler as any).dispatchOutbound(timer.contactId, response, timer.contactId);
      logger.info(`[Timer Callback] ✅ Sent response ${i + 1}/${executionResult.responses.length}`);

      // Add 300ms delay between messages to ensure correct order (except for last message)
      if (i < executionResult.responses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error) {
      logger.error(`[Timer Callback] ❌ Failed to send response ${i + 1}:`, error);
    }
  }
});

// Start timer checking (every 30 seconds)
timerScheduler.startChecking(30000);
logger.info('[TimerScheduler] ✅ Timer checking started and callback registered');

// Register reload callback for dynamic credential updates
registerReloadCallback(async () => {
  logger.info('[WhatsApp] Reloading handler with updated credentials...');
  whatsappHandler = await createWhatsAppHandler();
  logger.info('[WhatsApp] Handler reloaded successfully');
});

const healthHandler = (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
};

// Health check endpoints
app.get("/health", healthHandler);
app.get("/api/healthz", healthHandler);

// WhatsApp webhook endpoint (Meta for Developers configured URL)
app.all("/api/meta/webhook", webhookLimiter, async (req: Request, res: Response) => {
  try {
    logDebug(`[WEBHOOK] ${req.method} /api/meta/webhook - Body keys:`, Object.keys(req.body || {}));
    if (req.body) {
      logDebug(`[WEBHOOK] Full body:`, req.body);
    }

    // Process status updates for CRM messages (delivered, read, etc.)
    if (req.method === "POST" && req.body) {
      crmStatusWebhookHandler.processWebhook(req.body);
      // Also process webhooks for campaign messages
      campaignWebhookHandler.processWebhook(req.body);
    }

    // Build Request options conditionally - don't include body for GET/HEAD
    const requestOptions: RequestInit = {
      method: req.method,
      headers: req.headers as HeadersInit,
    };

    // Only include body for methods that support it (not GET/HEAD)
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestOptions.body = JSON.stringify(req.body);
    }

    const request = new Request(
      `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      requestOptions
    );

    const response = await whatsappHandler.handle(request);
    const body = await response.text();

    logDebug(`[WEBHOOK] Response status: ${response.status}`);
    res.status(response.status).send(body);
  } catch (error) {
    logError("[ERROR] Failed to handle webhook:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to create/update flows
const saveFlowHandler = async (req: Request, res: Response) => {
  try {
    const { flowId } = req.params;
    let payload = req.body;

    // Basic validation
    if (!payload || typeof payload !== 'object') {
      logger.error(`[ERROR] Invalid flow data for ${flowId}: not an object`);
      res.status(400).json({ error: "Invalid flow data" });
      return;
    }

    // CRITICAL: Store ENTIRE payload (flow + positions + viewport)
    // Frontend sends { flow: {...}, positions: {...}, viewport: {...} }
    // We need to store ALL of it so positions and viewport are preserved
    let dataToStore;
    let flow;

    if (payload.flow && typeof payload.flow === 'object') {
      // Wrapped format from frontend - store everything
      logger.info(`[INFO] Storing flow ${flowId} with positions and viewport`);
      dataToStore = payload;
      flow = payload.flow;
    } else {
      // Legacy format - just the flow
      logger.info(`[INFO] Storing flow ${flowId} (legacy format without positions)`);
      dataToStore = { flow: payload, positions: {}, viewport: null };
      flow = payload;
    }

    // Validate the flow has required fields
    if (!flow.id || !flow.nodes || typeof flow.nodes !== 'object') {
      logger.error(`[ERROR] Invalid flow structure for ${flowId}:`, {
        hasId: !!flow.id,
        hasNodes: !!flow.nodes,
        bodyKeys: Object.keys(flow).slice(0, 10)
      });
      res.status(400).json({ error: "Invalid flow structure - missing id or nodes" });
      return;
    }

    logger.info(`[INFO] Saving flow ${flowId}`, {
      flowName: flow.name,
      nodeCount: Object.keys(flow.nodes || {}).length,
      hasRootId: !!flow.rootId,
      flowId: flow.id,
      hasPositions: !!dataToStore.positions && Object.keys(dataToStore.positions).length > 0,
      hasViewport: !!dataToStore.viewport
    });

    // Create backup before saving
    if (flowProvider instanceof LocalStorageFlowProvider) {
      try {
        const existingFlow = await flowProvider.getFlow(flowId);
        if (existingFlow) {
          const backupPath = path.join(process.cwd(), "data", "flows", `${flowId}.backup`);
          await fs.writeFile(backupPath, JSON.stringify(existingFlow, null, 2), "utf-8");
          logger.info(`[INFO] Created backup for flow ${flowId}`);
        }
      } catch (backupError) {
        logger.warn(`[WARN] Failed to create backup for flow ${flowId}:`, backupError);
        // Continue with save even if backup fails
      }
    }

    // Save the ENTIRE persisted state (flow + positions + viewport)
    await flowProvider.saveFlow(flowId, dataToStore);

    logger.info(`[INFO] Flow ${flowId} saved successfully`);
    res.json({ success: true, flowId });
  } catch (error) {
    logger.error("[ERROR] Failed to save flow:", {
      flowId: req.params.flowId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({ error: "Failed to save flow" });
  }
};

// Support both POST and PUT for flow creation/update
// NOTE: Body validation removed for flows - they have complex, dynamic structure
app.post("/api/flows/:flowId", flowLimiter, validateParams(flowIdSchema), saveFlowHandler);
app.put("/api/flows/:flowId", flowLimiter, validateParams(flowIdSchema), saveFlowHandler);

// API endpoint to get a flow
app.get("/api/flows/:flowId", validateParams(flowIdSchema), async (req: Request, res: Response) => {
  try {
    const { flowId } = req.params;
    const flow = await flowProvider.getFlow(flowId);

    if (!flow) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    res.json(flow);
  } catch (error) {
    logger.error("[ERROR] Failed to get flow:", error);
    res.status(500).json({ error: "Failed to get flow" });
  }
});

// API endpoint to list all flows
app.get("/api/flows", async (req: Request, res: Response) => {
  try {
    const flowIds = await flowProvider.listFlows();

    // Get full flow data for each flow (for gallery)
    const fullFlows = await Promise.all(
      flowIds.map(async (id) => {
        try {
          const stored = await flowProvider.getFlow(id);
          // Handle both new format {flow, positions, viewport} and legacy format (just flow)
          const flow = stored?.flow || stored;

          // Validar que el flujo tenga un ID válido
          if (!flow || !flow.id) {
            logger.error(`[ERROR] Flow sin ID válido: ${id}`, stored);
            return null;
          }
          return flow;
        } catch (error) {
          logger.error(`[ERROR] Failed to load flow ${id}:`, error);
          return null;
        }
      })
    );

    // Filter out null values and flows without valid IDs
    const validFlows = fullFlows.filter((f) => f !== null && f.id);
    res.json({ flows: validFlows });
  } catch (error) {
    logger.error("[ERROR] Failed to list flows:", error);
    res.status(500).json({ error: "Failed to list flows" });
  }
});

// API endpoint to delete a flow
app.delete("/api/flows/:flowId", validateParams(flowIdSchema), async (req: Request, res: Response) => {
  try {
    const { flowId } = req.params;

    // Check if flow exists before deleting
    const flow = await flowProvider.getFlow(flowId);
    if (!flow) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }

    // Delete the flow
    if (flowProvider instanceof LocalStorageFlowProvider) {
      await flowProvider.deleteFlow(flowId);
      logger.info(`[API] Flow ${flowId} deleted successfully`);
      res.json({ success: true, flowId });
    } else {
      res.status(501).json({ error: "Delete not implemented for this storage type" });
    }
  } catch (error) {
    logger.error("[ERROR] Failed to delete flow:", error);
    res.status(500).json({ error: "Failed to delete flow" });
  }
});

// ============================================
// RUTAS PÚBLICAS (sin autenticación)
// ============================================

// Auth routes (login, logout, me)
app.use("/api/auth", createAuthRouter());

// Bitrix OAuth routes (MUST be public for OAuth callbacks)
app.use("/api/bitrix", createBitrixRouter());

// ============================================
// RUTAS PROTEGIDAS (requieren autenticación)
// ============================================

// WhatsApp connections routes - PROTEGIDAS
app.use("/api/connections/whatsapp", requireAuth, whatsappConnectionsRouter);

// Admin routes
const adminRouter = createAdminRouter();

// Image Proxy routes (PUBLIC - no auth required for performance)
const imageProxyRouter = createImageProxyRouter();

// Make whatsapp-numbers endpoint PUBLIC for canvas use (BEFORE auth middleware)
app.get("/api/admin/whatsapp-numbers", requireAuth, async (req, res) => {
  try {
    const numbers = await adminDb.getAllWhatsAppNumbers();
    res.json({ numbers });
  } catch (error) {
    logger.error("[Admin] Error getting WhatsApp numbers:", error);
    res.status(500).json({ error: "Failed to get WhatsApp numbers" });
  }
});

// CRM: Pin/unpin conversation
app.post("/api/crm/conversations/:convId/pin", requireAuth, async (req: Request, res: Response) => {
  try {
    const { convId } = req.params;
    const { pinned } = req.body;

    logger.info(`[CRM Pin] 📌 Request received - convId: ${convId}, pinned: ${pinned}`);

    if (typeof pinned !== 'boolean') {
      logger.warn(`[CRM Pin] ❌ Invalid pinned value: ${typeof pinned}`);
      res.status(400).json({ error: "pinned must be a boolean" });
      return;
    }

    // Set pinnedAt to current timestamp when pinning, null when unpinning
    const pinnedAt = pinned ? Date.now() : null;
    await crmDb.updateConversationMeta(convId, { pinned, pinnedAt });
    logger.info(`[CRM Pin] ✅ Updated conversation ${convId} - pinned: ${pinned}, pinnedAt: ${pinnedAt}`);

    // Emit WebSocket update so all clients see the change in real-time
    const updatedConv = await crmDb.getConversationById(convId);
    if (updatedConv) {
      logger.info(`[CRM Pin] 📡 Emitting WebSocket update for conversation ${convId} - pinned: ${updatedConv.pinned}`);
      crmSocketManager.emitConversationUpdate({ conversation: updatedConv });
      logger.info(`[CRM Pin] ✅ WebSocket update emitted successfully`);
    } else {
      logger.warn(`[CRM Pin] ⚠️ Could not find updated conversation ${convId}`);
    }

    res.json({ success: true, pinned });
  } catch (error) {
    logger.error("[CRM] Error toggling pin:", error);
    res.status(500).json({ error: "Failed to toggle pin" });
  }
});

// AI Analytics endpoints for conversation analysis
app.get("/api/crm/conversations/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    console.log('[AI Analytics] 📊 Request received:', req.query);
    const { from, to } = req.query;

    if (!from || !to) {
      console.log('[AI Analytics] ❌ Missing parameters');
      res.status(400).json({ error: "Missing date range parameters" });
      return;
    }

    const fromDate = new Date(from as string);
    const toDate = new Date(to as string);
    toDate.setHours(23, 59, 59, 999); // Include full day
    console.log('[AI Analytics] 📅 Date range:', { from: fromDate, to: toDate });

    // Get all conversations in date range
    console.log('[AI Analytics] 🔍 Fetching conversations...');
    const allConversations = await crmDb.listConversations();
    console.log('[AI Analytics] ✅ Fetched', allConversations.length, 'conversations');
    const filteredConversations = allConversations.filter(conv => {
      const convDate = new Date(conv.lastMessageAt);
      return convDate >= fromDate && convDate <= toDate;
    });

    // Group by day
    const dayMap = new Map<string, any[]>();

    for (const conv of filteredConversations) {
      const convDate = new Date(conv.lastMessageAt);
      const dateKey = convDate.toISOString().split('T')[0];

      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, []);
      }

      // Get messages for this conversation
      const messages = await crmDb.getMessagesByConversationId(conv.id);
      const duration = messages.length > 1
        ? Math.round((messages[messages.length - 1].createdAt - messages[0].createdAt) / 60000)
        : 0;

      // Get existing analysis if available
      const analysis = conv.aiAnalysis;

      dayMap.get(dateKey)!.push({
        id: conv.id,
        phone: conv.phone,
        contactName: conv.contactName,
        date: conv.lastMessageAt,
        messageCount: messages.length,
        duration: duration > 0 ? `${duration} min` : '< 1 min',
        summary: analysis?.summary,
        sentiment: analysis?.sentiment,
        topics: analysis?.topics,
        keywords: analysis?.keywords,
        analyzing: false
      });
    }

    // Build day groups
    const dayGroups = Array.from(dayMap.entries()).map(([date, conversations]) => {
      const sentimentDistribution = {
        positive: conversations.filter(c => c.sentiment === 'positive').length,
        negative: conversations.filter(c => c.sentiment === 'negative').length,
        neutral: conversations.filter(c => c.sentiment === 'neutral').length
      };

      const totalDuration = conversations.reduce((sum, c) => {
        const mins = parseInt(c.duration) || 0;
        return sum + mins;
      }, 0);

      const avgDuration = conversations.length > 0
        ? Math.round(totalDuration / conversations.length)
        : 0;

      return {
        date,
        conversations: conversations.sort((a, b) => b.date - a.date),
        totalConversations: conversations.length,
        avgDuration: avgDuration > 0 ? `${avgDuration} min` : '< 1 min',
        sentimentDistribution
      };
    }).sort((a, b) => b.date.localeCompare(a.date));

    console.log('[AI Analytics] ✅ Returning', dayGroups.length, 'day groups');
    res.json({ dayGroups });
  } catch (error) {
    console.error("[AI Analytics] ❌ Error loading conversations:", error);
    logger.error("[AI Analytics] Error loading conversations:", error);
    res.status(500).json({ error: "Failed to load conversations", details: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/crm/conversations/:id/analyze", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get conversation and messages
    const conversation = await crmDb.getConversationById(id);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const messages = await crmDb.getMessagesByConversationId(id);
    if (messages.length === 0) {
      res.json({
        summary: "Conversación sin mensajes",
        sentiment: "neutral",
        topics: [],
        keywords: []
      });
      return;
    }

    // Build conversation text for analysis
    const conversationText = messages
      .map(msg => {
        const sender = msg.sender === 'client' ? 'Cliente' : 'Bot/Asesor';
        return `${sender}: ${msg.text || '[Multimedia]'}`;
      })
      .join('\n');

    // Load AI config from file system (same as AI RAG nodes)
    const aiConfigModule = await import('./routes/ai-config');
    const aiConfigData = await aiConfigModule.readAIConfig();

    if (!aiConfigData || !aiConfigData.openai?.apiKey) {
      res.status(500).json({ error: "OpenAI not configured. Please go to Config → AI Configuration and add your OpenAI API key." });
      return;
    }

    // Call OpenAI for analysis
    const { OpenAIClient } = await import('./ai/clients/openai');
    const client = new OpenAIClient(aiConfigData.openai.apiKey, aiConfigData.openai.baseUrl);

    const prompt = `Analiza la siguiente conversación de WhatsApp y proporciona:
1. Un resumen breve (2-3 oraciones) de la conversación
2. El sentimiento general (positive, negative, o neutral)
3. Los 3 temas principales (máximo 3 palabras cada uno)
4. Las 5 palabras clave más importantes

Conversación:
${conversationText}

Responde SOLO con un JSON válido en este formato exacto:
{
  "summary": "resumen aquí",
  "sentiment": "positive|negative|neutral",
  "topics": ["tema1", "tema2", "tema3"],
  "keywords": ["palabra1", "palabra2", "palabra3", "palabra4", "palabra5"]
}`;

    const response = await client.complete({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Eres un asistente que analiza conversaciones de servicio al cliente en español. Siempre respondes con JSON válido.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      maxTokens: 500
    });

    // Parse AI response
    let analysis;
    try {
      // Clean response to extract JSON
      let jsonText = response.content.trim();

      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      logger.error("[AI Analytics] Failed to parse AI response:", parseError);
      logger.error("[AI Analytics] Raw response:", response.content);

      // Fallback analysis
      analysis = {
        summary: response.content.substring(0, 200) + '...',
        sentiment: 'neutral',
        topics: ['General'],
        keywords: []
      };
    }

    // Store analysis in conversation metadata
    await crmDb.updateConversationMeta(id, {
      aiAnalysis: analysis
    });

    logger.info(`[AI Analytics] ✅ Analyzed conversation ${id}`);
    res.json(analysis);
  } catch (error) {
    logger.error("[AI Analytics] Error analyzing conversation:", error);
    res.status(500).json({ error: "Failed to analyze conversation" });
  }
});

// All other admin routes REQUIRE AUTH
app.use("/api/admin", requireAuth, adminRouter);

// AI Configuration routes - PROTEGIDAS CON AUTH
app.use("/api/ai-config", requireAuth, aiConfigRouter);

// AI Analytics Configuration routes - PROTEGIDAS CON AUTH
app.use("/api/ai-analytics-config", requireAuth, aiAnalyticsConfigRouter);

// IA Agent Configuration routes - PROTEGIDAS CON AUTH
app.use("/api/ia-agent-config", requireAuth, iaAgentConfigRouter);

// IA Agent Files routes - PROTEGIDAS CON AUTH
app.use("/api/ia-agent-files", requireAuth, iaAgentFilesRouter);

// RAG Admin routes - PROTEGIDAS CON AUTH
app.use("/api/rag-admin", requireAuth, ragAdminRouter);

// Image Proxy routes (PUBLIC - for loading Facebook CDN images)
app.use("/api", imageProxyRouter);

// Template Images routes (for storing permanent images) - PROTEGIDAS CON AUTH
app.use("/api/template-images", templateImagesRouter);

// Template Creator routes (create and submit templates to Meta) - PROTEGIDAS CON AUTH
app.use("/api/template-creator", requireAuth, templateCreatorRouter);

// User Profile routes - PROTEGIDAS CON AUTH
app.use("/api/user-profile", requireAuth, userProfileRouter);

// Tickets system routes - PROTEGIDAS CON AUTH
app.use("/api/tickets", requireAuth, ticketsRouter);

// Maintenance alerts routes - PROTEGIDAS CON AUTH
app.use("/api/maintenance", requireAuth, maintenanceRouter);

// Channel Config routes (Instagram, Facebook, WhatsApp, Bitrix) - PROTEGIDAS CON AUTH
app.use("/api/channel-config", requireAuth, channelConfigRouter);

// Campaigns routes - PROTEGIDAS CON AUTH
app.use("/api/campaigns", requireAuth, createCampaignsRouter(crmSocketManager));

// CRM Metrics routes (template usage, RAG usage, etc.) - PROTEGIDAS CON AUTH
const crmMetricsRouter = createMetricsRouter();
app.use("/api/crm/metrics", requireAuth, metricsLimiter, crmMetricsRouter);

// Sales Conversions routes - PROTEGIDAS CON AUTH
const salesConversionsRouter = createSalesConversionsRouter();
app.use("/api/crm/sales-conversions", requireAuth, metricsLimiter, salesConversionsRouter);

// Quick Actions routes (minibots/scripts) - PROTEGIDAS CON AUTH
app.use("/api/crm/quick-actions", requireAuth, quickActionsRouter);

// Metrics routes - MORE LENIENT rate limiting for real-time polling
// Must be BEFORE the general /api route to override apiLimiter
const metricsRoutes = createApiRoutes({ flowProvider, sessionStore });
app.use("/api/stats", requireAuth, metricsLimiter, (req, res, next) => {
  metricsRoutes(req, res, next);
});
app.use("/api/metrics", requireAuth, metricsLimiter, (req, res, next) => {
  metricsRoutes(req, res, next);
});
app.use("/api/conversations/active", requireAuth, metricsLimiter, (req, res, next) => {
  metricsRoutes(req, res, next);
});

// Additional API routes (validation, simulation, monitoring, etc.) - PROTEGIDAS
app.use("/api", requireAuth, apiLimiter, createApiRoutes({ flowProvider, sessionStore }));

// Serve template images from public directory (NO AUTH required for images to be accessible in WhatsApp)
app.use("/template-images", express.static("public/template-images", {
  setHeaders: (res) => {
    // Cache images for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// Serve uploaded ad images (NO AUTH required - public access)
app.use("/uploads", express.static("uploads", {
  setHeaders: (res) => {
    // Cache images for 1 day (they never change)
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

// Serve static files from dist directory (frontend)
// Serve static files with no-cache headers to prevent stale JS bundles
app.use(express.static("dist", {
  setHeaders: (res, path) => {
    // Disable caching for HTML and JS files to ensure latest code is loaded
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// SPA fallback: serve index.html for all non-API routes
// Use regex to exclude /api and /template-images routes, preventing masking of undefined API endpoints
app.get(/^\/(?!api|template-images).*/, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile("index.html", { root: "dist" });
});

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Global error handler - must be last
app.use(errorHandler);

// Start server
server.listen(PORT, async () => {
  const whatsappEnv = getWhatsAppEnv();
  const verifyToken = getWhatsAppVerifyToken();

  logDebug(`🚀 Server iniciado en puerto ${PORT}`);
  logDebug(`📱 WhatsApp webhook: http://localhost:${PORT}/api/meta/webhook`);
  logDebug(`⚙️  Access Token configurado: ${whatsappEnv.accessToken ? "SI" : "NO"}`);
  logDebug(`⚙️  Phone Number ID: ${whatsappEnv.phoneNumberId ? whatsappEnv.phoneNumberId : "NO CONFIGURADO"}`);

  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 WhatsApp webhook: http://localhost:${PORT}/api/meta/webhook`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
  logger.info(`⚙️  Configuration:`);
  logger.info(`   - Verify Token: ${verifyToken ? "✓" : "✗"}`);
  logger.info(`   - Access Token: ${whatsappEnv.accessToken ? "✓" : "✗"}`);
  logger.info(`   - Phone Number ID: ${whatsappEnv.phoneNumberId ? "✓" : "✗"}`);
  logger.info(`   - Default Flow ID: ${process.env.DEFAULT_FLOW_ID || "default-flow"}`);
  logger.info(`   - Session Storage: ${process.env.SESSION_STORAGE_TYPE || "file"}`);
  logger.info(`   - Bitrix24: ${bitrix24Client ? "✓" : "✗"}`);
  logger.info(`📊 Additional Endpoints:`);
  logger.info(`   - Logs: GET http://localhost:${PORT}/api/logs`);
  logger.info(`   - Stats: GET http://localhost:${PORT}/api/stats`);
  logger.info(`   - Metrics: GET http://localhost:${PORT}/api/metrics`);
  logger.info(`   - Active Conversations: GET http://localhost:${PORT}/api/conversations/active`);
  logger.info(`   - Validate Flow: POST http://localhost:${PORT}/api/validate`);
  logger.info(`   - Simulate Start: POST http://localhost:${PORT}/api/simulate/start`);
  logger.info(`   - Simulate Message: POST http://localhost:${PORT}/api/simulate/message`);

  // ========== PROACTIVE BITRIX24 TOKEN REFRESH ==========
  // Auto-refresh Bitrix24 tokens BEFORE they expire (every hour)
  // Check every 10 minutes, refresh if token is near expiration
  const { refreshBitrixTokens, readTokens } = await import("./routes/bitrix");

  setInterval(async () => {
    try {
      const tokens = readTokens();
      if (!tokens?.refresh_token || !tokens?.expires) {
        return; // No tokens to refresh or no expiration time
      }

      const now = Date.now();
      const expiresAt = tokens.expires;
      const timeUntilExpiry = expiresAt - now;
      const threshold = 15 * 60 * 1000; // 15 minutes before expiration

      // Refresh if token expires in less than 15 minutes OR if already expired
      if (timeUntilExpiry < threshold) {
        const isExpired = timeUntilExpiry <= 0;
        logger.info("[Bitrix] Proactive token refresh triggered", {
          expired: isExpired,
          expires_in_minutes: isExpired ? 'EXPIRED' : Math.floor(timeUntilExpiry / 60000),
          threshold_minutes: 15
        });
        await refreshBitrixTokens();
        logger.info("[Bitrix] Proactive token refresh completed successfully");
      }
    } catch (err) {
      logger.error("[Bitrix] Proactive token refresh failed", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }, 10 * 60 * 1000); // Check every 10 minutes

  logger.info("[Bitrix] Proactive token refresh mechanism initialized", {
    check_interval_minutes: 10,
    refresh_threshold_minutes: 15
  });
  // ========== END PROACTIVE BITRIX24 TOKEN REFRESH ==========

  // ========== START SALES-WHATSAPP SYNC JOB ==========
  const { startSalesSyncSchedule } = await import("./jobs/sales-sync-job");
  startSalesSyncSchedule();
  // ========== END SALES-WHATSAPP SYNC JOB ==========

  // ========== START CLEANUP SERVICE ==========
  // Automatic cleanup of old files (uploads, logs, temp) with proper error handling
  const { runCleanup, getCleanupMetrics } = await import("./services/cleanup-service");

  // Run cleanup every 24 hours
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  let cleanupFailureCount = 0;
  const MAX_CLEANUP_FAILURES = 5;

  const runCleanupWithErrorHandling = async () => {
    try {
      await runCleanup();
      cleanupFailureCount = 0; // Reset on success
    } catch (error) {
      cleanupFailureCount++;
      logger.error("[Cleanup] Job failed", {
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures: cleanupFailureCount,
      });

      // Alert if too many consecutive failures
      if (cleanupFailureCount >= MAX_CLEANUP_FAILURES) {
        logger.error(`[Cleanup] ⚠️ ALERT: ${cleanupFailureCount} consecutive failures! Check disk space and permissions.`);
      }
    }
  };

  // Run initial cleanup after 1 minute (let server fully start)
  setTimeout(runCleanupWithErrorHandling, 60 * 1000);

  // Schedule recurring cleanup
  setInterval(runCleanupWithErrorHandling, CLEANUP_INTERVAL_MS);

  logger.info("[Cleanup] 🧹 Automatic cleanup service initialized", {
    interval_hours: 24,
    initial_run_in_seconds: 60,
  });
  // ========== END CLEANUP SERVICE ==========
});

// Export bot timeout scheduler for API access
export function getBotTimeoutScheduler() {
  return botTimeoutScheduler;
}

export { server };

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully...");
  process.exit(0);
});
