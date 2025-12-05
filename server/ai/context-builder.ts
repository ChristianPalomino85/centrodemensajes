/**
 * Context Builder for AI Agent
 * Builds dynamic context based on WhatsApp number and Bitrix contact data
 */

import { createBitrixService } from '../crm/services/bitrix';
import { crmDb } from '../crm/db-postgres';

export interface BusinessContext {
  channel: 'catalogo' | 'ecommerce' | 'prospectos' | 'general';
  channelName: string;
  priority: string[];
  greeting: string;
}

export interface ContactContext {
  name: string | null;
  contactType: string | null;  // From UF_CRM_67D702957E80A
  isExisting: boolean;
  bitrixId: string | null;
}

// PhoneNumberId to phone number mapping
const PHONE_NUMBER_ID_MAP: Record<string, string> = {
  '857608144100041': '6193638',  // +51 1 6193638
  // Add more mappings as needed
};

// WhatsApp number to business context mapping
const WHATSAPP_CHANNELS: Record<string, BusinessContext> = {
  // Ecommerce / Tiendas
  '6193636': {
    channel: 'ecommerce',
    channelName: 'Ecommerce/Tiendas',
    priority: ['tiendas', 'stock', 'precios_publico', 'cambios', 'garantia'],
    greeting: '¡Hola! Bienvenido a Azaleia Perú 👟'
  },
  '6193637': {
    channel: 'ecommerce',
    channelName: 'Ecommerce/Tiendas',
    priority: ['tiendas', 'stock', 'precios_publico', 'cambios', 'garantia'],
    greeting: '¡Hola! Bienvenido a Azaleia Perú 👟'
  },
  // Promotoras (Catálogo)
  '961842916': {
    channel: 'catalogo',
    channelName: 'Catálogo Promotoras',
    priority: ['precios_promotora', 'pedidos', 'pagos', 'envios', 'catalogo'],
    greeting: '¡Hola! Soy tu asistente de Catálogo Azaleia 💙'
  },
  // Prospectos
  '966748784': {
    channel: 'prospectos',
    channelName: 'Prospectos',
    priority: ['ser_promotora', 'beneficios', 'inscripcion', 'informacion'],
    greeting: '¡Hola! Gracias por tu interés en Azaleia 💙'
  }
};

// Contact type mapping from Bitrix field TYPE_ID (lista desplegable "Tipo de contacto")
const CONTACT_TYPES: Record<string, string> = {
  '1': 'promotor',
  '2': 'lider',
  '3': 'funcionario',
  '4': 'segmento',
  '5': 'cliente_ecommerce',
  '6': 'cliente_tienda_concepto',
  '7': 'cliente_outlet',
  '8': 'cliente_mayorista',
  '9': 'cliente_vip',
  '10': 'ecommerce_catalogos',
  '11': 'ecommerce_tiendas',
  '12': 'catalogos_tiendas',
  '13': 'catalogos_ecommerce',
  '14': 'catalogos_tiendas_ecommerce',
  '15': 'persona_contacto',
};

/**
 * Get business context from WhatsApp number
 */
export function getBusinessContext(whatsappNumber: string | null): BusinessContext {
  if (!whatsappNumber) {
    return {
      channel: 'general',
      channelName: 'General',
      priority: [],
      greeting: '¡Hola! Soy el asistente virtual de Azaleia 😊'
    };
  }

  // First, check if it's a phoneNumberId and map it to actual phone number
  let numberToCheck = whatsappNumber;
  if (PHONE_NUMBER_ID_MAP[whatsappNumber]) {
    numberToCheck = PHONE_NUMBER_ID_MAP[whatsappNumber];
    console.log(`[getBusinessContext] Mapped phoneNumberId ${whatsappNumber} to ${numberToCheck}`);
  }

  // Clean the number (remove prefix like 51, +51, etc.)
  const cleanNumber = numberToCheck.replace(/^\+?51/, '').replace(/\D/g, '');
  console.log(`[getBusinessContext] Clean number to match: "${cleanNumber}"`);

  // Try to match with known channels
  for (const [key, context] of Object.entries(WHATSAPP_CHANNELS)) {
    console.log(`[getBusinessContext] Checking if "${cleanNumber}" includes "${key}": ${cleanNumber.includes(key)}`);
    if (cleanNumber.includes(key) || cleanNumber.endsWith(key)) {
      console.log(`[getBusinessContext] ✅ MATCHED! Returning channel: ${context.channelName}`);
      return context;
    }
  }

  console.log(`[getBusinessContext] ❌ No match found, returning General`);
  return {
    channel: 'general',
    channelName: 'General',
    priority: [],
    greeting: '¡Hola! Soy el asistente virtual de Azaleia 😊'
  };
}

