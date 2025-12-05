/**
 * RAG Embeddings Service with OpenAI
 * Handles PDF processing, embedding generation, and semantic search
 */

import fs from 'fs/promises';
import { createRequire } from 'module';

// Create require for CommonJS modules
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

export interface DocumentChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    source: string;
    page?: number;
    chunkIndex: number;
  };
}

export interface EmbeddingsDatabase {
  chunks: DocumentChunk[];
  version: string;
  lastUpdated: string;
}

/**
 * Split text into chunks for embedding
 */
export function splitIntoChunks(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk);

    // Move forward, ensuring we always advance
    if (end >= text.length) break; // Reached the end
    start += chunkSize - overlap; // Move forward with overlap
  }

  return chunks;
}

/**
 * Extract text from PDF (using efficient pdf-parse 1.x)
 */
export async function extractTextFromPDF(pdfPath: string): Promise<string> {
  try {
    const dataBuffer = await fs.readFile(pdfPath);
    const data = await pdfParse(dataBuffer);
    console.log(`[RAG] Extracted ${data.text.length} characters from ${data.numpages} pages`);
    return data.text;
  } catch (error) {
    console.error(`[RAG] Error extracting text from PDF: ${pdfPath}`, error);
    throw error;
  }
}

/**
 * Create embedding using OpenAI with retry logic for transient errors
 */
export async function createEmbedding(text: string, openaiApiKey: string, maxRetries: number = 3): Promise<number[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-3-small' // Cheapest and fastest
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isRetryable = response.status >= 500 || response.status === 429;

        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
          console.log(`[RAG] OpenAI error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      lastError = error as Error;

      // Check if it's a network error that should be retried
      if (attempt < maxRetries && (error as Error).message?.includes('fetch')) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[RAG] Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Failed to create embedding after retries');
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search for relevant chunks using semantic search
 */
export async function searchRelevantChunks(
  query: string,
  database: EmbeddingsDatabase,
  openaiApiKey: string,
  topK: number = 3
): Promise<DocumentChunk[]> {
  // Create embedding for the query
  const queryEmbedding = await createEmbedding(query, openaiApiKey);

  // Calculate similarity scores
  const scored = database.chunks.map(chunk => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));

  // Sort by score and return top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(item => item.chunk);
}

/**
 * Process PDF and create embeddings database
 */
export async function processPDFDocument(
  pdfPath: string,
  openaiApiKey: string,
  sourceName: string
): Promise<DocumentChunk[]> {
  console.log(`[RAG] Processing PDF: ${pdfPath}`);

  // Extract text
  const text = await extractTextFromPDF(pdfPath);
  console.log(`[RAG] Extracted ${text.length} characters from PDF`);

  // Split into chunks
  const textChunks = splitIntoChunks(text);
  console.log(`[RAG] Split into ${textChunks.length} chunks`);

  // Create embeddings for each chunk
  const chunks: DocumentChunk[] = [];

  for (let i = 0; i < textChunks.length; i++) {
    const memUsage = process.memoryUsage();
    console.log(`[RAG] Creating embedding ${i + 1}/${textChunks.length} (Mem: ${(memUsage.heapUsed / 1024 / 1024).toFixed(0)}MB)`);

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

      // Small delay to avoid rate limits (reduced for faster processing)
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`[RAG] Error creating embedding for chunk ${i}:`, error);
      throw error;
    }
  }

  console.log(`[RAG] Successfully created ${chunks.length} embeddings`);
  return chunks;
}

/**
 * Load embeddings database from JSON
 */
export async function loadEmbeddingsDatabase(dbPath: string): Promise<EmbeddingsDatabase> {
  try {
    const data = await fs.readFile(dbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Return empty database if file doesn't exist
    return {
      chunks: [],
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Save embeddings database to JSON
 */
export async function saveEmbeddingsDatabase(db: EmbeddingsDatabase, dbPath: string): Promise<void> {
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`[RAG] Saved embeddings database to ${dbPath}`);
}
