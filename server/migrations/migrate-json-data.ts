#!/usr/bin/env tsx
/**
 * Migration Script: JSON to PostgreSQL
 * Migrates conversation metrics, campaigns, advisor sessions, and scheduled timers
 * from JSON files to PostgreSQL tables
 */

import { readFile, copyFile } from 'fs/promises';
import { join } from 'path';
import pg from 'pg';

const { Pool } = pg;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
});

interface MigrationStats {
  metrics: { total: number; success: number; failed: number };
  campaigns: { total: number; success: number; failed: number };
  campaignDetails: { total: number; success: number; failed: number };
  sessions: { total: number; success: number; failed: number };
  timers: { total: number; success: number; failed: number };
}

const stats: MigrationStats = {
  metrics: { total: 0, success: 0, failed: 0 },
  campaigns: { total: 0, success: 0, failed: 0 },
  campaignDetails: { total: 0, success: 0, failed: 0 },
  sessions: { total: 0, success: 0, failed: 0 },
  timers: { total: 0, success: 0, failed: 0 },
};

/**
 * Backup JSON file before migration
 */
async function backupFile(filePath: string): Promise<void> {
  const timestamp = Date.now();
  const backupPath = `${filePath}.backup-${timestamp}`;
  try {
    await copyFile(filePath, backupPath);
    console.log(`✅ Backup created: ${backupPath}`);
  } catch (error) {
    console.warn(`⚠️  Could not create backup for ${filePath}:`, error);
  }
}

/**
 * Migrate conversation metrics
 */
async function migrateConversationMetrics(): Promise<void> {
  console.log('\n📊 Migrating conversation metrics...');
  const filePath = join(process.cwd(), 'data', 'conversation-metrics.json');

  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    const metrics = parsed.metrics || parsed; // Handle both {metrics: [...]} and [...]
    stats.metrics.total = Array.isArray(metrics) ? metrics.length : 0;

    console.log(`Found ${stats.metrics.total} metrics to migrate`);

    for (const metric of metrics) {
      try {
        await pool.query(
          `INSERT INTO conversation_metrics (
            id, conversation_id, advisor_id, queue_id, channel_type, channel_id,
            started_at, first_response_at, ended_at, message_count, response_count,
            satisfaction_score, tags, status, transferred_to, transferred_from,
            transferred_at, session_duration, average_response_time
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (id) DO UPDATE SET
            ended_at = EXCLUDED.ended_at,
            message_count = EXCLUDED.message_count,
            response_count = EXCLUDED.response_count,
            satisfaction_score = EXCLUDED.satisfaction_score,
            status = EXCLUDED.status,
            session_duration = EXCLUDED.session_duration,
            average_response_time = EXCLUDED.average_response_time,
            updated_at = NOW()`,
          [
            metric.id,
            metric.conversationId,
            metric.advisorId,
            metric.queueId,
            metric.channelType,
            metric.channelId,
            metric.startedAt,
            metric.firstResponseAt,
            metric.endedAt,
            metric.messageCount || 0,
            metric.responseCount || 0,
            metric.satisfactionScore,
            JSON.stringify(metric.tags || []),
            metric.status,
            metric.transferredTo,
            metric.transferredFrom,
            metric.transferredAt,
            metric.sessionDuration,
            metric.averageResponseTime ? Math.round(metric.averageResponseTime) : null,
          ]
        );
        stats.metrics.success++;
      } catch (error) {
        console.error(`❌ Failed to migrate metric ${metric.id}:`, error);
        stats.metrics.failed++;
      }
    }

    console.log(`✅ Metrics: ${stats.metrics.success}/${stats.metrics.total} migrated successfully`);
    await backupFile(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('⚠️  No conversation-metrics.json file found - skipping');
    } else {
      console.error('❌ Error migrating metrics:', error);
      throw error;
    }
  }
}

/**
 * Migrate campaigns and campaign details
 */
