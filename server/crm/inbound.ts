import type { ChangeValue, WhatsAppMessage } from "../../src/api/whatsapp-webhook";
import { crmDb } from "./db";
import { metricsTracker } from "./metrics-tracker";
import type { CrmRealtimeManager } from "./ws";
import type { BitrixService } from "./services/bitrix";
import { attachmentStorage } from "./storage";
import type { Attachment, MessageType } from "./models";
import { logDebug, logError } from "../utils/file-logger";
import { getWhatsAppEnv } from "../utils/env";
import { getCachedProfilePicture } from "../services/whatsapp-profile";
import { adminDb } from "../admin-db";
import { errorTracker } from "./error-tracker";
import axios from "axios";
import { Pool } from "pg";
import { LocalStorageFlowProvider } from "../flow-provider";

// Create flowProvider instance to check if bot is active for a number
const flowProvider = new LocalStorageFlowProvider();

/**
 * Normalize displayNumber format for consistency
 * Removes extra spaces and ensures the number starts with "+"
 * Examples:
 *   "+51 1 6193636" -> "+51 6193636"
 *   "51961842916"   -> "+51961842916"
 *   "+51 961842916" -> "+51 961842916"
 */
function normalizeDisplayNumber(displayNumber: string | null): string | null {
  if (!displayNumber) return null;

  // Remove all whitespace characters
  let normalized = displayNumber.replace(/\s+/g, '');

  // Ensure it starts with "+"
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  return normalized;
}

/**
 * Update connection with WABA ID from webhook
 * This automatically captures the WhatsApp Business Account ID from incoming webhooks
 */
async function updateConnectionWabaId(phoneNumberId: string, wabaId: string): Promise<void> {
  try {
    // Read from PostgreSQL
    const pool = new Pool({
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      host: process.env.POSTGRES_HOST || 'localhost',
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
    });

    // Update WABA ID if not already set
    const result = await pool.query(
      `UPDATE whatsapp_connections
       SET waba_id = $1, updated_at = NOW()
       WHERE phone_number_id = $2 AND (waba_id IS NULL OR waba_id = '')
       RETURNING id, alias`,
      [wabaId, phoneNumberId]
    );

    await pool.end();

    if (result.rows.length > 0) {
      const connection = result.rows[0];
      logDebug(`[CRM] Updated connection ${connection.id} (${connection.alias}) with WABA ID: ${wabaId}`);
    }
  } catch (error) {
    logError(`[CRM] Failed to update connection with WABA ID:`, error);
  }
}

interface HandleIncomingArgs {
  entryId: string;
  value: ChangeValue;
  message: WhatsAppMessage;
  socketManager: CrmRealtimeManager;
  bitrixService: BitrixService;
}

/**
 * Check if conversation should auto-close based on:
 * - Last business message had buttons "Sí por favor" / "No gracias"
 * - More than 1 hour has passed since that message
 * - Customer just responded
 */
async function checkAndAutoCloseConversation(
  conversationId: string,
  socketManager: CrmRealtimeManager
): Promise<void> {
  try {
    // Get last outgoing message from business
    const messages = await crmDb.getMessagesByConversationId(conversationId);
    const lastOutgoing = messages
      .filter(m => m.direction === 'outgoing')
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

    if (!lastOutgoing) {
      return; // No outgoing messages
    }

    // Check if message has buttons in metadata
    const metadata = lastOutgoing.metadata as any;
    const buttons = metadata?.buttons;

    if (!buttons || !Array.isArray(buttons)) {
      return; // No buttons found
    }

    // Check if buttons match "Sí por favor" / "No gracias"
    const hasTargetButtons = buttons.some((btn: any) =>
      btn.title === 'Sí por favor' || btn.title === 'No gracias'
    ) && buttons.some((btn: any) =>
      btn.title === 'No gracias' || btn.title === 'Sí por favor'
    );

    if (!hasTargetButtons) {
      return; // Not the target buttons
    }

    // Check if more than 1 hour has passed
    const now = Date.now();
    const messageTime = lastOutgoing.timestamp || 0;
    const hourInMs = 60 * 60 * 1000;

    if (now - messageTime <= hourInMs) {
      return; // Less than 1 hour
    }

    // AUTO-CLOSE: All conditions met
    logDebug(`[CRM] 🔒 Auto-closing conversation ${conversationId} - customer responded after 1h to "Sí por favor"/"No gracias" buttons`);

    await crmDb.updateConversationMeta(conversationId, {
      status: 'closed',
      closedReason: 'Auto-cerrado: respuesta tardía a botones de finalización',
      closedAt: now
    });

    // Create system message
    const systemMessage = await crmDb.createSystemEvent(
      conversationId,
      'conversation_closed',
      '🔒 Conversación cerrada automáticamente (respuesta tardía)'
    );

    // Emit WebSocket events
    const conversation = await crmDb.getConversationById(conversationId);
    if (conversation) {
      socketManager.emitConversationUpdate({ conversation });
    }
    socketManager.emitNewMessage({ message: systemMessage });

    logDebug(`[CRM] ✅ Conversation ${conversationId} auto-closed successfully`);
  } catch (error) {
    logError(`[CRM] ❌ Error in checkAndAutoCloseConversation:`, error);
  }
}

