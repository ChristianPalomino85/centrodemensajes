import express from 'express';
import { requireSupervisor } from '../middleware/roles';

const router = express.Router();

interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  example?: {
    header_handle?: string[];
    body_text?: string[][];
  };
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'PHONE_NUMBER' | 'URL';
    text: string;
    phone_number?: string;
    url?: string;
    example?: string[];
  }>;
}

interface CreateTemplateRequest {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: TemplateComponent[];
}

/**
 * POST /api/template-creator/create
 * Crea una nueva plantilla y la envía a Meta para aprobación
 * Requiere rol: admin o supervisor
 */
router.post('/create', requireSupervisor, async (req, res) => {
  try {
    const { name, language, category, components, wabaId } = req.body as CreateTemplateRequest & { wabaId: string };

    // Validaciones básicas
    if (!name || !language || !category || !components) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: name, language, category, components'
      });
    }

    if (!wabaId) {
      return res.status(400).json({
        error: 'Falta wabaId (WhatsApp Business Account ID)'
      });
    }

    // Validar nombre de plantilla (solo minúsculas, números y guiones bajos)
    if (!/^[a-z0-9_]+$/.test(name)) {
      return res.status(400).json({
        error: 'El nombre de la plantilla solo puede contener minúsculas, números y guiones bajos'
      });
    }

    // Obtener configuración de WhatsApp desde PostgreSQL
    const { Pool } = await import('pg');
    const pool = new Pool({
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      host: process.env.POSTGRES_HOST || 'localhost',
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
    });

    const result = await pool.query(
      'SELECT id, alias, phone_number_id, access_token FROM whatsapp_connections WHERE is_active = true LIMIT 1'
    );

    await pool.end();

    if (result.rows.length === 0) {
      return res.status(500).json({
        error: 'No hay números de WhatsApp configurados'
      });
    }

    // Usar el primer número configurado para obtener el access token y phoneNumberId
    const firstConnection = result.rows[0];
    const accessToken = firstConnection.access_token;
    const phoneNumberId = firstConnection.phone_number_id;

    if (!accessToken) {
      return res.status(500).json({
        error: 'No se encontró access token de WhatsApp'
      });
    }

    if (!phoneNumberId) {
      return res.status(500).json({
        error: 'No se encontró phoneNumberId de WhatsApp'
      });
    }

    // Construir el payload para la API de Meta
    const payload = {
      name,
      language,
      category,
      components: components.map(comp => {
        const component: any = {
          type: comp.type
        };

        if (comp.type === 'HEADER' && comp.format) {
          component.format = comp.format;

          // Solo incluir text si el formato es TEXT
          if (comp.format === 'TEXT' && comp.text) {
            component.text = comp.text;
          }

          // Para formatos IMAGE, VIDEO, DOCUMENT: incluir example
          if (comp.format !== 'TEXT' && comp.example) {
            component.example = comp.example;
          }
        }

        if (comp.type === 'BODY') {
          component.text = comp.text;
          if (comp.example) {
            component.example = comp.example;
          }
        }

        if (comp.type === 'FOOTER' && comp.text) {
          component.text = comp.text;
        }

        if (comp.type === 'BUTTONS' && comp.buttons) {
          component.buttons = comp.buttons;
        }

        return component;
      })
    };

    console.log('[TemplateCreator] Creating template:', {
      name,
      language,
      category,
      wabaId,
      componentsCount: components.length
    });

    // Si hay un header IMAGE con URL, subirla usando Resumable Upload API
    const headerComp = components.find(c => c.type === 'HEADER' && c.format === 'IMAGE');
    if (headerComp && headerComp.example?.header_handle?.[0]?.startsWith('http')) {
      const imageUrl = headerComp.example.header_handle[0];
      console.log('[TemplateCreator] Uploading image to Meta:', imageUrl);

      try {
        // Extraer App ID del access token
        const debugResponse = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
        const debugData = await debugResponse.json();
        const appId = debugData?.data?.app_id;

        if (!appId) {
          throw new Error('No se pudo obtener el App ID del token');
        }

        console.log('[TemplateCreator] Using App ID:', appId);

        // Descargar la imagen
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error('No se pudo descargar la imagen');
        }

        const imageBuffer = await imageResponse.arrayBuffer();
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const fileSize = imageBuffer.byteLength;

        console.log('[TemplateCreator] Image info:', { contentType, fileSize });

        // PASO 1: Crear sesión de upload con App ID
        const sessionUrl = `https://graph.facebook.com/v21.0/${appId}/uploads`;
        const sessionPayload = {
          file_length: fileSize,
          file_type: contentType,
          file_name: 'template-image.jpg'
        };

        const sessionResponse = await fetch(sessionUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(sessionPayload)
        });

        const sessionData = await sessionResponse.json();

        if (!sessionResponse.ok || !sessionData.id) {
          console.error('[TemplateCreator] Error creating upload session:', sessionData);
          throw new Error('Error al crear sesión de upload en Meta');
        }

        console.log('[TemplateCreator] Upload session created:', sessionData.id);

        // PASO 2: Subir el archivo
        const uploadUrl = `https://graph.facebook.com/v21.0/${sessionData.id}`;
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `OAuth ${accessToken}`,
            'file_offset': '0',
            'Content-Type': 'application/octet-stream'
          },
          body: imageBuffer
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok || !uploadData.h) {
          console.error('[TemplateCreator] Error uploading to Meta:', uploadData);
          throw new Error('Error al subir imagen a Meta');
        }

        console.log('[TemplateCreator] Image uploaded with handle:', uploadData.h);

        // Actualizar el componente con el handle
        const compIndex = payload.components.findIndex((c: any) => c.type === 'HEADER');
        if (compIndex >= 0) {
          payload.components[compIndex].example = {
            header_handle: [uploadData.h]
          };
        }
      } catch (uploadError) {
        console.error('[TemplateCreator] Error uploading image:', uploadError);
        return res.status(500).json({
          error: 'Error al subir imagen a Meta',
          details: uploadError instanceof Error ? uploadError.message : 'Unknown error'
        });
      }
    }

    console.log('[TemplateCreator] Full payload:', JSON.stringify(payload, null, 2));

    // Enviar a Meta Graph API
    const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
    const response = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('[TemplateCreator] Meta API error:', responseData);
      return res.status(response.status).json({
        error: 'Error al crear plantilla en Meta',
        details: responseData.error || responseData
      });
    }

    console.log('[TemplateCreator] Template created successfully:', {
      id: responseData.id,
      status: responseData.status,
      name
    });

    res.json({
      success: true,
      template: {
        id: responseData.id,
        name,
        status: responseData.status || 'PENDING',
        message: 'Plantilla enviada a Meta para aprobación. El proceso puede tomar entre 1 minuto y 48 horas.'
      }
    });

  } catch (error: any) {
    console.error('[TemplateCreator] Error creating template:', error);
    res.status(500).json({
      error: 'Error interno al crear plantilla',
      details: error.message
    });
  }
});

