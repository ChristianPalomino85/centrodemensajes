/**
 * AI Agent Tool Executor
 * Executes tool calls from the AI agent
 */

import type { OpenAIToolCall } from '../clients/openai';
import type { OutboundMessage } from '../../../src/runtime/executor';

export interface ToolExecutionContext {
  phone: string;
  conversationId?: string;
  config: any; // Agent configuration
  currentImageBase64?: string; // Current image being processed (data:image/... format)
  currentMessage?: string; // Current message text from the customer
}

export interface ToolExecutionResult {
  success: boolean;
  result: any;
  messages?: OutboundMessage[];
  shouldTransfer?: boolean;
  transferQueue?: string;
  shouldEnd?: boolean;
}

/**
 * Execute a single tool call
 */
export async function executeTool(
  toolCall: OpenAIToolCall,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const functionName = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  console.log(`[Agent Tool] Executing ${functionName} with args:`, args);

  switch (functionName) {
    case 'search_knowledge_base':
      return await executeSearchKnowledgeBase(args, context);

    case 'send_catalogs':
      return await executeSendCatalogs(args, context);

    case 'transfer_to_queue':
      return await executeTransferToQueue(args, context);

    case 'check_business_hours':
      return executeCheckBusinessHours(args, context);

    case 'save_lead_info':
      return await executeSaveLeadInfo(args, context);

    case 'extract_text_ocr':
      return await executeExtractTextOCR(args, context);

    case 'extract_handwritten_order':
      return await executeExtractHandwrittenOrder(args, context);

    case 'end_conversation':
      return executeEndConversation(args, context);

    case 'validar_promotora_sql':
      return await executeValidarPromotoraSql(args, context);

    case 'verificar_opt_in':
      return await executeVerificarOptIn(args, context);

    case 'enviar_pregunta_opt_in':
      return await executeEnviarPreguntaOptIn(args, context);

    case 'guardar_opt_in':
      return await executeGuardarOptIn(args, context);

    default:
      console.error(`[Agent Tool] Unknown tool: ${functionName}`);
      return {
        success: false,
        result: { error: `Unknown tool: ${functionName}` }
      };
  }
}

/**
 * Tool: search_knowledge_base
 * Searches the knowledge base for specific information using RAG
 */
