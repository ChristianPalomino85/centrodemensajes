/**
 * Migration 004: Add campaign_id field to crm_conversations
 *
 * This field allows tracking which campaign/template blast a conversation originated from.
 * Used to categorize mass-sent templates that should go to MASIVOS section.
 */

-- Add campaign_id column to crm_conversations
ALTER TABLE crm_conversations
ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(255);

-- Create index for faster campaign lookups
CREATE INDEX IF NOT EXISTS idx_conv_campaign_id
  ON crm_conversations(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN crm_conversations.campaign_id IS
  'Campaign ID for mass template sends - used to categorize conversations in MASIVOS';