export async function handleIncomingWhatsAppMessage(args: HandleIncomingArgs): Promise<void> {
  const phone = args.message.from;
  if (!phone) {
    return;
  }

  // CRITICAL: Extract phoneNumberId and displayNumber from webhook metadata
  // This ensures conversations from different WhatsApp numbers stay separate
  const phoneNumberId = args.value.metadata?.phone_number_id || null;
  const rawDisplayNumber = args.value.metadata?.display_phone_number || null;
  const displayNumber = normalizeDisplayNumber(rawDisplayNumber); // Normalize format for consistency
  const wabaId = args.entryId; // WhatsApp Business Account ID from webhook entry

  logDebug(`[CRM] Incoming message from ${phone} via phoneNumberId: ${phoneNumberId} (${displayNumber}), WABA: ${wabaId}`);

  // IMPORTANT: Extract ad referral data from WhatsApp message (Facebook/Instagram Ads tracking)
  const referral = args.message.referral;
  let adReferralData = referral ? {
    sourceUrl: referral.source_url || null,
    sourceId: referral.source_id || null,
    sourceType: referral.source_type || null,
    headline: referral.headline || null,
    body: referral.body || null,
    mediaType: referral.media_type || null,
    imageUrl: referral.image_url || null,
    videoUrl: referral.video_url || null,
    thumbnailUrl: referral.thumbnail_url || null,
    ctwaClid: referral.ctwa_clid || null, // CRITICAL: Click ID for conversion tracking
  } : null;

  if (adReferralData && adReferralData.ctwaClid) {
    logDebug(`[CRM] 📢 Ad tracking detected! Source: ${adReferralData.sourceType}, Ad ID: ${adReferralData.sourceId}, Click ID: ${adReferralData.ctwaClid}`);

    // Download and store ad images locally to avoid Facebook CDN expiration
    if (adReferralData.imageUrl) {
      const { downloadAndStoreImage } = await import('../services/image-downloader');
      const localImagePath = await downloadAndStoreImage(adReferralData.imageUrl);
      if (localImagePath) {
        logDebug(`[CRM] ✅ Downloaded ad image: ${localImagePath}`);
        adReferralData.imageUrl = localImagePath;
      } else {
        logDebug(`[CRM] ⚠️ Failed to download ad image, keeping original URL`);
      }
    }

    if (adReferralData.thumbnailUrl) {
      const { downloadAndStoreImage } = await import('../services/image-downloader');
      const localThumbPath = await downloadAndStoreImage(adReferralData.thumbnailUrl);
      if (localThumbPath) {
        logDebug(`[CRM] ✅ Downloaded ad thumbnail: ${localThumbPath}`);
        adReferralData.thumbnailUrl = localThumbPath;
      }
    }
  }

  // Update connection with WABA ID if not already set
  if (phoneNumberId && wabaId) {
    await updateConnectionWabaId(phoneNumberId, wabaId);
  }

  // Get or create conversation using phone + channel + phoneNumberId
  let conversation = await crmDb.getConversationByPhoneAndChannel(phone, "whatsapp", phoneNumberId);
  if (!conversation) {
    // Try to get WhatsApp profile picture
    let avatarUrl: string | null = null;
    try {
      const whatsappEnv = getWhatsAppEnv();
      if (whatsappEnv.accessToken && phoneNumberId) {
        avatarUrl = await getCachedProfilePicture({
          accessToken: whatsappEnv.accessToken,
          phoneNumberId: phoneNumberId,
          apiVersion: whatsappEnv.apiVersion,
          baseUrl: whatsappEnv.baseUrl
        }, phone);
      }
    } catch (error) {
      logError(`[CRM] Failed to fetch profile picture for ${phone}:`, error);
    }

    conversation = await crmDb.createConversation(phone, null, avatarUrl, "whatsapp", phoneNumberId, displayNumber, adReferralData);
    logDebug(`[CRM] Created new conversation ${conversation.id} for ${phone} on WhatsApp ${displayNumber}${avatarUrl ? ' (with profile picture)' : ''}${adReferralData?.ctwaClid ? ' 📢 WITH AD TRACKING' : ''}`);

    // CRITICAL: Check if there's a fallback queue configured for this WhatsApp number
    // This ensures conversations are automatically assigned to a queue when no bot is available
    // IMPROVED: Use display_number as fallback when phone_number_id is not available (handles Meta API issues)
    if (phoneNumberId || displayNumber) {
      // CRITICAL FIX: First check if there's a bot active for this number
      // ONLY assign fallback queue if NO bot is configured
      let hasActiveBot = false;
      if (phoneNumberId) {
        try {
          const assignedFlow = await flowProvider.findFlowByWhatsAppNumber(phoneNumberId);
          hasActiveBot = !!assignedFlow;
          if (hasActiveBot) {
            logDebug(`[CRM] 🤖 Bot active for number ${displayNumber} (${phoneNumberId}) - skipping fallback queue assignment`);
          }
        } catch (error) {
          logError(`[CRM] Error checking for active bot:`, error);
        }
      }

      // Only assign fallback queue if NO bot is active
      if (!hasActiveBot) {
        const whatsappNumbers = await adminDb.getAllWhatsAppNumbers();

        // Normalize phone numbers for comparison (remove spaces, +, -, parentheses)
        const normalizePhone = (phone: string) => phone.replace(/[\s\+\-\(\)]/g, '');
        const normalizedDisplay = normalizePhone(displayNumber || '');

        const numberConfig = whatsappNumbers.find(num =>
          normalizePhone(num.phoneNumber) === normalizedDisplay
        );

        if (numberConfig && numberConfig.queueId) {
          const matchMethod = phoneNumberId ? 'phone_number_id' : 'display_number';
          logDebug(`[CRM] 🔄 Applying fallback queue "${numberConfig.queueId}" for conversation ${conversation.id} (matched ${numberConfig.phoneNumber} with ${displayNumber} via ${matchMethod}) - NO bot active`);
          await crmDb.updateConversationMeta(conversation.id, {
            queueId: numberConfig.queueId,
            queuedAt: Date.now()
          });

          // Create system message to indicate conversation is in queue
          const queue = adminDb.getQueueById(numberConfig.queueId);
          const queueName = queue?.name || numberConfig.queueId;
          const now = new Date();
          const timestamp = now.toLocaleString('es-PE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });

          const systemMessage = await crmDb.createSystemEvent(
            conversation.id,
            'conversation_queued',
            `⏳ En cola ${queueName} - Esperando asignación (${timestamp})`
          );

          // Refresh conversation to get updated data
          conversation = (await crmDb.getConversationById(conversation.id))!;
          logDebug(`[CRM] ✅ Conversation ${conversation.id} assigned to fallback queue ${numberConfig.queueId}`);

          // Emit WebSocket events
          args.socketManager.emitConversationUpdate({ conversation });
          args.socketManager.emitNewMessage({ message: systemMessage });
        } else {
          logDebug(`[CRM] ℹ️  No fallback queue configured for WhatsApp number ${displayNumber}`);
        }
      }
    } else {
      logDebug(`[CRM] ⚠️  Cannot assign fallback queue - no phone_number_id or display_number available`);
    }
  }

  // CRITICAL: Check if message type should NOT reactivate closed conversations
  // Reactions, contacts, and unsupported messages are passive interactions
  const shouldNotReactivate = args.message.type === 'reaction' ||
                               args.message.type === 'contacts' ||
                               args.message.type === 'unsupported';

  // Log when passive message is received on closed conversation (but don't reactivate)
  if (conversation.status === "closed" && shouldNotReactivate) {
    logDebug(`[CRM] 📨 Received ${args.message.type} on closed conversation ${conversation.id} - NOT reactivating (passive interaction)`);
  }

  // Auto-reopen if client writes back (BUT NOT for reactions/contacts/unsupported)
  if (conversation.status === "closed" && !shouldNotReactivate) {
    // CRITICAL: Clear both queueId and assignedTo when reopening
    // The bot or advisor that reopens it will be assigned

    // CAMPAIGNS: Si tiene categoría cat-masivos, cambiar a cat-en-cola-bot
    // (la categoría se actualizará dinámicamente según el bot o transferencia)
    const categoryUpdate = conversation.category === 'cat-masivos' ? 'cat-en-cola-bot' : conversation.category;

    await crmDb.updateConversationMeta(conversation.id, {
      status: "active",
      queueId: null,
      assignedTo: null,
      category: categoryUpdate,
      closedReason: null  // CRITICAL: Clear closed_reason when auto-reopening
    });
    conversation = (await crmDb.getConversationById(conversation.id))!;

    if (categoryUpdate === 'cat-en-cola-bot') {
      logDebug(`[CRM] 📬 Conversación ${conversation.id} de campaña masiva reabierta - categoría: cat-en-cola-bot`);
    } else {
      logDebug(`[CRM] Conversación ${conversation.id} auto-reabierta - listo para bot o reasignación`);
    }

    // Automatic queue assignment when reopening - reassign to fallback queue if available
    // This ensures conversations return to the queue when customers write back
    if (!conversation.queueId && phoneNumberId) {
      const whatsappNumbers = await adminDb.getAllWhatsAppNumbers();

      // Normalize phone numbers for comparison (remove spaces, +, -, parentheses)
      const normalizePhone = (phone: string) => phone.replace(/[\s\+\-\(\)]/g, '');
      const normalizedDisplay = normalizePhone(displayNumber || '');

      const numberConfig = whatsappNumbers.find(num =>
        normalizePhone(num.phoneNumber) === normalizedDisplay
      );

      if (numberConfig && numberConfig.queueId) {
        logDebug(`[CRM] 🔄 Applying fallback queue "${numberConfig.queueId}" to reactivated conversation ${conversation.id} (matched ${numberConfig.phoneNumber} with ${displayNumber})`);
        await crmDb.updateConversationMeta(conversation.id, {
          queueId: numberConfig.queueId,
          queuedAt: Date.now()
        });

        // Refresh conversation to get updated queue
        conversation = (await crmDb.getConversationById(conversation.id))!;
      } else {
        logDebug(`[CRM] ℹ️  No fallback queue configured for WhatsApp number ${displayNumber}`);
      }
    }

    // Create system message for reactivated conversation (if in queue and not assigned)
    if (conversation.queueId && !conversation.assignedTo) {
      const queue = await adminDb.getQueueById(conversation.queueId);
      const queueName = queue?.name || conversation.queueId;
      const now = new Date();
      const timestamp = now.toLocaleString('es-PE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      const systemMessage = await crmDb.createSystemEvent(
        conversation.id,
        'conversation_queued',
        `⏳ En cola ${queueName} - Esperando asignación (${timestamp})`
      );

      logDebug(`[CRM] ✅ Reactivated conversation ${conversation.id} back in queue ${queueName}`);

      // Emit WebSocket events
      args.socketManager.emitConversationUpdate({ conversation });
      args.socketManager.emitNewMessage({ message: systemMessage });
    }
  }

  const { type, text, attachment } = await translateMessage(args.message);

  const storedMessage = await crmDb.appendMessage({
    convId: conversation.id,
    direction: "incoming",
    type,
    text,
    mediaUrl: attachment?.url ?? null,
    mediaThumb: attachment?.thumbUrl ?? null,
    repliedToId: null,
    status: "delivered",
    providerMetadata: {
      whatsapp_message_id: args.message.id,
      from: args.message.from,
      timestamp: args.message.timestamp,
    },
  });

  // Track incoming message for metrics
  metricsTracker.recordMessage(conversation.id, false);

  let storedAttachment: Attachment | null = null;
  if (attachment) {
    // CRITICAL: Await attachment storage to complete BEFORE emitting WebSocket event
    // This prevents race condition where frontend tries to fetch attachment before DB insert completes
    storedAttachment = await crmDb.storeAttachment({
      id: attachment.id,
      msgId: storedMessage.id,
      filename: attachment.filename,
      mime: attachment.mime,
      size: attachment.size,
      url: attachment.url,
      thumbUrl: attachment.thumbUrl,
    });
  }

  args.socketManager.emitNewMessage({ message: storedMessage, attachment: storedAttachment });

  // AUTO-CLOSE: Check if last business message had "Sí por favor"/"No gracias" buttons > 1 hour ago
  await checkAndAutoCloseConversation(conversation.id, args.socketManager);

  const refreshed = await crmDb.getConversationById(conversation.id);
  if (refreshed) {
    args.socketManager.emitConversationUpdate({ conversation: refreshed });
  }

  // NO CREAR AUTOMÁTICAMENTE - Solo buscar contacto existente en Bitrix24
  if (!conversation.bitrixId && args.bitrixService.isAvailable) {
    args.bitrixService
      .lookupByPhone(phone)
      .then(async (contact) => {
        if (contact?.ID) {
          // Encontró contacto existente, asociarlo
          await args.bitrixService.attachConversation(conversation!, contact.ID.toString());
          // Actualizar también autorizaPublicidad desde Bitrix
          const autorizaPublicidad = contact.UF_CRM_1753421555 || null;
          if (autorizaPublicidad) {
            await crmDb.updateConversationMeta(conversation!.id, { autorizaPublicidad });
          }
          const updated = await crmDb.getConversationById(conversation.id);
          if (updated) {
            args.socketManager.emitConversationUpdate({ conversation: updated });
          }
          console.log(`[CRM][Bitrix] Contacto existente encontrado: ${contact.ID} para ${phone} (autPub: ${autorizaPublicidad || 'N/A'})`);
        } else {
          // No hay contacto en Bitrix, se mostrará solo con datos de Meta (phone + profileName)
          console.log(`[CRM][Bitrix] No se encontró contacto para ${phone}. Mostrando solo datos de Meta.`);
        }
      })
      .catch((error) => {
        console.warn("[CRM][Bitrix] lookup failed", error);
      });
  }
}

async function translateMessage(message: WhatsAppMessage): Promise<{
  type: MessageType;
  text: string | null;
  attachment: Attachment | null;
}> {
  switch (message.type) {
    case "text":
      return { type: "text", text: message.text?.body ?? null, attachment: null };
    case "interactive": {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return {
        type: "text",
        text: reply?.title ?? "",
        attachment: null,
      };
    }
    case "button":
      return { type: "text", text: message.button?.text ?? message.button?.payload ?? "", attachment: null };
    case "reaction": {
      // Format reaction as readable text
      const emoji = message.reaction?.emoji ?? "👍";
      const text = `${emoji} Reaccionó a un mensaje`;
      return { type: "system", text, attachment: null };
    }
    case "contacts": {
      // Format shared contact as readable text
      const contact = message.contacts?.[0];
      const name = contact?.name?.formatted_name ?? "Contacto";
      const phone = contact?.phones?.[0]?.phone ?? "";
      const text = `📇 Compartió contacto: ${name}${phone ? ` (${phone})` : ""}`;
      return { type: "system", text, attachment: null };
    }
    case "unsupported": {
      // Format unsupported message
      const errorDetails = message.errors?.[0]?.error_data?.details ?? "Tipo de mensaje no soportado";
      const text = `⚠️ ${errorDetails}`;
      return { type: "system", text, attachment: null };
    }
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const mediaInfo = getMediaInfo(message);
      if (!mediaInfo) {
        logError(`[CRM][Media] No se pudo extraer info de media del mensaje tipo ${message.type}`);
        return { type: "document", text: null, attachment: null };
      }
      logDebug(`[CRM][Media] Descargando ${message.type} con ID: ${mediaInfo.id} (usando axios)`);
      const downloaded = await downloadMedia(mediaInfo.id, mediaInfo.mimeType ?? undefined);
      if (!downloaded) {
        logError(`[CRM][Media] Falló descarga de ${message.type} con ID: ${mediaInfo.id}`);
        return {
          type: mapType(message.type),
          text: mediaInfo.caption ?? null,
          attachment: null,
        };
      }
      logDebug(`[CRM][Media] Descarga exitosa: ${downloaded.filename} (${downloaded.mime}, ${downloaded.buffer.length} bytes)`);
      const stored = await attachmentStorage.saveBuffer({
        buffer: downloaded.buffer,
        filename: downloaded.filename,
        mime: downloaded.mime,
      });
      logDebug(`[CRM][Media] Guardado en storage: ${stored.url}`);
      return {
        type: mapType(message.type),
        text: mediaInfo.caption ?? null,
        attachment: {
          id: stored.id,
          msgId: null,
          filename: downloaded.filename,
          mime: downloaded.mime,
          size: stored.size,
          url: stored.url,
          thumbUrl: stored.url,
          createdAt: Date.now(),
        },
      };
    }
    case "location": {
      // WhatsApp location message
      const lat = (message as any).location?.latitude;
      const lng = (message as any).location?.longitude;
      const name = (message as any).location?.name;
      const address = (message as any).location?.address;

      let text = "📍 Ubicación compartida";
      if (name) text += `: ${name}`;
      else if (address) text += `: ${address}`;
      else if (lat && lng) text += ` (${lat}, ${lng})`;

      // Add Google Maps link
      const mapsUrl = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;
      if (mapsUrl) {
        text += `\n🗺️ Ver en Google Maps: ${mapsUrl}`;
      }

      return { type: "system", text, attachment: null };
    }
    case "order": {
      // WhatsApp order/catalog message
      const text = "🛒 Pedido de catálogo";
      return { type: "system", text, attachment: null };
    }
    default: {
      // Unknown message type - show generic message
      const text = `⚠️ Mensaje de tipo "${message.type}" (no soportado)`;
      return { type: "system", text, attachment: null };
    }
  }
}

