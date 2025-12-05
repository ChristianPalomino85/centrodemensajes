// @ts-ignore - pg types not installed
import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

export interface MenuOptionSelection {
  id: number;
  sessionId: string;
  nodeId: string;
  optionId: string;
  optionLabel: string;
  selectedAt: Date;
  metadata?: Record<string, any>;
}

export interface MenuOptionStats {
  nodeId: string;
  optionId: string;
  label: string;
  count: number;
}

/**
 * Save a menu option selection to the database
 */
export async function saveMenuOptionSelection(data: {
  sessionId: string;
  nodeId: string;
  optionId: string;
  optionLabel: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO menu_option_selections (session_id, node_id, option_id, option_label, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, node_id, option_id, selected_at) DO NOTHING`,
      [
        data.sessionId,
        data.nodeId,
        data.optionId,
        data.optionLabel,
        JSON.stringify(data.metadata || {})
      ]
    );
  } catch (error) {
    console.error('[MenuAnalyticsDB] Error saving menu option selection:', error);
    // Don't throw - we don't want to break the flow if analytics fails
  }
}

/**
 * Get menu option statistics
 */
export async function getMenuOptionStats(options?: {
  startDate?: number;
  endDate?: number;
}): Promise<MenuOptionStats[]> {
  try {
    let query = `SELECT
      node_id,
      option_id,
      option_label as option_label,
      COUNT(*)::text as count
     FROM menu_option_selections`;

    const params: any[] = [];
    const whereClauses: string[] = [];

    if (options?.startDate) {
      whereClauses.push(`selected_at >= to_timestamp($${params.length + 1} / 1000.0)`);
      params.push(options.startDate);
    }

    if (options?.endDate) {
      whereClauses.push(`selected_at <= to_timestamp($${params.length + 1} / 1000.0)`);
      params.push(options.endDate);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` GROUP BY node_id, option_id, option_label
     ORDER BY COUNT(*) DESC`;

    const result = await pool.query<{
      node_id: string;
      option_id: string;
      option_label: string;
      count: string;
    }>(query, params);

    return result.rows.map((row: any) => ({
      nodeId: row.node_id,
      optionId: row.option_id,
      label: row.option_label,
      count: parseInt(row.count, 10)
    }));
  } catch (error) {
    console.error('[MenuAnalyticsDB] Error getting menu option stats:', error);
    return [];
  }
}

/**
 * Get menu option selections for a specific session
 */
export async function getSessionMenuSelections(sessionId: string): Promise<MenuOptionSelection[]> {
  try {
    const result = await pool.query<{
      id: number;
      session_id: string;
      node_id: string;
      option_id: string;
      option_label: string;
      selected_at: Date;
      metadata: any;
    }>(
      `SELECT id, session_id, node_id, option_id, option_label, selected_at, metadata
       FROM menu_option_selections
       WHERE session_id = $1
       ORDER BY selected_at DESC`,
      [sessionId]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      nodeId: row.node_id,
      optionId: row.option_id,
      optionLabel: row.option_label,
      selectedAt: row.selected_at,
      metadata: row.metadata
    }));
  } catch (error) {
    console.error('[MenuAnalyticsDB] Error getting session menu selections:', error);
    return [];
  }
}

/**
 * Clear old menu selections (cleanup)
 */
export async function clearOldMenuSelections(olderThanDays: number): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM menu_option_selections
       WHERE selected_at < NOW() - INTERVAL '1 day' * $1`,
      [olderThanDays]
    );

    return result.rowCount || 0;
  } catch (error) {
    console.error('[MenuAnalyticsDB] Error clearing old menu selections:', error);
    return 0;
  }
}