/**
 * Get contact info from Bitrix by phone number
 */
export async function getContactContext(customerPhone: string): Promise<ContactContext> {
  const defaultContext: ContactContext = {
    name: null,
    contactType: null,
    isExisting: false,
    bitrixId: null
  };

  if (!customerPhone) return defaultContext;

  try {
    // First: Get cached name from CRM conversation (fast)
    const conversations = await crmDb.getAllConversations();
    const conversation = conversations.find(c => c.phone === customerPhone || c.phone === customerPhone.replace(/^51/, ''));
    const cachedName = conversation?.contactName || null;
    const cachedBitrixId = conversation?.bitrixId || null;

    // Second: Always lookup in Bitrix to get contact type (UF_CRM_67D702957E80A)
    // Get the global Bitrix client
    const { getBitrixClientManager } = await import('../bitrix-client-manager');
    const bitrixClient = getBitrixClientManager().getClient();
    const bitrixService = createBitrixService(bitrixClient || undefined);

    if (!bitrixService.isAvailable) {
      console.log(`[ContextBuilder] ⚠️ Bitrix service not available`);
      if (cachedName) {
        return { name: cachedName, contactType: null, isExisting: true, bitrixId: cachedBitrixId };
      }
      return defaultContext;
    }

    const phoneDigits = customerPhone.replace(/\D/g, '');
    const withoutCountry = phoneDigits.replace(/^51/, '');

    // Try different formats
    const phoneFormats = [
      phoneDigits,                    // 51918131082
      withoutCountry,                 // 918131082
      `+51${withoutCountry}`,         // +51918131082
      `+${phoneDigits}`,              // +51918131082
      `9${withoutCountry.slice(-8)}`, // 9XXXXXXXX (if 8 digits after 9)
    ];

    console.log(`[ContextBuilder] 🔍 Looking up Bitrix contact for phone variants:`, phoneFormats);

    let contact = null;
    for (const phone of phoneFormats) {
      console.log(`[ContextBuilder] 🔎 Trying format: ${phone}`);
      contact = await bitrixService.lookupByPhone(phone);
      if (contact?.ID) {
        console.log(`[ContextBuilder] ✅ Found with format: ${phone}`);
        break;
      } else {
        console.log(`[ContextBuilder] ❌ Not found with format: ${phone}`);
      }
    }

    // If no Bitrix contact but we have cached name, use that
    if (!contact?.ID) {
      if (cachedName) {
        console.log(`[ContextBuilder] ⚠️ Using cached name (no Bitrix match): ${cachedName}`);
        return {
          name: cachedName,
          contactType: null,
          isExisting: true,
          bitrixId: cachedBitrixId
        };
      }
      console.log(`[ContextBuilder] ❌ No contact found for: ${withoutCountry}`);
      return defaultContext;
    }

    // Extract name from Bitrix
    const bitrixFirstName = contact.NAME || '';
    const bitrixLastName = contact.LAST_NAME || '';
    const fullName = [bitrixFirstName, bitrixLastName].filter(Boolean).join(' ').trim();

    // Extract contact type from TYPE_ID (campo estándar de Bitrix "Tipo de contacto")
    const contactTypeId = contact.TYPE_ID;
    const contactType = contactTypeId ? (CONTACT_TYPES[contactTypeId] || `tipo_${contactTypeId}`) : null;

    console.log(`[ContextBuilder] ✅ Bitrix contact: ${fullName}, TYPE_ID: ${contactTypeId}, Mapped: ${contactType}`);


    return {
      name: fullName || cachedName || null,
      contactType,
      isExisting: true,
      bitrixId: contact.ID.toString()
    };
  } catch (error) {
    console.error('[ContextBuilder] Error fetching Bitrix contact:', error);
    return defaultContext;
  }
}

/**
 * Build personalized system context based on channel and contact
 */
