-- Migration 002: Create tables for transactional data
-- Migrates conversation metrics, campaigns, advisor sessions, and scheduled timers from JSON to PostgreSQL

-- ============================================================================
-- 1. CONVERSATION METRICS
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_metrics (
  id VARCHAR(255) PRIMARY KEY,
  conversation_id VARCHAR(255),
  advisor_id VARCHAR(255),
  queue_id VARCHAR(255),
  channel_type VARCHAR(50),
  channel_id VARCHAR(255),
  started_at BIGINT NOT NULL,
  first_response_at BIGINT,
  ended_at BIGINT,
  message_count INTEGER DEFAULT 0,
  response_count INTEGER DEFAULT 0,
  satisfaction_score INTEGER CHECK (satisfaction_score BETWEEN 1 AND 5 OR satisfaction_score IS NULL),
  tags JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(50),
  transferred_to VARCHAR(255),
  transferred_from VARCHAR(255),
  transferred_at BIGINT,
  session_duration BIGINT,
  average_response_time BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices para conversation_metrics
CREATE INDEX IF NOT EXISTS idx_metrics_conversation ON conversation_metrics(conversation_id);
CREATE INDEX IF NOT EXISTS idx_metrics_advisor ON conversation_metrics(advisor_id);
CREATE INDEX IF NOT EXISTS idx_metrics_started_at ON conversation_metrics(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_status ON conversation_metrics(status);
CREATE INDEX IF NOT EXISTS idx_metrics_queue ON conversation_metrics(queue_id);
CREATE INDEX IF NOT EXISTS idx_metrics_channel ON conversation_metrics(channel_type, channel_id);
CREATE INDEX IF NOT EXISTS idx_metrics_ended_at ON conversation_metrics(ended_at DESC) WHERE ended_at IS NOT NULL;

-- ============================================================================
-- 2. CAMPAIGNS
-- ============================================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  whatsapp_number_id VARCHAR(255),
  template_name VARCHAR(255),
  language VARCHAR(10),
  recipients JSONB NOT NULL,
  variables JSONB,
  status VARCHAR(50) NOT NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(255),
  throttle_rate INTEGER,
  started_at BIGINT,
  completed_at BIGINT,
  db_created_at TIMESTAMP DEFAULT NOW(),
  db_updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices para campaigns
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaign_created_at ON campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_created_by ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_campaign_whatsapp ON campaigns(whatsapp_number_id);

-- ============================================================================
-- 3. CAMPAIGN MESSAGE DETAILS
-- ============================================================================
CREATE TABLE IF NOT EXISTS campaign_message_details (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  sent_at BIGINT,
  delivered_at BIGINT,
  read_at BIGINT,
  responded BOOLEAN DEFAULT FALSE,
  clicked_button BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  message_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Indices para campaign_message_details
CREATE INDEX IF NOT EXISTS idx_campaign_details_campaign ON campaign_message_details(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_details_phone ON campaign_message_details(phone);
CREATE INDEX IF NOT EXISTS idx_campaign_details_status ON campaign_message_details(status);
CREATE INDEX IF NOT EXISTS idx_campaign_details_message_id ON campaign_message_details(message_id);

-- ============================================================================
-- 4. ADVISOR SESSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS advisor_sessions (
  id VARCHAR(255) PRIMARY KEY,
  advisor_id VARCHAR(255) NOT NULL,
  conversation_id VARCHAR(255),
  start_time BIGINT NOT NULL,
  end_time BIGINT,
  duration BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices para advisor_sessions
CREATE INDEX IF NOT EXISTS idx_sessions_advisor ON advisor_sessions(advisor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON advisor_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON advisor_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_end_time ON advisor_sessions(end_time DESC) WHERE end_time IS NOT NULL;

-- ============================================================================
-- 5. SCHEDULED TIMERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheduled_timers (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  flow_id VARCHAR(255) NOT NULL,
  contact_id VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  next_node_id VARCHAR(255) NOT NULL,
  node_id VARCHAR(255) NOT NULL,
  execute_at BIGINT NOT NULL,
  timer_created_at BIGINT NOT NULL,
  executed BOOLEAN DEFAULT FALSE,
  executed_at BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indices para scheduled_timers
CREATE INDEX IF NOT EXISTS idx_timers_execute_at ON scheduled_timers(execute_at) WHERE NOT executed;
CREATE INDEX IF NOT EXISTS idx_timers_session ON scheduled_timers(session_id);
CREATE INDEX IF NOT EXISTS idx_timers_flow ON scheduled_timers(flow_id);
CREATE INDEX IF NOT EXISTS idx_timers_contact ON scheduled_timers(contact_id);
CREATE INDEX IF NOT EXISTS idx_timers_executed ON scheduled_timers(executed);

-- ============================================================================
-- VIEWS FOR ANALYTICS
-- ============================================================================

-- Vista para estadísticas de campañas agregadas
CREATE OR REPLACE VIEW campaign_stats AS
SELECT
  c.id as campaign_id,
  c.name as campaign_name,
  c.status,
  c.created_at,
  c.created_by,
  jsonb_array_length(c.recipients) as total_recipients,
  COUNT(cmd.id) as total_sent,
  COUNT(cmd.id) FILTER (WHERE cmd.status = 'delivered') as delivered,
  COUNT(cmd.id) FILTER (WHERE cmd.status = 'read') as read,
  COUNT(cmd.id) FILTER (WHERE cmd.status = 'failed') as failed,
  COUNT(cmd.id) FILTER (WHERE cmd.responded = true) as responded,
  COUNT(cmd.id) FILTER (WHERE cmd.clicked_button = true) as clicked
FROM campaigns c
LEFT JOIN campaign_message_details cmd ON c.id = cmd.campaign_id
GROUP BY c.id, c.name, c.status, c.created_at, c.created_by, c.recipients;

-- Vista para métricas diarias de conversaciones
CREATE OR REPLACE VIEW daily_conversation_metrics AS
SELECT
  DATE(to_timestamp(started_at / 1000)) as date,
  COUNT(*) as total_conversations,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'active') as active,
  AVG(session_duration) as avg_duration,
  AVG(message_count) as avg_messages,
  AVG(average_response_time) as avg_response_time,
  COUNT(DISTINCT advisor_id) as unique_advisors
FROM conversation_metrics
GROUP BY DATE(to_timestamp(started_at / 1000))
ORDER BY date DESC;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para cada tabla
CREATE TRIGGER update_conversation_metrics_updated_at
  BEFORE UPDATE ON conversation_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_details_updated_at
  BEFORE UPDATE ON campaign_message_details
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_advisor_sessions_updated_at
  BEFORE UPDATE ON advisor_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_timers_updated_at
  BEFORE UPDATE ON scheduled_timers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE conversation_metrics IS 'Métricas de conversaciones para análisis y reportes';
COMMENT ON TABLE campaigns IS 'Campañas de WhatsApp con plantillas y destinatarios';
COMMENT ON TABLE campaign_message_details IS 'Detalles de envío por mensaje individual de cada campaña';
COMMENT ON TABLE advisor_sessions IS 'Sesiones de asesores para tracking de tiempo y productividad';
COMMENT ON TABLE scheduled_timers IS 'Timers programados para ejecución diferida en flujos';

COMMENT ON VIEW campaign_stats IS 'Estadísticas agregadas de campañas con métricas de envío';
COMMENT ON VIEW daily_conversation_metrics IS 'Métricas diarias de conversaciones para dashboards';
