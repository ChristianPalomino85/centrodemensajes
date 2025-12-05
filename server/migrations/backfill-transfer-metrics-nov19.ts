/**
 * Migration script to backfill missing transfer metrics from Nov 19, 2025 onwards
 *
 * Due to a bug in the transferConversation() method (incorrect parameters),
 * transfers were recorded as system events but not in conversation_metrics.
 *
 * This script:
 * 1. Reads transfer events from crm_messages (Nov 19 - Nov 25)
 * 2. Parses advisor names from the text
 * 3. Maps names to advisor IDs
 * 4. Creates the missing metrics (transferred_out and transferred_in)
 */

import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DATABASE || 'flowbuilder_crm',
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || '',
});

// Mapping of advisor names to IDs (from database)
// NOTE: Must match exactly the names that appear in the transfer system message text.
const ADVISOR_NAME_TO_ID: Record<string, string> = {
  'Amanda Arroyo': 'user-1763560668531',
  'Ana Ortíz': 'user-1761954747002',
  'Angela Custodio': 'user-1761954617719',
  'Carlos': 'user-1762179224034',
  'Christian Palomino': 'user-1',
  'Elena': 'user-1761954513456',
  'Mariela Vargas': 'user-1761956723838',
  'Martha Sosa': 'user-1761954642084',
  'Rosario Luján': 'user-1761954566426',
  'Sócrates': 'user-1761893409008',
  'Test Migration User': 'user-1763335510359',
  'Usuario de pruebas': 'user-1762290677265',
};

interface TransferEvent {
  conversation_id: string;
  text: string;
  timestamp: number;
}

interface ParsedTransfer {
  conversationId: string;
  fromName: string;
  toName: string;
  timestamp: number;
  fromAdvisorId: string | null;
  toAdvisorId: string | null;
}

/**
 * Parse transfer text to extract advisor names
 * Format: "🔀 [From Name] transfirió a [To Name] (DD/MM/YYYY HH:MM)"
 */
