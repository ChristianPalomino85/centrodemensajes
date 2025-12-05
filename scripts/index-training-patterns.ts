/**
 * Script para indexar patrones de conversación en RAG
 * Indexa documentos Markdown con patrones de entrenamiento
 */

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import {
  loadEmbeddingsDatabase,
  saveEmbeddingsDatabase,
  createEmbedding,
  splitIntoChunks,
  type EmbeddingsDatabase,
  type DocumentChunk
} from '../server/ai/rag-embeddings';
import { readAIConfig } from '../server/routes/ai-config';

async function indexMarkdownDocument(
  filePath: string,
  openaiApiKey: string,
  sourceName: string
): Promise<DocumentChunk[]> {
  console.log(`[RAG] Procesando documento: ${filePath}`);

  // Leer contenido del archivo
  const content = await readFile(filePath, 'utf-8');
  console.log(`[RAG] Leídos ${content.length} caracteres`);

  // Dividir en chunks más pequeños (800 caracteres con 150 de overlap)
  // Más pequeños para conversaciones porque son fragmentos cortos
  const textChunks = splitIntoChunks(content, 800, 150);
  console.log(`[RAG] Dividido en ${textChunks.length} chunks`);

  const chunks: DocumentChunk[] = [];

  for (let i = 0; i < textChunks.length; i++) {
    console.log(`[RAG] Creando embedding ${i + 1}/${textChunks.length}...`);

    try {
      const embedding = await createEmbedding(textChunks[i], openaiApiKey);

      chunks.push({
        id: `${sourceName}-chunk-${i}`,
        content: textChunks[i],
        embedding,
        metadata: {
          source: sourceName,
          chunkIndex: i
        }
      });

      // Delay pequeño para evitar rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`[RAG] Error en chunk ${i}:`, error);
      throw error;
    }
  }

  console.log(`[RAG] ✅ Creados ${chunks.length} embeddings para ${sourceName}`);
  return chunks;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('📚 INDEXADOR DE PATRONES DE CONVERSACIÓN');
  console.log('═'.repeat(60));

  try {
    // 1. Leer API key de OpenAI (desencriptada)
    const aiConfig = await readAIConfig();
    const openaiApiKey = aiConfig?.openai?.apiKey;

    if (!openaiApiKey) {
      throw new Error('❌ No hay API key de OpenAI configurada. Configúrala desde la UI en Configuración > IA');
    }
    console.log('✅ API key de OpenAI encontrada (desencriptada)\n');

    // 2. Cargar base de datos existente
    const dbPath = path.join(process.cwd(), 'data', 'embeddings-db.json');
    let database = await loadEmbeddingsDatabase(dbPath);
    console.log(`📖 Base de datos actual: ${database.chunks.length} chunks\n`);

    // 3. Remover chunks antiguos de patrones (para reemplazar)
    const oldCount = database.chunks.length;
    database.chunks = database.chunks.filter(
      chunk => !chunk.metadata.source.includes('patrones')
    );
    const removedCount = oldCount - database.chunks.length;
    if (removedCount > 0) {
      console.log(`🗑️  Removidos ${removedCount} chunks antiguos de patrones\n`);
    }

    // 4. Indexar documento de patrones
    const patternsPath = path.join(process.cwd(), 'data', 'knowledge-base', 'patrones-conversacion.md');
    const newChunks = await indexMarkdownDocument(
      patternsPath,
      openaiApiKey,
      'patrones-conversacion'
    );

    // 5. Agregar nuevos chunks
    database.chunks.push(...newChunks);
    database.lastUpdated = new Date().toISOString();

    // 6. Guardar base de datos
    await saveEmbeddingsDatabase(database, dbPath);

    console.log('\n' + '═'.repeat(60));
    console.log('✅ INDEXACIÓN COMPLETADA');
    console.log('═'.repeat(60));
    console.log(`   - Chunks de patrones agregados: ${newChunks.length}`);
    console.log(`   - Total chunks en base de datos: ${database.chunks.length}`);
    console.log(`   - Archivo actualizado: ${dbPath}`);

    // Mostrar resumen por fuente
    const sources: Record<string, number> = {};
    database.chunks.forEach(chunk => {
      sources[chunk.metadata.source] = (sources[chunk.metadata.source] || 0) + 1;
    });

    console.log('\n📊 Chunks por fuente:');
    Object.entries(sources).forEach(([source, count]) => {
      console.log(`   - ${source}: ${count} chunks`);
    });

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
