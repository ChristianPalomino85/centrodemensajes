import { Pool } from 'pg';
import { getBitrixClientConfig } from '../server/utils/env';

const pool = new Pool({
  host: 'localhost',
  database: 'flowbuilder_crm',
  user: 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure'
});

async function updatePublicidad() {
  try {
    const config = getBitrixClientConfig();

    if (!config?.accessToken || !config?.domain) {
      console.log('No Bitrix credentials found');
      return;
    }

    console.log('Bitrix domain:', config.domain);

    // Obtener TODAS las conversaciones pendientes
    const result = await pool.query(
      'SELECT id, bitrix_id FROM crm_conversations WHERE bitrix_id IS NOT NULL AND autoriza_publicidad IS NULL'
    );

    console.log('Conversaciones a actualizar:', result.rows.length);
    if (result.rows.length === 0) {
      console.log('No hay conversaciones pendientes');
      return;
    }

    // Agrupar por bitrix_id para consultas batch
    const bitrixIds = [...new Set(result.rows.map(r => r.bitrix_id))];
    console.log('IDs únicos de Bitrix:', bitrixIds.length);

    // Procesar en lotes de 50
    const BATCH_SIZE = 50;
    let updated = 0;
    const publicidadMap = new Map<string, string>();

    for (let i = 0; i < bitrixIds.length; i += BATCH_SIZE) {
      const batch = bitrixIds.slice(i, i + BATCH_SIZE);
      console.log(`Procesando lote ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(bitrixIds.length/BATCH_SIZE)} (${batch.length} IDs)`);

      // Consulta batch a Bitrix - contactos
      const filter = batch.map(id => `filter[ID][]=${id}`).join('&');
      const url = `https://${config.domain}/rest/crm.contact.list.json?${filter}&select[]=ID&select[]=UF_CRM_1753421555&auth=${config.accessToken}`;

      try {
        const resp = await fetch(url);
        const data = await resp.json() as any;

        if (data.result) {
          for (const contact of data.result) {
            if (contact.UF_CRM_1753421555) {
              publicidadMap.set(contact.ID, contact.UF_CRM_1753421555);
            }
          }
        }
      } catch (e: any) {
        console.log('Error en batch contactos:', e.message);
      }

      // También consultar leads para los que no se encontraron como contactos
      const leadUrl = `https://${config.domain}/rest/crm.lead.list.json?${filter}&select[]=ID&select[]=UF_CRM_1749101575&auth=${config.accessToken}`;

      try {
        const resp = await fetch(leadUrl);
        const data = await resp.json() as any;

        if (data.result) {
          for (const lead of data.result) {
            if (lead.UF_CRM_1749101575 && !publicidadMap.has(lead.ID)) {
              publicidadMap.set(lead.ID, lead.UF_CRM_1749101575);
            }
          }
        }
      } catch (e: any) {
        console.log('Error en batch leads:', e.message);
      }

      // Rate limit entre lotes
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('Datos obtenidos de Bitrix:', publicidadMap.size);

    // Actualizar base de datos
    for (const row of result.rows) {
      const value = publicidadMap.get(row.bitrix_id);
      if (value) {
        await pool.query(
          'UPDATE crm_conversations SET autoriza_publicidad = $1 WHERE id = $2',
          [value, row.id]
        );
        updated++;
      }
    }

    console.log('Total actualizado:', updated);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

updatePublicidad();
