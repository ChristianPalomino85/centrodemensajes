/**
 * AI Agent Tool Definitions
 * Defines all available tools/functions for the IA Agent
 */

import type { OpenAITool } from '../clients/openai';

/**
 * Tool: Send Catalogs
 * Sends PDF catalogs to the customer
 */
export const SEND_CATALOGS_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'send_catalogs',
    description: 'Envía catálogos PDF al cliente. Usa esta herramienta cuando el cliente solicite catálogos, precios, o información sobre productos. IMPORTANTE: Siempre pregunta al cliente si quiere catálogos CON o SIN precios antes de llamar esta función.',
    parameters: {
      type: 'object',
      properties: {
        with_prices: {
          type: 'boolean',
          description: 'true si el cliente quiere catálogos CON precios, false si los quiere SIN precios'
        },
        brands: {
          type: 'array',
          description: 'Marcas de catálogos a enviar. Si el cliente no especifica, envía todas.',
          items: {
            type: 'string',
            enum: ['azaleia_abierto', 'azaleia_cerrado', 'olympikus', 'tus_pasos', 'all']
          }
        },
        customer_note: {
          type: 'string',
          description: 'Nota opcional sobre qué tipo de cliente es o qué necesita (para analytics)'
        }
      },
      required: ['with_prices', 'brands']
    }
  }
};

/**
 * Tool: Transfer to Queue
 * Transfers the customer to a human agent in a specific queue
 */
export const TRANSFER_TO_QUEUE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'transfer_to_queue',
    description: 'Transfiere a asesora humana. Llama esta herramienta DESPUÉS de check_business_hours e informar al cliente. USA cuando: 1) Cliente quiera pedido/reserva (sales), 2) Problemas/reclamos/garantías (support), 3) Quiera ser promotora (prospects). IMPORTANTE: Usa lenguaje peruano informal: "asesora/asesor" (NUNCA "especialista"), "ahora te paso", "deja te comunico". Varía tu mensaje cada vez (no repitas lo mismo). Sé breve y cálida.',
    parameters: {
      type: 'object',
      properties: {
        queue_type: {
          type: 'string',
          enum: ['sales', 'support', 'prospects'],
          description: 'Tipo de cola: "sales" para ventas/pedidos/cotizaciones (Counter), "support" para soporte/reclamos/garantías (ATC), "prospects" para personas interesadas en ser promotoras (Prospectos)'
        },
        reason: {
          type: 'string',
          description: 'Razón de la transferencia (qué necesita el cliente)'
        },
        customer_info: {
          type: 'object',
          description: 'Información del cliente recopilada durante la conversación',
          properties: {
            name: {
              type: 'string',
              description: 'Nombre del cliente'
            },
            location: {
              type: 'string',
              description: 'Ciudad o ubicación del cliente'
            },
            business_type: {
              type: 'string',
              description: 'Tipo de negocio (tienda física, catálogo, online, etc.)'
            },
            estimated_quantity: {
              type: 'string',
              description: 'Cantidad aproximada de pares que necesita'
            },
            interest: {
              type: 'string',
              description: 'En qué está interesado el cliente'
            }
          }
        }
      },
      required: ['queue_type', 'reason']
    }
  }
};

/**
 * Tool: Check Business Hours
 * Checks if we're currently within business hours for transfers
 */
export const CHECK_BUSINESS_HOURS_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'check_business_hours',
    description: 'Verifica horario (Lun-Sab 9am-6pm Lima). CRÍTICO: Esta herramienta SOLO verifica, NO transfiere. SIEMPRE debes llamar transfer_to_queue después. Usa lenguaje peruano: "asesora" (NUNCA "especialista"). Varía tu respuesta cada vez (no repitas la misma frase). Si isOpen=true: Ej. "ahora mismo te paso con una asesora", "deja te comunico con el equipo". Si isOpen=false: Ej. "estamos fuera de horario (Lun-Sab 9am-6pm), pero te dejo en cola y apenas se conecte una asesora te atiende".',
    parameters: {
      type: 'object',
      properties: {
        queue_type: {
          type: 'string',
          enum: ['sales', 'support', 'prospects'],
          description: 'Tipo de cola para verificar el horario específico'
        }
      },
      required: ['queue_type']
    }
  }
};

/**
 * Tool: Save Lead Information
 * Saves lead/customer information to Bitrix24 CRM
 */
