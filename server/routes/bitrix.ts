import { Router } from "express";
import { getSecretsPath, readJsonFile, writeJsonFile } from "../utils/storage";
import { httpRequest } from "../utils/http";
import { BITRIX_CONTACT_FIELDS, BITRIX_LEAD_FIELDS } from "../crm/bitrix-fields.config";
import { encryptObject, decryptObject } from "../utils/encryption";

interface BitrixTokens {
  access_token?: string;
  refresh_token?: string;
  domain?: string;
  member_id?: string;
  scope?: string | string[];
  expires?: number;
}

const TOKENS_PATH = getSecretsPath("bitrix-tokens.json");
const SENSITIVE_FIELDS: (keyof BitrixTokens)[] = ['access_token', 'refresh_token'];

// CONFIGURACIÓN OAUTH - REEMPLAZAR CON TUS CREDENCIALES DE BITRIX24
const BITRIX_CLIENT_ID = process.env.BITRIX_CLIENT_ID;
const BITRIX_CLIENT_SECRET = process.env.BITRIX_CLIENT_SECRET;
const BITRIX_REDIRECT_URI = process.env.BITRIX_REDIRECT_URI || "https://wsp.azaleia.com.pe/api/bitrix/oauth/callback";

if (!BITRIX_CLIENT_ID || !BITRIX_CLIENT_SECRET) {
  console.warn('[Bitrix] BITRIX_CLIENT_ID or BITRIX_CLIENT_SECRET not set in environment');
}

export function readTokens(): BitrixTokens | null {
  const encrypted = readJsonFile<BitrixTokens>(TOKENS_PATH);
  if (!encrypted) return null;
  return decryptObject(encrypted, SENSITIVE_FIELDS);
}

function saveTokens(tokens: BitrixTokens): void {
  const encrypted = encryptObject(tokens, SENSITIVE_FIELDS);
  writeJsonFile(TOKENS_PATH, encrypted);
}

/**
 * Refresh Bitrix24 access token using refresh_token
 * @throws Error if refresh fails or credentials are missing
 */
export async function refreshBitrixTokens(): Promise<void> {
  const tokens = readTokens();

  if (!tokens?.refresh_token) {
    throw new Error("No refresh_token available. Please re-authorize the Bitrix24 app.");
  }

  if (!BITRIX_CLIENT_ID || !BITRIX_CLIENT_SECRET) {
    throw new Error("Missing BITRIX_CLIENT_ID or BITRIX_CLIENT_SECRET in environment");
  }

  const tokenUrl = `https://oauth.bitrix.info/oauth/token/?` +
    `grant_type=refresh_token&` +
    `client_id=${encodeURIComponent(BITRIX_CLIENT_ID)}&` +
    `client_secret=${encodeURIComponent(BITRIX_CLIENT_SECRET)}&` +
    `refresh_token=${encodeURIComponent(tokens.refresh_token)}`;

  const response = await httpRequest<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(tokenUrl, {
    method: "GET",
    timeoutMs: 15000,
  });

  if (!response.ok || !response.body?.access_token) {
    throw new Error(`Token refresh failed: ${response.status} - ${JSON.stringify(response.body)}`);
  }

  // Merge with existing tokens
  const updatedTokens: BitrixTokens = {
    ...tokens,
    access_token: response.body.access_token,
    refresh_token: response.body.refresh_token || tokens.refresh_token,
    expires: response.body.expires_in ? Date.now() + response.body.expires_in * 1000 : undefined,
    scope: response.body.scope || tokens.scope,
  };

  saveTokens(updatedTokens);
  console.log(`[Bitrix] Tokens refreshed successfully. Expires in: ${response.body.expires_in}s`);
}

