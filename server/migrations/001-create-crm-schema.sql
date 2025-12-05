-- Migration 001: Create CRM Schema
-- Crea las tablas necesarias para el CRM con todos los campos actuales

-- Drop existing tables if needed (commented out for safety)
-- DROP TABLE IF EXISTS crm_messages CASCADE;
-- DROP TABLE IF EXISTS crm_conversations CASCADE;
-- DROP TABLE IF EXISTS crm_attachments CASCADE;

-- Create conversations table
CREATE TABLE IF NOT EXISTS crm_conversations (
    id VARCHAR(255) PRIMARY KEY,
    phone VARCHAR(50) NOT NULL,
    contact_name VARCHAR(255),
    bitrix_id VARCHAR(100),
    bitrix_document JSONB,
    avatar_url TEXT,
    last_message_at BIGINT,
    last_message_preview TEXT,
    unread INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    assigned_to VARCHAR(255),
    assigned_at BIGINT,
    queued_at BIGINT,
    queue_id VARCHAR(255),
    channel VARCHAR(50) DEFAULT 'whatsapp',
    channel_connection_id VARCHAR(255),
    phone_number_id VARCHAR(255),
    display_number VARCHAR(50),
    attended_by JSONB DEFAULT '[]'::jsonb,
    ticket_number INTEGER,
    bot_started_at BIGINT,
    bot_flow_id VARCHAR(255),
    read_at BIGINT,
    transferred_from VARCHAR(255),
    transferred_at BIGINT,
    active_advisors JSONB DEFAULT '[]'::jsonb,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
    updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);

-- Create indexes for conversations
CREATE INDEX IF NOT EXISTS idx_conv_phone ON crm_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conv_status ON crm_conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_assigned_to ON crm_conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_conv_queue_id ON crm_conversations(queue_id);
CREATE INDEX IF NOT EXISTS idx_conv_channel_conn ON crm_conversations(channel_connection_id);
CREATE INDEX IF NOT EXISTS idx_conv_phone_channel ON crm_conversations(phone, channel, phone_number_id);

-- Create messages table
CREATE TABLE IF NOT EXISTS crm_messages (
    id VARCHAR(255) PRIMARY KEY,
    conversation_id VARCHAR(255) NOT NULL REFERENCES crm_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    type VARCHAR(50) DEFAULT 'text',
    text TEXT,
    media_url TEXT,
    media_thumb TEXT,
    replied_to_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'sent',
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
    metadata JSONB,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);

-- Create indexes for messages
CREATE INDEX IF NOT EXISTS idx_msg_conversation_id ON crm_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_timestamp ON crm_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_msg_direction ON crm_messages(direction);

-- Create attachments table
CREATE TABLE IF NOT EXISTS crm_attachments (
    id VARCHAR(255) PRIMARY KEY,
    message_id VARCHAR(255) NOT NULL REFERENCES crm_messages(id) ON DELETE CASCADE,
    type VARCHAR(50),
    url TEXT,
    thumbnail TEXT,
    filename VARCHAR(500),
    mimetype VARCHAR(100),
    size BIGINT,
    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);

-- Create indexes for attachments
CREATE INDEX IF NOT EXISTS idx_att_message_id ON crm_attachments(message_id);

-- Create trigger to update last_message_at
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE crm_conversations
    SET last_message_at = NEW.timestamp,
        updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_last_message ON crm_messages;
CREATE TRIGGER trg_update_last_message
    AFTER INSERT ON crm_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_last_message();

COMMENT ON TABLE crm_conversations IS 'Conversaciones del CRM multicanal';
COMMENT ON TABLE crm_messages IS 'Mensajes de las conversaciones';
COMMENT ON TABLE crm_attachments IS 'Adjuntos de los mensajes';
