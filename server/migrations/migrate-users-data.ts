/**
 * Migration: Migrate users data from JSON to PostgreSQL
 * Copies all 14 users (10 humans + 4 bots) from users.json to users table
 */

import { Pool } from 'pg';
import * as fs from 'fs';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  name?: string;
  role: string;
  status: string;
  isBot?: boolean;
  phoneNumberId?: string;
  createdAt?: string;
  updatedAt?: string;
}

async function migrateUsersData() {
  console.log('[Migration] Starting users data migration...');

  try {
    // Read users from JSON file
    const jsonPath = '/opt/flow-builder/data/admin/users.json';
    console.log(`[Migration] Reading users from: ${jsonPath}`);

    if (!fs.existsSync(jsonPath)) {
      throw new Error(`users.json not found at ${jsonPath}`);
    }

    const jsonData = fs.readFileSync(jsonPath, 'utf-8');
    const users: User[] = JSON.parse(jsonData);

    console.log(`[Migration] Found ${users.length} users to migrate`);

    // Count users by type
    const humanUsers = users.filter(u => !u.isBot);
    const botUsers = users.filter(u => u.isBot);
    console.log(`[Migration]   - ${humanUsers.length} human users`);
    console.log(`[Migration]   - ${botUsers.length} bot users`);

    // Migrate each user
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        // Map JSON fields to PostgreSQL columns
        const result = await pool.query(`
          INSERT INTO users (
            id,
            username,
            email,
            password,
            name,
            role,
            status,
            is_bot,
            phone_number_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            password = EXCLUDED.password,
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            is_bot = EXCLUDED.is_bot,
            phone_number_id = EXCLUDED.phone_number_id,
            updated_at = EXCLUDED.updated_at
          RETURNING id
        `, [
          user.id,
          user.username,
          user.email,
          user.password,
          user.name || null,
          user.role,
          user.status,
          user.isBot || false,
          user.phoneNumberId || null,
          user.createdAt ? new Date(user.createdAt) : new Date(),
          user.updatedAt ? new Date(user.updatedAt) : new Date()
        ]);

        successCount++;
        const userType = user.isBot ? 'bot' : 'user';
        console.log(`[Migration] ✅ Migrated ${userType}: ${user.id} (${user.username})`);
      } catch (error: any) {
        failCount++;
        console.error(`[Migration] ❌ Failed to migrate user ${user.id}:`, error.message);
      }
    }

    console.log('\n[Migration] Migration Summary:');
    console.log(`[Migration]   ✅ Success: ${successCount}/${users.length}`);
    console.log(`[Migration]   ❌ Failed: ${failCount}/${users.length}`);

    // Verify migration
    const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log(`[Migration] 🐘 PostgreSQL users table now has ${rows[0].count} users`);

    if (successCount === users.length) {
      console.log('\n[Migration] ✅ All users migrated successfully!');
    } else {
      console.warn('\n[Migration] ⚠️  Some users failed to migrate - please review errors above');
    }

  } catch (error) {
    console.error('[Migration] ❌ Fatal error during migration:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

migrateUsersData()
  .then(() => {
    console.log('[Migration] Users data migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Migration] Migration failed:', error);
    process.exit(1);
  });