export function createBitrixRouter() {
  const router = Router();

  /**
   * GET /api/bitrix/oauth/url
   * Genera la URL de autorización OAuth de Bitrix24
   */
  router.get("/oauth/url", (_req, res) => {
    try {
      const tokens = readTokens();
      const domain = tokens?.domain || "azaleia-peru.bitrix24.es";

      const authUrl = `https://${domain}/oauth/authorize/?` +
        `client_id=${BITRIX_CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(BITRIX_REDIRECT_URI)}&` +
        `scope=crm,user,im,imopenlines,placement,bizproc,task,lists,disk`;

      res.json({ url: authUrl });
    } catch (error) {
      console.error("[Bitrix] Error generating OAuth URL:", error);
      res.status(500).json({ error: "failed_to_generate_url" });
    }
  });

  /**
   * GET /api/bitrix/oauth/callback?code=XXX&domain=YYY
   * Callback de OAuth de Bitrix24
   */
  router.get("/oauth/callback", async (req, res) => {
    try {
      const { code, domain } = req.query;

      if (!code || !domain) {
        res.status(400).json({ error: "missing_code_or_domain" });
        return;
      }

      // Intercambiar código por tokens
      // IMPORTANTE: Bitrix24 Cloud usa oauth.bitrix.info para token exchange
      const tokenUrl = `https://oauth.bitrix.info/oauth/token/?` +
        `grant_type=authorization_code&` +
        `client_id=${BITRIX_CLIENT_ID}&` +
        `client_secret=${BITRIX_CLIENT_SECRET}&` +
        `code=${code}&` +
        `redirect_uri=${encodeURIComponent(BITRIX_REDIRECT_URI)}`;

      const response = await httpRequest<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        member_id?: string;
      }>(tokenUrl, {
        method: "GET",
        timeoutMs: 15000,
      });

      if (!response.ok || !response.body?.access_token) {
        console.error("[Bitrix] OAuth token exchange failed:", response.status, response.body);
        res.status(400).json({ error: "token_exchange_failed" });
        return;
      }

      // Guardar tokens
      const tokens: BitrixTokens = {
        access_token: response.body.access_token,
        refresh_token: response.body.refresh_token,
        domain: String(domain),
        member_id: response.body.member_id,
        scope: response.body.scope,
        expires: response.body.expires_in ? Date.now() + response.body.expires_in * 1000 : undefined,
      };

      saveTokens(tokens);

      // Redirigir al frontend con éxito
      res.redirect("/?bitrix_auth=success");
    } catch (error) {
      console.error("[Bitrix] OAuth callback error:", error);
      res.redirect("/?bitrix_auth=error");
    }
  });

  /**
   * GET /api/bitrix/fields
   * Lista campos disponibles de Bitrix24 (Contact y Lead)
   */
  router.get("/fields", (_req, res) => {
    try {
      res.json({
        contact: {
          standard: {
            NAME: "Nombre",
            LAST_NAME: "Apellidos",
            PHONE: "Teléfono",
            EMAIL: "Email",
          },
          custom: {
            [BITRIX_CONTACT_FIELDS.DOCUMENTO]: "N° Documento",
            [BITRIX_CONTACT_FIELDS.DIRECCION]: "Dirección",
            [BITRIX_CONTACT_FIELDS.TIPO_CONTACTO]: "Tipo de Contacto",
            [BITRIX_CONTACT_FIELDS.DEPARTAMENTO]: "Departamento",
            [BITRIX_CONTACT_FIELDS.PROVINCIA]: "Provincia",
            [BITRIX_CONTACT_FIELDS.DISTRITO]: "Distrito",
            [BITRIX_CONTACT_FIELDS.LIDER]: "Líder",
            [BITRIX_CONTACT_FIELDS.STENCIL]: "Stencil",
          },
        },
        lead: {
          standard: {
            TITLE: "Título",
            NAME: "Nombre",
            LAST_NAME: "Apellidos",
            PHONE: "Teléfono",
          },
          custom: {
            [BITRIX_LEAD_FIELDS.DEPARTAMENTOS]: "Departamentos",
          },
        },
      });
    } catch (error) {
      console.error("[Bitrix] Error getting fields:", error);
      res.status(500).json({ error: "failed_to_get_fields" });
    }
  });

  /**
   * GET /api/bitrix/field-options/:fieldName
   * Obtiene las opciones de un campo de lista de Bitrix24
   */
  router.get("/field-options/:fieldName", async (req, res) => {
    try {
      const tokens = readTokens();
      if (!tokens?.access_token || !tokens.domain) {
        res.status(401).json({ error: "not_authorized" });
        return;
      }

      const { fieldName } = req.params;
      const entityType = req.query.entity === "lead" ? "lead" : "contact";

      const baseUrl = tokens.domain.startsWith("http") ? tokens.domain : `https://${tokens.domain}`;
      const endpoint = entityType === "lead"
        ? `${baseUrl.replace(/\/$/, "")}/rest/crm.lead.userfield.list.json`
        : `${baseUrl.replace(/\/$/, "")}/rest/crm.contact.userfield.list.json`;

      const response = await httpRequest<{ result?: any[] }>(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        timeoutMs: 15000,
      });

      if (!response.ok || !response.body?.result) {
        res.status(500).json({ error: "bitrix_request_failed" });
        return;
      }

      const field = response.body.result.find((f: any) => f.FIELD_NAME === fieldName);
      if (!field) {
        res.status(404).json({ error: "field_not_found", availableFields: response.body.result.map((f: any) => f.FIELD_NAME) });
        return;
      }

      // Return field info with list options
      res.json({
        fieldName: field.FIELD_NAME,
        label: field.EDIT_FORM_LABEL || field.LIST_COLUMN_LABEL || field.FIELD_NAME,
        type: field.USER_TYPE_ID,
        options: field.LIST?.map((item: any) => ({
          id: item.ID,
          value: item.VALUE,
          sort: item.SORT,
        })) || [],
      });
    } catch (error) {
      console.error("[Bitrix] Error getting field options:", error);
      res.status(500).json({ error: "failed_to_get_field_options" });
    }
  });

  /**
   * GET /api/bitrix/contacts
   * Lista contactos de Bitrix24 con paginación y búsqueda
   * Query params:
   *   - page: Número de página (default: 1)
   *   - limit: Contactos por página (default: 50)
   *   - search: Término de búsqueda (nombre, teléfono)
   *   - department: Filtro por departamento (campo UF_CRM_68121FB2B841A)
   *   - contactType: Filtro por tipo de contacto (campo UF_CRM_67D702957E80A)
   *   - company: Filtro por empresa (COMPANY_TITLE)
   */
  router.get("/contacts", async (req, res) => {
    try {
      const tokens = readTokens();
      if (!tokens?.access_token || !tokens.domain) {
        res.status(401).json({ error: "not_authorized", message: "Bitrix24 not configured" });
        return;
      }

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const search = String(req.query.search || "").trim();
      const department = String(req.query.department || "").trim();
      const contactType = String(req.query.contactType || "").trim();
      const company = String(req.query.company || "").trim();
      const stencil = String(req.query.stencil || "").trim();
      const autorizaPublicidad = String(req.query.autorizaPublicidad || "").trim();

      const baseUrl = tokens.domain.startsWith("http") ? tokens.domain : `https://${tokens.domain}`;
      const start = (page - 1) * limit;

      // Call Bitrix24 API to list contacts
      const endpoint = `${baseUrl.replace(/\/$/, "")}/rest/crm.contact.list.json`;

      // Build base params with explicit field selection
      const params = new URLSearchParams({
        start: String(start),
        limit: String(limit),
      });

      // CRITICAL: Request specific fields from Bitrix
      // Bitrix API only returns basic fields by default, we need to specify all fields we want
      const selectFields = [
        'ID',
        'NAME',
        'LAST_NAME',
        'PHONE',
        'EMAIL',
        'COMPANY_TITLE',
        'UF_CRM_68121FB2B841A', // Departamento
        'UF_CRM_1565801603901', // Stencil
        'UF_CRM_67D702957E80A', // Tipo de contacto
        'UF_CRM_5DEAADAE301BB',  // N° Documento
        'UF_CRM_1745466972',     // Dirección
        'UF_CRM_1745461823632',  // Provincia
        'UF_CRM_1745461836705',  // Distrito
        'UF_CRM_1715014786',     // Líder
        'UF_CRM_1753421555',     // Autoriza Publicidad (¿Te gustaría recibir novedades?)
        'DATE_CREATE',
        'DATE_MODIFY',
      ];

      // Add select fields to params
      selectFields.forEach(field => {
        params.append('select[]', field);
      });

      // Build filter query string
      const filterParams: string[] = [];

      // Exact match filters (for dropdowns)
      if (department) {
        filterParams.push(`filter[UF_CRM_68121FB2B841A]=${encodeURIComponent(department)}`);
      }
      if (contactType) {
        filterParams.push(`filter[UF_CRM_67D702957E80A]=${encodeURIComponent(contactType)}`);
      }
      if (company) {
        filterParams.push(`filter[%COMPANY_TITLE]=${encodeURIComponent(company)}`);
      }
      if (stencil) {
        filterParams.push(`filter[UF_CRM_1565801603901]=${encodeURIComponent(stencil)}`);
      }
      if (autorizaPublicidad) {
        filterParams.push(`filter[UF_CRM_1753421555]=${encodeURIComponent(autorizaPublicidad)}`);
      }

      // Combine filter params
      const filterQuery = filterParams.length > 0 ? '&' + filterParams.join('&') : '';

      // If there's a search, use filter
      if (search) {
        // For search, we need to make multiple requests with different filters
        // and merge results (Bitrix doesn't support OR in filters)
        // CRITICAL: We need to include select[] params in search URLs too
        const searchByNameUrl = `${endpoint}?${params}&filter[%NAME]=${encodeURIComponent(search)}${filterQuery}`;
        const searchByPhoneUrl = `${endpoint}?${params}&filter[PHONE]=${encodeURIComponent(search)}${filterQuery}`;
        const searchByDocUrl = `${endpoint}?${params}&filter[UF_CRM_5DEAADAE301BB]=${encodeURIComponent(search)}${filterQuery}`;

        console.log('[Bitrix] Search URLs:', { searchByNameUrl, searchByPhoneUrl, searchByDocUrl });

        const [nameResults, phoneResults, docResults] = await Promise.all([
          httpRequest<{ result?: any[]; total?: number }>(
            searchByNameUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
          httpRequest<{ result?: any[]; total?: number }>(
            searchByPhoneUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
          httpRequest<{ result?: any[]; total?: number }>(
            searchByDocUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
        ]);

        console.log('[Bitrix] Search results:', {
          nameCount: nameResults.body?.result?.length || 0,
          phoneCount: phoneResults.body?.result?.length || 0,
          docCount: docResults.body?.result?.length || 0,
        });

        // Merge and deduplicate results
        const allResults = [
          ...(nameResults.body?.result || []),
          ...(phoneResults.body?.result || []),
          ...(docResults.body?.result || []),
        ];
        const uniqueContacts = Array.from(
          new Map(allResults.map(contact => [contact.ID, contact])).values()
        ).slice(0, limit);

        console.log('[Bitrix] Unique contacts after merge:', uniqueContacts.length);

        // Log first contact to verify PHONE field
        if (uniqueContacts.length > 0) {
          console.log('[Bitrix] Sample contact:', {
            ID: uniqueContacts[0].ID,
            NAME: uniqueContacts[0].NAME,
            PHONE: uniqueContacts[0].PHONE,
          });
        }

        res.json({
          contacts: uniqueContacts,
          total: uniqueContacts.length,
          page,
          limit,
          hasMore: false, // For search, we don't paginate
        });
        return;
      }

      // No search - regular list with pagination (with filters)
      const response = await httpRequest<{ result?: any[]; total?: number }>(
        `${endpoint}?${params}${filterQuery}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        // Try to refresh token if unauthorized
        if (response.status === 401) {
          try {
            await refreshBitrixTokens();
            // Retry the request with new token
            const newTokens = readTokens();
            const retryResponse = await httpRequest<{ result?: any[]; total?: number }>(
              `${endpoint}?${params}${filterQuery}`,
              {
                method: "GET",
                headers: { Authorization: `Bearer ${newTokens?.access_token}` },
                timeoutMs: 15000,
              }
            );

            if (retryResponse.ok) {
              const contacts = retryResponse.body?.result || [];
              const total = retryResponse.body?.total || contacts.length;

              res.json({
                contacts,
                total,
                page,
                limit,
                hasMore: start + contacts.length < total,
              });
              return;
            }
          } catch (refreshError) {
            console.error("[Bitrix] Token refresh failed:", refreshError);
          }
        }

        res.status(response.status).json({
          error: "bitrix_error",
          message: "Failed to fetch contacts from Bitrix24",
          details: response.body,
        });
        return;
      }

      const contacts = response.body?.result || [];
      const total = response.body?.total || contacts.length;

      res.json({
        contacts,
        total,
        page,
        limit,
        hasMore: start + contacts.length < total,
      });
    } catch (error) {
      console.error("[Bitrix] Error listing contacts:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/bitrix/leads
   * Lista prospectos (leads) de Bitrix24 con paginación y búsqueda
   * Query params:
   *   - page: Número de página (default: 1)
   *   - limit: Leads por página (default: 50)
   *   - search: Término de búsqueda (título, nombre, teléfono)
   *   - department: Filtro por departamento (campo UF_CRM_1662413427)
   *   - status: Filtro por estado (STATUS_ID)
   */
  router.get("/leads", async (req, res) => {
    try {
      const tokens = readTokens();
      if (!tokens?.access_token || !tokens.domain) {
        res.status(401).json({ error: "not_authorized", message: "Bitrix24 not configured" });
        return;
      }

      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const search = String(req.query.search || "").trim();
      const department = String(req.query.department || "").trim();
      const status = String(req.query.status || "").trim();

      const baseUrl = tokens.domain.startsWith("http") ? tokens.domain : `https://${tokens.domain}`;
      const start = (page - 1) * limit;

      // Call Bitrix24 API to list leads
      const endpoint = `${baseUrl.replace(/\/$/, "")}/rest/crm.lead.list.json`;

      // Build base params with explicit field selection
      const params = new URLSearchParams({
        start: String(start),
        limit: String(limit),
      });

      // Request specific fields from Bitrix
      const selectFields = [
        'ID',
        'TITLE',
        'NAME',
        'LAST_NAME',
        'PHONE',
        'EMAIL',
        'STATUS_ID',
        'SOURCE_ID',
        'UF_CRM_1662413427', // Departamentos
        'UF_CRM_1749101575', // Autoriza Publicidad
        'ASSIGNED_BY_ID',
        'DATE_CREATE',
        'DATE_MODIFY',
      ];

      // Add select fields to params
      selectFields.forEach(field => {
        params.append('select[]', field);
      });

      // Build filter query string
      const filterParams: string[] = [];

      // Exact match filters
      if (department) {
        filterParams.push(`filter[UF_CRM_1662413427]=${encodeURIComponent(department)}`);
      }
      if (status) {
        filterParams.push(`filter[STATUS_ID]=${encodeURIComponent(status)}`);
      }

      // Combine filter params
      const filterQuery = filterParams.length > 0 ? '&' + filterParams.join('&') : '';

      // If there's a search, use filter
      if (search) {
        // Search in multiple fields
        const searchByTitleUrl = `${endpoint}?${params}&filter[%TITLE]=${encodeURIComponent(search)}${filterQuery}`;
        const searchByNameUrl = `${endpoint}?${params}&filter[%NAME]=${encodeURIComponent(search)}${filterQuery}`;
        const searchByPhoneUrl = `${endpoint}?${params}&filter[PHONE]=${encodeURIComponent(search)}${filterQuery}`;

        const [titleResults, nameResults, phoneResults] = await Promise.all([
          httpRequest<{ result?: any[]; total?: number }>(
            searchByTitleUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
          httpRequest<{ result?: any[]; total?: number }>(
            searchByNameUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
          httpRequest<{ result?: any[]; total?: number }>(
            searchByPhoneUrl,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              timeoutMs: 15000,
            }
          ),
        ]);

        // Merge and deduplicate results
        const allResults = [
          ...(titleResults.body?.result || []),
          ...(nameResults.body?.result || []),
          ...(phoneResults.body?.result || []),
        ];
        const uniqueLeads = Array.from(
          new Map(allResults.map(lead => [lead.ID, lead])).values()
        ).slice(0, limit);

        res.json({
          leads: uniqueLeads,
          total: uniqueLeads.length,
          page,
          limit,
          hasMore: false,
        });
        return;
      }

      // No search - regular list
      const response = await httpRequest<{ result?: any[]; total?: number }>(
        `${endpoint}?${params}${filterQuery}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        // Try to refresh token if unauthorized
        if (response.status === 401) {
          try {
            await refreshBitrixTokens();
            // Retry the request with new token
            const newTokens = readTokens();
            const retryResponse = await httpRequest<{ result?: any[]; total?: number }>(
              `${endpoint}?${params}${filterQuery}`,
              {
                method: "GET",
                headers: { Authorization: `Bearer ${newTokens?.access_token}` },
                timeoutMs: 15000,
              }
            );

            if (retryResponse.ok) {
              const leads = retryResponse.body?.result || [];
              const total = retryResponse.body?.total || leads.length;

              res.json({
                leads,
                total,
                page,
                limit,
                hasMore: start + leads.length < total,
              });
              return;
            }
          } catch (refreshError) {
            console.error("[Bitrix] Token refresh failed:", refreshError);
          }
        }

        res.status(response.status).json({
          error: "bitrix_error",
          message: "Failed to fetch leads from Bitrix24",
          details: response.body,
        });
        return;
      }

      const leads = response.body?.result || [];
      const total = response.body?.total || leads.length;

      res.json({
        leads,
        total,
        page,
        limit,
        hasMore: start + leads.length < total,
      });
    } catch (error) {
      console.error("[Bitrix] Error listing leads:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/bitrix/contacts/:contactId/send-template
   * Enviar plantilla de WhatsApp a un contacto de Bitrix
   * Body:
   *   - templateName: Nombre de la plantilla
   *   - language: Idioma (default: "es")
   *   - components: Componentes de la plantilla (opcional)
   *   - channelConnectionId: ID de conexión de WhatsApp (opcional)
   */
  router.post("/contacts/:contactId/send-template", async (req, res) => {
    try {
      const { contactId } = req.params;
      const { templateName, language = "es", components, channelConnectionId } = req.body;

      if (!templateName) {
        res.status(400).json({ error: "missing_template_name", message: "templateName is required" });
        return;
      }

      // Get contact from Bitrix to extract phone number
      const tokens = readTokens();
      if (!tokens?.access_token || !tokens.domain) {
        res.status(401).json({ error: "not_authorized", message: "Bitrix24 not configured" });
        return;
      }

      const baseUrl = tokens.domain.startsWith("http") ? tokens.domain : `https://${tokens.domain}`;
      const contactEndpoint = `${baseUrl.replace(/\/$/, "")}/rest/crm.contact.get.json?id=${contactId}`;

      const contactResponse = await httpRequest<{ result?: any }>(contactEndpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        timeoutMs: 10000,
      });

      if (!contactResponse.ok || !contactResponse.body?.result) {
        res.status(404).json({ error: "contact_not_found", message: "Contact not found in Bitrix24" });
        return;
      }

      const contact = contactResponse.body.result;
      const phone = contact.PHONE?.[0]?.VALUE;

      if (!phone) {
        res.status(400).json({ error: "no_phone", message: "Contact has no phone number" });
        return;
      }

      // Forward to templates endpoint (reuse existing logic)
      // Note: This assumes the templates endpoint is available in the same Express app
      res.json({
        success: true,
        message: "Use /api/crm/templates/send endpoint",
        phone,
        templateName,
        language,
        components,
        channelConnectionId,
      });
    } catch (error) {
      console.error("[Bitrix] Error sending template to contact:", error);
      res.status(500).json({
        error: "server_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  router.get("/validate", async (_req, res) => {
    const tokens = readTokens();
    if (!tokens?.access_token || !tokens.domain) {
      res.json({ ok: false, reason: "not_authorized" });
      return;
    }

    const baseUrl = tokens.domain.startsWith("http") ? tokens.domain : `https://${tokens.domain}`;
    const endpoint = `${baseUrl.replace(/\/$/, "")}/rest/user.current.json`;

    try {
      const response = await httpRequest<{ result?: { ID?: number; NAME?: string; LAST_NAME?: string } }>(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        timeoutMs: 10000,
        retries: 1,
      });

      if (!response.ok) {
        const reason = response.status === 401 ? "not_authorized" : "provider_error";
        res.json({ ok: false, reason, status: response.status, portal: tokens.domain });
        return;
      }

      const user = response.body?.result;
      const scopes = Array.isArray(tokens.scope)
        ? tokens.scope
        : typeof tokens.scope === "string"
        ? tokens.scope.split(/[,\s]+/).filter(Boolean)
        : [];

      res.json({
        ok: true,
        portal: tokens.domain,
        user: user
          ? { id: String(user.ID ?? ""), name: user.NAME ?? null, lastName: user.LAST_NAME ?? null }
          : null,
        scopes,
      });
    } catch (error) {
      console.error("[Bitrix] validate failed", error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, reason: "network_error" });
    }
  });

  /**
   * GET /fields/:entityType
   * Get available fields for a Bitrix entity type
   */
  router.get("/fields/:entityType", (req, res) => {
    const { entityType } = req.params;

    const fieldsMap: Record<string, any> = {
      lead: {
        ...BITRIX_LEAD_FIELDS,
        // Add standard fields with descriptions
        TITLE: { code: 'TITLE', title: 'Título', type: 'string' },
        NAME: { code: 'NAME', title: 'Nombre', type: 'string' },
        LAST_NAME: { code: 'LAST_NAME', title: 'Apellidos', type: 'string' },
        PHONE: { code: 'PHONE', title: 'Teléfono', type: 'phone' },
        EMAIL: { code: 'EMAIL', title: 'Email', type: 'email' },
        COMMENTS: { code: 'COMMENTS', title: 'Comentarios', type: 'text' },
        STATUS_ID: { code: 'STATUS_ID', title: 'Estado', type: 'status' },
        SOURCE_ID: { code: 'SOURCE_ID', title: 'Fuente', type: 'source' },
        ASSIGNED_BY_ID: { code: 'ASSIGNED_BY_ID', title: 'Responsable', type: 'user' },
      },
      contact: {
        ...BITRIX_CONTACT_FIELDS,
        NAME: { code: 'NAME', title: 'Nombre', type: 'string' },
        LAST_NAME: { code: 'LAST_NAME', title: 'Apellidos', type: 'string' },
        PHONE: { code: 'PHONE', title: 'Teléfono', type: 'phone' },
        EMAIL: { code: 'EMAIL', title: 'Email', type: 'email' },
        COMMENTS: { code: 'COMMENTS', title: 'Comentarios', type: 'text' },
        TYPE_ID: { code: 'TYPE_ID', title: 'Tipo', type: 'enumeration' },
        SOURCE_ID: { code: 'SOURCE_ID', title: 'Fuente', type: 'source' },
        ASSIGNED_BY_ID: { code: 'ASSIGNED_BY_ID', title: 'Responsable', type: 'user' },
      },
      deal: {
        TITLE: { code: 'TITLE', title: 'Título', type: 'string' },
        STAGE_ID: { code: 'STAGE_ID', title: 'Etapa', type: 'stage' },
        OPPORTUNITY: { code: 'OPPORTUNITY', title: 'Monto', type: 'double' },
        CURRENCY_ID: { code: 'CURRENCY_ID', title: 'Moneda', type: 'currency' },
        COMMENTS: { code: 'COMMENTS', title: 'Comentarios', type: 'text' },
        CONTACT_ID: { code: 'CONTACT_ID', title: 'Contacto', type: 'crm_contact' },
        ASSIGNED_BY_ID: { code: 'ASSIGNED_BY_ID', title: 'Responsable', type: 'user' },
      },
      company: {
        TITLE: { code: 'TITLE', title: 'Nombre de la empresa', type: 'string' },
        COMPANY_TYPE: { code: 'COMPANY_TYPE', title: 'Tipo de empresa', type: 'enumeration' },
        PHONE: { code: 'PHONE', title: 'Teléfono', type: 'phone' },
        EMAIL: { code: 'EMAIL', title: 'Email', type: 'email' },
        COMMENTS: { code: 'COMMENTS', title: 'Comentarios', type: 'text' },
        ASSIGNED_BY_ID: { code: 'ASSIGNED_BY_ID', title: 'Responsable', type: 'user' },
      }
    };

    const fields = fieldsMap[entityType.toLowerCase()];

    if (!fields) {
      res.status(400).json({ error: 'invalid_entity_type', message: `Entity type ${entityType} not supported` });
      return;
    }

    // Convert to array format
    const fieldsArray = Object.entries(fields).map(([key, value]) => {
      if (typeof value === 'string') {
        // It's a constant from config file (like UF_CRM_*)
        return {
          code: value,
          title: key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
          type: 'string'
        };
      }
      // It's already an object with code, title, type
      return value;
    });

    res.json({ fields: fieldsArray });
  });

  /**
   * GET /api/bitrix/lead-statuses
   * Obtener lista de etapas (STATUS_ID) disponibles para leads
   */
  router.get("/lead-statuses", async (req, res) => {
    try {
      const { getBitrixClientManager } = await import("../bitrix-client-manager");
      const client = getBitrixClientManager().getClient();

      if (!client) {
        res.status(503).json({ error: "bitrix_not_configured", message: "Bitrix24 not configured" });
        return;
      }

      // Obtener lista de estatus usando crm.status.list
      // Para leads, el ENTITY_ID es "STATUS"
      const response = await client.callMethod("crm.status.list", {
        filter: { ENTITY_ID: "STATUS" },
      });

      if (!response.result || response.result.length === 0) {
        res.status(500).json({ error: "no_statuses", message: "No statuses found" });
        return;
      }

      // Formatear las opciones de status
      const statuses = response.result.map((status: any) => ({
        id: status.STATUS_ID,
        name: status.NAME,
      }));

      res.json({ statuses });
    } catch (error) {
      console.error("[Bitrix] Error getting lead statuses:", error);
      res.status(500).json({ error: "internal_error", message: "Failed to get lead statuses" });
    }
  });

  /**
   * GET /api/bitrix/lead-sources
   * Obtener lista de orígenes (SOURCE_ID) disponibles para leads
   */
  router.get("/lead-sources", async (req, res) => {
    try {
      const { getBitrixClientManager } = await import("../bitrix-client-manager");
      const client = getBitrixClientManager().getClient();

      if (!client) {
        res.status(503).json({ error: "bitrix_not_configured", message: "Bitrix24 not configured" });
        return;
      }

      // Obtener lista de fuentes usando crm.status.list
      // Para SOURCE_ID de leads, el ENTITY_ID es "SOURCE"
      const response = await client.callMethod("crm.status.list", {
        filter: { ENTITY_ID: "SOURCE" },
      });

      if (!response.result || response.result.length === 0) {
        res.status(500).json({ error: "no_sources", message: "No sources found" });
        return;
      }

      // Formatear las opciones de source
      const sources = response.result.map((source: any) => ({
        id: source.STATUS_ID,
        name: source.NAME,
      }));

      res.json({ sources });
    } catch (error) {
      console.error("[Bitrix] Error getting lead sources:", error);
      res.status(500).json({ error: "internal_error", message: "Failed to get lead sources" });
    }
  });

  /**
   * GET /api/bitrix/users
   * Obtener lista de usuarios de Bitrix24
   */
  router.get("/users", async (req, res) => {
    try {
      const { getBitrixClientManager } = await import("../bitrix-client-manager");
      const client = getBitrixClientManager().getClient();

      if (!client) {
        res.status(503).json({ error: "bitrix_not_configured", message: "Bitrix24 not configured" });
        return;
      }

      const users = await client.getUsers({
        filter: { ACTIVE: true }, // Solo usuarios activos
        select: ["ID", "NAME", "LAST_NAME", "EMAIL", "WORK_POSITION"],
      });

      // Formatear usuarios para el frontend
      const formattedUsers = users.map((user: any) => ({
        id: user.ID,
        name: user.NAME || "",
        lastName: user.LAST_NAME || "",
        fullName: `${user.NAME || ""} ${user.LAST_NAME || ""}`.trim(),
        email: user.EMAIL || "",
        position: user.WORK_POSITION || "",
      }));

      res.json({ users: formattedUsers });
    } catch (error) {
      console.error("[Bitrix] Error getting users:", error);
      res.status(500).json({ error: "internal_error", message: "Failed to get users" });
    }
  });

  /**
   * POST /api/bitrix/create-lead
   * Crear un prospecto (lead) en Bitrix24 desde el chat
   */
  router.post("/create-lead", async (req, res) => {
    try {
      const { title, firstName, lastName, phone, responsibleId, statusId, sourceId } = req.body;

      // Validaciones
      if (!title || !phone) {
        res.status(400).json({ error: "missing_fields", message: "Title and phone are required" });
        return;
      }

      const { getBitrixClientManager } = await import("../bitrix-client-manager");
      const client = getBitrixClientManager().getClient();

      if (!client) {
        res.status(503).json({ error: "bitrix_not_configured", message: "Bitrix24 not configured" });
        return;
      }

      // Preparar campos del lead
      const leadFields: Record<string, any> = {
        TITLE: title,
        PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
      };

      if (firstName) leadFields.NAME = firstName;
      if (lastName) leadFields.LAST_NAME = lastName;
      if (responsibleId) leadFields.ASSIGNED_BY_ID = responsibleId;

      // Establecer etapa (STATUS_ID)
      // Si no se especifica, usar "NEW" por defecto
      leadFields.STATUS_ID = statusId || "NEW";

      // Establecer origen (SOURCE_ID) si se especifica
      if (sourceId) {
        leadFields.SOURCE_ID = sourceId;
      }

      // Crear el lead
      const leadId = await client.createLead(leadFields);

      if (!leadId) {
        res.status(500).json({ error: "creation_failed", message: "Failed to create lead in Bitrix24" });
        return;
      }

      console.log(`[Bitrix] ✅ Lead created successfully: ID=${leadId}`);

      res.json({
        success: true,
        leadId,
        message: "Lead created successfully",
      });
    } catch (error) {
      console.error("[Bitrix] Error creating lead:", error);
      res.status(500).json({ error: "internal_error", message: "Failed to create lead" });
    }
  });

  return router;
}
