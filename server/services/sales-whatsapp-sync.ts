/**
 * Sales-WhatsApp Conversion Sync Service
 * Syncs sales data from SQL Server and matches with WhatsApp conversations
 */

import sql from 'mssql';
import { Pool } from 'pg';

const pgPool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

const sqlServerConfig = {
  user: 'cpalomino',
  password: 'azaleia.2018',
  server: '190.119.245.254',
  database: 'dbbusiness',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
};

interface SaleRecord {
  customer_phone: string;
  customer_id: string;
  customer_name: string;
  sale_date: Date;
  sale_amount: number;
  document_number: string;
  area: string;
  seller_name: string;
  ubicacion: string;
  departamento: string;
  provincia: string;
  distrito: string;
}

interface WhatsAppContact {
  phone: string;
  first_contact: Date;
  phone_number_id: string | null;
  display_name: string | null;
  conversation_id: string | null;
}

/**
 * Fetch sales from SQL Server (last 60 days)
 */
async function fetchSalesFromSQLServer(): Promise<SaleRecord[]> {
  console.log('[SalesSync] Connecting to SQL Server...');

  const pool = await sql.connect(sqlServerConfig);

  // Calculate date range (last 60 days)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 60);

  const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
  const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

  console.log(`[SalesSync] Fetching sales from ${startDateStr} to ${endDateStr}...`);

  const query = `
    SELECT TOP 100 PERCENT * FROM (
      SELECT
        CONCAT('51', d.TlfCelular) AS customer_phone,
        d.IdCliente AS customer_id,
        d.RazonSocial AS customer_name,
        a.FchVenta AS sale_date,
        SUM(b.VtaImporte - b.VtaDscto) AS sale_amount,
        a.DocCod + a.DocSer + a.DocNro AS document_number,
        CASE
          WHEN a.Codvend IN ('TELEOPERADORA10', 'RLUJAN', 'ACUSTODIO', 'TELEOPERADORA9', 'TELEOPERADORA7',
                             'TELEOPERADORA6', 'TELEOPERADORA5', 'TELEOPERADORA4', 'TELEOPERADORA3',
                             'TELEOPERADORA2', 'TELEOPERADORA1', 'TELEOPERADORA11', 'TELEOPERADORA12', 'DORTIZ') THEN 'ATC'
          WHEN a.Codvend = 'WEBCATALOGO' THEN 'WEBCATALOGO'
          WHEN a.Codvend IN ('MQUIROZ', 'MSOSA', 'PREVENTAS1', 'EOYOLA', 'MMAZA') THEN 'COUNTER'
          ELSE 'OTROS'
        END AS area,
        CASE
          WHEN a.Codvend = 'preventas1' THEN 'Ana Ortiz'
          WHEN a.CodVend = 'acustodio' THEN 'Angela Custodio'
          WHEN a.CodVend = 'WEBCATALOGO' THEN 'Web'
          WHEN a.CodVend = 'MQUIROZ' THEN 'Mariela Vargas'
          WHEN a.CodVend = 'teleoperadora12' THEN 'Ana Ortiz'
          WHEN a.CodVend = 'rlujan' THEN 'Rosario Lujan'
          WHEN a.CodVend = 'eoyola' THEN 'Elena Oyola'
          WHEN a.CodVend = 'teleoperadora9' THEN 'Monica Montes'
          WHEN a.CodVend IN ('dortiz', 'teleoperadora10') THEN 'Dante Ortiz'
          WHEN a.CodVend = 'msosa' THEN 'Martha Sosa'
          WHEN a.CodVend = 'mmaza' THEN 'Patricia Maza'
          ELSE 'OTROS'
        END AS seller_name,
        CASE
          WHEN f.PROVINCIA IN ('LIMA', 'CALLAO') THEN 'LIMA'
          ELSE 'PROVINCIA'
        END AS ubicacion,
        f.Departamento AS departamento,
        f.Provincia AS provincia,
        f.Distrito AS distrito
      FROM
        DBBUSINESS.DBO.VTADOCUMENTOSDECARGO a
      INNER JOIN
        DBBUSINESS.DBO.VTADOCUMENTOSDECARGODETALLES b ON a.DOCCOD = b.DOCCOD AND a.DOCSER = b.DOCSER AND a.DOCNRO = b.DocNro
      INNER JOIN
        DBBUSINESS.DBO.ArtProductos c ON b.CodArticulo = c.CodArticulo
      INNER JOIN
        DBBUSINESS.DBO.MAECLIENTES d ON a.IDCLIENTE = d.IdCliente
      LEFT JOIN
        DBBUSINESS.DBO.UbigeoCourier f ON d.CODUBIGEO = f.CodUbigeo
      INNER JOIN
        DBBUSINESS.DBO.APPEMPRESA p ON a.CODEMPRESA = p.CODEMPRESA
      WHERE
        a.CODEMPRESA = 4
        AND CONVERT(VARCHAR, a.FCHVENTA, 112) BETWEEN '${startDateStr}' AND '${endDateStr}'
        AND c.CodColec <> 'SU'
        AND b.CodArticulo > 0
        AND b.ParPrecio > 0
        AND d.TlfCelular IS NOT NULL
        AND LEN(d.TlfCelular) >= 9
      GROUP BY
        f.Departamento, f.Provincia, f.Distrito, a.CodVend, d.RazonSocial, d.TlfCelular, d.IdCliente,
        a.FchVenta, a.DocCod, a.DocSer, a.DocNro, f.PROVINCIA
    ) A
    ORDER BY sale_date DESC;
  `;

  const result = await pool.request().query(query);
  await pool.close();

  console.log(`[SalesSync] Found ${result.recordset.length} sales records`);

  return result.recordset;
}

/**
 * Get WhatsApp first contacts from PostgreSQL
 */