async function migrateCampaigns(): Promise<void> {
  console.log('\n📢 Migrating campaigns...');
  const filePath = join(process.cwd(), 'data', 'campaigns.json');

  try {
    const data = await readFile(filePath, 'utf-8');
    const campaignsData = JSON.parse(data);
    const campaigns = campaignsData.campaigns || [];
    const metrics = campaignsData.metrics || {};

    stats.campaigns.total = campaigns.length;
    console.log(`Found ${campaigns.length} campaigns to migrate`);

    for (const campaign of campaigns) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert campaign
        await client.query(
            `INSERT INTO campaigns (
              id, name, whatsapp_number_id, template_name, language, recipients,
              variables, status, created_at, created_by, throttle_rate, started_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              completed_at = EXCLUDED.completed_at,
              db_updated_at = NOW()`,
            [
              campaign.id,
              campaign.name,
              campaign.whatsappNumberId,
              campaign.templateName,
              campaign.language,
              JSON.stringify(campaign.recipients),
              JSON.stringify(campaign.variables || {}),
              campaign.status,
              campaign.createdAt,
              campaign.createdBy,
              campaign.throttleRate,
              campaign.startedAt,
              campaign.completedAt,
            ]
          );

        stats.campaigns.success++;

        // Insert campaign message details if available
        const campaignMetrics = metrics[campaign.id];
        if (campaignMetrics && campaignMetrics.details) {
          for (const detail of campaignMetrics.details) {
            try {
              await client.query(
                `INSERT INTO campaign_message_details (
                  campaign_id, phone, status, sent_at, delivered_at, read_at,
                  responded, clicked_button, error_message, message_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT DO NOTHING`,
                [
                  campaign.id,
                  detail.phone,
                  detail.status,
                  detail.sentAt,
                  detail.deliveredAt,
                  detail.readAt,
                  detail.responded || false,
                  detail.clickedButton || false,
                  detail.errorMessage,
                  detail.messageId,
                ]
              );
              stats.campaignDetails.success++;
            } catch (error) {
              console.error(`❌ Failed to migrate detail for ${detail.phone}:`, error);
              stats.campaignDetails.failed++;
            }
          }
          stats.campaignDetails.total += campaignMetrics.details.length;
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to migrate campaign ${campaign.id}:`, error);
        stats.campaigns.failed++;
      } finally {
        client.release();
      }
    }

    console.log(`✅ Campaigns: ${stats.campaigns.success}/${stats.campaigns.total} migrated successfully`);
    console.log(`✅ Campaign details: ${stats.campaignDetails.success}/${stats.campaignDetails.total} migrated successfully`);
    await backupFile(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('⚠️  No campaigns.json file found - skipping');
    } else {
      console.error('❌ Error migrating campaigns:', error);
      throw error;
    }
  }
}

/**
 * Migrate advisor sessions
 */
async function migrateAdvisorSessions(): Promise<void> {
  console.log('\n👥 Migrating advisor sessions...');
  const filePath = join(process.cwd(), 'data', 'crm-sessions.json');

  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    const sessions = parsed.sessions || parsed; // Handle both {sessions: [...]} and [...]
    stats.sessions.total = Array.isArray(sessions) ? sessions.length : 0;

    console.log(`Found ${stats.sessions.total} sessions to migrate`);

    for (const session of sessions) {
      try {
        await pool.query(
          `INSERT INTO advisor_sessions (
            id, advisor_id, conversation_id, start_time, end_time, duration
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            end_time = EXCLUDED.end_time,
            duration = EXCLUDED.duration,
            updated_at = NOW()`,
          [
            session.id,
            session.advisorId,
            session.conversationId,
            session.startTime,
            session.endTime,
            session.duration,
          ]
        );
        stats.sessions.success++;
      } catch (error) {
        console.error(`❌ Failed to migrate session ${session.id}:`, error);
        stats.sessions.failed++;
      }
    }

    console.log(`✅ Sessions: ${stats.sessions.success}/${stats.sessions.total} migrated successfully`);
    await backupFile(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('⚠️  No crm-sessions.json file found - skipping');
    } else {
      console.error('❌ Error migrating sessions:', error);
      throw error;
    }
  }
}

/**
 * Migrate scheduled timers
 */
async function migrateScheduledTimers(): Promise<void> {
  console.log('\n⏰ Migrating scheduled timers...');
  const filePath = join(process.cwd(), 'data', 'scheduled-timers.json');

  try {
    const data = await readFile(filePath, 'utf-8');
    const timers = JSON.parse(data);
    stats.timers.total = timers.length;

    console.log(`Found ${timers.length} timers to migrate`);

    for (const timer of timers) {
      try {
        await pool.query(
          `INSERT INTO scheduled_timers (
            id, session_id, flow_id, contact_id, channel, next_node_id, node_id,
            execute_at, timer_created_at, executed, executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            executed = EXCLUDED.executed,
            executed_at = EXCLUDED.executed_at,
            updated_at = NOW()`,
          [
            timer.id,
            timer.sessionId,
            timer.flowId,
            timer.contactId,
            timer.channel,
            timer.nextNodeId,
            timer.nodeId,
            timer.executeAt,
            timer.createdAt,
            timer.executed || false,
            timer.executedAt,
          ]
        );
        stats.timers.success++;
      } catch (error) {
        console.error(`❌ Failed to migrate timer ${timer.id}:`, error);
        stats.timers.failed++;
      }
    }

    console.log(`✅ Timers: ${stats.timers.success}/${stats.timers.total} migrated successfully`);
    await backupFile(filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('⚠️  No scheduled-timers.json file found - skipping');
    } else {
      console.error('❌ Error migrating timers:', error);
      throw error;
    }
  }
}

/**
 * Print final statistics
 */
function printStats(): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));

  const total =
    stats.metrics.success +
    stats.campaigns.success +
    stats.campaignDetails.success +
    stats.sessions.success +
    stats.timers.success;

  const failed =
    stats.metrics.failed +
    stats.campaigns.failed +
    stats.campaignDetails.failed +
    stats.sessions.failed +
    stats.timers.failed;

  console.log(`\n✅ Total records migrated: ${total}`);
  console.log(`❌ Total records failed: ${failed}`);
  console.log('\nDetails:');
  console.log(`  📊 Metrics: ${stats.metrics.success}/${stats.metrics.total}`);
  console.log(`  📢 Campaigns: ${stats.campaigns.success}/${stats.campaigns.total}`);
  console.log(`  📝 Campaign Details: ${stats.campaignDetails.success}/${stats.campaignDetails.total}`);
  console.log(`  👥 Sessions: ${stats.sessions.success}/${stats.sessions.total}`);
  console.log(`  ⏰ Timers: ${stats.timers.success}/${stats.timers.total}`);
  console.log('\n' + '='.repeat(60));
}

/**
 * Main migration function
 */
async function main() {
  console.log('🚀 Starting JSON to PostgreSQL migration...\n');

  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful\n');

    // Run migrations
    await migrateConversationMetrics();
    await migrateCampaigns();
    await migrateAdvisorSessions();
    await migrateScheduledTimers();

    // Print statistics
    printStats();

    console.log('\n✅ Migration completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('  1. Update application code to use PostgreSQL');
    console.log('  2. Test the application thoroughly');
    console.log('  3. After 30 days of stable operation, delete backup files');
    console.log('  4. Remove JSON file reading code from the application\n');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
main();
