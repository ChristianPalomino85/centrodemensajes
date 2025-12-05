/**
 * Visual Search Service
 * Uses CLIP embeddings to find similar catalog pages by image
 */

import { spawn } from 'child_process';
import path from 'path';

export interface VisualSearchResult {
  catalog: string;
  page_number: number;
  image_path: string;
  similarity: number;
  source_file: string;
}

export interface VisualSearchResponse {
  success: boolean;
  query_type: string;
  total_pages_searched: number;
  results: VisualSearchResult[];
  error?: string;
}

/**
 * Search for similar catalog pages using an image
 * @param imageInput - File path or base64 data URL of the image
 * @param topK - Number of results to return (default: 5)
 * @returns Promise with search results
 */
export async function visualSearch(imageInput: string, topK: number = 5): Promise<VisualSearchResponse> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'visual-search.py');

    console.log('[VisualSearch] Starting visual search...');
    const isBase64 = imageInput.startsWith('data:');
    console.log(`[VisualSearch] Image input type: ${isBase64 ? 'base64' : 'file'}`);

    // For base64 images, pass via stdin to avoid E2BIG error (argument too long)
    const args = isBase64 ? ['--stdin', topK.toString()] : [imageInput, topK.toString()];

    const pythonProcess = spawn('python3', [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, TF_CPP_MIN_LOG_LEVEL: '3' }
    });

    // If base64, write to stdin
    if (isBase64) {
      pythonProcess.stdin.write(imageInput);
      pythonProcess.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (stderr && !stderr.includes('Using a slow image processor')) {
        console.error('[VisualSearch] Python stderr:', stderr);
      }

      try {
        const result = JSON.parse(stdout);

        if (result.success) {
          console.log(`[VisualSearch] ✅ Found ${result.results.length} similar pages`);
          result.results.forEach((r: VisualSearchResult, i: number) => {
            console.log(`  [${i + 1}] ${r.catalog} - Page ${r.page_number} (${(r.similarity * 100).toFixed(1)}%)`);
          });
        } else {
          console.error('[VisualSearch] ❌ Search failed:', result.error);
        }

        resolve(result);
      } catch (error) {
        console.error('[VisualSearch] ❌ Failed to parse result:', error);
        console.error('[VisualSearch] Raw stdout:', stdout);
        resolve({
          success: false,
          query_type: 'image',
          total_pages_searched: 0,
          results: [],
          error: `Failed to parse search result: ${error}`
        });
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('[VisualSearch] ❌ Process error:', error);
      resolve({
        success: false,
        query_type: 'image',
        total_pages_searched: 0,
        results: [],
        error: `Process error: ${error.message}`
      });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      pythonProcess.kill();
      resolve({
        success: false,
        query_type: 'image',
        total_pages_searched: 0,
        results: [],
        error: 'Search timeout (60s)'
      });
    }, 60000);
  });
}

/**
 * Format visual search results for the AI agent
 */
export function formatVisualSearchContext(results: VisualSearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  let context = '\n\n📸 RESULTADOS DE BÚSQUEDA VISUAL (CLIP):\n\n';
  context += 'IMPORTANTE: Las páginas del PDF pueden tener un desfase de 2-4 páginas respecto a las páginas impresas del catálogo.\n';
  context += 'Por ejemplo, la página 32 del PDF podría ser la página 30 o 28 del catálogo impreso.\n\n';
  context += 'Páginas del catálogo que coinciden visualmente con la imagen del cliente:\n\n';

  results.forEach((result, index) => {
    const catalogShort = result.catalog.includes('OLYMPIKUS') ? 'Olympikus' :
                        result.catalog.includes('AZALEIA ABIERTO') ? 'Azaleia Abierto' :
                        result.catalog.includes('AZALEIA CERRADO') ? 'Azaleia Cerrado' :
                        result.catalog.includes('TUS PASOS') ? 'Tus Pasos' : result.catalog;

    const matchQuality = result.similarity > 0.85 ? '🎯 Match muy alto' :
                        result.similarity > 0.75 ? '✅ Match bueno' :
                        result.similarity > 0.65 ? '🔍 Match parcial' : '⚠️ Match bajo';

    // Show range of possible catalog pages (accounting for offset)
    const pdfPage = result.page_number;
    const possiblePages = `${pdfPage - 2} a ${pdfPage}`;

    context += `${index + 1}. **${catalogShort}** - Página PDF ${pdfPage} (aprox. páginas ${possiblePages} del catálogo impreso)\n`;
    context += `   Similitud visual: ${(result.similarity * 100).toFixed(1)}% ${matchQuality}\n\n`;
  });

  context += 'INSTRUCCIONES IMPORTANTES:\n';
  context += '1. La búsqueda visual encuentra páginas visualmente similares, pero NO es 100% precisa.\n';
  context += '2. SIEMPRE busca en el RAG información de las páginas cercanas (±2 páginas) a cada resultado.\n';
  context += '3. Si hay varios productos posibles en esas páginas, MENCIONA TODOS con sus precios.\n';
  context += '4. Pregunta al cliente cuál de los productos es el que busca.\n';
  context += '5. NO asumas que el primer resultado es el correcto - la coincidencia visual puede ser con un producto vecino.\n';
  context += '6. NUNCA menciones tallas ni colores disponibles - para esa info ofrece transferir a un asesor.\n';

  return context;
}
