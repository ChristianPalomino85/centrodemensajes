import { type ChannelKey } from "../flow/types";
import { RuntimeEngine } from "../runtime/engine";
import { type IncomingMessage, type OutboundMessage } from "../runtime/executor";
import {
  type WhatsAppApiConfig,
  type WhatsAppApiResult,
  type WhatsAppButtonDefinition,
  type WhatsAppListOption,
  type WhatsAppMediaType,
  sendButtonsMessage,
  sendListMessage,
  sendMediaMessage,
  sendTextMessage,
} from "./whatsapp-sender";

// CRITICAL FIX: Import backend WhatsApp sending function (works correctly)
import { sendWhatsAppMessage } from "../../server/services/whatsapp";
import type { MessageGroupingService } from "../../server/services/message-grouping";
// CRITICAL FIX: Import Pool to query attachments for Vision API
import { Pool } from "pg";
// CRITICAL FIX: Import attachment storage to read images for base64 conversion
import { attachmentStorage } from "../../server/crm/storage";
import { readFile } from "fs/promises";

export interface Logger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface FlowResolution {
  sessionId: string;
  flowId: string;
  contactId: string;
  channel?: ChannelKey;
}

export interface WhatsAppMessageContext {
  value: ChangeValue;
  message: WhatsAppMessage;
  entryId: string;
}

export type FlowResolver = (context: WhatsAppMessageContext) => Promise<FlowResolution | null>;

export interface WhatsAppWebhookHandlerOptions {
  verifyToken: string;
  engine: RuntimeEngine;
  apiConfig: WhatsAppApiConfig;
  resolveApiConfig?: (phoneNumberId: string) => Promise<WhatsAppApiConfig | null> | WhatsAppApiConfig | null;
  resolveFlow: FlowResolver;
  logger?: Logger;
  messageGroupingService?: MessageGroupingService; // Optional message grouping service for IA Agent
  onIncomingMessage?: (payload: {
    entryId: string;
    value: ChangeValue;
    message: WhatsAppMessage;
  }) => Promise<void> | void;
  onBotTransfer?: (payload: {
    phone: string;
    phoneNumberId?: string; // WhatsApp Business Phone Number ID (channelConnectionId)
    queueId: string | null;
    transferTarget?: string; // "queue", "advisor", or "bot"
    transferDestination?: string; // ID of queue/advisor/flow
    flowId?: string; // Flow ID for context
  }) => Promise<void> | void;
  onBotMessage?: (payload: {
    phone: string;
    phoneNumberId?: string;
    flowId?: string; // Flow ID for context
    message: OutboundMessage;
    result: {ok: boolean; status: number};
  }) => Promise<void> | void;
  onFlowEnd?: (payload: {
    phone: string;
    phoneNumberId?: string;
    flowId?: string;
  }) => Promise<void> | void;
}

export class WhatsAppWebhookHandler {
  private readonly verifyToken: string;

  private readonly engine: RuntimeEngine;

  private readonly apiConfig: WhatsAppApiConfig;

  private readonly resolveApiConfig?: WhatsAppWebhookHandlerOptions["resolveApiConfig"];

  private readonly resolveFlow: FlowResolver;

  private readonly logger?: Logger;

  private readonly messageGroupingService?: MessageGroupingService;

  private readonly onIncomingMessage?: WhatsAppWebhookHandlerOptions["onIncomingMessage"];
  private readonly onBotTransfer?: WhatsAppWebhookHandlerOptions["onBotTransfer"];
  private readonly onBotMessage?: WhatsAppWebhookHandlerOptions["onBotMessage"];
  private readonly onFlowEnd?: WhatsAppWebhookHandlerOptions["onFlowEnd"];

  private currentPhoneNumberId?: string; // Track current incoming phoneNumberId
  private currentFlowId?: string; // Track current flow ID

