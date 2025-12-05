/**
 * Migration: Add performance indexes for high-concurrency operations
 *
 * These indexes optimize:
 * - Queue distribution queries (filtering by queue and status)
 * - Phone number lookups (contact search)
 * - Message history queries (conversation timeline)
 * - Metrics filtering (dashboard queries)
 */

import { Pool, PoolClient } from 'pg';

const indexes = [
  // Queue distribution: filter unassigned conversations by queue
  {
    name: 'idx_conversations_queue_unassigned',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_queue_unassigned
          ON conversations (queue_id, status)
          WHERE assigned_to IS NULL AND status = 'active'`,
    description: 'Optimizes queue distribution for unassigned active conversations',
  },
  // Phone lookups: fast contact search by phone number
  {
    name: 'idx_conversations_phone',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_phone
          ON conversations (contact_phone)`,
    description: 'Optimizes phone number lookups for contact identification',
  },
  // Message history: conversation timeline queries
  {
    name: 'idx_messages_conversation_created',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created
          ON messages (conversation_id, created_at DESC)`,
    description: 'Optimizes message history queries with proper ordering',
  },
  // Metrics filtering: dashboard date-range queries
  {
    name: 'idx_metrics_created_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_created_at
          ON transfer_metrics (created_at DESC)`,
    description: 'Optimizes metrics dashboard filtering by date',
  },
];

export async function runMigration(): Promise<void> {
  console.log('[Migration] 🚀 Starting performance indexes migration...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1, // Single connection for migrations
  });

  let client: PoolClient | null = null;
  let successCount = 0;
  let errorCount = 0;

  try {
    client = await pool.connect();

    for (const index of indexes) {
      try {
        console.log(`[Migration] Creating index: ${index.name}`);
        console.log(`[Migration]   ${index.description}`);

        await client.query(index.sql);
        successCount++;

        console.log(`[Migration] ✅ Index ${index.name} created successfully`);
      } catch (error: any) {
        // Index might already exist (not an error)
        if (error.code === '42P07') {
          console.log(`[Migration] ℹ️ Index ${index.name} already exists, skipping`);
          successCount++;
        } else {
          console.error(`[Migration] ❌ Error creating index ${index.name}:`, error.message);
          errorCount++;
        }
      }
    }

    console.log(`[Migration] 📊 Summary: ${successCount} indexes created/verified, ${errorCount} errors`);
  } finally {
    // IMPORTANT: Only release client in finally block (fixes pool resource leak)
    // Pool.end() should be called separately after all operations complete
    if (client) {
      client.release();
    }
  }

  // Close pool AFTER releasing client (proper cleanup order)
  await pool.end();
  console.log('[Migration] ✅ Migration completed, pool closed');
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('[Migration] Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Migration] Fatal error:', error);
      process.exit(1);
    });
}
