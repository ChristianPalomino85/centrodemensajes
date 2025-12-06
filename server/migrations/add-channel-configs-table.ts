/**
 * Migración: Crear tabla channel_configs
 * Almacena configuraciones de canales sociales (Instagram, Facebook, WhatsApp, Bitrix)
 * para poder editarlas desde el panel de configuración sin tocar código
 */

import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  password: process.env.POSTGRES_PASSWORD || 'Azaleia.2025',
});

export async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Crear tabla de configuraciones de canales
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_configs (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(50) NOT NULL UNIQUE,
        enabled BOOLEAN DEFAULT false,
        config JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Crear índice para búsquedas rápidas
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_channel_configs_channel
      ON channel_configs(channel);
    `);

    // Insertar configuraciones por defecto
    await client.query(`
      INSERT INTO channel_configs (channel, enabled, config)
      VALUES
        ('whatsapp', false, '{
          "phoneNumberId": "",
          "businessAccountId": "",
          "accessToken": "",
          "verifyToken": "",
          "appSecret": ""
        }'::jsonb),
        ('instagram', false, '{
          "pageId": "",
          "igUserId": "",
          "accessToken": "",
          "appSecret": "",
          "verifyToken": "",
          "enableDM": true,
          "enableComments": true
        }'::jsonb),
        ('facebook', false, '{
          "pageId": "",
          "pageAccessToken": "",
          "accessToken": "",
          "appSecret": "",
          "verifyToken": "",
          "enableMessenger": true,
          "enableComments": true
        }'::jsonb),
        ('bitrix', false, '{
          "webhookUrl": "",
          "connectorId": "flow_builder_connector",
          "domain": "",
          "enableOpenChannels": true,
          "enableCRM": true,
          "autoCreateLeads": true
        }'::jsonb)
      ON CONFLICT (channel) DO NOTHING;
    `);

    // Crear función para actualizar updated_at automáticamente
    await client.query(`
      CREATE OR REPLACE FUNCTION update_channel_configs_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Crear trigger
    await client.query(`
      DROP TRIGGER IF EXISTS trigger_channel_configs_updated_at ON channel_configs;
      CREATE TRIGGER trigger_channel_configs_updated_at
        BEFORE UPDATE ON channel_configs
        FOR EACH ROW
        EXECUTE FUNCTION update_channel_configs_updated_at();
    `);

    await client.query('COMMIT');
    console.log('[Migration] Tabla channel_configs creada exitosamente');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('[Migration] Completada');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Fallida:', err);
      process.exit(1);
    });
}