export function buildPersonalizedContext(
  businessContext: BusinessContext,
  contactContext: ContactContext,
  isFirstMessage: boolean,
  hasImage: boolean
): string {
  let context = '\n\n═══ CONTEXTO DINÁMICO ═══\n\n';

  // Current time in Lima timezone for greeting
  const now = new Date();
  const limaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const hour = limaTime.getHours();
  const timeOfDay = hour >= 5 && hour < 12 ? 'mañana' :
                    hour >= 12 && hour < 18 ? 'tarde' : 'noche';
  const greeting = hour >= 5 && hour < 12 ? '¡Buenos días!' :
                   hour >= 12 && hour < 18 ? '¡Buenas tardes!' : '¡Buenas noches!';

  console.log(`[ContextBuilder] 🕐 Lima time: ${hour}:${limaTime.getMinutes()} → ${greeting}`);

  context += `🕐 HORA ACTUAL (Lima): ${limaTime.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} - ${timeOfDay.toUpperCase()}\n`;
  context += `👋 SALUDO CORRECTO: ${greeting}\n`;
  context += `⚠️ IMPORTANTE: USA ESTE SALUDO, NO INVENTES OTRO\n\n`;

  // Channel info
  context += `📱 CANAL: ${businessContext.channelName}\n`;
  context += `🎯 PRIORIDAD: ${businessContext.priority.join(', ') || 'general'}\n\n`;

  // Contact personalization
  // Normalize name: "CHRISTIAN" -> "Christian", "christian" -> "Christian"
  const rawFirstName = contactContext.name ? contactContext.name.split(' ')[0] : null;
  const firstName = rawFirstName
    ? rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1).toLowerCase()
    : null;

  // Always show contact info (but NOT greeting instructions for every message)
  if (contactContext.isExisting && firstName) {
    context += `\n👤 CLIENTE: ${firstName}`;
    if (contactContext.contactType) {
      context += ` (${contactContext.contactType})`;
    }
    context += `\n`;
    context += `USA su nombre "${firstName}" de forma natural en la conversación (no en cada mensaje).\n`;
  }

  // First message handling - ONLY here we give greeting instructions
  if (isFirstMessage) {
    context += '\n🆕 PRIMER MENSAJE - SALUDA:\n';

    if (hasImage) {
      context += `El cliente envió una IMAGEN. Analiza y pregunta brevemente qué necesita.\n`;
      if (firstName) {
        context += `Ejemplo: "${firstName}, ¿qué necesitas con esta imagen?"\n`;
      }
    } else {
      if (firstName) {
        context += `Saludo CORTO: "¡Hola ${firstName}! ${greeting.replace('¡', '')} ¿En qué te ayudo?"\n`;
        context += `NO digas "soy tu asistente", NO uses frases largas.\n`;
      } else {
        context += `Saludo: "${greeting} ¿En qué te puedo ayudar?"\n`;
      }
    }
  } else {
    // Not first message - NO greeting, just continue conversation naturally
    context += `\n💬 CONVERSACIÓN EN CURSO - NO saludes, continúa la conversación naturalmente.\n`;
  }

  // Channel-specific instructions
  context += '\n📌 INSTRUCCIONES SEGÚN CANAL:\n';

  switch (businessContext.channel) {
    case 'catalogo':
      context += `- Prioriza información de CATÁLOGO y PROMOTORAS\n`;
      context += `- Usa precios PROMOTORA (no público)\n`;
      context += `- Menciona beneficios: 25% ganancia, envío gratis\n`;
      context += `- Para pedidos/pagos: WhatsApp 961842916\n`;
      break;

    case 'ecommerce':
      context += `- Prioriza información de TIENDAS y ECOMMERCE\n`;
      context += `- Usa precios PÚBLICO (PVP)\n`;
      context += `- Informa sobre stock y disponibilidad\n`;
      context += `- Para consultas: (01) 619-3637\n`;
      break;

    case 'prospectos':
      context += `- El cliente quiere INFORMACIÓN para ser promotora\n`;
      context += `- Enfatiza BENEFICIOS: 25% ganancia, envío gratis, promociones\n`;
      context += `- Guía hacia inscripción: azaleiacatalogo.com.pe\n`;
      context += `- Ofrece derivar a equipo de captación\n`;
      break;

    default:
      context += `- Canal general, adapta según la consulta\n`;
  }

  // Instructions based on contact type from Bitrix
  if (contactContext.contactType) {
    context += `\n📋 TIPO DE CLIENTE (Bitrix): ${contactContext.contactType.toUpperCase()}\n`;

    // Determine priority based on contact type
    const tiposPriorizarCatalogo = ['promotor', 'lider', 'catalogos_tiendas', 'catalogos_ecommerce', 'catalogos_tiendas_ecommerce', 'ecommerce_catalogos'];
    const tiposPriorizarEcommerce = ['cliente_ecommerce', 'ecommerce_tiendas', 'cliente_vip'];
    const tiposPriorizarTiendas = ['cliente_tienda_concepto', 'cliente_outlet', 'cliente_mayorista'];

    if (tiposPriorizarCatalogo.includes(contactContext.contactType)) {
      context += `→ PRIORIZA: Información de CATÁLOGO, precios PROMOTORA, beneficios de venta por catálogo\n`;
    } else if (tiposPriorizarEcommerce.includes(contactContext.contactType)) {
      context += `→ PRIORIZA: Información de ECOMMERCE, precios PÚBLICO (PVP), stock online\n`;
    } else if (tiposPriorizarTiendas.includes(contactContext.contactType)) {
      context += `→ PRIORIZA: Información de TIENDAS físicas, ubicaciones, horarios\n`;
    } else if (contactContext.contactType === 'funcionario') {
      context += `→ Es empleado/funcionario de Azaleia, trato interno\n`;
    }
  }

  context += '\n═══════════════════════════\n';

  return context;
}

