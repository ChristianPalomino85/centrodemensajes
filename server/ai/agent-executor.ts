/**
 * AI Agent Executor
 * Main orchestrator for the IA Agent with tool support
 */

import type { OpenAIClient, OpenAIAgentRequest, OpenAIAgentResponse } from './clients/openai';
import type { IncomingMessage, OutboundMessage } from '../../src/runtime/executor';
import type { ConversationSession } from '../../src/runtime/session';
import { ALL_AGENT_TOOLS } from './tools/definitions';
import { executeTools, type ToolExecutionContext } from './tools/executor';
import { readConfig } from '../routes/ia-agent-config';
import { registerKeywordUsage } from '../crm/keyword-usage-tracker';
import { registerCampaignTracking } from '../crm/campaign-tracker';
import { loadEmbeddingsDatabase, searchRelevantChunks } from './rag-embeddings';
import { visualSearch, formatVisualSearchContext } from './visual-search';
import { verifyVisualMatch, formatVerifiedContext } from './visual-verify';
import { getBusinessContext, getContactContext, buildFullContext } from './context-builder';
import path from 'path';
import fs from 'fs';

// Cache for system prompt loaded from file
let cachedSystemPrompt: string | null = null;
let cachedPromptMtime: number = 0;

/**
 * Normalize assistant text responses to avoid line-by-line outputs.
 * - Preserves line breaks so the agent can separar ideas sin guiones.
 * - Compacta saltos excesivos (3+ -> 2).
 */
