-- Migration 005: Add Ad Tracking Fields
-- Agrega campos para rastrear conversiones desde anuncios de Facebook/Instagram

-- Agregar columnas de tracking de anuncios a crm_conversations
ALTER TABLE crm_conversations
  ADD COLUMN IF NOT EXISTS ad_source_url TEXT,           -- URL del anuncio/post de Facebook
  ADD COLUMN IF NOT EXISTS ad_source_id VARCHAR(255),    -- ID del anuncio (Ad ID)
  ADD COLUMN IF NOT EXISTS ad_source_type VARCHAR(50),   -- "ad" o "post"
  ADD COLUMN IF NOT EXISTS ad_headline TEXT,             -- Título del anuncio
  ADD COLUMN IF NOT EXISTS ad_body TEXT,                 -- Descripción del anuncio
  ADD COLUMN IF NOT EXISTS ad_media_type VARCHAR(50),    -- "image" o "video"
  ADD COLUMN IF NOT EXISTS ad_image_url TEXT,            -- URL de imagen del anuncio
  ADD COLUMN IF NOT EXISTS ad_video_url TEXT,            -- URL de video del anuncio
  ADD COLUMN IF NOT EXISTS ad_thumbnail_url TEXT,        -- URL de thumbnail
  ADD COLUMN IF NOT EXISTS ad_ctwa_clid VARCHAR(500);    -- Click ID de Meta (CRÍTICO para medir ROI)

-- Crear índices para facilitar consultas de tracking
CREATE INDEX IF NOT EXISTS idx_conv_ad_source_id ON crm_conversations(ad_source_id);
CREATE INDEX IF NOT EXISTS idx_conv_ad_ctwa_clid ON crm_conversations(ad_ctwa_clid);
CREATE INDEX IF NOT EXISTS idx_conv_ad_source_type ON crm_conversations(ad_source_type);

-- Comentarios
COMMENT ON COLUMN crm_conversations.ad_source_url IS 'URL del anuncio o post de Facebook/Instagram que generó la conversación';
COMMENT ON COLUMN crm_conversations.ad_source_id IS 'ID del anuncio de Facebook/Instagram';
COMMENT ON COLUMN crm_conversations.ad_source_type IS 'Tipo de origen: "ad" (anuncio) o "post" (publicación orgánica)';
COMMENT ON COLUMN crm_conversations.ad_ctwa_clid IS 'Click ID de Meta para rastreo de conversiones (Click-to-WhatsApp Ads)';
