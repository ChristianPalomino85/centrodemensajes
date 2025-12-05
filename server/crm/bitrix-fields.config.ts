/**
 * Configuración de campos personalizados de Bitrix24 para Azaleia Perú
 *
 * Portal: azaleia-peru.bitrix24.es
 *
 * Esta configuración mapea los campos personalizados (UF_CRM_*) de Bitrix24
 * con sus descripciones y tipos de datos.
 */

export const BITRIX24_CONFIG = {
  /**
   * URL del portal de Bitrix24
   */
  PORTAL: 'azaleia-peru.bitrix24.es',

  /**
   * IDs de prueba para testing
   */
  TEST_IDS: {
    CONTACT: '866056',
    LEAD: '183036',
  },
};

/**
 * Campos personalizados para la entidad CONTACT (Contacto)
 */
export const BITRIX_CONTACT_FIELDS = {
  // Campos estándar de Bitrix24
  NAME: 'NAME',                      // Nombre (campo original)
  LAST_NAME: 'LAST_NAME',           // Apellidos (campo original)
  PHONE: 'PHONE',                   // Teléfono (campo original - work phone)

  // Campos personalizados
  DOCUMENTO: 'UF_CRM_5DEAADAE301BB',          // N°documento (Cadena)
  DIRECCION: 'UF_CRM_1745466972',             // Dirección (Cadena)
  TIPO_CONTACTO: 'UF_CRM_67D702957E80A',      // Tipo de contacto (Lista)
  DEPARTAMENTO: 'UF_CRM_68121FB2B841A',       // Departamento (Lista)
  PROVINCIA: 'UF_CRM_1745461823632',          // Provincia (Cadena)
  DISTRITO: 'UF_CRM_1745461836705',           // Distrito (Cadena)
  LIDER: 'UF_CRM_1715014786',                 // Líder (Cadena)
  STENCIL: 'UF_CRM_1565801603901',            // Stencil (Lista)
  AUTORIZA_PUBLICIDAD: 'UF_CRM_1753421555',   // ¿Te gustaría recibir novedades y ofertas exclusivas de Azaleia?
} as const;

/**
 * Campos personalizados para la entidad LEAD (Prospecto)
 */
export const BITRIX_LEAD_FIELDS = {
  // Campos estándar de Bitrix24
  TITLE: 'TITLE',                   // Título (campo original)
  NAME: 'NAME',                     // Nombre (campo original)
  LAST_NAME: 'LAST_NAME',          // Apellidos (campo original)
  PHONE: 'PHONE',                  // Teléfono (campo original - work phone)

  // Campos personalizados
  DEPARTAMENTOS: 'UF_CRM_1662413427',         // Departamentos (Lista)
  AUTORIZA_PUBLICIDAD: 'UF_CRM_1749101575',   // Autoriza Publicidad
} as const;

/**
 * Tipos de datos de los campos personalizados
 */
export const BITRIX_FIELD_TYPES = {
  // Contact
  [BITRIX_CONTACT_FIELDS.DOCUMENTO]: 'string',
  [BITRIX_CONTACT_FIELDS.DIRECCION]: 'string',
  [BITRIX_CONTACT_FIELDS.TIPO_CONTACTO]: 'list',
  [BITRIX_CONTACT_FIELDS.DEPARTAMENTO]: 'list',
  [BITRIX_CONTACT_FIELDS.PROVINCIA]: 'string',
  [BITRIX_CONTACT_FIELDS.DISTRITO]: 'string',
  [BITRIX_CONTACT_FIELDS.LIDER]: 'string',
  [BITRIX_CONTACT_FIELDS.STENCIL]: 'list',

  // Lead
  [BITRIX_LEAD_FIELDS.DEPARTAMENTOS]: 'list',
} as const;

/**
 * Descripción legible de los campos
 */
export const BITRIX_FIELD_DESCRIPTIONS = {
  // Contact
  [BITRIX_CONTACT_FIELDS.DOCUMENTO]: 'Número de documento (DNI, CE, etc.)',
  [BITRIX_CONTACT_FIELDS.DIRECCION]: 'Dirección completa',
  [BITRIX_CONTACT_FIELDS.TIPO_CONTACTO]: 'Tipo de contacto (Cliente, Prospecto, etc.)',
  [BITRIX_CONTACT_FIELDS.DEPARTAMENTO]: 'Departamento (región) del Perú',
  [BITRIX_CONTACT_FIELDS.PROVINCIA]: 'Provincia',
  [BITRIX_CONTACT_FIELDS.DISTRITO]: 'Distrito',
  [BITRIX_CONTACT_FIELDS.LIDER]: 'Líder o responsable asignado',
  [BITRIX_CONTACT_FIELDS.STENCIL]: 'Stencil o plantilla asignada',

  // Lead
  [BITRIX_LEAD_FIELDS.DEPARTAMENTOS]: 'Departamentos de interés',
} as const;

/**
 * Datos que vienen de WhatsApp Meta en el webhook
 *
 * Cuando llega un mensaje de WhatsApp, Meta nos envía:
 * - phone (from): Número de teléfono del remitente
 * - profile.name: Nombre del perfil configurado en WhatsApp
 *
 * NOTA: Meta NO envía otros datos personales como dirección, documento, etc.
 * Esos datos deben ser capturados en la conversación o ya existir en Bitrix.
 */
export interface WhatsAppMetaData {
  phone: string;              // Número de teléfono (from)
  profileName?: string;       // Nombre del perfil de WhatsApp
}
