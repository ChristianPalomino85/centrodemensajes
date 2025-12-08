/**
 * Admin Database - PostgreSQL version
 * Reads admin panel data from PostgreSQL instead of JSON files
 */

import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  max: 20,
});

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  name?: string;
  role: "admin" | "asesor" | "supervisor";
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
  permissions: string[];
}

export interface Queue {
  id: string;
  name: string;
  description: string;
  assignedAdvisors?: string[];
  supervisors?: string[];
  distributionMode?: string;
  status?: string;
}

export interface AdvisorStatus {
  id: string;
  name: string;
  color: string;
  action: "accept" | "redirect" | "pause";
}

export interface WhatsAppNumber {
  numberId: string;
  displayName: string;
  phoneNumber: string;
  queueId: string;
}

class AdminDatabasePostgres {
  async getUsers(): Promise<User[]> {
    const result = await pool.query('SELECT id, username, email, password_hash as password, name, role, created_at, updated_at FROM crm_users');
    return result.rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      password: row.password,
      name: row.name,
      role: row.role,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
    }));
  }

  async getUserById(id: string): Promise<User | null> {
    const result = await pool.query('SELECT id, username, email, password_hash as password, name, role, created_at, updated_at FROM crm_users WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password: row.password,
      name: row.name,
      role: row.role,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
    };
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await pool.query('SELECT id, username, email, password_hash as password, name, role, created_at, updated_at FROM crm_users WHERE username = $1', [username]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password: row.password,
      name: row.name,
      role: row.role,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
    };
  }

  async getRoles(): Promise<Role[]> {
    const result = await pool.query('SELECT id, name, permissions FROM crm_roles');
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      permissions: row.permissions || [],
    }));
  }

  async getQueues(): Promise<Queue[]> {
    const result = await pool.query('SELECT id, name, description FROM crm_queues');
    const queues: Queue[] = [];

    for (const row of result.rows) {
      const assignedAdvisors = await this.getQueueMembers(row.id);
      queues.push({
        id: row.id,
        name: row.name,
        description: row.description || '',
        assignedAdvisors,
        supervisors: [], // TODO: Implement supervisors table/logic
        distributionMode: 'least-busy', // Default mode
        status: 'active', // Default status
      });
    }

    return queues;
  }

  async getQueueById(id: string): Promise<Queue | null> {
    const result = await pool.query('SELECT id, name, description FROM crm_queues WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const assignedAdvisors = await this.getQueueMembers(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      assignedAdvisors,
      supervisors: [], // TODO: Implement supervisors table/logic
      distributionMode: 'least-busy', // Default mode
      status: 'active', // Default status
    };
  }

  async getAdvisorStatuses(): Promise<AdvisorStatus[]> {
    const result = await pool.query('SELECT id, name, color, action FROM crm_advisor_statuses ORDER BY id');
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      color: row.color,
      action: row.action,
    }));
  }

  async getWhatsAppNumbers(): Promise<WhatsAppNumber[]> {
    const result = await pool.query('SELECT number_id, display_name, phone_number, queue_id FROM crm_whatsapp_numbers');
    return result.rows.map(row => ({
      numberId: row.number_id,
      displayName: row.display_name,
      phoneNumber: row.phone_number,
      queueId: row.queue_id,
    }));
  }

  async getQueueMembers(queueId: string): Promise<string[]> {
    const result = await pool.query('SELECT user_id FROM queue_members WHERE queue_id = $1', [queueId]);
    return result.rows.map(row => row.user_id);
  }

  async getUserQueues(userId: string): Promise<string[]> {
    const result = await pool.query('SELECT queue_id FROM queue_members WHERE user_id = $1', [userId]);
    return result.rows.map(row => row.queue_id);
  }

  // Alias methods for compatibility
  async getAllQueues(): Promise<Queue[]> {
    return this.getQueues();
  }

  async getAllUsers(): Promise<User[]> {
    return this.getUsers();
  }

  async getAllWhatsAppNumbers(): Promise<WhatsAppNumber[]> {
    return this.getWhatsAppNumbers();
  }

  async getUser(userId: string): Promise<User | null> {
    return this.getUserById(userId);
  }

  async createUser(data: {
    username: string;
    email: string;
    password: string;
    name?: string;
    role: "admin" | "asesor" | "supervisor";
    status?: string;
  }): Promise<User> {
    const bcrypt = await import('bcrypt');
    const id = `user-${Date.now()}`;
    const createdAt = Date.now();
    const updatedAt = createdAt;

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    await pool.query(
      'INSERT INTO users (id, username, email, password, name, role, status, is_bot, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())',
      [id, data.username, data.email, passwordHash, data.name || '', data.role, data.status || 'active', false]
    );

    return {
      id,
      username: data.username,
      email: data.email,
      password: passwordHash,
      name: data.name || '',
      role: data.role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateUser(id: string, data: {
    username?: string;
    email?: string;
    password?: string;
    name?: string;
    role?: "admin" | "asesor" | "supervisor";
    status?: string;
  }): Promise<User | null> {
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.username !== undefined) {
      updates.push(`username = $${paramIndex++}`);
      values.push(data.username);
    }
    if (data.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(data.email);
    }
    if (data.password !== undefined) {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash(data.password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(passwordHash);
    }
    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(data.role);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }

    if (updates.length === 0) {
      // No updates provided, return current user
      return await this.getUserById(id);
    }

    // Add updated_at timestamp
    updates.push(`updated_at = NOW()`);

    values.push(id);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, email, password, name, role, created_at, updated_at`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      password: row.password,
      name: row.name,
      role: row.role,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async deleteUser(id: string): Promise<boolean> {
    // Prevent deletion of admin users (optional safety check)
    const user = await this.getUserById(id);
    if (user && user.role === 'admin') {
      // Check if this is the last admin
      const allUsers = await this.getAllUsers();
      const adminCount = allUsers.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        return false; // Prevent deletion of last admin
      }
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getAllRoles(): Promise<Role[]> {
    return this.getRoles();
  }

  async getRoleById(id: string): Promise<Role | null> {
    const result = await pool.query('SELECT id, name, permissions FROM crm_roles WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      permissions: row.permissions || [],
    };
  }

  async createRole(data: { name: string; description?: string; permissions: string[] }): Promise<Role> {
    const id = `role-${Date.now()}`;
    await pool.query(
      'INSERT INTO crm_roles (id, name, permissions) VALUES ($1, $2, $3)',
      [id, data.name, JSON.stringify(data.permissions)]
    );

    return {
      id,
      name: data.name,
      permissions: data.permissions,
    };
  }

  async updateRole(id: string, data: { name?: string; description?: string; permissions?: string[] }): Promise<Role | null> {
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.permissions !== undefined) {
      updates.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(data.permissions));
    }

    if (updates.length === 0) {
      // No updates provided, return current role
      return await this.getRoleById(id);
    }

    values.push(id);
    const query = `UPDATE crm_roles SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, permissions`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;

    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      permissions: result.rows[0].permissions || [],
    };
  }

  async deleteRole(id: string): Promise<boolean> {
    // Prevent deletion of system roles
    const systemRoles = ['role-admin', 'role-asesor', 'role-supervisor'];
    if (systemRoles.includes(id)) {
      return false;
    }

    const result = await pool.query('DELETE FROM crm_roles WHERE id = $1', [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getAllAdvisorStatuses(): Promise<AdvisorStatus[]> {
    return this.getAdvisorStatuses();
  }

  async getAdvisorStatus(userId: string): Promise<{ status: AdvisorStatus | null; isManuallyOffline: boolean } | null> {
    const result = await pool.query(`
      SELECT s.id, s.name, s.color, s.action, a.is_manually_offline
      FROM crm_advisor_status_assignments a
      JOIN crm_advisor_statuses s ON a.status_id = s.id
      WHERE a.user_id = $1
    `, [userId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      status: {
        id: row.id,
        name: row.name,
        color: row.color,
        action: row.action,
      },
      isManuallyOffline: row.is_manually_offline || false,
    };
  }

  async getAdvisorStatusById(statusId: string): Promise<AdvisorStatus | null> {
    const result = await pool.query('SELECT id, name, color, action FROM crm_advisor_statuses WHERE id = $1', [statusId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      action: row.action,
    };
  }

  async setAdvisorStatus(userId: string, statusId: string, isManuallyOffline: boolean = false): Promise<any> {
    // 🐛 BUG FIX #2: Check if status actually changed before logging
    // Get current status assignment
    const currentResult = await pool.query(
      'SELECT status_id FROM crm_advisor_status_assignments WHERE user_id = $1',
      [userId]
    );
    const currentStatusId = currentResult.rows.length > 0 ? currentResult.rows[0].status_id : null;
    const statusChanged = currentStatusId !== statusId;

    // Upsert: insert if not exists, update if exists
    await pool.query(`
      INSERT INTO crm_advisor_status_assignments (user_id, status_id, is_manually_offline, updated_at)
      VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()) * 1000)
      ON CONFLICT (user_id)
      DO UPDATE SET
        status_id = $2,
        is_manually_offline = $3,
        updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
    `, [userId, statusId, isManuallyOffline]);

    // 🐛 BUG FIX #2: Only log if status actually changed
    if (statusChanged) {
      const status = await this.getAdvisorStatusById(statusId);
      const user = await this.getUserById(userId);

      await this.logAdvisorActivity(
        userId,
        user?.name || user?.username || userId,
        'status_change',
        statusId,
        status?.name || statusId
      );

      console.log(`[AdminDB] Status changed for ${user?.name || userId}: ${currentStatusId || 'none'} → ${statusId}`);
    } else {
      console.log(`[AdminDB] Status unchanged for ${userId}: ${statusId} (skipping log)`);
    }

    return { userId, statusId, statusChanged };
  }

  async logAdvisorActivity(userId: string, userName: string, eventType: 'login' | 'logout' | 'status_change', statusId?: string, statusName?: string): Promise<void> {
    await pool.query(`
      INSERT INTO advisor_activity_logs (
        user_id, user_name, event_type, status_id, status_name, timestamp, metadata
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
    `, [
      userId,
      userName,
      eventType,
      statusId || null,
      statusName || null,
      JSON.stringify({})
    ]);
  }

  async createQueue(data: {
    name: string;
    description: string;
    status?: string;
    distributionMode?: string;
    maxConcurrent?: number;
    assignedAdvisors?: string[];
  }): Promise<Queue> {
    const id = `queue-${Date.now()}`;

    // Insert queue
    await pool.query(
      'INSERT INTO crm_queues (id, name, description) VALUES ($1, $2, $3)',
      [id, data.name, data.description]
    );

    // Insert assigned advisors if provided
    if (data.assignedAdvisors && data.assignedAdvisors.length > 0) {
      for (const advisorId of data.assignedAdvisors) {
        await pool.query(
          'INSERT INTO queue_members (queue_id, user_id) VALUES ($1, $2) ON CONFLICT (queue_id, user_id) DO NOTHING',
          [id, advisorId]
        );
      }
    }

    return {
      id,
      name: data.name,
      description: data.description,
      assignedAdvisors: data.assignedAdvisors || [],
      supervisors: [],
      distributionMode: data.distributionMode || 'least-busy',
      status: data.status || 'active',
    };
  }

  async updateQueue(id: string, data: {
    name?: string;
    description?: string;
    status?: string;
    distributionMode?: string;
    maxConcurrent?: number;
    assignedAdvisors?: string[];
  }): Promise<Queue | null> {
    // Check if queue exists
    const existing = await this.getQueueById(id);
    if (!existing) return null;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    // Update queue if there are changes
    if (updates.length > 0) {
      values.push(id);
      const query = `UPDATE crm_queues SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      await pool.query(query, values);
    }

    // Update assigned advisors if provided
    if (data.assignedAdvisors !== undefined) {
      // Remove all existing members
      await pool.query('DELETE FROM queue_members WHERE queue_id = $1', [id]);

      // Insert new members
      if (data.assignedAdvisors.length > 0) {
        for (const advisorId of data.assignedAdvisors) {
          await pool.query(
            'INSERT INTO queue_members (queue_id, user_id) VALUES ($1, $2) ON CONFLICT (queue_id, user_id) DO NOTHING',
            [id, advisorId]
          );
        }
      }
    }

    // Return updated queue
    return await this.getQueueById(id);
  }

  async deleteQueue(id: string): Promise<boolean> {
    // First, remove all queue members
    await pool.query('DELETE FROM queue_members WHERE queue_id = $1', [id]);

    // Then delete the queue
    const result = await pool.query('DELETE FROM crm_queues WHERE id = $1', [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async createAdvisorStatus(data: {
    name: string;
    description: string;
    color: string;
    action: "accept" | "redirect" | "pause";
    redirectToQueue?: string;
    isDefault?: boolean;
  }): Promise<any> {
    const id = `status-${Date.now()}`;

    await pool.query(
      'INSERT INTO crm_advisor_statuses (id, name, color, action) VALUES ($1, $2, $3, $4)',
      [id, data.name, data.color, data.action]
    );

    return {
      id,
      name: data.name,
      description: data.description,
      color: data.color,
      action: data.action,
      redirectToQueue: data.redirectToQueue || null,
      isDefault: data.isDefault || false,
    };
  }

  async updateAdvisorStatus(id: string, data: {
    name?: string;
    description?: string;
    color?: string;
    action?: "accept" | "redirect" | "pause";
    redirectToQueue?: string;
    isDefault?: boolean;
    order?: number;
  }): Promise<any | null> {
    // Check if status exists
    const existing = await this.getAdvisorStatusById(id);
    if (!existing) return null;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(data.color);
    }
    if (data.action !== undefined) {
      updates.push(`action = $${paramIndex++}`);
      values.push(data.action);
    }

    if (updates.length === 0) {
      // No updates provided, return current status with additional fields
      return {
        ...existing,
        description: data.description || '',
        redirectToQueue: data.redirectToQueue || null,
        isDefault: data.isDefault || false,
        order: data.order || 0,
      };
    }

    values.push(id);
    const query = `UPDATE crm_advisor_statuses SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, name, color, action`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;

    return {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: data.description || '',
      color: result.rows[0].color,
      action: result.rows[0].action,
      redirectToQueue: data.redirectToQueue || null,
      isDefault: data.isDefault || false,
      order: data.order || 0,
    };
  }

  async deleteAdvisorStatus(id: string): Promise<boolean> {
    // Prevent deletion of system statuses
    const systemStatuses = ['status-available', 'status-busy', 'status-away', 'status-offline'];
    if (systemStatuses.includes(id)) {
      return false;
    }

    // Remove all assignments first
    await pool.query('DELETE FROM crm_advisor_status_assignments WHERE status_id = $1', [id]);

    // Then delete the status
    const result = await pool.query('DELETE FROM crm_advisor_statuses WHERE id = $1', [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async createWhatsAppNumber(data: {
    displayName: string;
    phoneNumber: string;
    queueId?: string;
  }): Promise<WhatsAppNumber> {
    const numberId = `number-${Date.now()}`;

    await pool.query(
      'INSERT INTO crm_whatsapp_numbers (number_id, display_name, phone_number, queue_id) VALUES ($1, $2, $3, $4)',
      [numberId, data.displayName, data.phoneNumber, data.queueId || null]
    );

    return {
      numberId,
      displayName: data.displayName,
      phoneNumber: data.phoneNumber,
      queueId: data.queueId || '',
    };
  }

  async updateWhatsAppNumber(id: string, data: {
    displayName?: string;
    phoneNumber?: string;
    queueId?: string;
  }): Promise<WhatsAppNumber | null> {
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(data.displayName);
    }
    if (data.phoneNumber !== undefined) {
      updates.push(`phone_number = $${paramIndex++}`);
      values.push(data.phoneNumber);
    }
    if (data.queueId !== undefined) {
      updates.push(`queue_id = $${paramIndex++}`);
      values.push(data.queueId || null);
    }

    if (updates.length === 0) {
      // No updates provided, return current number
      const result = await pool.query('SELECT number_id, display_name, phone_number, queue_id FROM crm_whatsapp_numbers WHERE number_id = $1', [id]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        numberId: row.number_id,
        displayName: row.display_name,
        phoneNumber: row.phone_number,
        queueId: row.queue_id || '',
      };
    }

    values.push(id);
    const query = `UPDATE crm_whatsapp_numbers SET ${updates.join(', ')} WHERE number_id = $${paramIndex} RETURNING number_id, display_name, phone_number, queue_id`;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      numberId: row.number_id,
      displayName: row.display_name,
      phoneNumber: row.phone_number,
      queueId: row.queue_id || '',
    };
  }

  async deleteWhatsAppNumber(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM crm_whatsapp_numbers WHERE number_id = $1', [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateCRMFieldConfig(enabledFields: string[]): Promise<any> {
    // For now, just return the config (can be stored in a settings table later)
    return { enabledFields };
  }

  async getSettings(): Promise<any> {
    // Return default settings (can be stored in a settings table later)
    return {
      systemName: 'Flow Builder CRM',
      enableNotifications: true,
      autoAssignChats: true,
    };
  }

  async updateSettings(data: any): Promise<any> {
    // For now, just return the data (can be stored in a settings table later)
    return data;
  }

  async getChatThemePreferences(userId: string): Promise<any | null> {
    try {
      const result = await pool.query(
        'SELECT chat_theme_preferences FROM users WHERE id = $1',
        [userId]
      );
      if (result.rows.length === 0) return null;
      return result.rows[0].chat_theme_preferences;
    } catch (error) {
      console.error('[ChatTheme] Error fetching theme preferences:', error);
      return null;
    }
  }

  async setChatThemePreferences(userId: string, preferences: any): Promise<void> {
    await pool.query(
      'UPDATE users SET chat_theme_preferences = $1 WHERE id = $2',
      [JSON.stringify(preferences), userId]
    );
  }
}

export const adminDb = new AdminDatabasePostgres();