/**
 * Get conversation history from CRM database
 * Returns a summary of recent messages for context
 */
export async function getConversationHistory(
  conversationId: string,
  maxMessages: number = 20
): Promise<string> {
  if (!conversationId) return '';

  try {
    // Get messages from database
    const messages = await crmDb.getMessagesByConversationId(conversationId);

    if (!messages || messages.length === 0) return '';

    // Get last N messages
    const recentMessages = messages.slice(-maxMessages);

    // Format as conversation summary
    let summary = '\n\n═══ HISTORIAL DE CONVERSACIÓN ═══\n\n';
    summary += `📝 Últimos ${recentMessages.length} mensajes:\n\n`;

    for (const msg of recentMessages) {
      const direction = msg.direction === 'incoming' ? '👤 Cliente' : '🤖 Asistente';
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('es-PE', {
        hour: '2-digit',
        minute: '2-digit'
      }) : '';

      // Get message content
      let content = msg.text || '';

      // Handle media messages based on type field
      if (msg.type && msg.type !== 'text') {
        switch (msg.type) {
          case 'image':
            content = '[Imagen enviada]';
            break;
          case 'audio':
            content = '[Audio enviado]';
            break;
          case 'video':
            content = '[Video enviado]';
            break;
          case 'document':
            content = '[Documento enviado]';
            break;
          case 'sticker':
            content = '[Sticker enviado]';
            break;
          case 'system':
            content = '[Mensaje del sistema]';
            break;
          default:
            content = `[Archivo: ${msg.type}]`;
        }

        // Add caption if exists
        if (msg.text) {
          content += ` - "${msg.text}"`;
        }
      }

      // Truncate very long messages
      if (content.length > 200) {
        content = content.substring(0, 200) + '...';
      }

      summary += `${direction} (${time}): ${content}\n`;
    }

    summary += '\n═══════════════════════════════════\n';
    summary += '⚡ USA ESTE HISTORIAL para dar continuidad a la conversación.\n';
    summary += 'Si el cliente pregunta algo que ya mencionó antes, recuérdalo.\n';

    return summary;
  } catch (error) {
    console.error('[ContextBuilder] Error fetching conversation history:', error);
    return '';
  }
}

/**
 * Build full context including conversation history
 */
export async function buildFullContext(
  businessContext: BusinessContext,
  contactContext: ContactContext,
  conversationId: string,
  isFirstMessage: boolean,
  hasImage: boolean
): Promise<string> {
  // Build personalized context
  let fullContext = buildPersonalizedContext(
    businessContext,
    contactContext,
    isFirstMessage,
    hasImage
  );

  // Add conversation history (if not first message)
  if (!isFirstMessage && conversationId) {
    const history = await getConversationHistory(conversationId, 15);
    fullContext += history;
  }

  return fullContext;
}
