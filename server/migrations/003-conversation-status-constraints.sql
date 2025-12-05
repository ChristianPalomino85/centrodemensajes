/**
 * Migration: Add status constraints and campaign response configuration
 *
 * BLINDAJE: Database-level validation for conversation statuses
 */

-- 1. Add CHECK constraint for valid conversation statuses
-- This prevents invalid status values at the database level
ALTER TABLE crm_conversations
  DROP CONSTRAINT IF EXISTS chk_conversation_status;

ALTER TABLE crm_conversations
  ADD CONSTRAINT chk_conversation_status
  CHECK (status IN ('active', 'attending', 'archived', 'closed'));

COMMENT ON CONSTRAINT chk_conversation_status ON crm_conversations IS
  'Ensures only valid conversation statuses: active, attending, archived, closed';

-- 2. Add campaign response configuration columns
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS post_response_action VARCHAR(50) DEFAULT 'none'
    CHECK (post_response_action IN ('none', 'activate_bot'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS response_bot_flow_id VARCHAR(255);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS post_bot_action VARCHAR(50) DEFAULT 'close'
    CHECK (post_bot_action IN ('close', 'assign_to_queue'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS post_bot_queue_id VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN campaigns.post_response_action IS
  'What to do when client responds: none (keep closed) or activate_bot';

COMMENT ON COLUMN campaigns.response_bot_flow_id IS
  'Flow ID to activate when client responds to campaign message';

COMMENT ON COLUMN campaigns.post_bot_action IS
  'What to do after bot finishes: close or assign_to_queue';

COMMENT ON COLUMN campaigns.post_bot_queue_id IS
  'Queue ID to assign conversation after bot finishes';

-- 3. Create index for campaign response lookup
CREATE INDEX IF NOT EXISTS idx_campaigns_response_config
  ON campaigns(post_response_action, response_bot_flow_id)
  WHERE post_response_action = 'activate_bot';

-- 4. Validate existing data - find any invalid statuses
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM crm_conversations
  WHERE status NOT IN ('active', 'attending', 'archived', 'closed');

  IF invalid_count > 0 THEN
    RAISE WARNING 'Found % conversations with invalid status. Run cleanup query to fix.', invalid_count;
  ELSE
    RAISE NOTICE 'All conversation statuses are valid ✓';
  END IF;
END $$;

-- 5. Cleanup query (commented out - review before running)
-- UPDATE crm_conversations
-- SET status = 'archived'
-- WHERE status NOT IN ('active', 'attending', 'archived', 'closed');
