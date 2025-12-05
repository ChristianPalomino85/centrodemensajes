/**
 * Visual Verification Service
 * Uses GPT-4 Vision to compare user's image against candidate catalog pages
 * and identify the exact product match
 */

import fs from 'fs';
import path from 'path';
import { VisualSearchResult } from './visual-search';

export interface VisualVerifyResult {
  success: boolean;
  matched_page: number | null;
  matched_catalog: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  product_info: string | null;
  error?: string;
}

/**
 * Load image as base64 data URL
 */
function loadImageAsBase64(imagePath: string): string | null {
  try {
    if (!fs.existsSync(imagePath)) {
      console.error(`[VisualVerify] Image not found: ${imagePath}`);
      return null;
    }
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error(`[VisualVerify] Error loading image: ${error}`);
    return null;
  }
}

/**
 * Verify which catalog page contains the product from user's image
 * Uses GPT-4 Vision to compare the user's image against candidate pages
 */
export async function verifyVisualMatch(
  userImageBase64: string,
  candidates: VisualSearchResult[],
  openaiApiKey: string
): Promise<VisualVerifyResult> {
  if (!candidates || candidates.length === 0) {
    return {
      success: false,
      matched_page: null,
      matched_catalog: null,
      confidence: 'none',
      product_info: null,
      error: 'No candidates to verify'
    };
  }

  try {
    console.log(`[VisualVerify] Verifying ${candidates.length} candidate pages...`);

    // Load candidate page images
    const candidateImages: { page: number; catalog: string; base64: string }[] = [];

    for (const candidate of candidates) {
      const base64 = loadImageAsBase64(candidate.image_path);
      if (base64) {
        candidateImages.push({
          page: candidate.page_number,
          catalog: candidate.catalog,
          base64
        });
      }
    }

    if (candidateImages.length === 0) {
      return {
        success: false,
        matched_page: null,
        matched_catalog: null,
        confidence: 'none',
        product_info: null,
        error: 'Could not load candidate images'
      };
    }

    console.log(`[VisualVerify] Loaded ${candidateImages.length} candidate images for comparison`);

    // Build the comparison request for GPT-4 Vision
    const content: any[] = [
      {
        type: 'text',
        text: `Eres un experto en identificación PRECISA de calzado. El cliente ha enviado una foto de un zapato/zapatilla y necesitas identificar EN CUÁL de las siguientes páginas del catálogo aparece EXACTAMENTE ese producto.

INSTRUCCIONES CRÍTICAS:
1. Analiza la imagen del cliente identificando TODOS los detalles visuales:
   - Color principal del upper (parte superior)
   - Colores de ACENTOS/DETALLES (costados, talón, cordones)
   - Color y diseño de la SUELA (blanca, negra, con degradado, etc.)
   - Forma y ubicación del LOGO
   - Patrones o texturas distintivas

2. Compara con CADA página del catálogo buscando coincidencia EXACTA:
   - NO es suficiente que sea "similar" - debe ser el MISMO modelo
   - Los COLORES deben coincidir exactamente (negro con naranja ≠ negro sin naranja)
   - La SUELA debe coincidir (suela con degradado ≠ suela unicolor)

3. Si hay duda entre dos modelos similares, elige el que tenga MÁS características coincidentes

EJEMPLO DE DIFERENCIACIÓN:
- Zapatilla negra con acentos NARANJA en suela/costado → buscar modelo con esos acentos
- Zapatilla negra SIN acentos de color → diferente modelo aunque la forma sea similar

Responde SOLO en este formato JSON:
{
  "found": true/false,
  "page_index": número de PÁGINA mostrada (1, 2, 3, 4 o 5) - NO el número de página del catálogo,
  "catalog_page": número de página real del catálogo,
  "confidence": "high"/"medium"/"low",
  "product_name": "nombre del modelo si es visible",
  "product_code": "código si es visible",
  "product_price": "precio si es visible",
  "colors_matched": "colores que coinciden entre imagen y catálogo",
  "reason": "explicación detallada de por qué este modelo coincide o no"
}

IMPORTANTE: page_index es cuál de las páginas mostradas (1, 2, 3, 4 o 5) contiene el producto.`
      },
      {
        type: 'text',
        text: '📷 IMAGEN DEL CLIENTE:'
      },
      {
        type: 'image_url',
        image_url: { url: userImageBase64, detail: 'high' }
      }
    ];

    // Add each candidate page
    candidateImages.forEach((img, index) => {
      const catalogShort = img.catalog.includes('OLYMPIKUS') ? 'Olympikus' :
                          img.catalog.includes('AZALEIA ABIERTO') ? 'Azaleia Abierto' :
                          img.catalog.includes('AZALEIA CERRADO') ? 'Azaleia Cerrado' :
                          img.catalog.includes('TUS PASOS') ? 'Tus Pasos' : img.catalog;

      content.push({
        type: 'text',
        text: `📄 PÁGINA ${index + 1} - ${catalogShort} (Página ${img.page}):`
      });
      content.push({
        type: 'image_url',
        image_url: { url: img.base64, detail: 'high' }
      });
    });

    // Call GPT-4 Vision
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content
          }
        ],
        max_tokens: 500,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VisualVerify] GPT-4 Vision error:', errorText);
      return {
        success: false,
        matched_page: null,
        matched_catalog: null,
        confidence: 'none',
        product_info: null,
        error: `GPT-4 Vision error: ${response.status}`
      };
    }

    const result = await response.json();
    const assistantMessage = result.choices?.[0]?.message?.content || '';

    console.log('[VisualVerify] GPT-4 Vision response:', assistantMessage);

    // Parse JSON response
    const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        matched_page: null,
        matched_catalog: null,
        confidence: 'none',
        product_info: null,
        error: 'Could not parse GPT-4 Vision response'
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.found && (parsed.page_index || parsed.page_number)) {
      // Map back to actual page number and catalog
      // Use page_index if available (1-5), fallback to page_number for backwards compatibility
      const rawIndex = parsed.page_index || parsed.page_number;
      const pageIndex = rawIndex - 1; // Convert from 1-indexed to 0-indexed

      if (pageIndex >= 0 && pageIndex < candidateImages.length) {
        const matchedCandidate = candidateImages[pageIndex];

        // Build product info string
        let productInfo = '';
        if (parsed.product_name) productInfo += parsed.product_name;
        if (parsed.product_code) productInfo += ` (${parsed.product_code})`;
        if (parsed.product_price) productInfo += ` - ${parsed.product_price}`;

        console.log(`[VisualVerify] ✅ Match found: ${matchedCandidate.catalog} page ${matchedCandidate.page}`);
        console.log(`[VisualVerify] Product: ${productInfo || 'N/A'}`);
        console.log(`[VisualVerify] Confidence: ${parsed.confidence}`);
        console.log(`[VisualVerify] Reason: ${parsed.reason}`);

        return {
          success: true,
          matched_page: matchedCandidate.page,
          matched_catalog: matchedCandidate.catalog,
          confidence: parsed.confidence || 'medium',
          product_info: productInfo || null
        };
      }
    }

    // Log debug info if GPT found product but index is out of range
    if (parsed.found) {
      console.log(`[VisualVerify] ⚠️ GPT found product but index mismatch - page_index: ${parsed.page_index}, page_number: ${parsed.page_number}, candidates: ${candidateImages.length}`);
    }

    console.log(`[VisualVerify] ❌ No exact match found. Reason: ${parsed.reason || 'unknown'}`);

    return {
      success: false,
      matched_page: null,
      matched_catalog: null,
      confidence: 'none',
      product_info: null,
      error: parsed.reason || 'Product not found in candidate pages'
    };

  } catch (error) {
    console.error('[VisualVerify] Error:', error);
    return {
      success: false,
      matched_page: null,
      matched_catalog: null,
      confidence: 'none',
      product_info: null,
      error: `Verification error: ${error}`
    };
  }
}

