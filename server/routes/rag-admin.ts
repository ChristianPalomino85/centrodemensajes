/**
 * RAG Administration Panel API Routes
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { readConfig as readAgentConfig, writeConfig as writeAgentConfig } from './ia-agent-config';
import { readAIConfig, writeAIConfig } from './ai-config';
import {
  loadEmbeddingsDatabase,
  processPDFDocument,
  saveEmbeddingsDatabase,
  type EmbeddingsDatabase
} from '../ai/rag-embeddings';

const router = express.Router();

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'data', 'knowledge-base');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

/**
 * GET /api/rag-admin/status
 * Get RAG system status
 */
router.get('/status', async (req, res) => {
  try {
    const agentConfig = await readAgentConfig();
    const aiConfig = await readAIConfig();

    const knowledgeBase = agentConfig?.integrations?.knowledgeBase;
    const hasApiKey = !!aiConfig?.openai?.apiKey;

    // Load embeddings database
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    let database: EmbeddingsDatabase;
    try {
      database = await loadEmbeddingsDatabase(dbPath);
    } catch {
      database = { chunks: [], version: '1.0.0', lastUpdated: new Date().toISOString() };
    }

    // Calculate how many documents are indexed
    const documents = knowledgeBase?.documents || [];
    const documentsIndexed = documents.filter((doc: any) => {
      return database.chunks.some(chunk => chunk.metadata.source === doc.id);
    }).length;

    // Mark documents as indexed
    const documentsWithStatus = documents.map((doc: any) => {
      const chunks = database.chunks.filter(chunk => chunk.metadata.source === doc.id);
      return {
        ...doc,
        indexed: chunks.length > 0,
        chunks: chunks.length
      };
    });

    res.json({
      enabled: knowledgeBase?.enabled || false,
      apiKeyConfigured: hasApiKey,
      documentsIndexed,
      totalDocuments: documents.length,
      totalChunks: database.chunks.length,
      documents: documentsWithStatus
    });
  } catch (error) {
    console.error('[RAG Admin] Error getting status:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/validate-api-key
 * Validate OpenAI API key
 */
router.post('/validate-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ valid: false, message: 'API key requerida' });
    }

    // Test API key with OpenAI
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (response.ok) {
      res.json({ valid: true });
    } else {
      const error = await response.json();
      res.json({ valid: false, error: error.error?.message || 'API key inválida' });
    }
  } catch (error) {
    res.json({ valid: false, error: String(error) });
  }
});

/**
 * POST /api/rag-admin/save-api-key
 * Save OpenAI API key
 */
router.post('/save-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ message: 'API key requerida' });
    }

    // Validate API key first
    const validateResponse = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!validateResponse.ok) {
      const error = await validateResponse.json();
      return res.status(400).json({
        error: error.error?.message || 'API key inválida'
      });
    }

    const modelsData = await validateResponse.json();
    const modelsAvailable = modelsData.data?.length || 0;

    const aiConfig = await readAIConfig();
    if (!aiConfig.openai) {
      aiConfig.openai = {};
    }
    aiConfig.openai.apiKey = apiKey;

    await writeAIConfig(aiConfig);

    res.json({
      success: true,
      message: 'API key guardada correctamente',
      modelsAvailable
    });
  } catch (error) {
    console.error('[RAG Admin] Error saving API key:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/upload-pdf
 * Upload a new PDF to knowledge base
 */
router.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se recibió archivo PDF' });
    }

    const { name, description, type } = req.body;

    const document = {
      id: `doc-${Date.now()}`,
      name: name || req.file.originalname,
      description: description || '',
      url: req.file.path,
      type: type || 'catalog',
      uploadedAt: new Date().toISOString()
    };

    // Add to agent config
    const agentConfig = await readAgentConfig();
    if (!agentConfig.integrations) {
      agentConfig.integrations = {};
    }
    if (!agentConfig.integrations.knowledgeBase) {
      agentConfig.integrations.knowledgeBase = { enabled: true, documents: [] };
    }
    if (!agentConfig.integrations.knowledgeBase.documents) {
      agentConfig.integrations.knowledgeBase.documents = [];
    }

    agentConfig.integrations.knowledgeBase.documents.push(document);
    await writeAgentConfig(agentConfig);

    res.json({
      success: true,
      message: 'PDF subido correctamente',
      filename: document.name,
      document
    });
  } catch (error) {
    console.error('[RAG Admin] Error uploading PDF:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * DELETE /api/rag-admin/document/:id
 * Remove a document from knowledge base
 */
router.delete('/document/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const agentConfig = await readAgentConfig();
    const documents = agentConfig?.integrations?.knowledgeBase?.documents || [];

    const docIndex = documents.findIndex((d: any) => d.id === id);
    if (docIndex === -1) {
      return res.status(404).json({ message: 'Documento no encontrado' });
    }

    const doc = documents[docIndex];

    // Delete file if exists
    try {
      await fs.unlink(doc.url);
    } catch (err) {
      console.log('[RAG Admin] Could not delete file:', doc.url);
    }

    // Remove from config
    documents.splice(docIndex, 1);
    await writeAgentConfig(agentConfig);

    res.json({ success: true, message: 'Documento eliminado' });
  } catch (error) {
    console.error('[RAG Admin] Error deleting document:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/index
 * Index all documents (create embeddings)
 */
router.post('/index', async (req, res) => {
  try {
    const agentConfig = await readAgentConfig();
    const aiConfig = await readAIConfig();

    const openaiApiKey = aiConfig?.openai?.apiKey;
    if (!openaiApiKey) {
      return res.status(400).json({ message: 'API key de OpenAI no configurada' });
    }

    const documents = agentConfig?.integrations?.knowledgeBase?.documents || [];
    if (documents.length === 0) {
      return res.status(400).json({ message: 'No hay documentos para indexar' });
    }

    // Load or create embeddings database
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    let database = await loadEmbeddingsDatabase(dbPath);

    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      try {
        // Check if already indexed
        const existingChunks = database.chunks.filter(c => c.metadata.source === doc.id);
        if (existingChunks.length > 0) {
          console.log(`[RAG Admin] Document ${doc.id} already indexed, skipping`);
          skipped++;
          continue;
        }

        console.log(`[RAG Admin] Indexing document: ${doc.name}`);
        const chunks = await processPDFDocument(doc.url, openaiApiKey, doc.id);
        database.chunks.push(...chunks);
        indexed++;
      } catch (error) {
        console.error(`[RAG Admin] Error indexing ${doc.name}:`, error);
        errors.push(`${doc.name}: ${String(error)}`);
      }
    }

    // Update metadata and save
    database.lastUpdated = new Date().toISOString();
    await saveEmbeddingsDatabase(database, dbPath);

    res.json({
      success: true,
      indexed,
      skipped,
      totalChunks: database.chunks.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[RAG Admin] Error during indexing:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/reindex/:id
 * Reindex a specific document
 */
router.post('/reindex/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const agentConfig = await readAgentConfig();
    const aiConfig = await readAIConfig();

    const openaiApiKey = aiConfig?.openai?.apiKey;
    if (!openaiApiKey) {
      return res.status(400).json({ message: 'API key de OpenAI no configurada' });
    }

    const documents = agentConfig?.integrations?.knowledgeBase?.documents || [];
    const doc = documents.find((d: any) => d.id === id);

    if (!doc) {
      return res.status(404).json({ message: 'Documento no encontrado' });
    }

    // Load database
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    let database = await loadEmbeddingsDatabase(dbPath);

    // Remove existing chunks for this document
    database.chunks = database.chunks.filter(c => c.metadata.source !== id);

    // Reindex
    console.log(`[RAG Admin] Reindexing document: ${doc.name}`);
    const chunks = await processPDFDocument(doc.url, openaiApiKey, doc.id);
    database.chunks.push(...chunks);

    // Save
    database.lastUpdated = new Date().toISOString();
    await saveEmbeddingsDatabase(database, dbPath);

    res.json({
      success: true,
      message: `Documento reindexado: ${chunks.length} chunks`,
      chunks: chunks.length
    });
  } catch (error) {
    console.error('[RAG Admin] Error reindexing:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * DELETE /api/rag-admin/clear-index
 * Clear all embeddings
 */
router.delete('/clear-index', async (req, res) => {
  try {
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    const emptyDb: EmbeddingsDatabase = {
      chunks: [],
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    };

    await saveEmbeddingsDatabase(emptyDb, dbPath);

    res.json({ success: true, message: 'Índice limpiado correctamente' });
  } catch (error) {
    console.error('[RAG Admin] Error clearing index:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/toggle
 * Enable/disable RAG system
 */
router.post('/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    const agentConfig = await readAgentConfig();
    if (!agentConfig.integrations) {
      agentConfig.integrations = {};
    }
    if (!agentConfig.integrations.knowledgeBase) {
      agentConfig.integrations.knowledgeBase = { enabled: false, documents: [] };
    }

    agentConfig.integrations.knowledgeBase.enabled = enabled;
    await writeAgentConfig(agentConfig);

    res.json({
      success: true,
      enabled,
      message: `RAG ${enabled ? 'activado' : 'desactivado'}`
    });
  } catch (error) {
    console.error('[RAG Admin] Error toggling RAG:', error);
    res.status(500).json({ message: String(error) });
  }
});

// ============================================
// TRAINING ENDPOINTS - Aprendizaje de Chats
// ============================================

/**
 * GET /api/rag-admin/training/status
 * Get training data status
 */
router.get('/training/status', async (req, res) => {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const kbDir = path.join(dataDir, 'knowledge-base');

    // Check for training data files
    let trainingDataExists = false;
    let trainingDataDate = '';
    let trainingDataSize = 0;
    let conversationsCount = 0;
    let messagesCount = 0;

    // Check for pattern file
    let patternsExists = false;
    let patternsSize = 0;

    // Check for fine-tuning file
    let fineTuningExists = false;
    let fineTuningExamples = 0;

    try {
      const files = await fs.readdir(dataDir);

      // Find most recent training data file
      const trainingFiles = files.filter(f => f.startsWith('training-data-') && f.endsWith('.json'));
      if (trainingFiles.length > 0) {
        const latestFile = trainingFiles.sort().reverse()[0];
        const filePath = path.join(dataDir, latestFile);
        const stats = await fs.stat(filePath);
        trainingDataExists = true;
        trainingDataDate = latestFile.replace('training-data-', '').replace('.json', '');
        trainingDataSize = stats.size;

        // Read to get counts
        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        conversationsCount = content.length;
        messagesCount = content.reduce((acc: number, conv: any) => acc + (conv.messages?.length || 0), 0);
      }

      // Check fine-tuning file
      const ftFiles = files.filter(f => f.startsWith('fine-tuning-') && f.endsWith('.jsonl'));
      if (ftFiles.length > 0) {
        const latestFt = ftFiles.sort().reverse()[0];
        const ftPath = path.join(dataDir, latestFt);
        const ftContent = await fs.readFile(ftPath, 'utf-8');
        fineTuningExists = true;
        fineTuningExamples = ftContent.split('\n').filter(line => line.trim()).length;
      }
    } catch (err) {
      // Files don't exist yet
    }

    // Check patterns file
    try {
      const patternsPath = path.join(kbDir, 'patrones-conversacion.md');
      const stats = await fs.stat(patternsPath);
      patternsExists = true;
      patternsSize = stats.size;
    } catch (err) {
      // File doesn't exist
    }

    // Get chunks count for patterns
    const dbPath = path.join(dataDir, 'embeddings-db.json');
    let patternsChunks = 0;
    try {
      const database = await loadEmbeddingsDatabase(dbPath);
      patternsChunks = database.chunks.filter(c => c.metadata.source === 'patrones-conversacion').length;
    } catch (err) {
      // Database doesn't exist
    }

    res.json({
      trainingData: {
        exists: trainingDataExists,
        date: trainingDataDate,
        size: trainingDataSize,
        conversations: conversationsCount,
        messages: messagesCount
      },
      patterns: {
        exists: patternsExists,
        size: patternsSize,
        indexed: patternsChunks > 0,
        chunks: patternsChunks
      },
      fineTuning: {
        exists: fineTuningExists,
        examples: fineTuningExamples
      }
    });
  } catch (error) {
    console.error('[RAG Admin] Error getting training status:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/training/export
 * Export chats for training
 */
router.post('/training/export', async (req, res) => {
  try {
    const { days = 30, minMessages = 5 } = req.body;

    console.log(`[Training] Exporting chats from last ${days} days with min ${minMessages} messages`);

    // Dynamic import of pg
    const { Pool } = await import('pg');
    const pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
    });

    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    // Get conversations with enough messages
    const convQuery = `
      SELECT c.id, c.phone, c.category, c.status, COUNT(m.id) as msg_count
      FROM crm_conversations c
      JOIN crm_messages m ON m.conversation_id = c.id
      WHERE c.last_message_at > $1
        AND c.category NOT IN ('mass_send', 'campaign')
      GROUP BY c.id, c.phone, c.category, c.status
      HAVING COUNT(m.id) >= $2
      ORDER BY COUNT(m.id) DESC
      LIMIT 100
    `;

    const convResult = await pool.query(convQuery, [cutoffTime, minMessages]);

    // System messages to filter
    const systemPatterns = [
      'En cola', 'Asignado automáticamente', 'aceptó la conversación',
      'Conversación cerrada', 'Bot inició atención', 'Bot transfirió',
      'cambió su estado', 'devuelta a la cola', 'templateName',
      'No pude reconocer tu respuesta'
    ];

    const exports: any[] = [];
    let totalMessages = 0;

    for (const conv of convResult.rows) {
      const msgQuery = `
        SELECT direction, text, created_at as timestamp, sent_by
        FROM crm_messages WHERE conversation_id = $1
        ORDER BY created_at ASC
      `;
      const msgResult = await pool.query(msgQuery, [conv.id]);

      const messages: any[] = [];
      for (const msg of msgResult.rows) {
        if (!msg.text || msg.text.trim() === '') continue;
        if (systemPatterns.some(p => msg.text.includes(p))) continue;

        const role = msg.direction === 'incoming' ? 'cliente' :
          (msg.sent_by && msg.sent_by !== 'bot' && msg.sent_by !== 'system' ? 'asesor' : 'bot');

        messages.push({
          role,
          content: msg.text.trim(),
          timestamp: new Date(parseInt(msg.timestamp)).toISOString()
        });
      }

      if (messages.length >= 3) {
        exports.push({
          id: conv.id,
          phone: conv.phone.replace(/\d{4}$/, '****'),
          category: conv.category || 'general',
          status: conv.status,
          total_messages: messages.length,
          messages
        });
        totalMessages += messages.length;
      }
    }

    await pool.end();

    // Save training data
    const outputPath = path.join(process.cwd(), 'data', `training-data-${new Date().toISOString().split('T')[0]}.json`);
    await fs.writeFile(outputPath, JSON.stringify(exports, null, 2));

    // Generate patterns document
    let patternsDoc = `# PATRONES DE CONVERSACIÓN - AZALEIA PERÚ

Este documento contiene patrones reales de cómo los clientes hacen pedidos y consultas.
Generado: ${new Date().toISOString()}
Total conversaciones analizadas: ${exports.length}

## PATRONES DE INICIO DE CONVERSACIÓN

Los clientes típicamente inician con:
`;

    // Analyze openings
    const openings: Record<string, number> = {};
    exports.forEach(conv => {
      const first = conv.messages.find((m: any) => m.role === 'cliente');
      if (first) {
        const normalized = first.content.toLowerCase().trim();
        openings[normalized] = (openings[normalized] || 0) + 1;
      }
    });

    Object.entries(openings)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([text, count]) => {
        patternsDoc += `- "${text}" (${count} veces)\n`;
      });

    patternsDoc += `\n## EJEMPLOS DE CONVERSACIONES EXITOSAS\n\n`;

    // Add example conversations
    const goodConvs = exports
      .filter(c => c.messages.length >= 6 && c.status === 'closed')
      .slice(0, 10);

    goodConvs.forEach((conv, idx) => {
      patternsDoc += `### Ejemplo ${idx + 1} (${conv.category})\n\n`;
      conv.messages.forEach((m: any) => {
        const label = m.role === 'cliente' ? 'CLIENTE' : 'ASESOR';
        patternsDoc += `**${label}:** ${m.content}\n\n`;
      });
      patternsDoc += `---\n\n`;
    });

    const patternsPath = path.join(process.cwd(), 'data', 'knowledge-base', 'patrones-conversacion.md');
    await fs.writeFile(patternsPath, patternsDoc);

    // Generate fine-tuning file
    const ftExamples: any[] = [];
    for (const conv of exports) {
      if (conv.messages.length < 4) continue;

      const example: any = {
        messages: [{
          role: 'system',
          content: 'Eres un asistente de ventas de Azaleia Perú. Ayuda a los clientes con información de productos, precios y pedidos.'
        }]
      };

      for (const msg of conv.messages) {
        example.messages.push({
          role: msg.role === 'cliente' ? 'user' : 'assistant',
          content: msg.content
        });
      }

      const hasUser = example.messages.filter((m: any) => m.role === 'user').length >= 2;
      const hasAssistant = example.messages.filter((m: any) => m.role === 'assistant').length >= 2;
      if (hasUser && hasAssistant) ftExamples.push(example);
    }

    const ftPath = path.join(process.cwd(), 'data', `fine-tuning-${new Date().toISOString().split('T')[0]}.jsonl`);
    await fs.writeFile(ftPath, ftExamples.map(e => JSON.stringify(e)).join('\n'));

    res.json({
      success: true,
      conversations: exports.length,
      messages: totalMessages,
      patternsGenerated: true,
      fineTuningExamples: ftExamples.length,
      files: {
        trainingData: outputPath,
        patterns: patternsPath,
        fineTuning: ftPath
      }
    });
  } catch (error) {
    console.error('[Training] Export error:', error);
    res.status(500).json({ message: String(error) });
  }
});

/**
 * POST /api/rag-admin/training/index-patterns
 * Index conversation patterns into RAG
 */
router.post('/training/index-patterns', async (req, res) => {
  try {
    const aiConfig = await readAIConfig();
    const openaiApiKey = aiConfig?.openai?.apiKey;

    if (!openaiApiKey) {
      return res.status(400).json({ message: 'API key de OpenAI no configurada' });
    }

    const patternsPath = path.join(process.cwd(), 'data', 'knowledge-base', 'patrones-conversacion.md');

    // Check if patterns file exists
    try {
      await fs.access(patternsPath);
    } catch {
      return res.status(400).json({
        error: 'No hay archivo de patrones. Primero exporta los chats.'
      });
    }

    // Read patterns file
    const content = await fs.readFile(patternsPath, 'utf-8');
    console.log(`[Training] Indexing ${content.length} characters of patterns`);

    // Split into chunks
    const { splitIntoChunks, createEmbedding } = await import('../ai/rag-embeddings');
    const textChunks = splitIntoChunks(content, 800, 150);
    console.log(`[Training] Split into ${textChunks.length} chunks`);

    // Load existing database
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    let database = await loadEmbeddingsDatabase(dbPath);

    // Remove old pattern chunks
    const oldCount = database.chunks.length;
    database.chunks = database.chunks.filter(c => c.metadata.source !== 'patrones-conversacion');
    const removedCount = oldCount - database.chunks.length;

    // Create embeddings for new chunks
    const newChunks: any[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      console.log(`[Training] Creating embedding ${i + 1}/${textChunks.length}`);

      const embedding = await createEmbedding(textChunks[i], openaiApiKey);
      newChunks.push({
        id: `patrones-conversacion-chunk-${i}`,
        content: textChunks[i],
        embedding,
        metadata: {
          source: 'patrones-conversacion',
          chunkIndex: i
        }
      });

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Add new chunks and save
    database.chunks.push(...newChunks);
    database.lastUpdated = new Date().toISOString();
    await saveEmbeddingsDatabase(database, dbPath);

    res.json({
      success: true,
      chunksRemoved: removedCount,
      chunksAdded: newChunks.length,
      totalChunks: database.chunks.length
    });
  } catch (error) {
    console.error('[Training] Index patterns error:', error);
    res.status(500).json({ message: String(error) });
  }
});

export default router;
