/**
 * Quick Action Executor
 * Handles execution of quick actions (sending files, text, etc.)
 */
import { promises as fs } from "fs";
import * as path from "path";
import { QuickAction, QuickActionConfig } from "../routes/quick-actions";
import { crmDb } from "../db-postgres";
import { attachmentStorage } from "../storage";
import { getCrmGateway } from "../ws";

// Types
export interface ExecutionContext {
  conversationId: string;
  userId: string;
  phone: string;
  channelConnectionId?: string;
  actionName?: string;  // Name to show as sender (e.g., "🤖 Catálogos Azaleia")
  actionIcon?: string;  // Icon for the action
}

export interface ExecutionResult {
  success: boolean;
  messagesSent: number;
  errors: string[];
  details?: any;
}

// Load ia-agent-files config
async function loadAgentFiles(): Promise<any[]> {
  const configPath = path.join(process.cwd(), "data", "ia-agent-files.json");
  try {
    const data = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(data);
    return config.files || [];
  } catch (error) {
    console.error("[QuickActionExecutor] Error loading agent files:", error);
    return [];
  }
}

// Filter files based on config
function filterFiles(files: any[], config: QuickActionConfig): any[] {
  let filtered = files.filter(f => f.enabled !== false);

  if (config.fileIds && config.fileIds.length > 0) {
    // Specific files by ID
    filtered = filtered.filter(f => config.fileIds!.includes(f.id));
  } else if (config.fileFilters) {
    // Dynamic filters
    const { category, brand, withPrices } = config.fileFilters;

    if (category) {
      filtered = filtered.filter(f => f.category === category);
    }

    if (brand) {
      const brandLower = brand.toLowerCase();
      filtered = filtered.filter(f =>
        f.name?.toLowerCase().includes(brandLower) ||
        f.metadata?.brand?.toLowerCase().includes(brandLower) ||
        f.tags?.some((t: string) => t.toLowerCase().includes(brandLower))
      );
    }

    if (withPrices !== undefined) {
      filtered = filtered.filter(f => f.metadata?.withPrices === withPrices);
    }
  }

  return filtered;
}