function mapType(type: WhatsAppMessage["type"]): MessageType {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    default:
      return "text";
  }
}

function getMediaInfo(message: WhatsAppMessage):
  | { id: string; mimeType?: string; caption?: string }
  | null {
  switch (message.type) {
    case "image":
      return { id: message.image?.id ?? "", mimeType: message.image?.mime_type, caption: message.image?.caption ?? undefined };
    case "video":
      return { id: message.video?.id ?? "", mimeType: message.video?.mime_type, caption: message.video?.caption ?? undefined };
    case "audio":
      return { id: message.audio?.id ?? "", mimeType: message.audio?.mime_type };
    case "document":
      return { id: message.document?.id ?? "", mimeType: message.document?.mime_type, caption: message.document?.caption ?? undefined };
    case "sticker":
      return { id: message.sticker?.id ?? "", mimeType: message.sticker?.mime_type };
    default:
      return null;
  }
}

async function downloadMedia(mediaId: string, mimeHint?: string): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  if (!mediaId) {
    logError("[CRM][Media] downloadMedia: mediaId vacío");
    return null;
  }
  const whatsappEnv = getWhatsAppEnv();
  if (!whatsappEnv.accessToken) {
    logError("[CRM][Media] downloadMedia: WHATSAPP_ACCESS_TOKEN no configurado");
    return null;
  }

  // USAR CLOUDFLARE WORKER para descargar media (más confiable)
  const workerUrl = "https://rapid-surf-b867.cpalomino.workers.dev/download";
  logDebug(`[CRM][Media] Descargando desde Cloudflare Worker: ${mediaId}`);

  try {
    const workerResponse = await axios.post(workerUrl, {
      mediaId: mediaId,
      accessToken: whatsappEnv.accessToken,
      apiVersion: whatsappEnv.apiVersion || "v20.0"
    }, {
      responseType: "arraybuffer",
      timeout: 30000, // 30 segundos
    });

    const buffer = Buffer.from(workerResponse.data);
    const mime = workerResponse.headers['content-type'] || mimeHint || "application/octet-stream";
    const filename = `${mediaId}`;

    logDebug(`[CRM][Media] ✅ Descarga exitosa desde Cloudflare: ${buffer.length} bytes`);
    return { buffer, filename, mime };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logError(`[CRM][Media] Cloudflare Worker error: HTTP ${error.response?.status}`, error.response?.data);
    } else {
      logError("[CRM][Media] Error descargando desde Cloudflare Worker", error);
    }
    // Log error to error tracker
    await errorTracker.logErrorObject(
      error as Error,
      'media_download_error',
      { severity: 'error', context: { mediaId } }
    );
    return null;
  }
}