async function executeSearchKnowledgeBase(
  args: { query: string; category?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { query, category } = args;

  console.log(`[search_knowledge_base] Searching for: "${query}" in category: ${category || 'general'}`);

  try {
    // Import RAG service dynamically
    const { getRagService } = await import('../../ai/rag-service');
    const ragService = await getRagService();

    // Check if RAG is available
    if (!ragService.isProviderAvailable('openai')) {
      return {
        success: false,
        result: {
          error: 'RAG service not available',
          answer: 'No tengo acceso a la base de conocimiento en este momento. Déjame conectarte con un asesor.'
        }
      };
    }

    // Get knowledge base documents from config
    const knowledgeBase = context.config.integrations?.knowledgeBase;
    if (!knowledgeBase || !knowledgeBase.enabled || !knowledgeBase.documents || knowledgeBase.documents.length === 0) {
      console.log('[search_knowledge_base] Knowledge base not configured or empty');
      return {
        success: false,
        result: {
          error: 'Knowledge base not configured',
          answer: 'No tengo esa información disponible. ¿Te conecto con un asesor?'
        }
      };
    }

    // Load embeddings database
    const path = await import('path');
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');

    let database;
    try {
      const { loadEmbeddingsDatabase, searchRelevantChunks } = await import('../rag-embeddings');
      database = await loadEmbeddingsDatabase(dbPath);
    } catch (error) {
      console.log('[search_knowledge_base] Error loading embeddings database:', error);
      return {
        success: false,
        result: {
          error: 'Base de datos de embeddings no disponible',
          answer: 'No tengo acceso a la información en este momento. ¿Te conecto con un asesor?'
        }
      };
    }

    // Check if database has embeddings
    if (!database || database.chunks.length === 0) {
      console.log('[search_knowledge_base] Embeddings database is empty');
      return {
        success: false,
        result: {
          error: 'Base de datos vacía',
          answer: 'La base de conocimiento aún no ha sido indexada. ¿Te conecto con un asesor?'
        }
      };
    }

    console.log(`[search_knowledge_base] Searching in ${database.chunks.length} chunks for: "${query}"`);

    // Perform semantic search
    const { searchRelevantChunks } = await import('../rag-embeddings');

    // Read API key from AI config
    const { readAIConfig } = await import('../../routes/ai-config');
    const aiConfig = await readAIConfig();
    const openaiKey = aiConfig?.openai?.apiKey;

    if (!openaiKey) {
      return {
        success: false,
        result: {
          error: 'OpenAI API key not available',
          answer: 'No puedo acceder a la base de conocimiento. ¿Te conecto con un asesor?'
        }
      };
    }

    try {
      // Load agent files config to get priority information
      const fs = await import('fs/promises');
      const path = await import('path');
      const filesConfigPath = path.join(process.cwd(), 'data', 'ia-agent-files.json');
      let agentFiles: any[] = [];
      try {
        const filesData = await fs.readFile(filesConfigPath, 'utf-8');
        const filesConfig = JSON.parse(filesData);
        agentFiles = filesConfig.files || [];
      } catch {
        console.log('[search_knowledge_base] No agent files config found');
      }

      // Create priority map from agent files
      const priorityMap = new Map<string, { priority: number; isCurrentCatalog: boolean }>();
      for (const file of agentFiles) {
        // Match by name patterns
        const nameLower = file.name.toLowerCase();
        priorityMap.set(nameLower, {
          priority: file.priority || 2,
          isCurrentCatalog: file.isCurrentCatalog || false
        });
      }

      // Search for more chunks initially (top 10), then filter/rerank by priority
      const relevantChunks = await searchRelevantChunks(query, database, openaiKey, 10);

      if (!relevantChunks || relevantChunks.length === 0) {
        // Calculate embedding cost even when no results found
        const queryTokens = Math.ceil(query.length / 4);
        const embeddingCostUsd = (queryTokens / 1_000_000) * 0.0001;

        // Log to database
        try {
          // @ts-ignore - pg types not available but runtime works fine
          const { Pool } = await import('pg');
          const pool = new Pool({
            host: 'localhost',
            port: 5432,
            database: 'flowbuilder_crm',
            user: 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
          });

          await pool.query(
            `INSERT INTO rag_usage (
              query, category, chunks_used, found,
              embedding_cost_usd, completion_cost_usd, total_cost_usd,
              conversation_id, customer_phone
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              query,
              category || 'general',
              0,
              false,
              embeddingCostUsd,
              0,
              embeddingCostUsd,
              context.conversationId || null,
              context.phone
            ]
          );

          await pool.end();
        } catch (dbError) {
          console.error('[search_knowledge_base] Error tracking usage (no results):', dbError);
        }

        return {
          success: true,
          result: {
            found: false,
            answer: `No encontré información específica sobre "${query}" en los catálogos. ¿Te conecto con un asesor para ayudarte mejor?`,
            source: 'knowledge_base',
            category: category || 'general',
            cost: {
              embedding: embeddingCostUsd,
              completion: 0,
              total: embeddingCostUsd
            }
          }
        };
      }

      // Rerank chunks by priority (current catalogs first)
      const rankedChunks = relevantChunks.map(chunk => {
        const source = chunk.metadata?.source || '';
        const sourceLower = source.toLowerCase().replace(/-/g, ' ');

        // Find matching priority from agent files
        let priority = 2; // Default normal
        let isCurrentCatalog = false;

        for (const [name, info] of priorityMap.entries()) {
          // Check if source contains the file name pattern
          if (sourceLower.includes(name) || name.includes(sourceLower)) {
            priority = info.priority;
            isCurrentCatalog = info.isCurrentCatalog;
            break;
          }
        }

        return {
          ...chunk,
          priority,
          isCurrentCatalog
        };
      });

      // Sort: current catalogs first, then by priority, then by original order (similarity)
      rankedChunks.sort((a, b) => {
        // Current catalogs always first
        if (a.isCurrentCatalog && !b.isCurrentCatalog) return -1;
        if (!a.isCurrentCatalog && b.isCurrentCatalog) return 1;
        // Then by priority (lower number = higher priority)
        return a.priority - b.priority;
      });

      // Take top 5 after reranking
      const topChunks = rankedChunks.slice(0, 5);
      console.log(`[search_knowledge_base] Reranked ${relevantChunks.length} chunks, using top ${topChunks.length} (${topChunks.filter(c => c.isCurrentCatalog).length} from current catalogs)`);

      // Build context from relevant chunks with source information
      const ragContext = topChunks.map((chunk, idx) => {
        const source = chunk.metadata?.source || 'catálogo';
        // Estimate page number from chunk index (each chunk ~1000 chars, page ~2500 chars)
        const estimatedPage = Math.floor((chunk.metadata?.chunkIndex || 0) / 2.5) + 1;
        const pageInfo = chunk.metadata?.page || estimatedPage;

        // Format source name nicely
        const sourceName = source
          .replace(/catalog-/i, '')
          .replace(/rv-/i, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());

        return `[Fuente: ${sourceName}, Pág. ~${pageInfo}]\n${chunk.content}`;
      }).join('\n\n---\n\n');

      // Extract unique sources for citation
      const sources = [...new Set(topChunks.map(c => {
        const source = c.metadata?.source || 'catálogo';
        return source.replace(/catalog-/i, '').replace(/rv-/i, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }))];

      // Use OpenAI to generate answer based on context
      const answerPrompt = `Basándote ÚNICAMENTE en la siguiente información de los catálogos de Azaleia, responde esta pregunta del cliente:

PREGUNTA: "${query}"

INFORMACIÓN DE LOS CATÁLOGOS:
${ragContext}

REGLAS IMPORTANTES:
- Solo usa información que esté EXPLÍCITAMENTE en los fragmentos
- Si no encuentras la información, di "No encontré esa información"
- Sé específico: cita precios, modelos, códigos de producto cuando estén disponibles
- Responde en español de Perú, de manera clara y concisa
- Si hay precios, menciónalos con el formato exacto (ej: "S/ 159.90")
- Al final de tu respuesta, SIEMPRE menciona de qué catálogo(s) obtuviste la información
- Ejemplo de cita: "📖 Fuente: Catálogo Tus Pasos 2025, página 15"`;

      console.log(`[search_knowledge_base] Sources found: ${sources.join(', ')}`);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Eres un asistente que responde preguntas basándose SOLO en la información proporcionada.' },
            { role: 'user', content: answerPrompt }
          ],
          temperature: 0.3,
          max_tokens: 300
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${await response.text()}`);
      }

      const data = await response.json();
      const answer = data.choices[0]?.message?.content || 'No pude generar una respuesta';

      console.log(`[search_knowledge_base] Found ${topChunks.length} relevant chunks from ${sources.length} sources`);
      console.log(`[search_knowledge_base] Answer: ${answer.substring(0, 100)}...`);

      // Calculate costs
      // Embedding cost: text-embedding-3-small = $0.0001 per 1M tokens
      const queryTokens = Math.ceil(query.length / 4); // Approximate tokens
      const embeddingCostUsd = (queryTokens / 1_000_000) * 0.0001;

      // Completion cost from OpenAI response
      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
      // gpt-4o-mini: $0.00015 per 1M input tokens, $0.0006 per 1M output tokens
      const completionCostUsd =
        (usage.prompt_tokens / 1_000_000) * 0.00015 +
        (usage.completion_tokens / 1_000_000) * 0.0006;

      const totalCostUsd = embeddingCostUsd + completionCostUsd;

      console.log(`[search_knowledge_base] Cost - Embedding: $${embeddingCostUsd.toFixed(6)}, Completion: $${completionCostUsd.toFixed(6)}, Total: $${totalCostUsd.toFixed(6)}`);

      // Save usage to database
      try {
        // @ts-ignore - pg types not available but runtime works fine
        const { Pool } = await import('pg');
        const pool = new Pool({
          host: 'localhost',
          port: 5432,
          database: 'flowbuilder_crm',
          user: 'postgres',
          password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
        });

        await pool.query(
          `INSERT INTO rag_usage (
            query, category, chunks_used, found,
            embedding_cost_usd, completion_cost_usd, total_cost_usd,
            conversation_id, customer_phone
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            query,
            category || 'general',
            topChunks.length,
            true,
            embeddingCostUsd,
            completionCostUsd,
            totalCostUsd,
            context.conversationId || null,
            context.phone
          ]
        );

        await pool.end();
        console.log('[search_knowledge_base] Usage tracked to database');
      } catch (dbError) {
        console.error('[search_knowledge_base] Error tracking usage to database:', dbError);
        // Don't fail the request if logging fails
      }

      return {
        success: true,
        result: {
          found: true,
          answer,
          source: 'knowledge_base',
          category: category || 'general',
          chunksUsed: topChunks.length,
          sources: sources, // Catálogos de donde se obtuvo la información
          sourceDetails: topChunks.map(c => ({
            catalog: c.metadata?.source || 'catálogo',
            page: c.metadata?.page || Math.floor((c.metadata?.chunkIndex || 0) / 2.5) + 1
          })),
          cost: {
            embedding: embeddingCostUsd,
            completion: completionCostUsd,
            total: totalCostUsd
          }
        }
      };

    } catch (error) {
      console.error('[search_knowledge_base] Error during search:', error);
      return {
        success: false,
        result: {
          error: String(error),
          answer: 'Hubo un error al buscar en la base de conocimiento. ¿Te conecto con un asesor?'
        }
      };
    }

  } catch (error) {
    console.error('[search_knowledge_base] Error searching knowledge base:', error);
    return {
      success: false,
      result: {
        error: String(error),
        answer: 'Hubo un error al buscar en la base de conocimiento. Déjame conectarte con un asesor.'
      }
    };
  }
}

/**
 * Tool: send_catalogs
 * Sends PDF catalogs to the customer using public URLs
 */
async function executeSendCatalogs(
  args: { with_prices: boolean; brands: string[]; customer_note?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { with_prices, brands, customer_note } = args;
  const messages: OutboundMessage[] = [];

  console.log(`[send_catalogs] Sending catalogs: with_prices=${with_prices}, brands=${Array.isArray(brands) ? brands.join(',') : brands}`);

  // Normalize brands to array
  const brandList = Array.isArray(brands) ? brands : [brands];

  // Public URLs for December 2025 catalogs (from CRM attachments)
  const catalogMap: { [key: string]: { withPrices: { url: string; fileName: string }; withoutPrices: { url: string; fileName: string } } } = {
    olympikus: {
      withPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/774f844d-2d8e-488c-93a5-0a59b2912ea4',
        fileName: 'CAT_OLY PRIM-VER 2025-DICIEMBRE-CON PRECIOS.pdf'
      },
      withoutPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/13db5a07-e210-4586-bf33-4e9f77f13f3b',
        fileName: 'CAT_OLY PRIM-VER 2025-DICIEMBRE-SIN PRECIOS.pdf'
      }
    },
    azaleia_abierto: {
      withPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/9339ba4c-7aa0-4506-b258-3b3e299c71e1',
        fileName: 'CAT_AZA PRIM-VER_25 ABIERTOS DICIEMBRE-CON PRECIOS.pdf'
      },
      withoutPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/b32eab60-e4a5-41ae-bd2d-83610e49da82',
        fileName: 'CAT_AZA PRIM-VER_25 ABIERTOS DICIEMBRE-SIN PRECIOS.pdf'
      }
    },
    azaleia_cerrado: {
      withPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/a101531a-84b3-485a-ad1f-b886d646ecec',
        fileName: 'CAT_AZA PRIM VER_25 CERRADOS DICIEMBRE-CON PRECIOS.pdf'
      },
      withoutPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/450148b3-743e-4b70-b935-cc4b88c6aaab',
        fileName: 'CAT_AZA PRIM VER_25 CERRADOS DICIEMBRE-SIN PRECIOS.pdf'
      }
    },
    tus_pasos: {
      withPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/30e7a134-9435-4f9b-9026-65bcf92d4e93',
        fileName: 'RV TUS PASOS PRIM-VER 2025-DICIEMBRE.pdf'
      },
      withoutPrices: {
        url: 'https://wsp.azaleia.com.pe/api/crm/attachments/30e7a134-9435-4f9b-9026-65bcf92d4e93',
        fileName: 'RV TUS PASOS PRIM-VER 2025-DICIEMBRE.pdf'
      }
    }
  };

  // Determine which brands to send
  const brandsToSend = brandList.includes('all')
    ? ['olympikus', 'azaleia_abierto', 'azaleia_cerrado', 'tus_pasos']
    : brandList;

  const catalogsToSend: { name: string; url: string; fileName: string }[] = [];

  for (const brand of brandsToSend) {
    const catalogInfo = catalogMap[brand];
    if (catalogInfo) {
      const catalog = with_prices ? catalogInfo.withPrices : catalogInfo.withoutPrices;
      catalogsToSend.push({
        name: brand,
        url: catalog.url,
        fileName: catalog.fileName
      });
    }
  }

  // Send each catalog as a media message with public URL
  for (const catalog of catalogsToSend) {
    messages.push({
      type: 'media',
      url: catalog.url,
      mediaType: 'document',
      filename: catalog.fileName,
    });
  }

  console.log(`[send_catalogs] Sending ${catalogsToSend.length} catalogs: ${catalogsToSend.map(c => c.name).join(', ')}`);

  return {
    success: true,
    result: {
      catalogsSent: catalogsToSend.length,
      catalogs: catalogsToSend.map(c => c.name),
      withPrices: with_prices,
      customerNote: customer_note,
    },
    messages,
  };
}

/**
 * Legacy fallback for send_catalogs (uses old config format)
 */
async function executeSendCatalogsLegacy(
  args: { with_prices: boolean; brands: string[]; customer_note?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { with_prices, brands, customer_note } = args;
  const messages: OutboundMessage[] = [];

  console.log('[send_catalogs] Using legacy config-based catalogs');

  // Get catalogs from config
  const catalogs = context.config.catalogs || {};
  const catalogsToSend: any[] = [];

  // Determine which catalogs to send
  const brandList = brands.includes('all')
    ? ['azaleia_abierto', 'azaleia_cerrado', 'olympikus', 'tus_pasos']
    : brands;

  for (const brand of brandList) {
    const key = with_prices ? `${brand}_con_precios` : `${brand}_sin_precios`;
    const catalog = catalogs[key];

    if (catalog && catalog.enabled) {
      catalogsToSend.push(catalog);
    }
  }

  // Send each catalog as a media message
  for (const catalog of catalogsToSend) {
    messages.push({
      type: 'media',
      url: catalog.url,
      mediaType: 'file',
      filename: catalog.fileName,
    });
  }

  return {
    success: true,
    result: {
      catalogsSent: catalogsToSend.length,
      catalogs: catalogsToSend.map(c => c.name),
      withPrices: with_prices,
      customerNote: customer_note,
    },
    messages,
  };
}

/**
 * Tool: transfer_to_queue
 * Transfers customer to a specific queue
 */
async function executeTransferToQueue(
  args: { queue_type: 'sales' | 'support' | 'prospects'; reason: string; customer_info?: any },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { queue_type, reason, customer_info } = args;

  console.log(`[transfer_to_queue] Transferring to ${queue_type} queue: ${reason}`);

  // Get queue configuration - supports both array and object format
  let transferRules: any[] = [];
  if (Array.isArray(context.config.transferRules)) {
    transferRules = context.config.transferRules;
  } else if (context.config.transferRules && typeof context.config.transferRules === 'object') {
    // Convert object format { sales: {...}, support: {...} } to array
    transferRules = Object.entries(context.config.transferRules).map(([id, rule]: [string, any]) => ({
      id,
      ...rule
    }));
  }

  console.log(`[transfer_to_queue] Available transfer rules:`, transferRules.map((r: any) => ({ id: r.id, enabled: r.enabled, queueId: r.queueId })));

  const transferRule = transferRules.find((rule: any) => rule.id === queue_type);

  console.log(`[transfer_to_queue] Found rule for ${queue_type}:`, transferRule ? { id: transferRule.id, enabled: transferRule.enabled, queueId: transferRule.queueId } : 'NOT FOUND');

  if (!transferRule || !transferRule.enabled) {
    console.error(`[transfer_to_queue] ❌ Queue ${queue_type} is not configured or disabled`);
    return {
      success: false,
      result: { error: `Queue ${queue_type} is not configured or disabled` }
    };
  }

  const queueId = transferRule.queueId;
  console.log(`[transfer_to_queue] ✅ Will transfer to queueId: ${queueId}`);

  // Save customer info to CRM if Bitrix24 is enabled
  if (context.config.integrations?.bitrix24?.enabled && customer_info) {
    await executeSaveLeadInfo(
      {
        phone: context.phone,
        ...customer_info,
        notes: `Transfer reason: ${reason}`,
      },
      context
    );
  }

  // Return transfer instruction WITHOUT static message - AI will generate unique response
  return {
    success: true,
    result: {
      queueId,
      queueName: transferRule.name,
      reason,
      customerInfo: customer_info,
      note: 'Transferencia completada. El agente debe generar un mensaje de despedida ÚNICO y DIFERENTE cada vez.'
    },
    shouldTransfer: true,
    transferQueue: queueId,
  };
}

/**
 * Tool: check_business_hours
 * Checks if we're in business hours
 */
function executeCheckBusinessHours(
  args: { queue_type: 'sales' | 'support' | 'prospects' },
  context: ToolExecutionContext
): ToolExecutionResult {
  const { queue_type } = args;

  // Get schedule for this queue type - supports both array and object format
  let transferRules: any[] = [];
  if (Array.isArray(context.config.transferRules)) {
    transferRules = context.config.transferRules;
  } else if (context.config.transferRules && typeof context.config.transferRules === 'object') {
    // Convert object format { sales: {...}, support: {...} } to array
    transferRules = Object.entries(context.config.transferRules).map(([id, rule]: [string, any]) => ({
      id,
      ...rule
    }));
  }

  const transferRule = transferRules.find((rule: any) => rule.id === queue_type);
  if (!transferRule) {
    return {
      success: false,
      result: { isOpen: false, reason: 'Queue not configured' }
    };
  }

  const schedule = transferRule.schedule;
  const now = new Date();

  // Convert to Lima timezone using proper method
  const limaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));

  const currentDay = limaTime.getDay() === 0 ? 7 : limaTime.getDay(); // 1-7 (Monday-Sunday)
  const currentTime = `${String(limaTime.getHours()).padStart(2, '0')}:${String(limaTime.getMinutes()).padStart(2, '0')}`;

  const isOpenDay = schedule.days.includes(currentDay);
  const isOpenTime = currentTime >= schedule.startTime && currentTime < schedule.endTime;
  const isOpen = isOpenDay && isOpenTime;

  console.log(`[check_business_hours] Queue: ${queue_type}, Day: ${currentDay}, Time: ${currentTime}, Open: ${isOpen}`);

  // CAMBIO: Ya NO devolvemos mensaje estático, solo información para que la IA decida qué decir
  return {
    success: true,
    result: {
      isOpen,
      currentDay,
      currentTime,
      schedule: {
        days: schedule.days,
        hours: `${schedule.startTime}-${schedule.endTime}`,
      },
      // La IA usará esta info para generar su propia respuesta personalizada
      note: isOpen
        ? 'El equipo está disponible ahora'
        : 'El equipo no está disponible en este momento, pero la IA puede seguir ayudando'
    }
  };
}

/**
 * Tool: save_lead_info
 * Saves lead information to Bitrix24 CRM
 */
async function executeSaveLeadInfo(
  args: { phone: string; name?: string; location?: string; business_type?: string; interest?: string; notes?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  console.log(`[save_lead_info] Saving lead info for ${args.phone}`);

  // Check if Bitrix24 integration is enabled
  const bitrixConfig = context.config.integrations?.bitrix24;
  if (!bitrixConfig || !bitrixConfig.enabled) {
    console.log('[save_lead_info] Bitrix24 integration is disabled');
    return {
      success: true,
      result: { saved: false, reason: 'Bitrix24 integration disabled' }
    };
  }

  try {
    // Here you would integrate with your actual Bitrix24 client
    // For now, we'll just log it and return success
    // TODO: Integrate with actual Bitrix24 API

    console.log('[save_lead_info] Lead info:', args);

    return {
      success: true,
      result: {
        saved: true,
        leadInfo: args,
      }
    };
  } catch (error) {
    console.error('[save_lead_info] Error saving to Bitrix24:', error);
    return {
      success: false,
      result: { error: String(error) }
    };
  }
}

/**
 * Tool: extract_text_ocr
 * Extracts text from images/documents using Google Vision OCR
 */
async function executeExtractTextOCR(
  args: { image_url: string; document_type: string; purpose?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { image_url, document_type, purpose } = args;

  console.log(`[extract_text_ocr] Processing ${document_type}: ${image_url}`);
  if (purpose) {
    console.log(`[extract_text_ocr] Purpose: ${purpose}`);
  }

  try {
    // Import OCR service dynamically
    const { extractTextFromDocument } = await import('../ocr-service');

    // Extract text using Google Vision
    const ocrResult = await extractTextFromDocument(image_url);

    if (!ocrResult.success) {
      console.error('[extract_text_ocr] OCR failed:', ocrResult.error);
      return {
        success: false,
        result: {
          error: ocrResult.error || 'Failed to extract text from image',
          text: '',
        }
      };
    }

    const extractedText = ocrResult.text || '';
    console.log(`[extract_text_ocr] ✅ Extracted ${extractedText.length} characters`);

    // Provide context based on document type
    let contextualInfo = '';
    switch (document_type) {
      case 'dni':
        contextualInfo = 'Texto extraído del DNI. Busca el número de DNI (8 dígitos).';
        break;
      case 'ruc':
        contextualInfo = 'Texto extraído del RUC. Busca el número RUC (11 dígitos).';
        break;
      case 'voucher':
        contextualInfo = 'Texto extraído del voucher de pago. Busca número de operación, fecha, monto.';
        break;
      case 'factura':
        contextualInfo = 'Texto extraído de la factura. Busca número de factura, RUC, monto total.';
        break;
      case 'comprobante':
        contextualInfo = 'Texto extraído del comprobante. Busca datos relevantes como número, fecha, monto.';
        break;
      default:
        contextualInfo = 'Texto extraído del documento.';
    }

    return {
      success: true,
      result: {
        text: extractedText,
        document_type,
        context: contextualInfo,
        extracted_successfully: true,
      }
    };

  } catch (error: any) {
    console.error('[extract_text_ocr] Error:', error.message);
    return {
      success: false,
      result: {
        error: error.message || 'Unknown error during OCR processing',
        text: '',
      }
    };
  }
}

/**
 * Tool: extract_handwritten_order
 * Extracts order information from handwritten notes using GPT-4 Vision
 */
async function executeExtractHandwrittenOrder(
  args: { image_url: string; additional_context?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let { image_url, additional_context } = args;

  console.log(`[extract_handwritten_order] Processing handwritten order from: ${image_url}`);

  // CRITICAL FIX: If the AI hallucinated a fake URL (common patterns like imgur, placeholder URLs)
  // and we have an actual image in context, use that instead
  const isLikelyHallucinatedUrl = image_url && (
    image_url.includes('imgur.com') ||
    image_url.includes('placeholder') ||
    image_url.includes('example.com') ||
    image_url.includes('picsum') ||
    image_url.includes('lorempixel') ||
    image_url.includes('dummyimage') ||
    image_url.includes('via.placeholder') ||
    // URL looks like a generic stock photo URL
    /\/(stock|sample|test|demo|fake|dummy)/i.test(image_url)
  );

  if (isLikelyHallucinatedUrl && context.currentImageBase64) {
    console.log(`[extract_handwritten_order] ⚠️ Detected hallucinated URL: ${image_url}`);
    console.log(`[extract_handwritten_order] ✅ Using actual image from context instead`);
    image_url = context.currentImageBase64;
  } else if (!image_url.startsWith('data:') && !image_url.startsWith('/uploads/') && context.currentImageBase64) {
    // If URL is remote but we have a local image, prefer the local one for reliability
    console.log(`[extract_handwritten_order] ℹ️ Using local image from context for reliability`);
    image_url = context.currentImageBase64;
  }

  try {
    // Read API key from AI config
    const { readAIConfig } = await import('../../routes/ai-config');
    const aiConfig = await readAIConfig();
    const openaiKey = aiConfig?.openai?.apiKey;

    if (!openaiKey) {
      return {
        success: false,
        result: {
          error: 'OpenAI API key not configured',
          message: 'No puedo procesar la imagen en este momento. ¿Podrías escribir tu pedido aquí?'
        }
      };
    }

    // Convert image to base64 (local or remote)
    let imageDataUrl = image_url;

    // Handle local images
    if (image_url.startsWith('/uploads/')) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const imagePath = path.join(process.cwd(), image_url);

      try {
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const ext = path.extname(imagePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';
        imageDataUrl = `data:${mimeType};base64,${base64Image}`;
        console.log(`[extract_handwritten_order] Converted local image to base64 (${imageBuffer.length} bytes)`);
      } catch (err) {
        console.error('[extract_handwritten_order] Error reading local image:', err);
        return {
          success: false,
          result: {
            error: 'Could not read image file',
            message: 'No pude leer la imagen. ¿Podrías enviarla de nuevo?'
          }
        };
      }
    }
    // Handle remote images (http/https URLs) - download and convert to base64
    else if (image_url.startsWith('http://') || image_url.startsWith('https://')) {
      try {
        console.log(`[extract_handwritten_order] Downloading remote image: ${image_url}`);

        // Use native https module instead of fetch (undici has issues)
        const https = await import('https');
        const http = await import('http');
        const { URL } = await import('url');

        const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
          const parsedUrl = new URL(image_url);
          const client = parsedUrl.protocol === 'https:' ? https : http;

          const request = client.get(image_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          }, (response) => {
            // Handle redirects
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = response.headers.location;
              console.log(`[extract_handwritten_order] Following redirect to: ${redirectUrl}`);
              const redirectClient = redirectUrl.startsWith('https:') ? https : http;
              redirectClient.get(redirectUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
              }, (redirectResponse) => {
                const chunks: Buffer[] = [];
                redirectResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
                redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
                redirectResponse.on('error', reject);
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

        // Detect mime type from URL extension
        const ext = image_url.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
        const mimeTypes: Record<string, string> = {
          'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
          'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';

        imageDataUrl = `data:${mimeType};base64,${base64Image}`;
        console.log(`[extract_handwritten_order] Downloaded and converted remote image (${imageBuffer.length} bytes, ${mimeType})`);
      } catch (err) {
        console.error('[extract_handwritten_order] Error downloading remote image:', err);
        return {
          success: false,
          result: {
            error: 'Could not download image',
            message: 'No pude descargar la imagen. ¿Podrías enviarla de nuevo?'
          }
        };
      }
    }
    // Already base64
    else if (image_url.startsWith('data:')) {
      console.log('[extract_handwritten_order] Image already in base64 format');
    }

    // Use GPT-4 Vision to analyze the handwritten order
    const visionPrompt = `Analiza esta imagen de un pedido escrito a mano. Extrae TODA la información que puedas identificar.

INSTRUCCIONES:
1. Identifica CADA línea escrita en la imagen
2. Para cada item, extrae: código/modelo, talla, cantidad, color (si se menciona)
3. Identifica el nombre del cliente si aparece
4. Si hay totales o subtotales, inclúyelos
5. Si alguna parte es difícil de leer, indícalo con [ilegible]

CONTEXTO ADICIONAL: ${additional_context || 'Pedido de calzado Azaleia/Olympikus'}

FORMATO DE RESPUESTA (JSON):
{
  "cliente": "nombre si aparece o null",
  "items": [
    {
      "modelo": "código o nombre del producto",
      "talla": "número de talla",
      "cantidad": número,
      "color": "color si se menciona o null",
      "notas": "cualquier nota adicional"
    }
  ],
  "total_items": número total de pares,
  "observaciones": "cualquier nota general del pedido",
  "confianza": "alta/media/baja - qué tan legible está la escritura",
  "partes_ilegibles": ["lista de partes que no se pudieron leer"]
}

IMPORTANTE:
- Los códigos de producto suelen ser letras+números (ej: PAULA-293, GINNY-545, RALY-647)
- Las tallas brasileñas van de 33-40 para mujer, las peruanas de 34-41
- Sé preciso con los números, la diferencia entre 3, 5, 6, 8, 9 es importante`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: visionPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[extract_handwritten_order] OpenAI API error:', errorText);
      return {
        success: false,
        result: {
          error: 'Vision API error',
          message: 'Hubo un problema al analizar la imagen. ¿Podrías enviarla de nuevo o escribir el pedido?'
        }
      };
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content || '';

    console.log(`[extract_handwritten_order] AI response:`, aiResponse.substring(0, 200));

    // Try to parse JSON from response
    let orderData;
    try {
      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        orderData = JSON.parse(jsonMatch[0]);
      } else {
        orderData = { raw_text: aiResponse, items: [] };
      }
    } catch (parseError) {
      console.log('[extract_handwritten_order] Could not parse JSON, returning raw text');
      orderData = { raw_text: aiResponse, items: [] };
    }

    // Calculate usage cost
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
    // GPT-4o vision: ~$5 per 1M input tokens, $15 per 1M output tokens
    const costUsd =
      (usage.prompt_tokens / 1_000_000) * 5 +
      (usage.completion_tokens / 1_000_000) * 15;

    console.log(`[extract_handwritten_order] ✅ Extracted order with ${orderData.items?.length || 0} items, cost: $${costUsd.toFixed(4)}`);

    // Format summary for the AI to use
    let summary = '';
    if (orderData.items && orderData.items.length > 0) {
      summary = `📝 PEDIDO EXTRAÍDO:\n`;
      if (orderData.cliente) {
        summary += `Cliente: ${orderData.cliente}\n`;
      }
      summary += `\nItems detectados:\n`;
      orderData.items.forEach((item: any, idx: number) => {
        summary += `${idx + 1}. ${item.modelo || '?'} - Talla ${item.talla || '?'} - Cant: ${item.cantidad || 1}`;
        if (item.color) summary += ` - ${item.color}`;
        summary += '\n';
      });
      if (orderData.total_items) {
        summary += `\nTotal: ${orderData.total_items} pares`;
      }
      if (orderData.observaciones) {
        summary += `\nNotas: ${orderData.observaciones}`;
      }
      if (orderData.partes_ilegibles && orderData.partes_ilegibles.length > 0) {
        summary += `\n⚠️ Partes difíciles de leer: ${orderData.partes_ilegibles.join(', ')}`;
      }
    } else {
      summary = `No pude identificar items claros en la imagen. Texto detectado: ${orderData.raw_text || 'ninguno'}`;
    }

    return {
      success: true,
      result: {
        order: orderData,
        summary,
        confidence: orderData.confianza || 'media',
        cost_usd: costUsd,
        items_count: orderData.items?.length || 0
      }
    };

  } catch (error: any) {
    console.error('[extract_handwritten_order] Error:', error.message);
    return {
      success: false,
      result: {
        error: error.message,
        message: 'No pude procesar la imagen del pedido. ¿Podrías escribirlo directamente aquí?'
      }
    };
  }
}

/**
 * Tool: verificar_opt_in
 * Checks if customer has already accepted/rejected marketing communications in Bitrix
 */
async function executeVerificarOptIn(
  args: { phone?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // ALWAYS use the customer's phone from context, ignore any args.phone
  const phoneToCheck = context.phone;
  const currentMessage = context.currentMessage?.toLowerCase().trim() || '';

  console.log(`[verificar_opt_in] Checking opt-in status for: ${phoneToCheck}, currentMessage: "${currentMessage}"`);

  // DETECT IF THIS IS A BUTTON RESPONSE TO OPT-IN QUESTION
  // Button IDs: opt_in_politica_si, opt_in_politica_no
  // Button labels: "Sí, acepto", "No acepto"
  const isOptInAccepted = currentMessage === 'sí, acepto' ||
                          currentMessage === 'si, acepto' ||
                          currentMessage === 'acepto' ||
                          currentMessage === 'si acepto' ||
                          currentMessage.includes('opt_in_politica_si');

  const isOptInRejected = currentMessage === 'no acepto' ||
                          currentMessage === 'no, no acepto' ||
                          currentMessage.includes('opt_in_politica_no');

  if (isOptInAccepted) {
    console.log('[verificar_opt_in] 🎉 Client ACCEPTED privacy policy! Proceeding to marketing question...');
    // Client accepted privacy policy - now ask about marketing
    const messages: OutboundMessage[] = [{
      type: 'buttons',
      text: '¡Gracias por aceptar! 😊\n\n¿Te gustaría recibir información sobre nuestras promociones y novedades?',
      buttons: [
        { id: 'opt_in_publicidad_si', label: 'Sí, quiero' },
        { id: 'opt_in_publicidad_no', label: 'No, gracias' }
      ]
    }];

    return {
      success: true,
      result: {
        optInStatus: 'privacy_accepted',
        needsOptIn: false, // Privacy is done, now waiting for marketing response
        privacyAccepted: true,
        mensaje: 'Cliente aceptó política de privacidad. Se envió pregunta sobre publicidad. ESPERA la respuesta.',
        accion: 'ESPERAR_RESPUESTA_PUBLICIDAD'
      },
      messages
    };
  }

  if (isOptInRejected) {
    console.log('[verificar_opt_in] ❌ Client REJECTED privacy policy');
    return {
      success: true,
      result: {
        optInStatus: 'rejected',
        needsOptIn: false,
        privacyAccepted: false,
        mensaje: 'Cliente rechazó la política de privacidad. No se puede continuar con la atención automatizada.',
        accion: 'CLIENTE_RECHAZO_POLITICA'
      }
    };
  }

  // Check for marketing response buttons
  const isMarketingAccepted = currentMessage === 'sí, quiero' ||
                               currentMessage === 'si, quiero' ||
                               currentMessage === 'si quiero' ||
                               currentMessage.includes('opt_in_publicidad_si');

  const isMarketingRejected = currentMessage === 'no, gracias' ||
                               currentMessage === 'no gracias' ||
                               currentMessage.includes('opt_in_publicidad_no');

  if (isMarketingAccepted || isMarketingRejected) {
    console.log(`[verificar_opt_in] 📢 Marketing response: ${isMarketingAccepted ? 'ACCEPTED' : 'REJECTED'}`);
    // Call guardar_opt_in automatically
    const guardarResult = await executeGuardarOptIn(
      { aceptaPublicidad: isMarketingAccepted },
      context
    );

    // Return success with continuation message
    return {
      success: true,
      result: {
        optInStatus: 'completed',
        needsOptIn: false,
        privacyAccepted: true,
        marketingAccepted: isMarketingAccepted,
        mensaje: `¡Perfecto! ${isMarketingAccepted ? 'Te mantendremos informado/a' : 'Entendido, no te enviaremos publicidad'}. ¿En qué puedo ayudarte hoy? 😊`,
        accion: 'CONTINUAR_ATENCION',
        bitrixResult: guardarResult.result
      }
    };
  }

  try {
    // Import Bitrix service
    const { getBitrixClientManager } = await import('../../bitrix-client-manager');
    const { createBitrixService } = await import('../../crm/services/bitrix');

    const bitrixClient = getBitrixClientManager().getClient();
    const bitrixService = createBitrixService(bitrixClient || undefined);

    if (!bitrixService.isAvailable) {
      console.log('[verificar_opt_in] Bitrix service not available');
      return {
        success: true,
        result: {
          optInStatus: 'unknown',
          needsOptIn: false, // Don't block if Bitrix is down
          mensaje: 'No se pudo verificar el estado de consentimiento (Bitrix no disponible)'
        }
      };
    }

    // Lookup contact in Bitrix
    const contact = await bitrixService.lookupByPhone(phoneToCheck);

    if (!contact) {
      // No contact found - might be a lead, check leads too
      console.log(`[verificar_opt_in] No contact found for ${phoneToCheck}, sending policy buttons`);

      // For new clients, automatically send policy question with buttons
      const messages: OutboundMessage[] = [{
        type: 'buttons',
        text: '¡Hola! 👋 Bienvenido/a a Azaleia Perú.\n\nAntes de comenzar, necesitamos tu consentimiento según nuestra política de privacidad y tratamiento de datos:\n\n🔗 https://www.azaleia.pe/politica-y-privacidad\n\n¿Aceptas nuestra política de privacidad?',
        buttons: [
          { id: 'opt_in_politica_si', label: 'Sí, acepto' },
          { id: 'opt_in_politica_no', label: 'No acepto' }
        ]
      }];

      return {
        success: true,
        result: {
          optInStatus: 'not_found',
          entityType: null,
          entityId: null,
          needsOptIn: true,
          autorizaPublicidad: null,
          mensaje: 'Se envió pregunta de consentimiento con botones. ESPERA la respuesta del cliente.',
          accion: 'ESPERAR_RESPUESTA_CLIENTE'
        },
        messages
      };
    }

    // Check the authorization field - UF_CRM_1753421555 for contacts
    const autorizaPublicidad = contact.UF_CRM_1753421555;

    // Contact field values: 96420 = Sí, 96422 = No, 96424 = Por confirmar (transitorio)
    // We want only definitives: Sí / No. Treat "Por confirmar" as needsOptIn.
    const needsOptIn = autorizaPublicidad === null ||
                       autorizaPublicidad === undefined ||
                       autorizaPublicidad === '' ||
                       autorizaPublicidad === '0' ||
                       String(autorizaPublicidad) === '96424' ||
                       !['96420', '96422'].includes(String(autorizaPublicidad));

    console.log(`[verificar_opt_in] Contact ${contact.ID}: autorizaPublicidad=${autorizaPublicidad}, needsOptIn=${needsOptIn}`);

    // If opt-in is needed, automatically send the policy question with buttons
    if (needsOptIn) {
      console.log(`[verificar_opt_in] needsOptIn=true, automatically sending policy buttons`);
      // Get customer name for personalized greeting
      const customerName = [contact.NAME || ''].filter(Boolean).join(' ').trim();
      const greeting = customerName ? `¡Hola ${customerName}! 👋` : '¡Hola! 👋';

      const messages: OutboundMessage[] = [{
        type: 'buttons',
        text: `${greeting} Bienvenido/a a Azaleia Perú.\n\nAntes de comenzar, necesitamos tu consentimiento según nuestra política de privacidad y tratamiento de datos:\n\n🔗 https://www.azaleia.pe/politica-y-privacidad\n\n¿Aceptas nuestra política de privacidad?`,
        buttons: [
          { id: 'opt_in_politica_si', label: 'Sí, acepto' },
          { id: 'opt_in_politica_no', label: 'No acepto' }
        ]
      }];

      return {
        success: true,
        result: {
          optInStatus: 'pending',
          entityType: 'contact',
          entityId: contact.ID?.toString(),
          needsOptIn: true,
          autorizaPublicidad: null,
          nombre: [contact.NAME || '', contact.LAST_NAME || ''].filter(Boolean).join(' ').trim() || null,
          mensaje: 'Se envió pregunta de consentimiento con botones. ESPERA la respuesta del cliente.',
          accion: 'ESPERAR_RESPUESTA_CLIENTE'
        },
        messages
      };
    }

    return {
      success: true,
      result: {
        optInStatus: 'completed',
        entityType: 'contact',
        entityId: contact.ID?.toString(),
        needsOptIn: false,
        autorizaPublicidad: autorizaPublicidad || null,
        nombre: [contact.NAME || '', contact.LAST_NAME || ''].filter(Boolean).join(' ').trim() || null,
        mensaje: `Cliente ya tiene consentimiento registrado: ${String(autorizaPublicidad) === '96420' ? 'Sí acepta' : 'No acepta'} publicidad. Continúa con la atención normal.`
      }
    };

  } catch (error: any) {
    console.error('[verificar_opt_in] Error:', error.message);
    return {
      success: false,
      result: {
        error: error.message,
        needsOptIn: false, // Don't block on error
        mensaje: 'Error al verificar consentimiento.'
      }
    };
  }
}

/**
 * Tool: enviar_pregunta_opt_in
 * Sends the opt-in question with interactive buttons
 */
async function executeEnviarPreguntaOptIn(
  args: { tipo: 'politica' | 'publicidad' },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { tipo } = args;

  console.log(`[enviar_pregunta_opt_in] Sending ${tipo} question with buttons`);

  const messages: OutboundMessage[] = [];

  if (tipo === 'politica') {
    messages.push({
      type: 'buttons',
      text: '¡Hola! 👋 Bienvenido/a a Azaleia Perú.\n\nAntes de comenzar, necesitamos tu consentimiento según nuestra política de privacidad y tratamiento de datos:\n\n🔗 https://www.azaleia.pe/politica-y-privacidad\n\n¿Aceptas nuestra política de privacidad?',
      buttons: [
        { id: 'opt_in_politica_si', label: 'Sí, acepto' },
        { id: 'opt_in_politica_no', label: 'No acepto' }
      ]
    });
  } else if (tipo === 'publicidad') {
    messages.push({
      type: 'buttons',
      text: '¡Gracias! 🙌\n\n¿Te gustaría recibir información sobre ofertas exclusivas y promociones de Azaleia?',
      buttons: [
        { id: 'opt_in_publicidad_si', label: 'Sí, quiero' },
        { id: 'opt_in_publicidad_no', label: 'No, gracias' }
      ]
    });
  }

  return {
    success: true,
    result: {
      questionSent: true,
      tipo,
      mensaje: `Pregunta de ${tipo} enviada con botones.`
    },
    messages
  };
}

/**
 * Tool: guardar_opt_in
 * Saves the opt-in response in Bitrix (Contact or Lead)
 */
async function executeGuardarOptIn(
  args: {
    aceptaPublicidad: boolean;
    entityType?: 'contact' | 'lead';
    entityId?: string;
    phone?: string;
  },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const { aceptaPublicidad, entityType, entityId } = args;
  const phoneToCheck = args.phone || context.phone;

  console.log(`[guardar_opt_in] Saving opt-in for ${phoneToCheck}: aceptaPublicidad=${aceptaPublicidad}`);

  try {
    const { getBitrixClientManager } = await import('../../bitrix-client-manager');
    const bitrixClient = getBitrixClientManager().getClient();

    if (!bitrixClient) {
      console.log('[guardar_opt_in] Bitrix client not available');
      return {
        success: false,
        result: {
          saved: false,
          error: 'Bitrix no disponible',
          mensaje: 'No se pudo guardar el consentimiento (Bitrix no disponible)'
        }
      };
    }

    // Value for Bitrix: List IDs from Bitrix24 UI
    // Contact field UF_CRM_1753421555: "96420" = Sí, "96422" = No, "96424" = Por confirmar
    // Lead field UF_CRM_1749101575: "96130" = Sí, "96132" = No
    const valorPublicidadContact = aceptaPublicidad ? '96420' : '96422';
    const valorPublicidadLead = aceptaPublicidad ? '96130' : '96132';

    // If we have entityType and entityId, update directly
    if (entityType && entityId) {
      if (entityType === 'contact') {
        // Update contact - UF_CRM_1753421555
        await bitrixClient.updateContact(entityId, {
          UF_CRM_1753421555: valorPublicidadContact
        });
        console.log(`[guardar_opt_in] Updated contact ${entityId} with UF_CRM_1753421555=${valorPublicidadContact}`);
      } else if (entityType === 'lead') {
        // Update lead - UF_CRM_1749101575
        await bitrixClient.updateLead(entityId, {
          UF_CRM_1749101575: valorPublicidadLead
        });
        console.log(`[guardar_opt_in] Updated lead ${entityId} with UF_CRM_1749101575=${valorPublicidadLead}`);
      }

      const continuationMessage: OutboundMessage = {
        type: 'text',
        text: aceptaPublicidad
          ? '¡Perfecto, gracias! 😊 Ahora sí, ¿en qué puedo ayudarte hoy?'
          : '¡Entendido, gracias! 😊 Ahora sí, ¿en qué puedo ayudarte hoy?'
      };

      return {
        success: true,
        result: {
          saved: true,
          entityType,
          entityId,
          aceptaPublicidad,
          mensaje: `Consentimiento guardado: ${aceptaPublicidad ? 'Sí acepta' : 'No acepta'} publicidad.`
        },
        messages: [continuationMessage]
      };
    }

    // If no entityId, try to find the contact/lead by phone
    const { createBitrixService } = await import('../../crm/services/bitrix');
    const bitrixService = createBitrixService(bitrixClient);

    const contact = await bitrixService.lookupByPhone(phoneToCheck);

    if (contact && contact.ID) {
      await bitrixClient.updateContact(contact.ID.toString(), {
        UF_CRM_1753421555: valorPublicidadContact
      });
      console.log(`[guardar_opt_in] Found and updated contact ${contact.ID} with value ${valorPublicidadContact}`);

      const continuationMessage: OutboundMessage = {
        type: 'text',
        text: aceptaPublicidad
          ? '¡Perfecto, gracias! 😊 Ahora sí, ¿en qué puedo ayudarte hoy?'
          : '¡Entendido, gracias! 😊 Ahora sí, ¿en qué puedo ayudarte hoy?'
      };

      return {
        success: true,
        result: {
          saved: true,
          entityType: 'contact',
          entityId: contact.ID.toString(),
          aceptaPublicidad,
          mensaje: `Consentimiento guardado para contacto ${contact.ID}.`
        },
        messages: [continuationMessage]
      };
    }

    // No contact found, might need to create or it's a lead
    console.log(`[guardar_opt_in] No contact found for ${phoneToCheck}, opt-in not saved`);
    return {
      success: false,
      result: {
        saved: false,
        error: 'No se encontró contacto/lead para guardar',
        mensaje: 'No se pudo guardar el consentimiento (cliente no encontrado en Bitrix)'
      }
    };

  } catch (error: any) {
    console.error('[guardar_opt_in] Error:', error.message);
    return {
      success: false,
      result: {
        saved: false,
        error: error.message,
        mensaje: 'Error al guardar consentimiento en Bitrix.'
      }
    };
  }
}

/**
 * Tool: validar_promotora_sql
 * Validates if a customer is a registered promotora in SQL Server database
 */
async function executeValidarPromotoraSql(
  args: { documento?: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const phoneToCheck = context.phone;
  const documento = args.documento;

  console.log(`[validar_promotora_sql] Validating - phone: ${phoneToCheck}, documento: ${documento || 'N/A'}`);

  try {
    // Import the promotora validator service
    const { validatePromotoraByPhone, validatePromotoraByDocumento } = await import('../../services/promotora-validator');

    let result;

    // If documento is provided, validate by documento
    if (documento && documento.trim()) {
      console.log(`[validar_promotora_sql] Validating by documento: ${documento}`);
      result = await validatePromotoraByDocumento(documento.trim());
    } else {
      // Otherwise validate by phone
      console.log(`[validar_promotora_sql] Validating by phone: ${phoneToCheck}`);
      result = await validatePromotoraByPhone(phoneToCheck);
    }

    if (!result.found) {
      // Not found
      const searchedBy = documento ? `documento ${documento}` : `teléfono`;

      if (!documento) {
        // First attempt was by phone, suggest asking for DNI/RUC
        console.log(`[validar_promotora_sql] Not found by phone, suggest asking for DNI/RUC`);
        return {
          success: true,
          result: {
            found: false,
            isPromotora: false,
            searchedBy: 'phone',
            phone: phoneToCheck,
            mensaje: 'No veo tu registro con este número. ¿Me compartes tu DNI o RUC con el que te inscribiste para revisarlo?',
            accion: 'PEDIR_DOCUMENTO',
            note: 'El cliente debe proporcionar su DNI (8 dígitos) o RUC (11 dígitos) para buscar su registro.'
          }
        };
      } else {
        // Second attempt was by documento, suggest transfer
        console.log(`[validar_promotora_sql] Not found by documento either, suggest transfer`);
        return {
          success: true,
          result: {
            found: false,
            isPromotora: false,
            searchedBy: 'documento',
            documento: documento,
            mensaje: 'No la ubico con ese documento. Te conecto con una asesora para actualizar tus datos y avanzar rápido.',
            accion: 'TRANSFERIR_PARA_ACTUALIZAR',
            note: 'Transferir a cola COUNTER (sales) para que actualicen los datos del cliente.'
          }
        };
      }
    }

    // Found! Return promotora info
    console.log(`[validar_promotora_sql] ✅ Found promotora: ${result.razonSocial}`);

    return {
      success: true,
      result: {
        found: true,
        isPromotora: true,
        idCliente: result.idCliente,
        nombre: result.razonSocial,
        documento: result.documento,
        tipoDocumento: result.tipoDocumento,
        telefono: result.telefono,
        ubicacion: {
          departamento: result.departamento,
          provincia: result.provincia,
          distrito: result.distrito,
        },
        lider: result.lider,
        fechaRegistro: result.fechaRegistro,
        mensaje: `Hola ${result.razonSocial?.split(' ')[0] || ''}! ¿En qué puedo ayudarte hoy?`,
        accion: 'CONTINUAR_ATENCION',
        note: 'Cliente es promotora registrada. Puede hacer pedidos. Guardar flag isPromotora=true en sesión.'
      }
    };

  } catch (error: any) {
    console.error('[validar_promotora_sql] Error:', error.message);
    return {
      success: false,
      result: {
        error: error.message,
        found: false,
        isPromotora: false,
        mensaje: 'Hubo un problema al verificar tu registro. ¿Me podrías proporcionar tu DNI o RUC?',
        accion: 'PEDIR_DOCUMENTO'
      }
    };
  }
}

/**
 * Tool: end_conversation
 * Ends the conversation gracefully
 */
function executeEndConversation(
  args: { reason: string; customer_satisfied?: boolean },
  context: ToolExecutionContext
): ToolExecutionResult {
  const { reason, customer_satisfied } = args;

  console.log(`[end_conversation] Ending conversation: ${reason}, satisfied: ${customer_satisfied}`);

  return {
    success: true,
    result: {
      ended: true,
      reason,
      customerSatisfied: customer_satisfied ?? true,
    },
    shouldEnd: true,
  };
}

/**
 * Execute multiple tool calls in sequence
 */
export async function executeTools(
  toolCalls: OpenAIToolCall[],
  context: ToolExecutionContext
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  for (const toolCall of toolCalls) {
    const result = await executeTool(toolCall, context);
    results.push(result);
  }

  return results;
}