// Infer message type from MIME type
function inferTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// Send a single message
async function sendMessage(
  conversationId: string,
  userId: string,
  options: {
    text?: string;
    attachmentId?: string;
    isInternal?: boolean;
    senderName?: string;  // Custom sender name (action name)
    caption?: string;     // Caption for media files
  }
): Promise<{ success: boolean; error?: string; message?: any }> {
  try {
    // Get conversation
    const conversation = await crmDb.getConversationById(conversationId);
    if (!conversation) {
      return { success: false, error: "Conversation not found" };
    }

    // Get gateway early for all emits
    const gateway = getCrmGateway();

    // Determine sender name - use action name if provided, otherwise userId
    const sentBy = options.senderName || userId;

    // Get attachment info if provided
    let attachment = options.attachmentId
      ? await crmDb.getAttachment(options.attachmentId)
      : null;

    // Determine message type
    const type = attachment
      ? inferTypeFromMime(attachment.mime)
      : 'text';

    // Create message in DB with all required fields
    const message = await crmDb.appendMessage({
      convId: conversationId,
      direction: "outgoing",
      type,
      text: options.text || options.caption || null,
      mediaUrl: attachment?.url || null,
      mediaThumb: attachment?.thumbUrl || null,
      repliedToId: null,
      status: options.isInternal ? "sent" : "pending",
      sentBy: sentBy,
    });

    console.log(`[QuickActionExecutor] Created message ${message.id} for conversation ${conversationId}`);

    // Link attachment if provided and re-fetch to get msgId
    let linkedAttachment = null;
    if (options.attachmentId && attachment) {
      await crmDb.linkAttachmentToMessage(options.attachmentId, message.id);
      // Re-fetch to get the updated attachment with msgId
      linkedAttachment = await crmDb.getAttachment(options.attachmentId);
    }

    // Emit to WebSocket so advisor can see the message immediately
    if (gateway) {
      console.log(`[QuickActionExecutor] Emitting new message to WebSocket`);
      gateway.emitNewMessage({ message, attachment: linkedAttachment });
    } else {
      console.warn(`[QuickActionExecutor] No gateway available for WebSocket emit`);
    }

    // If not internal, send to WhatsApp
    if (!options.isInternal && conversation.phone) {
      // Import WhatsApp service dynamically
      const { sendWhatsAppMessage, uploadToWhatsAppMedia } = await import("../../services/whatsapp");

      let mediaId: string | undefined;

      if (attachment) {
        const stream = await attachmentStorage.getStream(options.attachmentId!);
        if (stream) {
          // Convert stream to buffer for upload
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          const { Readable } = await import("stream");
          const uploadResult = await uploadToWhatsAppMedia({
            stream: Readable.from(buffer),
            filename: attachment.filename,
            mimeType: attachment.mime,
            channelConnectionId: conversation.channelConnectionId,
          });

          if (uploadResult.ok && uploadResult.mediaId) {
            mediaId = uploadResult.mediaId;
          } else {
            console.error(`[QuickActionExecutor] Failed to upload media:`, uploadResult);
          }
        }
      }

      // Send message to WhatsApp
      // For documents/media, use caption for the display name
      const mediaType = attachment ? inferTypeFromMime(attachment.mime) : undefined;
      const sendResult = await sendWhatsAppMessage({
        phone: conversation.phone,
        text: !attachment ? (options.text || options.caption) : undefined,  // text only for non-media
        mediaId,
        mediaType,
        caption: attachment ? (options.caption || options.text) : undefined,  // caption for media
        filename: attachment && mediaType === 'document' ? (options.caption || attachment.filename) : undefined,
        channelConnectionId: conversation.channelConnectionId,
      });

      // Update message status
      if (sendResult.ok) {
        await crmDb.updateMessageStatus(message.id, "sent", {
          waMessageId: sendResult.messageId,
        });
        // Emit status update - construct the updated message manually since updateMessageStatus returns void
        const updatedMessage = { ...message, status: "sent" as const, metadata: { waMessageId: sendResult.messageId } };
        if (gateway) {
          console.log(`[QuickActionExecutor] Emitting status update for message ${message.id} -> sent`);
          gateway.emitMessageUpdate({ message: updatedMessage, attachment: linkedAttachment });
        }
        console.log(`[QuickActionExecutor] Message ${message.id} sent successfully`);
      } else {
        await crmDb.updateMessageStatus(message.id, "failed");
        // Emit failure update
        const failedMessage = { ...message, status: "failed" as const };
        if (gateway) {
          gateway.emitMessageUpdate({ message: failedMessage, attachment: linkedAttachment });
        }
        console.error(`[QuickActionExecutor] Message ${message.id} failed:`, sendResult.error);
        return { success: false, error: sendResult.error || "Send failed", message };
      }
    }

    return { success: true, message };
  } catch (error: any) {
    console.error("[QuickActionExecutor] Error sending message:", error);
    return { success: false, error: error.message };
  }
}

// Helper to wait
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute send_files action
 */