/**
 * GET /api/template-creator/status/:templateId
 * Obtiene el estado de una plantilla
 * Requiere rol: admin o supervisor
 */
router.get('/status/:templateId', requireSupervisor, async (req, res) => {
  try {
    const { templateId } = req.params;

    // Obtener access token desde PostgreSQL
    const { Pool } = await import('pg');
    const pool = new Pool({
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      host: process.env.POSTGRES_HOST || 'localhost',
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
    });

    const result = await pool.query(
      'SELECT access_token FROM whatsapp_connections WHERE is_active = true LIMIT 1'
    );

    await pool.end();

    if (result.rows.length === 0) {
      return res.status(500).json({ error: 'No hay números de WhatsApp configurados' });
    }

    const accessToken = result.rows[0].access_token;
    if (!accessToken) {
      return res.status(500).json({ error: 'No se encontró access token' });
    }

    // Consultar estado en Meta
    const metaUrl = `https://graph.facebook.com/v21.0/${templateId}`;
    const response = await fetch(metaUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Error al obtener estado de plantilla',
        details: data.error || data
      });
    }

    res.json({
      id: data.id,
      name: data.name,
      status: data.status,
      category: data.category,
      language: data.language
    });

  } catch (error: any) {
    console.error('[TemplateCreator] Error getting template status:', error);
    res.status(500).json({
      error: 'Error al obtener estado',
      details: error.message
    });
  }
});

/**
 * GET /api/template-creator/waba-ids
 * Obtiene los WhatsApp Business Account IDs disponibles
 * Requiere rol: admin o supervisor
 */
router.get('/waba-ids', requireSupervisor, async (req, res) => {
  try {
    // Leer configuración desde PostgreSQL
    const { Pool } = await import('pg');
    const pool = new Pool({
      user: process.env.POSTGRES_USER || 'whatsapp_user',
      host: process.env.POSTGRES_HOST || 'localhost',
      database: process.env.POSTGRES_DB || 'flowbuilder_crm',
      password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
    });

    const result = await pool.query(
      'SELECT DISTINCT waba_id FROM whatsapp_connections WHERE is_active = true AND waba_id IS NOT NULL'
    );

    await pool.end();

    // Extraer WABAs únicos
    const wabaIds = result.rows.map(row => row.waba_id);

    if (wabaIds.length === 0) {
      return res.json({
        wabaIds: [],
        message: 'No se encontraron WABAs. Configura un número de WhatsApp primero.'
      });
    }

    res.json({
      wabaIds,
      default: wabaIds[0]
    });

  } catch (error: any) {
    console.error('[TemplateCreator] Error getting WABA IDs:', error);
    res.status(500).json({
      error: 'Error al obtener WABA IDs',
      details: error.message
    });
  }
});

export default router;
