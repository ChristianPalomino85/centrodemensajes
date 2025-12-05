-- Migration: Add RAG usage tracking
-- Created: 2025-11-14

CREATE TABLE IF NOT EXISTS rag_usage (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  category VARCHAR(50),
  chunks_used INTEGER DEFAULT 0,
  found BOOLEAN DEFAULT false,

  -- Cost breakdown
  embedding_cost_usd DECIMAL(10, 6) DEFAULT 0,
  completion_cost_usd DECIMAL(10, 6) DEFAULT 0,
  total_cost_usd DECIMAL(10, 6) DEFAULT 0,

  -- Context
  advisor_id VARCHAR(255),
  advisor_name VARCHAR(255),
  conversation_id VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_name VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_rag_usage_created_at ON rag_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_rag_usage_advisor ON rag_usage(advisor_id);
CREATE INDEX IF NOT EXISTS idx_rag_usage_conversation ON rag_usage(conversation_id);

-- Add comment
COMMENT ON TABLE rag_usage IS 'Tracks RAG (Retrieval-Augmented Generation) usage and costs';
COMMENT ON COLUMN rag_usage.embedding_cost_usd IS 'Cost of embedding search (text-embedding-3-small)';
COMMENT ON COLUMN rag_usage.completion_cost_usd IS 'Cost of GPT completion for answer generation';
COMMENT ON COLUMN rag_usage.total_cost_usd IS 'Total cost (embedding + completion)';