async function executeSendFiles(
  action: QuickAction,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    success: true,
    messagesSent: 0,
    errors: [],
  };

  // Build sender name from action icon and name
  const senderName = `${action.icon} ${action.name}`;

  try {
    // Load and filter files
    const allFiles = await loadAgentFiles();
    const filesToSend = filterFiles(allFiles, action.config);

    if (filesToSend.length === 0) {
      result.success = false;
      result.errors.push("No files found matching the criteria");
      return result;
    }

    console.log(`[QuickActionExecutor] Sending ${filesToSend.length} files for action "${action.name}"`);

    // Send each file with delay
    for (let i = 0; i < filesToSend.length; i++) {
      const file = filesToSend[i];

      // Get or create attachment from file URL
      let attachmentId: string | undefined;

      // Extract ID from URL if it's an internal attachment URL
      if (file.url && file.url.startsWith('/api/crm/attachments/')) {
        attachmentId = file.url.split('/').pop()?.split('?')[0];
      }

      // If no attachment ID, we need to create one from the file
      if (!attachmentId) {
        // For now, skip files without valid attachment IDs
        result.errors.push(`File "${file.name}" has no valid attachment ID`);
        continue;
      }

      // Use custom name from config if available, otherwise use file name
      const customFileName = action.config.fileDisplayNames?.[file.id] || file.name;

      const sendResult = await sendMessage(context.conversationId, context.userId, {
        caption: customFileName,  // File display name as caption
        attachmentId,
        senderName,  // Show action name as sender
      });

      if (sendResult.success) {
        result.messagesSent++;
      } else {
        result.errors.push(`Failed to send "${file.name}": ${sendResult.error}`);
      }

      // Delay between messages (except after last)
      if (i < filesToSend.length - 1) {
        await delay(action.delayBetweenMs || 500);
      }
    }

    result.success = result.messagesSent > 0;
    result.details = {
      totalFiles: filesToSend.length,
      sent: result.messagesSent,
      failed: filesToSend.length - result.messagesSent,
    };
  } catch (error: any) {
    result.success = false;
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Execute send_text action
 */
async function executeSendText(
  action: QuickAction,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    success: false,
    messagesSent: 0,
    errors: [],
  };

  // Build sender name from action icon and name
  const senderName = `${action.icon} ${action.name}`;

  try {
    const text = action.config.text;
    if (!text) {
      result.errors.push("No text configured for this action");
      return result;
    }

    // TODO: Replace variables in text like {{nombre}}, {{fecha}}, etc.
    const finalText = text;

    const sendResult = await sendMessage(context.conversationId, context.userId, {
      text: finalText,
      senderName,  // Show action name as sender
    });

    if (sendResult.success) {
      result.success = true;
      result.messagesSent = 1;
    } else {
      result.errors.push(sendResult.error || "Failed to send message");
    }
  } catch (error: any) {
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Execute composite action (multiple steps)
 */
async function executeComposite(
  action: QuickAction,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    success: true,
    messagesSent: 0,
    errors: [],
  };

  // Build sender name from action icon and name
  const senderName = `${action.icon} ${action.name}`;

  const steps = action.config.steps || [];
  if (steps.length === 0) {
    result.success = false;
    result.errors.push("No steps configured for this action");
    return result;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    switch (step.type) {
      case 'text':
        if (step.content) {
          const sendResult = await sendMessage(context.conversationId, context.userId, {
            text: step.content,
            senderName,
          });
          if (sendResult.success) {
            result.messagesSent++;
          } else {
            result.errors.push(`Step ${i + 1} (text): ${sendResult.error}`);
          }
        }
        break;

      case 'file':
        if (step.fileId || step.attachmentId) {
          const sendResult = await sendMessage(context.conversationId, context.userId, {
            attachmentId: step.fileId || step.attachmentId,
            caption: step.caption || step.displayName,
            senderName,
          });
          if (sendResult.success) {
            result.messagesSent++;
          } else {
            result.errors.push(`Step ${i + 1} (file): ${sendResult.error}`);
          }
        }
        break;

      case 'delay':
        await delay(step.delayMs || 500);
        break;
    }

    // Default delay between steps (except delays)
    if (step.type !== 'delay' && i < steps.length - 1) {
      await delay(action.delayBetweenMs || 500);
    }
  }

  result.success = result.messagesSent > 0 || result.errors.length === 0;
  return result;
}

/**
 * Main execute function
 */
export async function executeQuickAction(
  action: QuickAction,
  context: ExecutionContext
): Promise<ExecutionResult> {
  console.log(`[QuickActionExecutor] Executing action "${action.name}" (${action.type}) for conversation ${context.conversationId}`);

  switch (action.type) {
    case 'send_files':
      return executeSendFiles(action, context);

    case 'send_text':
      return executeSendText(action, context);

    case 'composite':
      return executeComposite(action, context);

    case 'send_template':
      // TODO: Implement template sending
      return {
        success: false,
        messagesSent: 0,
        errors: ['send_template not implemented yet'],
      };

    default:
      return {
        success: false,
        messagesSent: 0,
        errors: [`Unknown action type: ${action.type}`],
      };
  }
}