function parseTransferText(text: string): { fromName: string; toName: string } | null {
  const match = text.match(/^🔀 (.+?) transfirió a (.+?) \(\d{2}\/\d{2}\/\d{4}/);
  if (!match) {
    return null;
  }
  return {
    fromName: match[1].trim(),
    toName: match[2].trim(),
  };
}

/**
 * Get advisor ID from name using mapping
 */
function getAdvisorId(name: string): string | null {
  return ADVISOR_NAME_TO_ID[name] || null;
}

async function main() {
  console.log('🔄 Starting transfer metrics backfill migration...\n');

  // Date range: from Nov 24, 2025 00:00:00 UTC to now
  const START_DATE = new Date('2025-11-24T00:00:00Z').getTime();
  const END_DATE = Date.now();

  console.log(`📅 Date range: ${new Date(START_DATE).toISOString()} - ${new Date(END_DATE).toISOString()}`);
  console.log(`📅 Timestamp range: ${START_DATE} - ${END_DATE}\n`);

  try {
    // 1. Fetch all advisor transfer events from the period
    console.log('📖 Fetching transfer events from crm_messages...');
    const eventsResult = await pool.query<TransferEvent>(
      `SELECT conversation_id, text, timestamp
       FROM crm_messages
       WHERE event_type = 'conversation_transferred'
         AND text LIKE '🔀%'
         AND timestamp >= $1
         AND timestamp < $2
       ORDER BY timestamp ASC`,
      [START_DATE, END_DATE]
    );

    console.log(`✅ Found ${eventsResult.rows.length} transfer events\n`);

    if (eventsResult.rows.length === 0) {
      console.log('ℹ️  No transfers to process. Exiting.');
      await pool.end();
      return;
    }

    // 2. Parse and validate all transfers
    console.log('🔍 Parsing transfer events...');
    const parsedTransfers: ParsedTransfer[] = [];
    const skippedTransfers: Array<{ text: string; reason: string }> = [];

    for (const event of eventsResult.rows) {
      const parsed = parseTransferText(event.text);
      if (!parsed) {
        skippedTransfers.push({ text: event.text, reason: 'Failed to parse' });
        continue;
      }

      const fromAdvisorId = getAdvisorId(parsed.fromName);
      const toAdvisorId = getAdvisorId(parsed.toName);

      if (!fromAdvisorId) {
        skippedTransfers.push({ text: event.text, reason: `Unknown advisor: ${parsed.fromName}` });
        continue;
      }

      if (!toAdvisorId) {
        skippedTransfers.push({ text: event.text, reason: `Unknown advisor: ${parsed.toName}` });
        continue;
      }

      parsedTransfers.push({
        conversationId: event.conversation_id,
        fromName: parsed.fromName,
        toName: parsed.toName,
        timestamp: event.timestamp,
        fromAdvisorId,
        toAdvisorId,
      });
    }

    console.log(`✅ Successfully parsed ${parsedTransfers.length} transfers`);
    if (skippedTransfers.length > 0) {
      console.log(`⚠️  Skipped ${skippedTransfers.length} transfers:\n`);
      skippedTransfers.slice(0, 5).forEach(s => {
        console.log(`   - ${s.text}`);
        console.log(`     Reason: ${s.reason}\n`);
      });
      if (skippedTransfers.length > 5) {
        console.log(`   ... and ${skippedTransfers.length - 5} more\n`);
      }
    }

    // 3. Check which metrics already exist
    console.log('\n🔍 Checking for existing metrics...');
    const existingMetricsResult = await pool.query(
      `SELECT conversation_id, advisor_id, status, started_at
       FROM conversation_metrics
       WHERE status IN ('transferred_out', 'transferred_in')
         AND started_at >= $1
         AND started_at < $2`,
      [START_DATE, END_DATE]
    );

    console.log(`✅ Found ${existingMetricsResult.rows.length} existing transfer metrics\n`);

    // 4. Create missing metrics
    console.log('💾 Creating missing transfer metrics...\n');
    let createdOut = 0;
    let createdIn = 0;
    let errors = 0;

    for (const transfer of parsedTransfers) {
      try {
        // Create transferred_out metric
        const outMetricId = `metric_${transfer.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          `INSERT INTO conversation_metrics
           (id, conversation_id, advisor_id, status, started_at, ended_at, transferred_at, transferred_to, channel_type, channel_id, queue_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'transferred_out', $4, $4, $4, $5, 'whatsapp', NULL, NULL, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [outMetricId, transfer.conversationId, transfer.fromAdvisorId, transfer.timestamp, transfer.toAdvisorId]
        );
        createdOut++;

        // Create transferred_in metric
        const inMetricId = `metric_${transfer.timestamp}_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          `INSERT INTO conversation_metrics
           (id, conversation_id, advisor_id, status, started_at, transferred_from, channel_type, channel_id, queue_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'transferred_in', $4, $5, 'whatsapp', NULL, NULL, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [inMetricId, transfer.conversationId, transfer.toAdvisorId, transfer.timestamp, transfer.fromAdvisorId]
        );
        createdIn++;

        if ((createdOut + createdIn) % 20 === 0) {
          console.log(`   📝 Progress: ${createdOut} OUT + ${createdIn} IN = ${createdOut + createdIn} metrics created`);
        }
      } catch (error) {
        console.error(`❌ Error creating metrics for transfer:`, transfer, error);
        errors++;
      }
    }

    // 5. Summary
    console.log('\n✅ Migration completed!\n');
    console.log('📊 Summary:');
    console.log(`   - Transfer events found: ${eventsResult.rows.length}`);
    console.log(`   - Successfully parsed: ${parsedTransfers.length}`);
    console.log(`   - Skipped: ${skippedTransfers.length}`);
    console.log(`   - Created transferred_out metrics: ${createdOut}`);
    console.log(`   - Created transferred_in metrics: ${createdIn}`);
    console.log(`   - Total metrics created: ${createdOut + createdIn}`);
    console.log(`   - Errors: ${errors}\n`);

    // 6. Verify final counts
    const finalCountResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'transferred_out') as total_out,
         COUNT(*) FILTER (WHERE status = 'transferred_in') as total_in
       FROM conversation_metrics
       WHERE status IN ('transferred_out', 'transferred_in')`
    );

    console.log('📊 Final metrics count:');
    console.log(`   - Total transferred_out: ${finalCountResult.rows[0].total_out}`);
    console.log(`   - Total transferred_in: ${finalCountResult.rows[0].total_in}\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