export const SAVE_LEAD_INFO_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'save_lead_info',
    description: 'Guarda información del cliente/lead en el CRM (Bitrix24). Usa esta herramienta cuando hayas recopilado información valiosa del cliente que debe guardarse.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Número de teléfono del cliente'
        },
        name: {
          type: 'string',
          description: 'Nombre del cliente'
        },
        location: {
          type: 'string',
          description: 'Ciudad o ubicación'
        },
        business_type: {
          type: 'string',
          description: 'Tipo de negocio'
        },
        interest: {
          type: 'string',
          description: 'En qué está interesado'
        },
        notes: {
          type: 'string',
          description: 'Notas adicionales sobre la conversación'
        }
      },
      required: ['phone']
    }
  }
};

/**
 * Tool: End Conversation
 * Ends the conversation gracefully
 */
export const END_CONVERSATION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'end_conversation',
    description: 'Termina la conversación de forma apropiada. Usa esta herramienta cuando: 1) El cliente se despide (dice "adiós", "gracias", "ya está", etc.), 2) Ya respondiste todas las preguntas del cliente y no hay más nada que hacer, 3) El cliente indica que no necesita nada más. IMPORTANTE: Siempre despídete amablemente ANTES de llamar esta función.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Razón por la que termina la conversación (ej: "cliente se despidió", "consulta resuelta", "no necesita más ayuda")'
        },
        customer_satisfied: {
          type: 'boolean',
          description: 'true si el cliente parece satisfecho con la atención, false si no'
        }
      },
      required: ['reason']
    }
  }
};

/**
 * Tool: Search Knowledge Base
 * Searches the knowledge base for specific information
 */
export const SEARCH_KNOWLEDGE_BASE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: 'Busca información específica en los catálogos y documentos de Azaleia. USA ESTA HERRAMIENTA cuando el cliente pregunte por: precios de productos específicos, características de modelos, políticas detalladas, stock, promociones específicas, o cualquier información que necesite consultar los catálogos. IMPORTANTE: Siempre usa esta herramienta ANTES de decir "no sé" o transferir por falta de información.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La pregunta o búsqueda específica. Ejemplos: "precio de GINNY-545", "zapatillas Olympikus con grafeno", "política de cambios", "premio pasa y gana 500 soles"'
        },
        category: {
          type: 'string',
          enum: ['productos', 'precios', 'politicas', 'promociones', 'general'],
          description: 'Categoría de la búsqueda para mejorar los resultados'
        }
      },
      required: ['query']
    }
  }
};

/**
 * Tool: Extract Text from Image (OCR)
 * Extracts text from images/documents using Google Vision OCR
 */
export const EXTRACT_TEXT_OCR_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'extract_text_ocr',
    description: 'Extrae texto de imágenes de documentos usando OCR (reconocimiento óptico de caracteres). USA ESTA HERRAMIENTA cuando el cliente envíe: DNI, RUC, comprobantes, facturas, vouchers de pago, documentos escaneados, o cualquier imagen con texto que necesite ser leído. IMPORTANTE: Esta herramienta es SOLO para extraer texto de documentos, NO para analizar productos. Para productos usa la capacidad de Vision integrada.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL de la imagen del documento a procesar'
        },
        document_type: {
          type: 'string',
          enum: ['dni', 'ruc', 'voucher', 'factura', 'comprobante', 'documento_general'],
          description: 'Tipo de documento para optimizar el procesamiento'
        },
        purpose: {
          type: 'string',
          description: 'Para qué necesitas el texto extraído (ej: "verificar número de DNI", "obtener número de operación del voucher")'
        }
      },
      required: ['image_url', 'document_type']
    }
  }
};

/**
 * Tool: Extract Handwritten Order
 * Extracts order information from handwritten notes using GPT-4 Vision
 */
export const EXTRACT_HANDWRITTEN_ORDER_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'extract_handwritten_order',
    description: 'Extrae información de pedidos escritos a mano en papel. USA ESTA HERRAMIENTA cuando el cliente envíe una FOTO de una hoja de papel con un pedido escrito a mano. Puede reconocer: códigos de producto, modelos, tallas, cantidades y nombres. Esta herramienta usa visión por computadora especializada para manuscritos.',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'URL de la imagen de la hoja con el pedido escrito a mano'
        },
        additional_context: {
          type: 'string',
          description: 'Contexto adicional proporcionado por el cliente (ej: "es mi pedido de la semana")'
        }
      },
      required: ['image_url']
    }
  }
};

