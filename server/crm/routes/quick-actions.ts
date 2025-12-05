/**
 * Quick Actions Routes
 * API for managing advisor quick actions (minibots/scripts)
 */
import { Router, Request, Response } from "express";
import { pool } from "../db-postgres";
import { requireAuth } from "../../auth/middleware";

const router = Router();

// Types
export type QuickActionType = 'send_files' | 'send_text' | 'send_template' | 'composite';

export interface QuickActionConfig {
  // For send_files
  fileIds?: string[];
  fileFilters?: {
    category?: string;
    brand?: string;
    withPrices?: boolean;
  };
  // Custom display names for files (fileId -> displayName)
  fileDisplayNames?: Record<string, string>;
  // For send_text
  text?: string;
  // For composite - mix of text, files, and delays
  steps?: Array<{
    type: 'text' | 'file' | 'delay';
    content?: string;           // For text steps
    fileId?: string;            // For file steps (legacy)
    attachmentId?: string;      // For file steps (attachment ID)
    caption?: string;           // Caption for file
    displayName?: string;       // Display name for file
    delayMs?: number;           // For delay steps
  }>;
}

export interface QuickAction {
  id: string;
  userId: string;
  name: string;
  command: string | null;
  icon: string;
  type: QuickActionType;
  config: QuickActionConfig;
  delayBetweenMs: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// Helper to generate command from name
function generateCommand(name: string): string {
  return '/' + name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s-]/g, '')    // Remove special chars
    .trim()
    .replace(/\s+/g, '-')            // Spaces to dashes
    .substring(0, 45);               // Max length
}

// Map DB row to QuickAction
function mapRowToAction(row: any): QuickAction {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    command: row.command,
    icon: row.icon || '⚡',
    type: row.type as QuickActionType,
    config: row.config || {},
    delayBetweenMs: row.delay_between_ms || 500,
    enabled: row.enabled !== false,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/crm/quick-actions
 * Get all quick actions for the current user
 */
router.get("/", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM quick_actions
       WHERE user_id = $1
       ORDER BY sort_order ASC, created_at DESC`,
      [userId]
    );

    const actions = result.rows.map(mapRowToAction);
    res.json({ actions });
  } catch (error) {
    console.error("[QuickActions] Error fetching actions:", error);
    res.status(500).json({ error: "Failed to fetch actions" });
  }
});

/**
 * GET /api/crm/quick-actions/:id
 * Get a specific quick action
 */
router.get("/:id", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM quick_actions WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    res.json({ action: mapRowToAction(result.rows[0]) });
  } catch (error) {
    console.error("[QuickActions] Error fetching action:", error);
    res.status(500).json({ error: "Failed to fetch action" });
  }
});

/**
 * POST /api/crm/quick-actions
 * Create a new quick action
 */
router.post("/", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { name, command, icon, type, config, delayBetweenMs, enabled } = req.body;

    // Validate required fields
    if (!name || !type) {
      res.status(400).json({ error: "Missing required fields: name, type" });
      return;
    }

    // Validate type
    const validTypes: QuickActionType[] = ['send_files', 'send_text', 'send_template', 'composite'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    // Generate command if not provided
    const finalCommand = command || generateCommand(name);

    // Check if command already exists for this user
    const existingCommand = await pool.query(
      `SELECT id FROM quick_actions WHERE command = $1 AND user_id = $2`,
      [finalCommand, userId]
    );
    if (existingCommand.rows.length > 0) {
      res.status(400).json({ error: "Command already exists" });
      return;
    }

    // Get max sort order
    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM quick_actions WHERE user_id = $1`,
      [userId]
    );

    const result = await pool.query(
      `INSERT INTO quick_actions (user_id, name, command, icon, type, config, delay_between_ms, enabled, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        name,
        finalCommand,
        icon || '⚡',
        type,
        JSON.stringify(config || {}),
        delayBetweenMs || 500,
        enabled !== false,
        maxOrder.rows[0].next_order
      ]
    );

    const action = mapRowToAction(result.rows[0]);
    console.log(`[QuickActions] Created action "${name}" for user ${userId}`);
    res.status(201).json({ action });
  } catch (error) {
    console.error("[QuickActions] Error creating action:", error);
    res.status(500).json({ error: "Failed to create action" });
  }
});

/**
 * PUT /api/crm/quick-actions/:id
 * Update a quick action
 */
router.put("/:id", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { name, command, icon, type, config, delayBetweenMs, enabled } = req.body;

    // Verify ownership
    const existing = await pool.query(
      `SELECT * FROM quick_actions WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    // Check command uniqueness if changed
    if (command && command !== existing.rows[0].command) {
      const existingCommand = await pool.query(
        `SELECT id FROM quick_actions WHERE command = $1 AND user_id = $2 AND id != $3`,
        [command, userId, id]
      );
      if (existingCommand.rows.length > 0) {
        res.status(400).json({ error: "Command already exists" });
        return;
      }
    }

    const result = await pool.query(
      `UPDATE quick_actions
       SET name = COALESCE($1, name),
           command = COALESCE($2, command),
           icon = COALESCE($3, icon),
           type = COALESCE($4, type),
           config = COALESCE($5, config),
           delay_between_ms = COALESCE($6, delay_between_ms),
           enabled = COALESCE($7, enabled),
           updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        name,
        command,
        icon,
        type,
        config ? JSON.stringify(config) : null,
        delayBetweenMs,
        enabled,
        id,
        userId
      ]
    );

    const action = mapRowToAction(result.rows[0]);
    console.log(`[QuickActions] Updated action "${action.name}" (${id})`);
    res.json({ action });
  } catch (error) {
    console.error("[QuickActions] Error updating action:", error);
    res.status(500).json({ error: "Failed to update action" });
  }
});

/**
 * DELETE /api/crm/quick-actions/:id
 * Delete a quick action
 */
router.delete("/:id", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM quick_actions WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    console.log(`[QuickActions] Deleted action "${result.rows[0].name}" (${id})`);
    res.json({ success: true });
  } catch (error) {
    console.error("[QuickActions] Error deleting action:", error);
    res.status(500).json({ error: "Failed to delete action" });
  }
});

/**
 * POST /api/crm/quick-actions/reorder
 * Reorder quick actions
 */
router.post("/reorder", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: "orderedIds must be an array" });
      return;
    }

    // Update sort_order for each action
    for (let i = 0; i < orderedIds.length; i++) {
      await pool.query(
        `UPDATE quick_actions SET sort_order = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
        [i, orderedIds[i], userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[QuickActions] Error reordering actions:", error);
    res.status(500).json({ error: "Failed to reorder actions" });
  }
});

/**
 * POST /api/crm/quick-actions/:id/toggle
 * Toggle action enabled/disabled
 */
router.post("/:id/toggle", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE quick_actions
       SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    const action = mapRowToAction(result.rows[0]);
    res.json({ action });
  } catch (error) {
    console.error("[QuickActions] Error toggling action:", error);
    res.status(500).json({ error: "Failed to toggle action" });
  }
});