  constructor(options: WhatsAppWebhookHandlerOptions) {
    this.verifyToken = options.verifyToken;
    this.engine = options.engine;
    this.apiConfig = options.apiConfig;
    this.resolveApiConfig = options.resolveApiConfig;
    this.resolveFlow = options.resolveFlow;
    this.logger = options.logger;
    this.messageGroupingService = options.messageGroupingService;
    this.onIncomingMessage = options.onIncomingMessage;
    this.onBotTransfer = options.onBotTransfer;
    this.onBotMessage = options.onBotMessage;
    this.onFlowEnd = options.onFlowEnd;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return this.handleVerify(request);
    }
    if (request.method === "POST") {
      return this.handleIncoming(request);
    }
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleVerify(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === this.verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  private async handleIncoming(request: Request): Promise<Response> {
    try {
      const payload = (await request.json()) as WhatsAppWebhookPayload;
      if (!payload.entry) {
        return this.ok();
      }
      for (const entry of payload.entry) {
        for (const change of entry.changes ?? []) {
          if (!change.value.messages) continue;
          for (const message of change.value.messages) {
            await this.processMessage(entry.id, change.value, message);
          }
        }
      }
      return this.ok();
    } catch (error) {
      this.logger?.error?.("Failed to handle webhook", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async processMessage(entryId: string, value: ChangeValue, message: WhatsAppMessage): Promise<void> {
    try {
      console.log('[processMessage] 🔵 START - messageId:', message.id, 'from:', message.from);

      // CRITICAL: Store incoming phoneNumberId and flowId for correct response routing
      this.currentPhoneNumberId = value.metadata?.phone_number_id;
      console.log('[processMessage] 📱 phoneNumberId:', this.currentPhoneNumberId);

      const context: WhatsAppMessageContext = { entryId, value, message };
      console.log('[processMessage] 🔍 Calling resolveFlow...');
      const resolution = await this.resolveFlow(context);
      console.log('[processMessage] ✅ resolveFlow returned:', resolution ? `flowId=${resolution.flowId}` : 'null');

      // Always process through CRM first
      console.log('[processMessage] 📋 Calling onIncomingMessage...');
      await this.onIncomingMessage?.({ entryId, value, message });
      console.log('[processMessage] ✅ onIncomingMessage completed');

      // If no flow assigned, skip bot execution (message only goes to CRM)
      if (!resolution) {
        console.log('[processMessage] 🚫 No resolution - exiting early');
        this.currentFlowId = undefined;
        this.logger?.info?.("No flow assigned - message forwarded to CRM only", {
          from: message.from,
          phoneNumberId: value.metadata?.phone_number_id,
        });
        return;
      }

      // Store flowId for callbacks
      this.currentFlowId = resolution.flowId;
      console.log('[processMessage] 🤖 Resolution found - flowId:', this.currentFlowId);

      // CRITICAL: Check if this flow uses IA Agent and if message grouping is enabled
      const shouldUseGrouping = this.messageGroupingService && await this.shouldUseMessageGrouping(resolution.flowId);

      if (shouldUseGrouping) {
        console.log('[processMessage] 📦 Using message grouping for IA Agent flow');
        // Use message grouping - add message to queue and wait for timeout
        const conversationId = `${resolution.contactId}_${this.currentPhoneNumberId || 'default'}`;
        // CRITICAL FIX: Capture phoneNumberId NOW before it gets overwritten by other concurrent messages
        const capturedPhoneNumberId = this.currentPhoneNumberId;

        await this.messageGroupingService!.addMessage(
          conversationId,
          message,
          async (groupedMessages) => {
            console.log(`[processMessage] ⚡ Processing ${groupedMessages.length} grouped messages for ${conversationId}`);
            // CRITICAL FIX: Restore the correct phoneNumberId for this conversation before processing
            this.currentPhoneNumberId = capturedPhoneNumberId;
            console.log(`[processMessage] 📱 Restored phoneNumberId: ${this.currentPhoneNumberId} for conversation ${conversationId}`);
            await this.processGroupedMessages(entryId, value, groupedMessages, resolution);
          }
        );
        console.log('[processMessage] ✅ Message added to grouping queue');
        return;
      }

      // Normal processing for non-IA Agent flows
      console.log('[processMessage] 🔧 Processing message without grouping');
      await this.processSingleMessage(entryId, value, message, resolution);

    } catch (error) {
      this.logger?.error?.("Runtime processing failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        entryId,
        messageId: message.id,
      });
    }
  }

  /**
   * Check if a flow uses IA Agent node (requires message grouping)
   */
  private async shouldUseMessageGrouping(flowId: string): Promise<boolean> {
    try {
      // Get flow from engine
      const flow = await this.engine.getFlow(flowId);
      if (!flow) {
        console.log(`[MessageGrouping] 🚫 Flow ${flowId} not found`);
        return false;
      }

      console.log(`[MessageGrouping] 🔍 Checking flow ${flowId} with ${Object.keys(flow.nodes).length} nodes`);

      // Check if any node is of type "ia_agent"
      for (const [nodeId, node] of Object.entries(flow.nodes)) {
        console.log(`[MessageGrouping]   Node ${nodeId}: type="${node.type}", action.kind="${node.action?.kind}"`);
        if (node.action?.kind === "ia_agent") {
          console.log(`[MessageGrouping] ✅ Flow ${flowId} uses IA Agent node - grouping ENABLED`);
          return true;
        }
      }

      console.log(`[MessageGrouping] ❌ Flow ${flowId} does NOT use IA Agent - grouping DISABLED`);
      return false;
    } catch (error) {
      console.error('[MessageGrouping] Error checking flow for IA Agent:', error);
      return false;
    }
  }

  /**
   * Process grouped messages - combine text from all messages and send to agent once
   * ENHANCED: Handles multiple images + text combinations
   */
  private async processGroupedMessages(
    entryId: string,
    value: ChangeValue,
    messages: WhatsAppMessage[],
    resolution: FlowResolution
  ): Promise<void> {
    console.log(`[processGroupedMessages] Processing ${messages.length} messages`);

    // Separate images and text messages - NOW CAPTURES ALL IMAGES
    const textParts: string[] = [];
    const imageMessages: WhatsAppMessage[] = [];
    let lastMessage = messages[messages.length - 1]; // Use last message metadata

    for (const msg of messages) {
      if (msg.type === 'text' && msg.text?.body) {
        textParts.push(msg.text.body);
      } else if (msg.type === 'interactive') {
        // Handle button/list replies
        const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        if (reply?.title) {
          textParts.push(reply.title);
        }
      } else if (msg.type === 'button' && msg.button?.text) {
        textParts.push(msg.button.text);
      } else if (msg.type === 'image' && msg.image) {
        // Capture ALL images
        imageMessages.push(msg);
        console.log(`[processGroupedMessages] 📷 Found image ${imageMessages.length} with id:`, msg.image.id);
        // Also add image caption if present
        if (msg.image.caption) {
          textParts.push(msg.image.caption);
        }
      }
    }

    console.log(`[processGroupedMessages] Found ${imageMessages.length} images and ${textParts.length} text parts`);

    // CASE 1: Multiple images - process each one sequentially
    if (imageMessages.length > 1) {
      console.log(`[processGroupedMessages] 📷📷 Processing ${imageMessages.length} images sequentially`);

      // Add context text to first image only
      const combinedCaption = textParts.length > 0 ? textParts.join('\n') : '';

      for (let i = 0; i < imageMessages.length; i++) {
        const imgMsg = imageMessages[i];
        const isFirst = i === 0;
        const imageNum = i + 1;

        // Create message with context (only for first image) or image number indicator
        const caption = isFirst && combinedCaption
          ? `[Imagen ${imageNum} de ${imageMessages.length}]\n${combinedCaption}`
          : `[Imagen ${imageNum} de ${imageMessages.length}]`;

        const imageWithCaption: WhatsAppMessage = {
          ...imgMsg,
          image: {
            ...imgMsg.image!,
            caption: caption,
          },
        };

        console.log(`[processGroupedMessages] 📷 Processing image ${imageNum}/${imageMessages.length}`);
        await this.processSingleMessage(entryId, value, imageWithCaption, resolution);
      }
      return;
    }

    // CASE 2: Single image + Text - combine image with text as caption
    if (imageMessages.length === 1 && textParts.length > 0) {
      const combinedCaption = textParts.join('\n');
      console.log(`[processGroupedMessages] 📷+💬 Image + Text detected. Caption: "${combinedCaption.substring(0, 50)}..."`);

      // Create combined message: image with all text as caption
      const combinedMessage: WhatsAppMessage = {
        ...imageMessages[0],
        image: {
          ...imageMessages[0].image!,
          caption: combinedCaption, // Add all text as caption
        },
      };

      await this.processSingleMessage(entryId, value, combinedMessage, resolution);
      return;
    }

    // CASE 3: Single image only - process as-is
    if (imageMessages.length === 1 && textParts.length === 0) {
      console.log('[processGroupedMessages] 📷 Single image only, processing as-is');
      await this.processSingleMessage(entryId, value, imageMessages[0], resolution);
      return;
    }

    // CASE 4: No text and no image - process last message normally
    if (textParts.length === 0) {
      console.log('[processGroupedMessages] No text messages to group, processing last message');
      await this.processSingleMessage(entryId, value, lastMessage, resolution);
      return;
    }

    // CASE 5: Text only - combine all text messages
    const combinedText = textParts.join('\n');
    console.log(`[processGroupedMessages] 💬 Combined ${messages.length} text messages: "${combinedText.substring(0, 100)}..."`);

    // Create a synthetic WhatsApp message with combined text
    const combinedMessage: WhatsAppMessage = {
      ...lastMessage,
      type: 'text',
      text: { body: combinedText },
    };

    // Process the combined message
    await this.processSingleMessage(entryId, value, combinedMessage, resolution);
  }

  /**
   * Process a single message (or combined grouped message)
   */
  private async processSingleMessage(
    entryId: string,
    value: ChangeValue,
    message: WhatsAppMessage,
    resolution: FlowResolution
  ): Promise<void> {
    // CRITICAL FIX: Extract phoneNumberId from value metadata to pass through the chain
    // This prevents race condition where concurrent messages overwrite this.currentPhoneNumberId
    const messagePhoneNumberId = value.metadata?.phone_number_id;
    console.log('[processSingleMessage] 🔑 Extracted phoneNumberId from message:', messagePhoneNumberId);

    console.log('[processSingleMessage] Converting message to runtime format...');
    const incoming = await convertMessageToRuntime(message);
    console.log('[processSingleMessage] 📤 Converted message:', JSON.stringify(incoming, null, 2));

    console.log('[processSingleMessage] 🚀 Calling engine.processMessage with:', {
      sessionId: resolution.sessionId,
      flowId: resolution.flowId,
      channel: resolution.channel ?? "whatsapp",
      contactId: resolution.contactId,
    });

    const result = await this.engine.processMessage({
      sessionId: resolution.sessionId,
      flowId: resolution.flowId,
      channel: resolution.channel ?? "whatsapp",
      contactId: resolution.contactId,
      message: incoming,
      metadata: { whatsapp: message },
    });

    console.log('[processSingleMessage] ✅ engine.processMessage returned - responses:', result.responses.length, 'ended:', result.ended);

    // Send responses sequentially with small delay to prevent out-of-order delivery
    for (let i = 0; i < result.responses.length; i++) {
      const response = result.responses[i];
      // CRITICAL FIX: Pass messagePhoneNumberId to prevent race condition
      await this.dispatchOutbound(resolution.contactId, response, message.from, messagePhoneNumberId);

      // Add 300ms delay between messages to ensure correct order (except for last message)
      if (i < result.responses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Handle transfer request from IA Agent
    if (result.shouldTransfer && result.transferQueue) {
      console.log('[processSingleMessage] 🎯 IA Agent requested transfer to queue:', result.transferQueue);
      if (this.onBotTransfer) {
        console.log('[processSingleMessage] 📞 Calling onBotTransfer callback for IA Agent...');
        await this.onBotTransfer({
          phone: message.from,
          phoneNumberId: this.currentPhoneNumberId,
          queueId: result.transferQueue,
          transferTarget: 'queue',
          transferDestination: result.transferQueue,
          flowId: this.currentFlowId,
        });
        console.log('[processSingleMessage] ✅ IA Agent transfer callback completed');
      } else {
        console.log('[processSingleMessage] ⚠️  No onBotTransfer callback registered - transfer will not be processed');
      }
    }

    // Handle flow ended - call onFlowEnd callback to archive conversation
    // CRITICAL: Do NOT end flow if there's a pending transfer
    if (result.ended && !result.shouldTransfer) {
      console.log('[processSingleMessage] 🏁 Flow ended - calling onFlowEnd callback');
      if (this.onFlowEnd) {
        await this.onFlowEnd({
          phone: message.from,
          phoneNumberId: this.currentPhoneNumberId,
          flowId: this.currentFlowId,
        });
        console.log('[processSingleMessage] ✅ onFlowEnd callback completed');
      } else {
        console.log('[processSingleMessage] ⚠️  No onFlowEnd callback registered');
      }
    } else if (result.shouldTransfer) {
      console.log('[processSingleMessage] 🔄 Transfer requested to queue:', result.transferQueue, '- NOT ending flow');
    }
  }

  private async getActiveApiConfig(): Promise<WhatsAppApiConfig> {
    // CRITICAL: Use phoneNumberId from incoming message to get correct API config
    if (this.currentPhoneNumberId && this.resolveApiConfig) {
      const resolved = await this.resolveApiConfig(this.currentPhoneNumberId);
      if (resolved) {
        return resolved;
      }
    }
    // Fallback to default config
    return this.apiConfig;
  }

  // CRITICAL FIX: Added phoneNumberId parameter to prevent race condition
  // Previously used this.currentPhoneNumberId which could be overwritten by concurrent messages
  private async dispatchOutbound(to: string, message: OutboundMessage, phone: string, phoneNumberId?: string): Promise<void> {
    // Use passed phoneNumberId or fall back to instance variable (for backward compatibility)
    const effectivePhoneNumberId = phoneNumberId || this.currentPhoneNumberId;
    const apiConfig = await this.getActiveApiConfig();

    switch (message.type) {
      case "text": {
        // CRITICAL FIX: Use backend sendWhatsAppMessage instead of frontend sendTextMessage
        // Pass effectivePhoneNumberId to prevent race condition
        await this.safeSendBackend(to, message.text, null, null, phone, message, effectivePhoneNumberId);
        return;
      }
      case "buttons": {
        // IMPROVED: Send interactive buttons (max 3 allowed by WhatsApp)
        const buttons: WhatsAppButtonDefinition[] = message.buttons
          .slice(0, 3) // WhatsApp allows max 3 buttons
          .map((btn, index) => ({
            // CRITICAL FIX: Ensure ID is never empty string (WhatsApp requirement)
            id: (btn.value && btn.value.trim()) || (btn.id && btn.id.trim()) || `BTN_${index + 1}`,
            title: (btn.label ?? `Opción ${index + 1}`).substring(0, 20), // Max 20 chars
          }));

        // CRITICAL FIX: WhatsApp requires non-empty body text for interactive buttons
        const bodyText = message.text?.trim() || "Selecciona una opción:";

        console.log('[WhatsApp] Sending interactive buttons:', {
          count: buttons.length,
          text: bodyText.substring(0, 50)
        });

        await this.safeSend(
          () => sendButtonsMessage(apiConfig, to, bodyText, buttons),
          message,
          phone
        );
        return;
      }
      case "media": {
        const mediaType = normalizeMediaType(message.mediaType);
        await this.safeSend(
          () => sendMediaMessage(apiConfig, to, message.url, mediaType, message.caption, message.filename),
          message,
          phone,
        );
        return;
      }
      case "menu": {
        console.log('🟣 [WhatsApp] MENU RESPONSE RECEIVED:', {
          isPlainText: message.isPlainText,
          optionCount: message.options.length,
          text: message.text?.substring(0, 50)
        });

        // Check if this is a simple menu (always send as plain text)
        if (message.isPlainText) {
          const text = buildMenuText(message);
          console.log('[WhatsApp] Sending simple menu as plain text:', {
            text: text.substring(0, 100) + '...'
          });
          await this.safeSend(() => sendTextMessage(apiConfig, to, text), message, phone);
          return;
        }

        // IMPROVED: Smart menu handling based on option count
        const optionCount = message.options.length;

        // Strategy: 1-3 options → buttons, 4-10 options → list, >10 → text fallback
        if (optionCount >= 1 && optionCount <= 3) {
          // Use interactive buttons for 1-3 options
          const buttons: WhatsAppButtonDefinition[] = message.options.map((option, index) => ({
            // CRITICAL FIX: Ensure ID is never empty string (WhatsApp requirement)
            id: (option.value && option.value.trim()) || (option.id && option.id.trim()) || `OPT_${index + 1}`,
            title: (option.label ?? `Opción ${index + 1}`).substring(0, 20),
          }));

          // CRITICAL FIX: WhatsApp requires non-empty body text for interactive buttons
          const bodyText = message.text?.trim() || "Selecciona una opción:";

          console.log('[WhatsApp] Sending menu as interactive buttons:', {
            count: buttons.length,
            text: bodyText.substring(0, 50)
          });

          await this.safeSend(
            () => sendButtonsMessage(apiConfig, to, bodyText, buttons),
            message,
            phone
          );
        } else if (optionCount >= 4 && optionCount <= 10) {
          // Use interactive list for 4-10 options
          const listOptions: WhatsAppListOption[] = message.options.map((option, index) => ({
            // CRITICAL FIX: Ensure ID is never empty string (WhatsApp requirement)
            id: (option.value && option.value.trim()) || (option.id && option.id.trim()) || `OPT_${index + 1}`,
            title: (option.label ?? `Opción ${index + 1}`).substring(0, 24), // Max 24 chars
            description: "",
          }));

          // CRITICAL FIX: WhatsApp requires non-empty body text for interactive lists
          const bodyText = message.text?.trim() || "Selecciona una opción:";

          console.log('[WhatsApp] Sending menu as interactive list:', {
            count: listOptions.length,
            text: bodyText.substring(0, 50)
          });

          await this.safeSend(
            () => sendListMessage(apiConfig, to, bodyText, "Ver opciones", listOptions),
            message,
            phone
          );
        } else {
          // Fallback to text for >10 options or edge cases
          const text = buildMenuText(message);
          console.log('[WhatsApp] Sending menu as text (>10 options):', {
            count: optionCount,
            text: text.substring(0, 100) + '...'
          });
          await this.safeSend(() => sendTextMessage(apiConfig, to, text), message, phone);
        }
        return;
      }
      case "system":
        console.log('[WhatsApp] 🔍 System message received:', JSON.stringify(message.payload, null, 2));
        this.logger?.info?.("System message received", { payload: message.payload });

        // CRITICAL: Process bot transfer to prevent conversations going to limbo
        if (message.payload?.action === "transfer_to_agent" ||
            message.payload?.action === "transfer" ||
            message.payload?.action === "handoff_to_agent") {
          const payload = message.payload as any;

          // Extract queue information
          let queueId = payload.queueId as string | null;
          let transferTarget = payload.transferTarget as string | undefined; // "queue", "advisor", or "bot"
          let transferDestination = payload.transferDestination as string | undefined;

          // Handle handoff_to_agent format (uses metadata.queue instead)
          if (message.payload.action === "handoff_to_agent") {
            const metadata = payload.metadata as any;
            queueId = metadata?.queue || "default";
            transferTarget = "queue";
            transferDestination = queueId || "default";
          }

          console.log('[WhatsApp] 🎯 Bot transfer detected!', {
            to,
            queueId,
            transferTarget,
            transferDestination,
            hasCallback: !!this.onBotTransfer
          });

          this.logger?.info?.("Bot transfer detected", {
            to,
            queueId,
            transferTarget,
            transferDestination
          });

          if (this.onBotTransfer) {
            console.log('[WhatsApp] 📞 Calling onBotTransfer callback...');
            console.log('[WhatsApp] 🔑 Using phoneNumberId:', effectivePhoneNumberId, '(passed:', phoneNumberId, ', instance:', this.currentPhoneNumberId, ')');
            await this.onBotTransfer({
              phone: to,
              phoneNumberId: effectivePhoneNumberId, // CRITICAL FIX: Use effective (passed) phoneNumberId
              queueId: queueId || null,
              transferTarget: transferTarget || "queue",
              transferDestination: transferDestination || "",
              flowId: this.currentFlowId,
            });
            console.log('[WhatsApp] ✅ onBotTransfer callback completed');
          } else {
            console.log('[WhatsApp] ⚠️ onBotTransfer callback is not defined!');
          }
        }
        // CRITICAL: Process flow end to close/archive conversation
        else if (message.payload?.action === "end") {
          console.log('[WhatsApp] 🏁 Flow end detected!', {
            to,
            flowId: this.currentFlowId,
            hasCallback: !!this.onFlowEnd
          });

          this.logger?.info?.("Flow end detected", {
            to,
            flowId: this.currentFlowId
          });

          if (this.onFlowEnd) {
            console.log('[WhatsApp] 📞 Calling onFlowEnd callback...');
            await this.onFlowEnd({
              phone: to,
              phoneNumberId: effectivePhoneNumberId, // CRITICAL FIX: Use effective phoneNumberId
              flowId: this.currentFlowId,
            });
            console.log('[WhatsApp] ✅ onFlowEnd callback completed');
          } else {
            console.log('[WhatsApp] ⚠️ onFlowEnd callback is not defined!');
          }
        }
        else {
          console.log('[WhatsApp] ℹ️ System message but not a transfer/end action:', message.payload?.action);
        }
        return;
      default:
        this.logger?.warn?.("Unknown outbound message type", { type: (message as OutboundMessage).type });
    }
  }

  // CRITICAL FIX: New method using backend WhatsApp function
  // Added phoneNumberId parameter to prevent race condition
  private async safeSendBackend(
    to: string,
    text: string | undefined,
    mediaUrl: string | null,
    mediaType: "image" | "audio" | "video" | "document" | "sticker" | null,
    phone: string,
    message: OutboundMessage,
    phoneNumberId?: string, // CRITICAL FIX: Pass phoneNumberId explicitly
  ): Promise<void> {
    // Use passed phoneNumberId or fall back to instance variable
    const effectivePhoneNumberId = phoneNumberId || this.currentPhoneNumberId;
    try {
      console.log('[WhatsApp Backend] Sending message...', { phone, messageType: message.type, phoneNumberId: effectivePhoneNumberId });
      const result = await sendWhatsAppMessage({
        phone: to,
        text,
        mediaUrl,
        mediaType: mediaType ?? undefined,
        channelConnectionId: effectivePhoneNumberId, // CRITICAL FIX: Use effective phoneNumberId
      });
      console.log('[WhatsApp Backend] Message sent. Result:', { ok: result.ok, status: result.status });

      // Notify CRM about bot message
      if (this.onBotMessage) {
        console.log('[WhatsApp Backend] Calling onBotMessage callback...');
        await this.onBotMessage({
          phone,
          phoneNumberId: effectivePhoneNumberId, // CRITICAL FIX: Use effective phoneNumberId
          flowId: this.currentFlowId,
          message,
          result: { ok: result.ok, status: result.status },
        });
        console.log('[WhatsApp Backend] onBotMessage callback completed');
      }

      if (!result.ok) {
        this.logger?.warn?.("WhatsApp Backend API call failed", {
          status: result.status,
          body: result.body,
          message,
        });
      }
    } catch (error) {
      console.error('[WhatsApp Backend] Error in safeSendBackend:', error);
      this.logger?.error?.("WhatsApp Backend API call threw", {
        error: error instanceof Error ? error.message : "Unknown error",
        message,
      });
    }
  }

  private async safeSend(
    sender: () => Promise<WhatsAppApiResult>,
    message: OutboundMessage,
    phone: string,
  ): Promise<void> {
    try {
      console.log('[WhatsApp] Sending message via API...', { phone, messageType: message.type });
      const result = await sender();
      console.log('[WhatsApp] Message sent. Result:', { ok: result.ok, status: result.status });

      // Notify CRM about bot message
      if (this.onBotMessage) {
        console.log('[WhatsApp] Calling onBotMessage callback...');
        await this.onBotMessage({
          phone,
          phoneNumberId: this.currentPhoneNumberId, // Pass phoneNumberId to CRM
          flowId: this.currentFlowId, // Pass flowId to CRM
          message,
          result: { ok: result.ok, status: result.status },
        });
        console.log('[WhatsApp] onBotMessage callback completed');
      } else {
        console.warn('[WhatsApp] WARNING: onBotMessage callback is NOT defined!');
      }

      if (!result.ok) {
        this.logger?.warn?.("WhatsApp API call failed", {
          status: result.status,
          body: result.body,
          message,
        });
      }
    } catch (error) {
      console.error('[WhatsApp] Error in safeSend:', error);
      this.logger?.error?.("WhatsApp API call threw", {
        error: error instanceof Error ? error.message : "Unknown error",
        message,
      });
    }
  }

  private ok(): Response {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// PostgreSQL connection pool for attachment lookups
const pgPool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  max: 5,
});

/**
 * Get base64-encoded image for OpenAI Vision API
 * Looks up attachment in DB by WhatsApp media ID (stored as filename)
 * Reads file and converts to base64 data URL
 */
async function getPublicMediaUrl(mediaId: string | undefined): Promise<string | undefined> {
  if (!mediaId) return undefined;

  try {
    // Query DB for attachment by filename (WhatsApp media ID is stored as filename)
    const result = await pgPool.query(
      'SELECT id, url FROM crm_attachments WHERE filename = $1 LIMIT 1',
      [mediaId]
    );

    if (result.rows.length > 0) {
      const attachmentId = result.rows[0].id;

      // Get file metadata and path
      const metadata = await attachmentStorage.getMetadata(attachmentId);
      if (!metadata) {
        console.log(`[Vision] ⚠️  Attachment metadata not found for ${attachmentId}`);
        return mediaId;
      }

      // Read file as buffer
      const buffer = await readFile(metadata.filepath);

      // Convert to base64
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${metadata.mime};base64,${base64}`;

      console.log(`[Vision] 📸 Converted attachment ${attachmentId} to base64 (${buffer.length} bytes, ${metadata.mime})`);
      return dataUrl;
    }

    console.log(`[Vision] ⚠️  No attachment found for media ID: ${mediaId}, using original ID`);
    return mediaId;
  } catch (error) {
    console.error('[Vision] Error converting image to base64:', error);
    return mediaId; // Fallback to original ID
  }
}

async function convertMessageToRuntime(message: WhatsAppMessage): Promise<IncomingMessage> {
  const raw = message as unknown as Record<string, unknown>;
  switch (message.type) {
    case "text":
      return { type: "text", text: message.text?.body ?? "", raw };
    case "button":
      return {
        type: "button",
        text: message.button?.text,
        payload: message.button?.payload ?? message.button?.text,
        raw,
      };
    case "interactive":
      if (message.interactive?.button_reply) {
        return {
          type: "button",
          text: message.interactive.button_reply.title,
          payload: message.interactive.button_reply.id,
          raw,
        };
      }
      if (message.interactive?.list_reply) {
        return {
          type: "button",
          text: message.interactive.list_reply.title,
          payload: message.interactive.list_reply.id,
          raw,
        };
      }
      return { type: "unknown", raw };
    case "image":
      return {
        type: "media",
        mediaUrl: await getPublicMediaUrl(message.image?.id) ?? message.image?.link,
        mediaType: "image",
        caption: message.image?.caption,
        raw,
      };
    case "video":
      return {
        type: "media",
        mediaUrl: await getPublicMediaUrl(message.video?.id) ?? message.video?.link,
        mediaType: "video",
        caption: message.video?.caption,
        raw,
      };
    case "document":
      return {
        type: "media",
        mediaUrl: await getPublicMediaUrl(message.document?.id) ?? message.document?.link,
        mediaType: "document",
        caption: message.document?.caption,
        filename: message.document?.filename,
        raw,
      };
    case "audio":
      return {
        type: "media",
        mediaUrl: await getPublicMediaUrl(message.audio?.id) ?? message.audio?.link,
        mediaType: "audio",
        raw,
      };
    case "sticker":
      return {
        type: "media",
        mediaUrl: await getPublicMediaUrl(message.sticker?.id) ?? message.sticker?.link,
        mediaType: "sticker",
        raw,
      };
    default:
      return { type: "unknown", raw };
  }
}

function buildMenuText(message: Extract<OutboundMessage, { type: "menu" }>): string {
  const lines = [];
  // Only add menu text if it's not empty or whitespace
  if (message.text && message.text.trim()) {
    lines.push(message.text);
  }
  message.options.forEach((option, index) => {
    const label = option.label ?? option.value ?? `Opción ${index + 1}`;
    // Use simple text format without special characters to avoid WhatsApp's list detection
    lines.push(`${index + 1}. ${label}`);
  });
  return lines.join("\n\n");
}

function normalizeMediaType(type: string): WhatsAppMediaType {
  switch (type) {
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      return type;
    case "file":
    default:
      return "document";
  }
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: WhatsAppEntry[];
}

interface WhatsAppEntry {
  id: string;
  changes?: Change[];
}

interface Change {
  field: string;
  value: ChangeValue;
}

export interface ChangeValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: WhatsAppMessage[];
}

interface WhatsAppMessageBase {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  context?: {
    from?: string;
    id?: string;  // ID of the message being replied to
  };
  referral?: {
    source_url?: string;      // URL of the Facebook ad or post
    source_id?: string;        // Ad ID
    source_type?: string;      // "ad" or "post"
    headline?: string;         // Ad title
    body?: string;             // Ad description
    media_type?: string;       // "image" or "video"
    image_url?: string;        // Image URL if applicable
    video_url?: string;        // Video URL if applicable
    thumbnail_url?: string;    // Thumbnail URL if applicable
    ctwa_clid?: string;        // Click ID from Meta for Click-to-WhatsApp ads
  };
}

interface TextMessage extends WhatsAppMessageBase {
  type: "text";
  text?: { body?: string };
}

interface ButtonMessage extends WhatsAppMessageBase {
  type: "button";
  button?: { text?: string; payload?: string };
}

interface InteractiveButtonMessage extends WhatsAppMessageBase {
  type: "interactive";
  interactive?: {
    type?: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface MediaMessage extends WhatsAppMessageBase {
  type: "image" | "video" | "document" | "audio" | "sticker";
  image?: { id?: string; link?: string; caption?: string; mime_type?: string };
  video?: { id?: string; link?: string; caption?: string; mime_type?: string };
  document?: { id?: string; link?: string; caption?: string; mime_type?: string; filename?: string };
  audio?: { id?: string; link?: string; mime_type?: string };
  sticker?: { id?: string; link?: string; mime_type?: string };
}

interface ReactionMessage extends WhatsAppMessageBase {
  type: "reaction";
  reaction?: {
    message_id: string;  // ID of the message being reacted to
    emoji: string;       // The emoji reaction (e.g., "👏", "❤️")
  };
}

interface ContactsMessage extends WhatsAppMessageBase {
  type: "contacts";
  contacts?: Array<{
    name?: { formatted_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
  }>;
}

interface UnsupportedMessage extends WhatsAppMessageBase {
  type: "unsupported";
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

export type WhatsAppMessage = TextMessage | ButtonMessage | InteractiveButtonMessage | MediaMessage | ReactionMessage | ContactsMessage | UnsupportedMessage;