function normalizeTextResponse(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Load system prompt from external TOON file (more efficient than JSON)
 * Caches the prompt and reloads only if file has changed
 */
function loadSystemPrompt(): string {
  const promptPath = path.join(process.cwd(), 'data', 'system-prompt-final.txt');
  const fallbackPrompt = 'Eres un asistente virtual útil de Azaleia Perú. Tu objetivo es ayudar a promotoras y clientes a comprar calzado.';

  try {
    if (!fs.existsSync(promptPath)) {
      console.warn('[Agent] ⚠️ System prompt file not found:', promptPath);
      return fallbackPrompt;
    }

    const stats = fs.statSync(promptPath);
    const mtime = stats.mtimeMs;

    // Reload if file changed or not cached
    if (!cachedSystemPrompt || mtime !== cachedPromptMtime) {
      cachedSystemPrompt = fs.readFileSync(promptPath, 'utf-8');
      cachedPromptMtime = mtime;
      console.log(`[Agent] 📄 System prompt loaded from file (${cachedSystemPrompt.length} chars)`);
    }

    return cachedSystemPrompt || fallbackPrompt;
  } catch (error) {
    console.error('[Agent] ⚠️ Could not load system prompt from file:', error);
    return fallbackPrompt;
  }
}

export interface AgentExecutorResult {
  responses: OutboundMessage[];
  shouldTransfer?: boolean;
  transferQueue?: string;
  shouldEnd?: boolean;
  variables?: Record<string, any>;
}

/**
 * Detect keywords in user message and track them
 */
async function detectAndTrackKeywords(
  message: string,
  conversationId: string,
  config: any
): Promise<Array<{ keyword: string; groupId: string; groupName: string }>> {
  try {
    // Normalize message: lowercase, trim, remove trailing punctuation
    const normalizedMessage = message.toLowerCase().trim().replace(/[.,;!?]+$/, '');

    // Detect keywords in message
    const detectedKeywords: Array<{ keyword: string; groupId: string; groupName: string }> = [];

    // ONLY track keywords from keywordTracking configuration (EXACT MATCH for metrics)
    if (config.keywordTracking && Array.isArray(config.keywordTracking.groups)) {
      config.keywordTracking.groups.forEach((group: any) => {
        if (group.enabled && Array.isArray(group.keywords)) {
          group.keywords.forEach((keyword: string) => {
            // Normalize keyword: lowercase, trim, remove trailing punctuation
            const normalizedKeyword = keyword.toLowerCase().trim().replace(/[.,;!?]+$/, '');

            // EXACT MATCH ONLY for metrics
            if (normalizedMessage === normalizedKeyword) {
              detectedKeywords.push({
                keyword: keyword, // Use original keyword for display
                groupId: group.id,
                groupName: group.name
              });
              console.log(`[Agent Keywords] ✅ EXACT MATCH: "${keyword}" in group "${group.name}"`);
            }
          });
        }
      });
    }

    // Register each detected keyword
    for (const { keyword, groupId, groupName } of detectedKeywords) {
      await registerKeywordUsage({
        flowId: 'ia-agent',
        flowName: 'Agente IA',
        nodeId: 'agent-root',
        keywordGroupId: groupId,
        keywordGroupLabel: groupName,
        matchedKeyword: keyword,
        customerPhone: '',  // Will be added from context if available
        conversationId: conversationId,
      });
    }

    return detectedKeywords;
  } catch (error) {
    console.error('[Agent Keywords] Error tracking keywords:', error);
    // Don't fail the conversation if keyword tracking fails
    return [];
  }
}

/**
 * Execute the AI Agent
 * This handles the full conversation flow with tool support
 */
export async function executeAgent(
  openaiClient: OpenAIClient,
  session: ConversationSession,
  message: IncomingMessage | null,
  metadata?: any  // WhatsApp message metadata with referral data
): Promise<AgentExecutorResult> {
  try {
    // Load agent configuration
    const config = await readConfig();

    // ✅ CHECK CENTRAL: Si el agente está deshabilitado, no ejecutar
    if (!config.enabled) {
      console.log('[Agent] ⚠️ Agent is DISABLED in ia-agent-config.json');
      return {
        responses: [{
          type: 'text',
          text: 'El agente virtual está temporalmente deshabilitado. Un asesor te atenderá pronto.'
        }],
        shouldTransfer: true,
        transferQueue: 'sales',
        conversationHistory: [],
        detectedKeywords: []
      };
    }

    console.log('[Agent] ✅ Agent is ENABLED - Executing for session:', session.id);

    // Get conversation history from session
    const conversationHistory: any[] = Array.isArray(session.variables?.agentConversationHistory)
      ? session.variables.agentConversationHistory
      : [];

    // Check if this is first message (no previous history)
    const isFirstMessage = conversationHistory.length === 0;

    // Add user message to history
    const userMessage = message?.text || message?.caption || '';

    // Check if message has media (image/video)
    const hasMedia = message?.type === 'media' && message.mediaUrl;
    const isImage = hasMedia && message.mediaType?.startsWith('image');

    // 🎯 BUILD PERSONALIZED CONTEXT based on WhatsApp number and Bitrix contact
    // Also includes conversation history from CRM database for better context
    let personalizedContext = '';
    let businessContext: any;
    let contactContext: any;

    try {
      // Get business WhatsApp number from multiple sources
      const phoneNumberId = session.variables?.['phoneNumberId'] ||
                           session.id?.split('_')[2] || // Extract from session ID
                           '';

      const businessPhone = metadata?.display_phone_number ||
                           session.variables?.['__businessPhone'] ||
                           session.variables?.['channelConnectionId'] ||
                           phoneNumberId || '';

      // Get customer phone for Bitrix lookup
      const customerPhone = session.contactId || '';

      console.log(`[Agent] 📱 Business phone: ${businessPhone}, PhoneNumberId: ${phoneNumberId}, Customer: ${customerPhone}`);

      // Get business context based on WhatsApp number
      businessContext = getBusinessContext(businessPhone);
      console.log(`[Agent] 🎯 Channel: ${businessContext.channelName}`);

      // Get contact context from Bitrix (name, type)
      contactContext = await getContactContext(customerPhone);
      if (contactContext.isExisting) {
        console.log(`[Agent] 👤 Bitrix contact found: ${contactContext.name} (type: ${contactContext.contactType})`);
      }

      // Build full context including conversation history from CRM
      personalizedContext = await buildFullContext(
        businessContext,
        contactContext,
        session.id,           // Conversation ID for history lookup
        isFirstMessage,
        isImage && !userMessage // Image without text
      );
    } catch (error) {
      console.error('[Agent] ⚠️ Error building personalized context:', error);
    }

    // Store current image for tool execution (declared at function level)
    let currentImageBase64: string | undefined;

    if (userMessage || hasMedia) {
      // Build message content
      let messageContent: any;

      if (isImage) {
        // GPT-4 Vision format: array with text and image_url
        console.log('[Agent] 📸 Image detected:', message.mediaUrl);

        // CRITICAL FIX: Convert local image to base64 for OpenAI Vision API
        let imageDataUrl = message.mediaUrl;
        try {
          // Check if URL is local (starts with /uploads/)
          if (message.mediaUrl && message.mediaUrl.startsWith('/uploads/')) {
            const fs = await import('fs/promises');
            const path = await import('path');

            // Read image file
            const imagePath = path.join(process.cwd(), message.mediaUrl);
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');

            // Determine mime type from file extension or metadata
            const mimeType = message.mediaType || 'image/jpeg';
            imageDataUrl = `data:${mimeType};base64,${base64Image}`;
          }
          // Handle /api/crm/attachments/:id URLs (internal CRM attachments)
          else if (message.mediaUrl && message.mediaUrl.startsWith('/api/crm/attachments/')) {
            const fs = await import('fs/promises');
            const fsSync = await import('fs');
            const path = await import('path');

            // Extract attachment ID from URL
            const attachmentId = message.mediaUrl.replace('/api/crm/attachments/', '').split('?')[0];

            // Search in data/uploads/YEAR/MONTH/ directories
            const uploadRoot = path.join(process.cwd(), 'data/uploads');
            let foundFile: string | null = null;

            if (fsSync.existsSync(uploadRoot)) {
              const yearDirs = await fs.readdir(uploadRoot);
              outerLoop:
              for (const year of yearDirs) {
                const yearPath = path.join(uploadRoot, year);
                const yearStat = await fs.stat(yearPath);
                if (!yearStat.isDirectory()) continue;

                const monthDirs = await fs.readdir(yearPath);
                for (const month of monthDirs) {
                  const monthPath = path.join(yearPath, month);
                  const monthStat = await fs.stat(monthPath);
                  if (!monthStat.isDirectory()) continue;

                  const files = await fs.readdir(monthPath);
                  for (const file of files) {
                    if (file.startsWith(attachmentId)) {
                      foundFile = path.join(monthPath, file);
                      break outerLoop;
                    }
                  }
                }
              }
            }

            if (foundFile) {
              const imageBuffer = await fs.readFile(foundFile);
              const base64Image = imageBuffer.toString('base64');
              const ext = path.extname(foundFile).toLowerCase().replace('.', '');
              const mimeTypes: Record<string, string> = {
                'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
              };
              const mimeType = mimeTypes[ext] || message.mediaType || 'image/jpeg';
              imageDataUrl = `data:${mimeType};base64,${base64Image}`;
            }
          }
          // Handle remote images (http/https URLs)
          else if (message.mediaUrl && (message.mediaUrl.startsWith('http://') || message.mediaUrl.startsWith('https://'))) {
            const https = await import('https');
            const http = await import('http');
            const { URL } = await import('url');

            const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
              const parsedUrl = new URL(message.mediaUrl!);
              const client = parsedUrl.protocol === 'https:' ? https : http;

              const request = client.get(message.mediaUrl!, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              }, (response) => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                  const redirectUrl = response.headers.location;
                  const redirectClient = redirectUrl.startsWith('https:') ? https : http;
                  redirectClient.get(redirectUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                  }, (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                    res.on('error', reject);
                  }).on('error', reject);
                  return;
                }

                if (response.statusCode !== 200) {
                  reject(new Error(`HTTP ${response.statusCode}`));
                  return;
                }

                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
              });

              request.on('error', reject);
              request.setTimeout(15000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
              });
            });

            const base64Image = imageBuffer.toString('base64');
            const ext = message.mediaUrl.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
            const mimeTypes: Record<string, string> = {
              'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
              'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
            };
            const mimeType = mimeTypes[ext] || message.mediaType || 'image/jpeg';
            imageDataUrl = `data:${mimeType};base64,${base64Image}`;
          }
        } catch (error) {
          console.error('[Agent] ❌ Error converting image to base64:', error);
          // Fall back to original URL
        }

        // Store current image for tool execution (e.g., extract_handwritten_order)
        if (imageDataUrl.startsWith('data:')) {
          currentImageBase64 = imageDataUrl;
        }

        messageContent = [
          {
            type: 'text',
            text: userMessage || 'El cliente envió esta imagen. Analízala y ayúdalo.',
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high', // Use high detail for product recognition
            },
          },
        ];
      } else if (hasMedia) {
        // For non-image media (videos, documents), just mention it
        messageContent = userMessage + `\n\n[El cliente envió un archivo: ${message.mediaType}]`;
      } else {
        // Plain text message
        messageContent = userMessage;
      }

      conversationHistory.push({
        role: 'user',
        content: messageContent,
      });

      // 🔐 AUTO-CHECK OPT-IN: Always check on first message of conversation
      if (isFirstMessage && session.variables?.optInChecked) {
        session.variables.optInChecked = false;
      }

      // Check if we've already verified opt-in in this session
      const hasCheckedOptIn = session.variables?.optInChecked === true;

      if (!hasCheckedOptIn) {
        try {
          const { executeTool } = await import('./tools/executor');
          const toolCall = {
            function: { name: 'verificar_opt_in', arguments: '{}' }
          };
          const toolContext = {
            phone: session.contactId || '',
            businessPhone: '',
            channel: 'General',
            conversationId: session.id,
            currentMessage: userMessage, // Pass current message to detect opt-in button responses
          };
          const optInResult = await executeTool(toolCall as any, toolContext);

          // Mark as checked
          if (!session.variables) session.variables = {};
          session.variables.optInChecked = true;

          // If opt-in is needed, the tool already sent the buttons
          // Return immediately with those messages
          if (optInResult.messages && optInResult.messages.length > 0) {
            return {
              responses: optInResult.messages,
              shouldTransfer: false,
            };
          }
        } catch (error) {
          console.error('[Agent] ⚠️ Error checking opt-in:', error);
          // Continue execution even if opt-in check fails
        }
      }

      // 🔄 AUTO-DETECT TRANSFER REQUEST
      const contactType = contactContext?.contactType;
      const isValidatedPromotora = session.variables?.__promotoraValidated === true;
      const isPromoterOrLeader = contactType === 'promotor' || contactType === 'lider' || isValidatedPromotora;

      // Keywords that indicate ORDER/PURCHASE intent (for promotoras only)
      const orderKeywords = [
        'pedido', 'reserva', 'compra', 'comprar', 'ordenar', 'order',
        'pasar pedido', 'hacer pedido', 'quiero pedir', 'quisiera pedir'
      ];
      const promotoraSalesKeywords = [
        'precio', 'precios', 'stock', 'talla', 'tallas', 'modelo', 'catalogo', 'catálogo', 'oferta', 'ofertas'
      ];
      const supportKeywords = [
        'cambio', 'cambiar', 'devolver', 'devolucion', 'devolución', 'garantia', 'garantía',
        'no lleg', 'no me lleg', 'estado de pedido', 'seguimiento', 'reclamo', 'queja', 'defecto', 'fallo'
      ];

      // Keywords that indicate explicit transfer request (for ALL clients)
      const explicitTransferKeywords = [
        'transferir', 'transfier', 'transfiere', 'pasame', 'pásame',
        'comunica con', 'comunicar con', 'comunicame', 'comunícame',
        'hablar con un', 'hablar con una', 'quiero hablar con',
        'asesor', 'asesora', 'persona real', 'humano', 'agente',
        'atiendame', 'atiéndame', 'que me atienda', 'que me atiendan'
      ];

      const messageNormalized = userMessage.toLowerCase();
      const greetingKeywords = [
        'hola', 'buenas', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches',
        'hey', 'holi', 'holis', 'qué tal', 'que tal'
      ];
      // Detect if contact has name
      const hasContactName = Boolean(contactContext?.contactName && String(contactContext.contactName).trim().length > 0);

      // Check if promotora wants to place an order
      const hasOrderKeyword = orderKeywords.some(keyword => messageNormalized.includes(keyword));
      const promotoraSalesIntent = isPromoterOrLeader && (hasOrderKeyword || promotoraSalesKeywords.some(k => messageNormalized.includes(k)));
      const hasSupportKeyword = supportKeywords.some(k => messageNormalized.includes(k));

      // Check if ANY client explicitly asks for transfer
      const isExplicitTransferRequest = explicitTransferKeywords.some(k => messageNormalized.includes(k));

      // Guard: simple greeting without intent -> responde saludo y no transfieras
      const isGreetingOnly = greetingKeywords.some(k => messageNormalized.includes(k));
      const hasIntentKeywords = hasOrderKeyword || promotoraSalesIntent || hasSupportKeyword || isExplicitTransferRequest;
      if (isGreetingOnly && !hasIntentKeywords) {
        const askName = !isPromoterOrLeader && !hasContactName;
        const greetingText = normalizeTextResponse(
          askName
            ? '¡Hola! ¿Con quién tengo el gusto? Dime tu nombre y cuéntame si necesitas hacer un pedido, un cambio o revisar tu pedido, y te ayudo al toque.'
            : '¡Hola! Cuéntame si necesitas hacer un pedido, un cambio o revisar tu pedido y te ayudo al toque.'
        );
        return {
          responses: [{ type: 'text', text: greetingText }],
          shouldTransfer: false,
        };
      }

      // Force transfer ONLY if:
      // 1. Promotora/lider explicitly wants to place an ORDER, OR
      // 2. ANY client explicitly asks for human transfer
      const shouldForceTransfer = hasOrderKeyword || promotoraSalesIntent || isExplicitTransferRequest || hasSupportKeyword;

      if (shouldForceTransfer) {
        try {
          const { executeTool } = await import('./tools/executor');

          // Determine queue type based on keywords
          let queueType = 'sales'; // Default to sales (Counter) for most transfers

          // Sales (Counter) for promotor/lider with order intent
          if ((isPromoterOrLeader && hasOrderKeyword) || hasOrderKeyword || promotoraSalesIntent) {
            queueType = 'sales';
          }
          // Support (ATC) for problems/complaints/seguimiento
          else if (hasSupportKeyword || messageNormalized.match(/problema|reclamo|queja|devolver|garantia|garantía|cambio|defecto|seguimiento|estado/)) {
            queueType = 'support';
          }
          // Prospects for people wanting to become promotoras
          else if (messageNormalized.match(/quiero ser promotora|quiero vender|inscrib|registr|ser promotor/)) {
            queueType = 'prospects';
          }
          // Default to sales for general transfer requests
          else {
            queueType = 'sales';
          }

          // If sales intent and promotora no validada, intenta validar antes de transferir
          if ((hasOrderKeyword || promotoraSalesIntent) && !isPromoterOrLeader) {
            console.log('[Agent] 🔎 Attempting promotora validation before transfer');
            const validateCall = {
              function: { name: 'validar_promotora_sql', arguments: JSON.stringify({ documento: null }) },
              id: 'forced_validate_promotora'
            };
            const validateContext = {
              phone: session.contactId || '',
              conversationId: session.id,
              config,
              currentImageBase64,
              currentMessage: userMessage,
            };
            const validateResult = await executeTool(validateCall as any, validateContext);
            if (validateResult?.messages && validateResult.messages.length > 0) {
              // If tool already asked for DNI/RUC, return those messages and stop here
              const responses = validateResult.messages;
              // Persist promotora flag if found
              if (validateResult.result?.found) {
                session.variables = session.variables || {};
                session.variables.__promotoraValidated = true;
                session.variables.__promotoraId = validateResult.result.idCliente;
                session.variables.__promotoraNombre = validateResult.result.nombre;
                session.variables.__promotoraDocumento = validateResult.result.documento;
                session.variables.__promotoraValidatedAt = Date.now();
              }
              return { responses, shouldTransfer: false };
            }
            if (validateResult?.result?.found) {
              session.variables = session.variables || {};
              session.variables.__promotoraValidated = true;
              session.variables.__promotoraId = validateResult.result.idCliente;
              session.variables.__promotoraNombre = validateResult.result.nombre;
              session.variables.__promotoraDocumento = validateResult.result.documento;
              session.variables.__promotoraValidatedAt = Date.now();
            }
          }

          const toolContext = {
            phone: session.contactId || '',
            businessPhone: '',
            channel: businessContext?.channelName || 'General',
            conversationId: session.id,
            config
          };

          // STEP 1: Force check_business_hours
          const checkHoursCall = {
            function: { name: 'check_business_hours', arguments: JSON.stringify({ queue_type: queueType }) },
            id: 'forced_check_hours'
          };
          const hoursResult = await executeTool(checkHoursCall as any, toolContext);

          // STEP 2: Force transfer_to_queue
          const transferCall = {
            function: { name: 'transfer_to_queue', arguments: JSON.stringify({ queue_type: queueType }) },
            id: 'forced_transfer'
          };
          const transferResult = await executeTool(transferCall as any, toolContext);

          // STEP 3: Inject tool results into conversation history and let OpenAI generate natural response
          conversationHistory.push({
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'forced_check_hours', type: 'function', function: { name: 'check_business_hours', arguments: JSON.stringify({ queue_type: queueType }) } },
              { id: 'forced_transfer', type: 'function', function: { name: 'transfer_to_queue', arguments: JSON.stringify({ queue_type: queueType }) } }
            ]
          });

          // Add tool results
          conversationHistory.push({
            role: 'tool',
            tool_call_id: 'forced_check_hours',
            name: 'check_business_hours',
            content: JSON.stringify(hoursResult.result)
          });
          conversationHistory.push({
            role: 'tool',
            tool_call_id: 'forced_transfer',
            name: 'transfer_to_queue',
            content: JSON.stringify(transferResult.result)
          });

          // Store transfer info for later
          session.variables = session.variables || {};
          session.variables.__forcedTransfer = true;
          session.variables.__forcedTransferQueue = transferResult.transferQueue;
          session.variables.__forcedTransferResult = transferResult.shouldTransfer;

        } catch (error) {
          console.error('[Agent] ⚠️ Error in forced transfer detection:', error);
          // Continue with normal AI flow if forced transfer fails
        }
      }

      // Detect and track keywords
      const detectedKeywords = await detectAndTrackKeywords(userMessage, session.id, config);

      // Register campaign tracking on first message
      if (isFirstMessage) {
        // Extract referral data from metadata if available
        const referralData = metadata?.referral;

        await registerCampaignTracking({
          conversationId: session.id,
          customerPhone: session.contactId || '',
          initialMessage: userMessage,
          detectedKeyword: detectedKeywords.length > 0 ? detectedKeywords[0].keyword : undefined,
          keywordGroupId: detectedKeywords.length > 0 ? detectedKeywords[0].groupId : undefined,
          keywordGroupName: detectedKeywords.length > 0 ? detectedKeywords[0].groupName : undefined,
          flowId: 'ia-agent',
          flowName: 'Agente IA',
          // Add referral data from WhatsApp Click-to-Ad
          referralSourceUrl: referralData?.source_url,
          referralSourceId: referralData?.source_id,
          referralSourceType: referralData?.source_type,
          referralHeadline: referralData?.headline,
          referralBody: referralData?.body,
          referralMediaType: referralData?.media_type,
          referralImageUrl: referralData?.image_url,
          referralVideoUrl: referralData?.video_url,
          referralThumbnailUrl: referralData?.thumbnail_url,
          ctwaClid: referralData?.ctwa_clid,
        });
      }
    }

    // 🖼️ VISUAL SEARCH: Find similar catalog pages using CLIP embeddings
    let visualSearchContext = '';
    let verifiedProductInfo: string | null = null;
    if (isImage && currentImageBase64 && config.integrations?.knowledgeBase?.enabled) {
      try {
        console.log('[Agent] 🖼️ Running visual search with CLIP...');
        const visualResults = await visualSearch(currentImageBase64, 5);

        if (visualResults.success && visualResults.results.length > 0) {
          // Log all visual matches for debugging
          const topMatch = visualResults.results[0];
          if (topMatch.similarity > 0.60) {
            const catalogName = topMatch.catalog.includes('OLYMPIKUS') ? 'Olympikus' :
                               topMatch.catalog.includes('AZALEIA') ? 'Azaleia' : topMatch.catalog;
            console.log(`[Agent] 🎯 Visual matches: ${catalogName} (top: ${(topMatch.similarity * 100).toFixed(1)}%)`);
          }

          // 🔬 VERIFICATION: Use GPT-4 Vision to identify exact product
          try {
            const { readAIConfig } = await import('../routes/ai-config');
            const aiConfig = await readAIConfig();
            const openaiApiKey = aiConfig?.openai?.apiKey;

            if (openaiApiKey) {
              console.log('[Agent] 🔬 Verifying product with GPT-4 Vision...');
              const verifyResult = await verifyVisualMatch(
                currentImageBase64,
                visualResults.results,
                openaiApiKey
              );

              if (verifyResult.success && verifyResult.confidence !== 'low') {
                // Use verified result for more accurate context
                visualSearchContext = formatVerifiedContext(verifyResult, visualResults.results);
                verifiedProductInfo = verifyResult.product_info;
                console.log(`[Agent] ✅ Product verified: ${verifyResult.product_info || 'Unknown'} (${verifyResult.confidence} confidence)`);
              } else {
                // Fall back to CLIP results if verification failed
                console.log('[Agent] ⚠️ Verification inconclusive, using CLIP results');
                visualSearchContext = formatVisualSearchContext(visualResults.results);
              }
            } else {
              // No API key, use CLIP results only
              visualSearchContext = formatVisualSearchContext(visualResults.results);
            }
          } catch (verifyError) {
            console.error('[Agent] ⚠️ Visual verification error:', verifyError);
            visualSearchContext = formatVisualSearchContext(visualResults.results);
          }
        }
      } catch (error) {
        console.error('[Agent] ⚠️ Visual search error:', error);
        // Continue without visual search results
      }
    }

  // 🔍 RAG: Search for relevant documents using semantic search
  let ragContext = '';
    let ragPatternContext = '';

    // Pre-analyze image for RAG query if image is sent without text
    let ragSearchQuery = userMessage;

    // If we have verified product info from visual verification, use it for RAG
    if (verifiedProductInfo && !userMessage) {
      ragSearchQuery = verifiedProductInfo;
      console.log(`[Agent] 📚 Using verified product for RAG: "${verifiedProductInfo}"`);
    }
    // Otherwise, analyze image for RAG query
    else if (isImage && !userMessage && currentImageBase64 && config.integrations?.knowledgeBase?.enabled) {
      try {
        console.log('[Agent] 🔍 Image without text detected - analyzing for product identification...');

        // Get OpenAI API key for quick product identification
        const { readAIConfig } = await import('../routes/ai-config');
        const aiConfig = await readAIConfig();
        const openaiApiKey = aiConfig?.openai?.apiKey;

        if (openaiApiKey) {
          // Quick Vision API call to identify the product
          // IMPORTANT: Search terms must match catalog format (model codes, categories)
          const identificationRequest = {
            model: 'gpt-4o',
            messages: [
              {
                role: 'system' as const,
                content: `Eres un experto en identificar calzado de los catálogos Azaleia y Olympikus Perú.

IMPORTANTE: Genera términos de búsqueda que coincidan con el catálogo:
- Marcas: Azaleia, Olympikus
- Categorías Olympikus: RUNNING, ENTRENAMIENTO, 24/7, KIDS
- Categorías Azaleia: FIESTA, CASUAL, CONFORT, ZAPATILLAS, BOTINES
- Modelos comunes Olympikus: CORRE, TREINO, SONORO, ESSENTIAL, PASSO, RUSH, LANCE, ERA, CHALLENGER, REVERSO, VOA, PRIDE, VOLTA
- Modelos comunes Azaleia: ELEGANCE, COMFORT, FASHION

Si ves un código en la imagen (ej: "336", "417"), inclúyelo.
Responde SOLO con términos de búsqueda separados por espacios. Máximo 10 palabras.
Ejemplo: "Olympikus ENTRENAMIENTO SONORO" o "Azaleia CASUAL sandalia"`
              },
              {
                role: 'user' as const,
                content: [
                  { type: 'text' as const, text: 'Identifica este calzado para buscar en el catálogo:' },
                  { type: 'image_url' as const, image_url: { url: currentImageBase64, detail: 'high' as const } }
                ]
              }
            ],
            max_tokens: 50,
            temperature: 0.2
          };

          // Direct call to OpenAI API for quick identification
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(identificationRequest)
          });

          if (response.ok) {
            const result = await response.json();
            const productDescription = result.choices?.[0]?.message?.content?.trim();

            if (productDescription) {
              ragSearchQuery = productDescription;
              console.log(`[Agent] ✅ Product identified for RAG search: "${productDescription}"`);
            }
          } else {
            console.error('[Agent] ⚠️ Failed to identify product:', await response.text());
          }
        }
      } catch (error) {
        console.error('[Agent] ⚠️ Error during image pre-analysis:', error);
        // Continue without RAG search for this image
      }
    }

    if (ragSearchQuery && config.integrations?.knowledgeBase?.enabled) {
      try {
        console.log('[Agent] 📚 RAG enabled - searching relevant documents...');

        // Load embeddings database
        const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
        const database = await loadEmbeddingsDatabase(dbPath);

        if (database.chunks.length > 0) {
          // Get OpenAI API key
          const { readAIConfig } = await import('../routes/ai-config');
          const aiConfig = await readAIConfig();
          const openaiApiKey = aiConfig?.openai?.apiKey;

          if (openaiApiKey) {
            // Search for relevant chunks
            const topK = config.integrations.knowledgeBase.topK || 3;
            const relevantChunks = await searchRelevantChunks(
              ragSearchQuery,
              database,
              openaiApiKey,
              topK
            );

            if (relevantChunks.length > 0) {
              // Format context from relevant chunks
              ragContext = '\n\n📚 CONTEXTO DE DOCUMENTOS RELEVANTES:\n\n';
              relevantChunks.forEach((chunk, i) => {
                ragContext += `--- Documento ${i + 1} (${chunk.metadata.source}) ---\n${chunk.content}\n\n`;
              });
              ragContext += '\nUsa este contexto para responder de manera precisa y detallada. Si la información no está en el contexto, indica que no tienes esa información específica.';

              console.log(`[Agent] ✅ Found ${relevantChunks.length} relevant document chunks`);
            }
          }
        } else {
          console.log('[Agent] ⚠️ No documents indexed yet. Run indexing first.');
        }
      } catch (error) {
        console.error('[Agent] ❌ Error during RAG search:', error);
        // Continue without RAG if there's an error
      }
    }

    // 📚 PATTERN RAG: Lightweight patterns for tone/flows
    try {
      const patternsPath = path.join(process.cwd(), 'data', 'embeddings-db-patterns.json');
      if (fs.existsSync(patternsPath)) {
        const patternsDb = await loadEmbeddingsDatabase(patternsPath);
        if (patternsDb.chunks.length > 0) {
          const { readAIConfig } = await import('../routes/ai-config');
          const aiConfig = await readAIConfig();
          const openaiApiKey = aiConfig?.openai?.apiKey;

          if (openaiApiKey) {
            const patternQuery = ragSearchQuery || userMessage || 'saludo y ofertas';
            const patternChunks = await searchRelevantChunks(
              patternQuery,
              patternsDb,
              openaiApiKey,
              3
            );
            if (patternChunks.length > 0) {
              ragPatternContext = '\n\n🧩 PATRONES (tono/perú):\n\n';
              patternChunks.forEach((chunk, i) => {
                ragPatternContext += `--- Patrón ${i + 1} (${chunk.metadata.source || 'patrones'}) ---\n${chunk.content}\n\n`;
              });
              console.log(`[Agent] ✅ Added ${patternChunks.length} pattern chunks for tone/flows`);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Agent] ⚠️ Pattern RAG error:', error);
      // Continue without pattern context
    }

    // Build messages for the AI
    // Load system prompt from external file (TOON format - more efficient than JSON)
    const systemPrompt = loadSystemPrompt();
    const messages = [
      {
        role: 'system' as const,
        content: systemPrompt + personalizedContext + visualSearchContext + ragPatternContext + ragContext,
      },
      ...conversationHistory.slice(-config.advancedSettings?.conversationMemory?.maxMessages || 10),
    ];

    console.log('[Agent] Calling OpenAI with', messages.length, 'messages and', ALL_AGENT_TOOLS.length, 'tools');

    // Call OpenAI with tools
    const request: OpenAIAgentRequest = {
      provider: 'openai',
      model: config.model || 'gpt-4-turbo-preview',
      messages,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 1000,
      tools: ALL_AGENT_TOOLS,
      tool_choice: 'auto',
    };

    let aiResponse: OpenAIAgentResponse = await openaiClient.completeWithTools(request);
    const responses: OutboundMessage[] = [];
    let shouldTransfer = false;
    let transferQueue: string | undefined;
    let shouldEnd = false;
    // Track if we already marked promotora validated to skip revalidation
    const promotoraAlreadyValidated = session.variables?.__promotoraValidated === true;
    let normalizedAssistantContent: string | undefined;

    // Handle tool calls
    if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
      console.log('[Agent] AI wants to call', aiResponse.toolCalls.length, 'tools');

      // Execute tools
      const toolContext: ToolExecutionContext = {
        phone: session.contactId || '',
        conversationId: session.id,
        config,
        currentImageBase64, // Pass current image for tools like extract_handwritten_order
        currentMessage: userMessage, // Pass current message for opt-in detection
      };

      const toolResults = await executeTools(aiResponse.toolCalls, toolContext);

      // Add assistant message with tool calls to history
      conversationHistory.push({
        role: 'assistant',
        content: aiResponse.content || '',
        tool_calls: aiResponse.toolCalls,
      });

      // Add tool results to history
      let optInToolSentMessages = false;

      for (let i = 0; i < aiResponse.toolCalls.length; i++) {
        const toolCall = aiResponse.toolCalls[i];
        const toolResult = toolResults[i];

        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(toolResult.result),
        });

        // Collect messages from tool execution
        if (toolResult.messages) {
          responses.push(...toolResult.messages);

          // Check if this is an opt-in tool that sent messages - no need to call AI again
          const optInTools = ['verificar_opt_in', 'enviar_pregunta_opt_in', 'guardar_opt_in'];
          if (optInTools.includes(toolCall.function.name)) {
            optInToolSentMessages = true;
            console.log(`[Agent] Opt-in tool ${toolCall.function.name} sent messages, skipping follow-up AI call`);
          }
        }

        // Check for transfer
        if (toolResult.shouldTransfer) {
          shouldTransfer = true;
          transferQueue = toolResult.transferQueue;
          console.log(`[Agent] 🔄 Transfer requested: shouldTransfer=${shouldTransfer}, transferQueue=${transferQueue}`);
        }

        // Check for end
        if (toolResult.shouldEnd) {
          shouldEnd = true;
        }

        // Persist promotora validation to avoid re-validating in the same session
        if (toolCall.function.name === 'validar_promotora_sql' && toolResult.result?.found) {
          session.variables = session.variables || {};
          session.variables.__promotoraValidated = true;
          session.variables.__promotoraId = toolResult.result.idCliente;
          session.variables.__promotoraNombre = toolResult.result.nombre;
          session.variables.__promotoraDocumento = toolResult.result.documento;
          session.variables.__promotoraValidatedAt = Date.now();
          console.log('[Agent] 🧾 Promotora validation cached for session');
        }
      }

      // Skip AI follow-up if opt-in tools already sent buttons (they handle the response)
      if (!optInToolSentMessages) {
        // Call AI again with tool results to get final response
        // IMPORTANT: Include personalizedContext to maintain greeting instructions, customer name, etc.
        console.log('[Agent] Calling OpenAI again with tool results (with personalized context)');

        const followUpRequest: OpenAIAgentRequest = {
          provider: 'openai',
          model: config.model || 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system' as const,
              content: loadSystemPrompt() + personalizedContext + visualSearchContext + ragContext,
            },
            ...conversationHistory.slice(-(config.advancedSettings?.conversationMemory?.maxMessages || 10) - 2),
          ],
          temperature: config.temperature ?? 0.7,
          maxTokens: config.maxTokens ?? 1000,
        };

        aiResponse = await openaiClient.completeWithTools(followUpRequest);

        // GPT-5 sometimes returns empty content after tool calls
        // If so, use the tool result as fallback response
        if (!aiResponse.content && toolResults.length > 0) {
          console.log('[Agent] ⚠️ GPT-5 returned empty content after tool call, using tool result as fallback');

          // Find the first tool result that has meaningful content
          for (const tr of toolResults) {
            const result = tr.result?.result;
            // Check for knowledge base answer
            if (result?.answer && typeof result.answer === 'string') {
              aiResponse.content = result.answer;
              console.log(`[Agent] Using knowledge base answer as response: "${result.answer.substring(0, 100)}..."`);
              break;
            }
            // Check for mensaje field (common in other tools)
            if (result?.mensaje && typeof result.mensaje === 'string') {
              aiResponse.content = result.mensaje;
              console.log(`[Agent] Using tool mensaje as response: "${result.mensaje.substring(0, 100)}..."`);
              break;
            }
          }
        }
      } else {
        console.log('[Agent] Skipping OpenAI follow-up call - opt-in buttons already sent');
        // Clear content so we don't add extra text response
        aiResponse = { ...aiResponse, content: '' };
      }
    }

    // Add AI response to conversation history
    if (aiResponse.content) {
      const normalized = normalizeTextResponse(aiResponse.content);
      conversationHistory.push({
        role: 'assistant',
        content: normalized,
      });

      // Add final response
      responses.push({
        type: 'text',
        text: normalized,
      });
      normalizedAssistantContent = normalized;
    }

    // FALLBACK: If GPT-5 returned nothing at all (no content, no tool calls with responses),
    // provide a default response to avoid leaving the user without a reply
    if (responses.length === 0) {
      console.log('[Agent] ⚠️ No responses generated - GPT-5 returned empty. Adding fallback response.');
      const fallbackText = normalizeTextResponse(
        'Cuéntame en una frase qué necesitas (pedido, cambio, seguimiento) y te ayudo o te paso con la asesora indicada.'
      );
      responses.push({
        type: 'text',
        text: fallbackText,
      });
      conversationHistory.push({
        role: 'assistant',
        content: fallbackText,
      });
    }

    console.log('[Agent] Execution complete. Responses:', responses.length);
    console.log('[Agent] 🔍 DEBUG - Response details:');
    responses.forEach((resp, idx) => {
      if (resp.type === 'text') {
        console.log(`  [${idx}] TEXT: "${resp.text?.substring(0, 100)}${resp.text && resp.text.length > 100 ? '...' : ''}"`);
      } else {
        console.log(`  [${idx}] ${resp.type.toUpperCase()}`);
      }
    });

    // Check if we forced a transfer earlier - use those values
    if (session.variables?.__forcedTransfer) {
      shouldTransfer = session.variables.__forcedTransferResult || false;
      transferQueue = session.variables.__forcedTransferQueue;
      console.log(`[Agent] 🔄 Using forced transfer values: shouldTransfer=${shouldTransfer}, transferQueue=${transferQueue}`);
      // Clean up temp variables
      delete session.variables.__forcedTransfer;
      delete session.variables.__forcedTransferResult;
      delete session.variables.__forcedTransferQueue;
    }

    console.log(`[Agent] 📤 Returning: shouldTransfer=${shouldTransfer}, transferQueue=${transferQueue}`);

    // Note: Transfer is handled by the runtime engine, not here
    // The shouldTransfer and transferQueue values are returned to the caller
    if (shouldTransfer && transferQueue) {
      console.log(`[Agent] 📤 Transfer will be handled by runtime engine - queue: ${transferQueue}`);
    }

    return {
      responses: responses.map(resp => {
        if (resp.type === 'text' && resp.text) {
          return { ...resp, text: normalizeTextResponse(resp.text) };
        }
        return resp;
      }),
      shouldTransfer,
      transferQueue,
      shouldEnd,
      variables: {
        ...session.variables,
        agentConversationHistory: conversationHistory,
        lastAgentResponse: normalizedAssistantContent || aiResponse.content,
        agentInteractionCount: (typeof session.variables?.agentInteractionCount === 'number'
          ? session.variables.agentInteractionCount
          : 0) + 1,
      },
    };
  } catch (error) {
    console.error('[Agent] Error executing agent:', error);

    // Return fallback response
    const fallbackConfig = await readConfig();
    return {
      responses: [{
        type: 'text',
        text: fallbackConfig?.advancedSettings?.fallbackResponse || 'Lo siento, ocurrió un error. Déjame conectarte con un asesor.',
      }],
      shouldTransfer: true,
      transferQueue: fallbackConfig?.transferRules?.sales?.queueId || undefined,
    };
  }
}