/**
 * POST /api/crm/quick-actions/:id/execute
 * Execute a quick action
 */
router.post("/:id/execute", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { conversationId } = req.body;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!conversationId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }

    // Get the action
    const actionResult = await pool.query(
      `SELECT * FROM quick_actions WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (actionResult.rows.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    const action = mapRowToAction(actionResult.rows[0]);

    if (!action.enabled) {
      res.status(400).json({ error: "Action is disabled" });
      return;
    }

    // Get conversation for context
    const { crmDb } = await import("../db-postgres");
    const conversation = await crmDb.getConversationById(conversationId);

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Execute the action
    const { executeQuickAction } = await import("../services/quick-action-executor");
    const result = await executeQuickAction(action, {
      conversationId,
      userId,
      phone: conversation.phone,
      channelConnectionId: conversation.channelConnectionId,
    });

    console.log(`[QuickActions] Executed "${action.name}": ${result.messagesSent} messages sent`);

    res.json({
      success: result.success,
      messagesSent: result.messagesSent,
      errors: result.errors,
      details: result.details,
    });
  } catch (error: any) {
    console.error("[QuickActions] Error executing action:", error);
    res.status(500).json({ error: "Failed to execute action", message: error.message });
  }
});

/**
 * POST /api/crm/quick-actions/execute-by-command
 * Execute a quick action by command (for slash commands)
 */
router.post("/execute-by-command", requireAuth, async (req: Request, res) => {
  try {
    const userId = req.user?.userId;
    const { command, conversationId } = req.body;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!command || !conversationId) {
      res.status(400).json({ error: "command and conversationId are required" });
      return;
    }

    // Normalize command (ensure it starts with /)
    const normalizedCommand = command.startsWith('/') ? command : '/' + command;

    // Find action by command
    const actionResult = await pool.query(
      `SELECT * FROM quick_actions WHERE command = $1 AND user_id = $2`,
      [normalizedCommand, userId]
    );

    if (actionResult.rows.length === 0) {
      res.status(404).json({ error: "Action not found for this command" });
      return;
    }

    const action = mapRowToAction(actionResult.rows[0]);

    if (!action.enabled) {
      res.status(400).json({ error: "Action is disabled" });
      return;
    }

    // Get conversation for context
    const { crmDb } = await import("../db-postgres");
    const conversation = await crmDb.getConversationById(conversationId);

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Execute the action
    const { executeQuickAction } = await import("../services/quick-action-executor");
    const result = await executeQuickAction(action, {
      conversationId,
      userId,
      phone: conversation.phone,
      channelConnectionId: conversation.channelConnectionId,
    });

    console.log(`[QuickActions] Executed by command "${command}": ${result.messagesSent} messages sent`);

    res.json({
      success: result.success,
      messagesSent: result.messagesSent,
      errors: result.errors,
      details: result.details,
      actionName: action.name,
    });
  } catch (error: any) {
    console.error("[QuickActions] Error executing action by command:", error);
    res.status(500).json({ error: "Failed to execute action", message: error.message });
  }
});

export default router;