/**
 * Format verified result for the AI agent
 */
export function formatVerifiedContext(result: VisualVerifyResult, candidates: VisualSearchResult[]): string {
  if (!result.success || !result.matched_page) {
    // Fall back to showing candidates if verification failed
    return '';
  }

  const catalogShort = result.matched_catalog?.includes('OLYMPIKUS') ? 'Olympikus' :
                      result.matched_catalog?.includes('AZALEIA ABIERTO') ? 'Azaleia Abierto' :
                      result.matched_catalog?.includes('AZALEIA CERRADO') ? 'Azaleia Cerrado' :
                      result.matched_catalog?.includes('TUS PASOS') ? 'Tus Pasos' : result.matched_catalog;

  let context = '\n\n🎯 PRODUCTO IDENTIFICADO POR ANÁLISIS VISUAL:\n\n';

  if (result.product_info) {
    context += `**${result.product_info}**\n`;
  }

  context += `Catálogo: ${catalogShort}\n`;
  context += `Página del PDF: ${result.matched_page}\n`;
  context += `Confianza: ${result.confidence === 'high' ? 'Alta ✅' : result.confidence === 'medium' ? 'Media 🔍' : 'Baja ⚠️'}\n\n`;

  context += 'INSTRUCCIÓN: Busca en el RAG la información completa de este producto ';
  context += `(página ${result.matched_page} ±1 del catálogo ${catalogShort}) `;
  context += 'para obtener el PRECIO del producto.\n';
  context += 'IMPORTANTE: NO menciones tallas ni colores - ofrece transferir a un asesor para esa información.\n';

  return context;
}