/**
 * Tool: Verificar Opt-In
 * Checks if customer has already accepted/rejected marketing communications
 */
export const VERIFICAR_OPT_IN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'verificar_opt_in',
    description: 'Verifica si el cliente actual ya tiene registrado su consentimiento de publicidad en Bitrix. USA ESTA HERRAMIENTA AL INICIO de cada conversación. NO necesitas pasar ningún parámetro - el sistema usa automáticamente el teléfono del cliente que está escribiendo. Si needsOptIn=true, se envían botones automáticamente.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
};

/**
 * Tool: Enviar Pregunta Opt-In
 * Sends opt-in questions with interactive buttons
 */
export const ENVIAR_PREGUNTA_OPT_IN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'enviar_pregunta_opt_in',
    description: '🚨 OBLIGATORIO: Envía pregunta de consentimiento con BOTONES INTERACTIVOS de WhatsApp. DEBES usar esta herramienta cuando verificar_opt_in retorne needsOptIn=true. NO escribas tú mismo la pregunta - USA ESTA HERRAMIENTA para que aparezcan los botones en WhatsApp. Orden: PRIMERO tipo="politica", DESPUÉS tipo="publicidad".',
    parameters: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['politica', 'publicidad'],
          description: 'PRIMERO usa "politica", DESPUÉS "publicidad". Nunca al revés.'
        }
      },
      required: ['tipo']
    }
  }
};

/**
 * Tool: Guardar Opt-In
 * Saves the opt-in response in Bitrix
 */
export const GUARDAR_OPT_IN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'guardar_opt_in',
    description: 'Guarda la respuesta de consentimiento de publicidad en Bitrix. Usa esta herramienta después de que el cliente responda a la pregunta de publicidad (Sí o No). El valor se guarda en el campo correspondiente según si es Contact o Lead.',
    parameters: {
      type: 'object',
      properties: {
        aceptaPublicidad: {
          type: 'boolean',
          description: 'true si el cliente acepta recibir publicidad, false si no acepta'
        },
        entityType: {
          type: 'string',
          enum: ['contact', 'lead'],
          description: 'Tipo de entidad en Bitrix (contact o lead). Si no se proporciona, se busca automáticamente.'
        },
        entityId: {
          type: 'string',
          description: 'ID de la entidad en Bitrix. Si no se proporciona, se busca automáticamente por teléfono.'
        }
      },
      required: ['aceptaPublicidad']
    }
  }
};

/**
 * Tool: Validar Promotora SQL
 * Validates if a customer is a registered promotora in SQL Server database
 */
export const VALIDAR_PROMOTORA_SQL_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'validar_promotora_sql',
    description: 'Valida si el cliente es una PROMOTORA REGISTRADA en el sistema (base de datos SQL Server). USA ESTA HERRAMIENTA cuando el cliente quiera hacer un PEDIDO o RESERVA de catálogo. FLUJO: 1) Primero valida por teléfono (automático), 2) Si no encuentra, pregunta DNI/RUC y valida con ese documento, 3) Si aún no encuentra, transferir a asesora para actualizar datos. IMPORTANTE: Una vez validado como promotora, el flag se guarda en la sesión para no repetir validaciones.',
    parameters: {
      type: 'object',
      properties: {
        documento: {
          type: 'string',
          description: 'DNI (8 dígitos) o RUC (11 dígitos) del cliente. Solo usar si la validación por teléfono falló y el cliente proporcionó su documento.'
        }
      },
      required: []
    }
  }
};

/**
 * All available tools for the agent
 */
export const ALL_AGENT_TOOLS: OpenAITool[] = [
  VERIFICAR_OPT_IN_TOOL,
  ENVIAR_PREGUNTA_OPT_IN_TOOL,
  GUARDAR_OPT_IN_TOOL,
  SEARCH_KNOWLEDGE_BASE_TOOL,
  SEND_CATALOGS_TOOL,
  TRANSFER_TO_QUEUE_TOOL,
  CHECK_BUSINESS_HOURS_TOOL,
  SAVE_LEAD_INFO_TOOL,
  VALIDAR_PROMOTORA_SQL_TOOL,
  EXTRACT_TEXT_OCR_TOOL,
  EXTRACT_HANDWRITTEN_ORDER_TOOL,
  END_CONVERSATION_TOOL,
];