async function getWhatsAppContacts(phones: string[]): Promise<Map<string, WhatsAppContact>> {
  if (phones.length === 0) return new Map();

  console.log(`[SalesSync] Fetching WhatsApp contacts for ${phones.length} phones...`);

  const query = `
    SELECT
      phone,
      MIN(created_at) as first_contact,
      (ARRAY_AGG(phone_number_id ORDER BY created_at))[1] as phone_number_id,
      (ARRAY_AGG(display_number ORDER BY created_at))[1] as display_name,
      (ARRAY_AGG(id::text ORDER BY created_at))[1] as conversation_id
    FROM crm_conversations
    WHERE phone = ANY($1)
    GROUP BY phone
  `;

  const result = await pgPool.query(query, [phones]);

  const contactsMap = new Map<string, WhatsAppContact>();
  for (const row of result.rows) {
    contactsMap.set(row.phone, {
      phone: row.phone,
      first_contact: row.first_contact,
      phone_number_id: row.phone_number_id,
      display_name: row.display_name,
      conversation_id: row.conversation_id,
    });
  }

  console.log(`[SalesSync] Found ${contactsMap.size} WhatsApp contacts`);

  return contactsMap;
}

/**
 * Sync sales with WhatsApp conversations
 */
export async function syncSalesWithWhatsApp(): Promise<{
  totalSales: number;
  withWhatsApp: number;
  withoutWhatsApp: number;
  syncedAt: Date;
}> {
  const startTime = Date.now();
  console.log('[SalesSync] ========== Starting sync ==========');

  try {
    // 1. Fetch sales from SQL Server
    const sales = await fetchSalesFromSQLServer();

    if (sales.length === 0) {
      console.log('[SalesSync] No sales found, skipping sync');
      return {
        totalSales: 0,
        withWhatsApp: 0,
        withoutWhatsApp: 0,
        syncedAt: new Date(),
      };
    }

    // 2. Get unique phone numbers
    const phones = [...new Set(sales.map(s => s.customer_phone))];

    // 3. Fetch WhatsApp contacts
    const whatsappContacts = await getWhatsAppContacts(phones);

    // 4. Clear old cache
    console.log('[SalesSync] Clearing old cache...');
    await pgPool.query('TRUNCATE TABLE sales_whatsapp_conversions');

    // 5. Insert new records
    console.log('[SalesSync] Inserting new records...');

    let withWhatsApp = 0;
    let withoutWhatsApp = 0;

    for (const sale of sales) {
      const whatsapp = whatsappContacts.get(sale.customer_phone);
      const hasWhatsApp = !!whatsapp;

      if (hasWhatsApp) withWhatsApp++;
      else withoutWhatsApp++;

      // Calculate days to conversion
      let daysToConversion: number | null = null;
      if (whatsapp && whatsapp.first_contact) {
        // whatsapp.first_contact is a bigint (returned as string by pg), convert to Date
        const timestampMs = typeof whatsapp.first_contact === 'string'
          ? parseInt(whatsapp.first_contact, 10)
          : Number(whatsapp.first_contact);
        const contactDate = new Date(timestampMs);
        const saleDate = new Date(sale.sale_date);
        daysToConversion = Math.floor((saleDate.getTime() - contactDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Convert dates to ISO strings to ensure proper PostgreSQL insertion
      const saleDate = sale.sale_date instanceof Date ? sale.sale_date.toISOString() : sale.sale_date;

      // Convert first_contact (which is a bigint millisecond timestamp) to ISO string
      // Note: pg library returns bigint as string to avoid precision loss
      let firstContactDate: string | null = null;
      if (whatsapp?.first_contact) {
        if (whatsapp.first_contact instanceof Date) {
          firstContactDate = whatsapp.first_contact.toISOString();
        } else {
          // Convert millisecond timestamp (number, bigint, or string) to Date
          const timestampMs = typeof whatsapp.first_contact === 'string'
            ? parseInt(whatsapp.first_contact, 10)
            : Number(whatsapp.first_contact);
          firstContactDate = new Date(timestampMs).toISOString();
        }
      }

      await pgPool.query(`
        INSERT INTO sales_whatsapp_conversions (
          customer_phone,
          customer_id,
          customer_name,
          sale_date,
          sale_amount,
          document_number,
          area,
          seller_name,
          ubicacion,
          departamento,
          provincia,
          distrito,
          first_whatsapp_contact_date,
          whatsapp_number_id,
          whatsapp_display_name,
          conversation_id,
          days_to_conversion,
          contacted_via_whatsapp,
          last_sync_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      `, [
        sale.customer_phone,
        sale.customer_id,
        sale.customer_name,
        saleDate,
        sale.sale_amount,
        sale.document_number,
        sale.area,
        sale.seller_name,
        sale.ubicacion,
        sale.departamento,
        sale.provincia,
        sale.distrito,
        firstContactDate,
        whatsapp?.phone_number_id || null,
        whatsapp?.display_name || null,
        whatsapp?.conversation_id || null,
        daysToConversion,
        hasWhatsApp,
      ]);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[SalesSync] ========== Sync completed in ${duration}s ==========`);
    console.log(`[SalesSync] Total sales: ${sales.length}`);
    console.log(`[SalesSync] With WhatsApp: ${withWhatsApp} (${((withWhatsApp / sales.length) * 100).toFixed(1)}%)`);
    console.log(`[SalesSync] Without WhatsApp: ${withoutWhatsApp} (${((withoutWhatsApp / sales.length) * 100).toFixed(1)}%)`);

    return {
      totalSales: sales.length,
      withWhatsApp,
      withoutWhatsApp,
      syncedAt: new Date(),
    };

  } catch (error) {
    console.error('[SalesSync] Error during sync:', error);
    throw error;
  }
}
