
import { pool } from '../crm/db-postgres';

async function run() {
  console.log('🚀 Iniciando creación de índices de rendimiento...');

  const client = await pool.connect();
  try {
    // 1. Índice compuesto para la distribución de colas (QueueDistributor)
    // Permite filtrar instantáneamente: chats activos en una cola específica y sin asignar
    console.log('Creating idx_conv_queue_distributor...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_queue_distributor
      ON crm_conversations (queue_id, status, assigned_to)
      WHERE status = 'active' AND assigned_to IS NULL;
    `);

    // 2. Índice para búsqueda rápida de conversaciones por teléfono (Inbound)
    // Usado cada vez que entra un mensaje de WhatsApp
    console.log('Creating idx_conv_phone_lookup...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_phone_lookup
      ON crm_conversations (phone, channel, status);
    `);

    // 3. Índice para el historial de mensajes (ordenado por tiempo)
    // Usado al abrir un chat en el frontend
    console.log('Creating idx_messages_history...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_history
      ON crm_messages (conversation_id, timestamp ASC);
    `);

    // 4. Índice para métricas y reportes (filtrado por fecha)
    console.log('Creating idx_conv_metrics_date...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_metrics_date
      ON crm_conversations (last_message_at DESC);
    `);

    console.log('✅ Todos los índices creados exitosamente.');
  } catch (error) {
    console.error('❌ Error creando índices:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
