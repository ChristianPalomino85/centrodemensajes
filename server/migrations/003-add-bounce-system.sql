-- Migration 003: Add Bounce System for Queue Messages
-- Adds fields to support automatic bouncing of unaccepted messages between advisors

-- Add new columns to crm_conversations
ALTER TABLE crm_conversations
ADD COLUMN IF NOT EXISTS assigned_to_advisor VARCHAR(255),
ADD COLUMN IF NOT EXISTS assigned_to_advisor_at BIGINT,
ADD COLUMN IF NOT EXISTS bounce_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_bounce_at BIGINT;

-- Create index for quick lookups by assigned_to_advisor
CREATE INDEX IF NOT EXISTS idx_conv_assigned_to_advisor ON crm_conversations(assigned_to_advisor);
CREATE INDEX IF NOT EXISTS idx_conv_queue_bounce ON crm_conversations(queue_id, assigned_to_advisor_at) WHERE queue_id IS NOT NULL;

-- Create settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);

-- Insert default bounce settings
INSERT INTO system_settings (key, value)
VALUES (
    'bounce_config',
    '{
        "enabled": true,
        "bounceTimeMinutes": 10,
        "maxBounces": 5,
        "strategy": "round-robin"
    }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN crm_conversations.assigned_to_advisor IS 'Asesor a quien está visible el mensaje en NUEVOS MENSAJES';
COMMENT ON COLUMN crm_conversations.assigned_to_advisor_at IS 'Timestamp cuando se asignó al asesor actual';
COMMENT ON COLUMN crm_conversations.bounce_count IS 'Número de veces que el mensaje ha rebotado';
COMMENT ON COLUMN crm_conversations.last_bounce_at IS 'Timestamp del último rebote';
COMMENT ON TABLE system_settings IS 'Configuraciones globales del sistema';
