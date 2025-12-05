/**
 * Exportador de Chats para Entrenamiento de IA
 *
 * Este script extrae conversaciones de la base de datos y las formatea
 * para uso en entrenamiento (fine-tuning) o RAG
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
});

interface ChatMessage {
  direction: 'incoming' | 'outgoing';
  text: string;
  timestamp: number;
  sent_by?: string;
}

interface ConversationExport {
  id: string;
  phone: string;
  category: string;
  status: string;
  total_messages: number;
  date_range: { start: string; end: string };
  messages: Array<{
    role: 'cliente' | 'asesor' | 'bot';
    content: string;
    timestamp: string;
  }>;
  summary?: string;
}

// Mensajes del sistema a filtrar
const SYSTEM_MESSAGES = [
  'En cola',
  'Asignado automáticamente',
  'aceptó la conversación',
  'Conversación cerrada',
  'Bot inició atención',
  'Bot transfirió',
  'cambió su estado',
  'devuelta a la cola',
  'templateName',
  'No pude reconocer tu respuesta',
];

function isSystemMessage(text: string): boolean {
  if (!text) return true;
  return SYSTEM_MESSAGES.some(pattern => text.includes(pattern));
}

function determineRole(msg: ChatMessage): 'cliente' | 'asesor' | 'bot' {
  if (msg.direction === 'incoming') return 'cliente';
  if (msg.sent_by && msg.sent_by !== 'bot' && msg.sent_by !== 'system') return 'asesor';
  return 'bot';
}

async function exportConversations(days: number = 3, minMessages: number = 5): Promise<void> {
  console.log(`\n📊 Exportando conversaciones de los últimos ${days} días con mínimo ${minMessages} mensajes...\n`);

  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

  // 1. Obtener conversaciones con suficientes mensajes
  const convQuery = `
    SELECT
      c.id,
      c.phone,
      c.category,
      c.status,
      COUNT(m.id) as msg_count
    FROM crm_conversations c
    JOIN crm_messages m ON m.conversation_id = c.id
    WHERE c.last_message_at > $1
      AND c.category NOT IN ('mass_send', 'campaign')
    GROUP BY c.id, c.phone, c.category, c.status
    HAVING COUNT(m.id) >= $2
    ORDER BY COUNT(m.id) DESC
    LIMIT 100
  `;

  const convResult = await pool.query(convQuery, [cutoffTime, minMessages]);
  console.log(`📁 Encontradas ${convResult.rows.length} conversaciones relevantes\n`);

  const exports: ConversationExport[] = [];
  let totalMessages = 0;

  for (const conv of convResult.rows) {
    // Obtener mensajes de esta conversación
    const msgQuery = `
      SELECT direction, text, created_at as timestamp, sent_by
      FROM crm_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `;

    const msgResult = await pool.query(msgQuery, [conv.id]);

    // Filtrar mensajes del sistema y formatear
    const messages: ConversationExport['messages'] = [];

    for (const msg of msgResult.rows) {
      if (isSystemMessage(msg.text)) continue;
      if (!msg.text || msg.text.trim() === '') continue;

      const role = determineRole(msg);
      messages.push({
        role,
        content: msg.text.trim(),
        timestamp: new Date(parseInt(msg.timestamp)).toISOString(),
      });
    }

    if (messages.length < 3) continue; // Skip if too few real messages

    const exportData: ConversationExport = {
      id: conv.id,
      phone: conv.phone.replace(/\d{4}$/, '****'), // Ocultar últimos 4 dígitos
      category: conv.category || 'general',
      status: conv.status,
      total_messages: messages.length,
      date_range: {
        start: messages[0]?.timestamp || '',
        end: messages[messages.length - 1]?.timestamp || '',
      },
      messages,
    };

    exports.push(exportData);
    totalMessages += messages.length;
  }

  // Guardar exportación
  const outputPath = `/opt/flow-builder/data/training-data-${new Date().toISOString().split('T')[0]}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify(exports, null, 2));

  console.log(`✅ Exportación completada:`);
  console.log(`   - Conversaciones: ${exports.length}`);
  console.log(`   - Mensajes totales: ${totalMessages}`);
  console.log(`   - Archivo: ${outputPath}`);

  // Mostrar resumen de categorías
  const categories: Record<string, number> = {};
  exports.forEach(e => {
    categories[e.category] = (categories[e.category] || 0) + 1;
  });
  console.log(`\n📊 Por categoría:`);
  Object.entries(categories).forEach(([cat, count]) => {
    console.log(`   - ${cat}: ${count}`);
  });

  // Mostrar ejemplo de conversación
  if (exports.length > 0) {
    const sample = exports.find(e => e.messages.length >= 8) || exports[0];
    console.log(`\n📝 Ejemplo de conversación (${sample.phone}):`);
    console.log('─'.repeat(60));
    sample.messages.slice(0, 10).forEach(m => {
      const emoji = m.role === 'cliente' ? '👤' : (m.role === 'asesor' ? '👩‍💼' : '🤖');
      const preview = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
      console.log(`${emoji} ${m.role.toUpperCase()}: ${preview}`);
    });
    if (sample.messages.length > 10) {
      console.log(`   ... y ${sample.messages.length - 10} mensajes más`);
    }
    console.log('─'.repeat(60));
  }

  // Generar formato para fine-tuning
  await generateFineTuningFormat(exports);
}

async function generateFineTuningFormat(conversations: ConversationExport[]): Promise<void> {
  console.log('\n🎯 Generando formato para fine-tuning...');

  const trainingExamples: Array<{
    messages: Array<{ role: string; content: string }>;
  }> = [];

  for (const conv of conversations) {
    if (conv.messages.length < 4) continue;

    const example: { messages: Array<{ role: string; content: string }> } = {
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente de ventas de Azaleia Perú. Ayuda a los clientes con información de productos, precios y pedidos. Sé amable y usa español peruano.',
        },
      ],
    };

    // Convertir mensajes al formato OpenAI
    for (const msg of conv.messages) {
      const role = msg.role === 'cliente' ? 'user' : 'assistant';
      example.messages.push({
        role,
        content: msg.content,
      });
    }

    // Solo incluir si tiene interacción real
    const hasUserMessages = example.messages.filter(m => m.role === 'user').length >= 2;
    const hasAssistantMessages = example.messages.filter(m => m.role === 'assistant').length >= 2;

    if (hasUserMessages && hasAssistantMessages) {
      trainingExamples.push(example);
    }
  }

  // Guardar en formato JSONL (requerido por OpenAI fine-tuning)
  const fs = await import('fs/promises');
  const jsonlPath = `/opt/flow-builder/data/fine-tuning-${new Date().toISOString().split('T')[0]}.jsonl`;
  const jsonlContent = trainingExamples.map(e => JSON.stringify(e)).join('\n');
  await fs.writeFile(jsonlPath, jsonlContent);

  console.log(`✅ Archivo fine-tuning generado:`);
  console.log(`   - Ejemplos: ${trainingExamples.length}`);
  console.log(`   - Archivo: ${jsonlPath}`);
}

// Generar documento de patrones para RAG
async function generatePatternsDocument(conversations: ConversationExport[]): Promise<void> {
  console.log('\n📚 Generando documento de patrones para RAG...');

  let document = `# PATRONES DE CONVERSACIÓN - AZALEIA PERÚ

Este documento contiene patrones reales de cómo los clientes hacen pedidos y consultas.
Generado: ${new Date().toISOString()}
Total conversaciones analizadas: ${conversations.length}

## PATRONES DE INICIO DE CONVERSACIÓN

Los clientes típicamente inician con:
`;

  // Analizar primeros mensajes
  const openings: Record<string, number> = {};
  conversations.forEach(conv => {
    const first = conv.messages.find(m => m.role === 'cliente');
    if (first) {
      const normalized = first.content.toLowerCase().trim();
      openings[normalized] = (openings[normalized] || 0) + 1;
    }
  });

  const topOpenings = Object.entries(openings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  topOpenings.forEach(([text, count]) => {
    document += `- "${text}" (${count} veces)\n`;
  });

  document += `\n## EJEMPLOS DE CONVERSACIONES EXITOSAS\n\n`;

  // Agregar ejemplos completos
  const goodConvs = conversations
    .filter(c => c.messages.length >= 6 && c.status === 'closed')
    .slice(0, 10);

  goodConvs.forEach((conv, idx) => {
    document += `### Ejemplo ${idx + 1} (${conv.category || 'general'})\n\n`;
    conv.messages.forEach(m => {
      const label = m.role === 'cliente' ? 'CLIENTE' : 'ASESOR';
      document += `**${label}:** ${m.content}\n\n`;
    });
    document += `---\n\n`;
  });

  const fs = await import('fs/promises');
  const docPath = `/opt/flow-builder/data/knowledge-base/patrones-conversacion.md`;
  await fs.writeFile(docPath, document);

  console.log(`✅ Documento de patrones generado: ${docPath}`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args[0]) || 3;
  const minMessages = parseInt(args[1]) || 5;

  console.log('═'.repeat(60));
  console.log('🤖 EXPORTADOR DE CHATS PARA ENTRENAMIENTO DE IA');
  console.log('═'.repeat(60));

  try {
    await exportConversations(days, minMessages);

    // Cargar los datos exportados y generar documento de patrones
    const fs = await import('fs/promises');
    const dataPath = `/opt/flow-builder/data/training-data-${new Date().toISOString().split('T')[0]}.json`;
    const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
    await generatePatternsDocument(data);

    console.log('\n✅ Proceso completado exitosamente');
    console.log('\n📋 Próximos pasos:');
    console.log('   1. Revisar el archivo JSON de entrenamiento');
    console.log('   2. El documento de patrones ya está en knowledge-base/');
    console.log('   3. Re-indexar RAG para incluir los nuevos patrones');
    console.log('   4. (Opcional) Usar el archivo .jsonl para fine-tuning en OpenAI');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();
