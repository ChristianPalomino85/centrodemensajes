/**
 * Migration: Create sales_whatsapp_conversions table
 * Tracks conversions from WhatsApp contact to sales
 */

import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

async function up() {
  console.log('Creating sales_whatsapp_conversions table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_whatsapp_conversions (
      id SERIAL PRIMARY KEY,

      -- Sale info
      customer_phone VARCHAR(50) NOT NULL,
      customer_id VARCHAR(50),
      customer_name VARCHAR(255),
      sale_date TIMESTAMP NOT NULL,
      sale_amount DECIMAL(12,2),
      document_number VARCHAR(50),
      area VARCHAR(50),
      seller_name VARCHAR(100),
      ubicacion VARCHAR(50),
      departamento VARCHAR(100),
      provincia VARCHAR(100),
      distrito VARCHAR(100),

      -- WhatsApp contact info
      first_whatsapp_contact_date TIMESTAMP,
      whatsapp_number_id VARCHAR(255),
      whatsapp_display_name VARCHAR(255),
      conversation_id VARCHAR(255),

      -- Conversion metrics
      days_to_conversion INT,
      contacted_via_whatsapp BOOLEAN DEFAULT FALSE,

      -- Metadata
      last_sync_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sales_conv_phone
    ON sales_whatsapp_conversions(customer_phone);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sales_conv_date
    ON sales_whatsapp_conversions(sale_date);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sales_conv_whatsapp_num
    ON sales_whatsapp_conversions(whatsapp_number_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sales_conv_contacted
    ON sales_whatsapp_conversions(contacted_via_whatsapp);
  `);

  console.log('✅ Table sales_whatsapp_conversions created successfully');
}

async function down() {
  console.log('Dropping sales_whatsapp_conversions table...');
  await pool.query('DROP TABLE IF EXISTS sales_whatsapp_conversions CASCADE;');
  console.log('✅ Table dropped');
}

// Run migration
up()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
