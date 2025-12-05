/**
 * Admin API Routes
 * Handles users, roles, queues, CRM field config, and general settings
 */

import { Router } from "express";
import { adminDb } from "../admin-db";
import { validateBody, validateParams } from "../middleware/validate";
import { createUserSchema, updateUserSchema, userIdSchema } from "../schemas/validation";
import logger from "../utils/logger";
import { getCrmGateway } from "../crm/ws";
import { requireAdmin, requireSupervisor } from "../middleware/roles";
import { advisorPresence } from "../crm/advisor-presence";

export function createAdminRouter(): Router {
  const router = Router();

  // ============================================
  // USERS ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/users
   * Get all users
   */
  router.get("/users", async (req, res) => {
    try {
      const users = await adminDb.getAllUsers();
      res.json({ users });
    } catch (error) {
      logger.error("[Admin] Error getting users:", error);
      res.status(500).json({ error: "Failed to get users" });
    }
  });

  /**
   * GET /api/admin/users/:id
   * Get user by ID
   */
  router.get("/users/:id", validateParams(userIdSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const user = await adminDb.getUserById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user });
    } catch (error) {
      logger.error("[Admin] Error getting user:", error);
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  /**
   * POST /api/admin/users
   * Create new user
   */
  router.post("/users", requireAdmin, validateBody(createUserSchema), async (req, res) => {
    try {
      const { username, email, password, name, role, status } = req.body;

      // Check if username already exists
      const existingUser = await adminDb.getUserByUsername(username);
       if(existingUser) {
        res.status(409).json({ error: "Username already exists" });
        return;
      }

      const user = await adminDb.createUser({
        username,
        email,
        password,
        name,
        role,
        status, // Will be "active" by default from schema
      });

      res.status(201).json({ user });
    } catch (error) {
      logger.error("[Admin] Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  /**
   * PUT /api/admin/users/:id
   * Update user
   */
  router.put("/users/:id", requireAdmin, validateParams(userIdSchema), validateBody(updateUserSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const user = await adminDb.updateUser(id, updates);

       if(!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ user });
    } catch (error) {
      logger.error("[Admin] Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  /**
   * DELETE /api/admin/users/:id
   * Delete user
   */
  router.delete("/users/:id", requireAdmin, validateParams(userIdSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await adminDb.deleteUser(id);

       if(!deleted) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("[Admin] Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ============================================
  // ROLES ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/roles
   * Get all roles
   */
  router.get("/roles", async (req, res) => {
    try {
      const roles = await adminDb.getAllRoles();
      res.json({ roles });
    } catch (error) {
      logger.error("[Admin] Error getting roles:", error);
      res.status(500).json({ error: "Failed to get roles" });
    }
  });

  /**
   * GET /api/admin/roles/:id
   * Get role by ID
   */
  router.get("/roles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const role = await adminDb.getRoleById(id);
       if(!role) {
        res.status(404).json({ error: "Role not found" });
        return;
      }
      res.json({ role });
    } catch (error) {
      console.error("[Admin] Error getting role:", error);
      res.status(500).json({ error: "Failed to get role" });
    }
  });

  /**
   * POST /api/admin/roles
   * Create new role
   */
  router.post("/roles", requireAdmin, async (req, res) => {
    try {
      const { name, description, permissions } = req.body;

       if(!name || !description) {
        res.status(400).json({ error: "Name and description are required" });
        return;
      }

      const role = await adminDb.createRole({
        name,
        description,
        permissions: permissions || [],
      });

      res.status(201).json({ role });
    } catch (error) {
      console.error("[Admin] Error creating role:", error);
      res.status(500).json({ error: "Failed to create role" });
    }
  });

  /**
   * PUT /api/admin/roles/:id
   * Update role
   */
  router.put("/roles/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, permissions } = req.body;

      const role = await adminDb.updateRole(id, {
        name,
        description,
        permissions,
      });

       if(!role) {
        res.status(404).json({ error: "Role not found" });
        return;
      }

      res.json({ role });
    } catch (error) {
      console.error("[Admin] Error updating role:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  /**
   * DELETE /api/admin/roles/:id
   * Delete role
   */
  router.delete("/roles/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await adminDb.deleteRole(id);

       if(!deleted) {
        res.status(400).json({ error: "Cannot delete default system roles" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting role:", error);
      res.status(500).json({ error: "Failed to delete role" });
    }
  });

  // ============================================
  // QUEUES ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/queues
   * Get all queues
   */
  router.get("/queues", async (req, res) => {
    try {
      const queues = await adminDb.getAllQueues();
      res.json({ queues });
    } catch (error) {
      console.error("[Admin] Error getting queues:", error);
      res.status(500).json({ error: "Failed to get queues" });
    }
  });

  /**
   * GET /api/admin/queues/:id
   * Get queue by ID
   */
  router.get("/queues/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const queue = await adminDb.getQueueById(id);
       if(!queue) {
        res.status(404).json({ error: "Queue not found" });
        return;
      }
      res.json({ queue });
    } catch (error) {
      console.error("[Admin] Error getting queue:", error);
      res.status(500).json({ error: "Failed to get queue" });
    }
  });

  /**
   * POST /api/admin/queues
   * Create new queue
   */
  router.post("/queues", requireSupervisor, async (req, res) => {
    try {
      const { name, description, status, distributionMode, maxConcurrent, assignedAdvisors } = req.body;

       if(!name || !description) {
        res.status(400).json({ error: "Name and description are required" });
        return;
      }

      const queue = await adminDb.createQueue({
        name,
        description,
        status: status || "active",
        distributionMode: distributionMode || "round-robin",
        maxConcurrent: maxConcurrent || 5,
        assignedAdvisors: assignedAdvisors || [],
      });

      res.status(201).json({ queue });
    } catch (error) {
      console.error("[Admin] Error creating queue:", error);
      res.status(500).json({ error: "Failed to create queue" });
    }
  });

  /**
   * PUT /api/admin/queues/:id
   * Update queue
   */
  router.put("/queues/:id", requireSupervisor, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, status, distributionMode, maxConcurrent, assignedAdvisors } = req.body;

      const queue = await adminDb.updateQueue(id, {
        name,
        description,
        status,
        distributionMode,
        maxConcurrent,
        assignedAdvisors,
      });

       if(!queue) {
        res.status(404).json({ error: "Queue not found" });
        return;
      }

      res.json({ queue });
    } catch (error) {
      console.error("[Admin] Error updating queue:", error);
      res.status(500).json({ error: "Failed to update queue" });
    }
  });

  /**
   * DELETE /api/admin/queues/:id
   * Delete queue
   */
  router.delete("/queues/:id", requireSupervisor, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await adminDb.deleteQueue(id);

       if(!deleted) {
        res.status(404).json({ error: "Queue not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting queue:", error);
      res.status(500).json({ error: "Failed to delete queue" });
    }
  });

  // ============================================
  // CRM FIELD CONFIG ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/crm-fields
   * Get CRM field configuration
   */
  router.get("/crm-fields", async (req, res) => {
    try {
      // Return default enabled fields for now (all enabled)
      const config = {
        enabledFields: ['contactName', 'phone', 'email', 'document', 'address', 'notes']
      };
      res.json({ config });
    } catch (error) {
      console.error("[Admin] Error getting CRM field config:", error);
      res.status(500).json({ error: "Failed to get CRM field config" });
    }
  });

  /**
   * PUT /api/admin/crm-fields
   * Update CRM field configuration
   */
  router.put("/crm-fields", requireAdmin, async (req, res) => {
    try {
      const { enabledFields } = req.body;

       if(!Array.isArray(enabledFields)) {
        res.status(400).json({ error: "enabledFields must be an array" });
        return;
      }

      const config = await adminDb.updateCRMFieldConfig(enabledFields);
      res.json({ config });
    } catch (error) {
      console.error("[Admin] Error updating CRM field config:", error);
      res.status(500).json({ error: "Failed to update CRM field config" });
    }
  });

  // ============================================
  // SETTINGS ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/settings
   * Get general settings
   */
  router.get("/settings", requireAdmin, async (req, res) => {
    try {
      const settings = await adminDb.getSettings();
      res.json({ settings });
    } catch (error) {
      console.error("[Admin] Error getting settings:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  /**
   * PUT /api/admin/settings
   * Update general settings
   */
  router.put("/settings", requireAdmin, async (req, res) => {
    try {
      const settings = await adminDb.updateSettings(req.body);
      res.json({ settings });
    } catch (error) {
      console.error("[Admin] Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ============================================
  // ADVISORS LIST (for queue assignment)
  // ============================================

  /**
   * GET /api/admin/advisors
   * Get list of advisors (users with role asesor or supervisor)
   */
  router.get("/advisors", async (req, res) => {
    try {
      const { advisorPresence } = await import("../crm/advisor-presence");
      const allUsers = await adminDb.getAllUsers();
      const advisors = allUsers
        .filter((user) => user.role === "asesor" || user.role === "supervisor")
        .map((user) => ({
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          isOnline: advisorPresence.isOnline(user.id), // Get real-time online status
        }));
      res.json({ advisors });
    } catch (error) {
      console.error("[Admin] Error getting advisors:", error);
      res.status(500).json({ error: "Failed to get advisors" });
    }
  });

  // ============================================
  // ADVISOR STATUSES ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/advisor-statuses
   * Get all advisor statuses
   */
  router.get("/advisor-statuses", async (req, res) => {
    try {
      const statuses = await adminDb.getAllAdvisorStatuses();
      res.json({ statuses });
    } catch (error) {
      console.error("[Admin] Error getting advisor statuses:", error);
      res.status(500).json({ error: "Failed to get advisor statuses" });
    }
  });

  /**
   * GET /api/admin/advisor-statuses/:id
   * Get advisor status by ID
   */
  router.get("/advisor-statuses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const status = await adminDb.getAdvisorStatusById(id);
       if(!status) {
        res.status(404).json({ error: "Advisor status not found" });
        return;
      }
      res.json({ status });
    } catch (error) {
      console.error("[Admin] Error getting advisor status:", error);
      res.status(500).json({ error: "Failed to get advisor status" });
    }
  });

  /**
   * POST /api/admin/advisor-statuses
   * Create new advisor status
   */
  router.post("/advisor-statuses", requireAdmin, async (req, res) => {
    try {
      const { name, description, color, action, redirectToQueue, isDefault } = req.body;

       if(!name || !description || !color || !action) {
        res.status(400).json({ error: "Name, description, color, and action are required" });
        return;
      }

      const status = await adminDb.createAdvisorStatus({
        name,
        description,
        color,
        action,
        redirectToQueue,
        isDefault,
      });

      res.status(201).json({ status });
    } catch (error) {
      console.error("[Admin] Error creating advisor status:", error);
      res.status(500).json({ error: "Failed to create advisor status" });
    }
  });

  /**
   * PUT /api/admin/advisor-statuses/:id
   * Update advisor status
   */
  router.put("/advisor-statuses/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, color, action, redirectToQueue, isDefault, order } = req.body;

      const status = await adminDb.updateAdvisorStatus(id, {
        name,
        description,
        color,
        action,
        redirectToQueue,
        isDefault,
        order,
      });

       if(!status) {
        res.status(404).json({ error: "Advisor status not found" });
        return;
      }

      res.json({ status });
    } catch (error) {
      console.error("[Admin] Error updating advisor status:", error);
      res.status(500).json({ error: "Failed to update advisor status" });
    }
  });

  /**
   * DELETE /api/admin/advisor-statuses/:id
   * Delete advisor status
   */
  router.delete("/advisor-statuses/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await adminDb.deleteAdvisorStatus(id);

       if(!deleted) {
        res.status(400).json({ error: "Cannot delete default status or status not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting advisor status:", error);
      res.status(500).json({ error: "Failed to delete advisor status" });
    }
  });

  // ============================================
  // ADVISOR STATUS ASSIGNMENT ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/advisor-status/:userId
   * Get current status of an advisor
   */
  router.get("/advisor-status/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const assignment = await adminDb.getAdvisorStatus(userId);

       if(!assignment || !assignment.status) {
        // Return default status if no assignment (first status = "Disponible")
        const allStatuses = await adminDb.getAllAdvisorStatuses();
        const defaultStatus = allStatuses.length > 0 ? allStatuses[0] : null;
        res.json({ assignment: null, defaultStatus });
        return;
      }

      res.json({ assignment, status: assignment.status });
    } catch (error) {
      console.error("[Admin] Error getting advisor status assignment:", error);
      res.status(500).json({ error: "Failed to get advisor status assignment" });
    }
  });

  /**
   * POST /api/admin/advisor-status/:userId
   * Set current status of an advisor
   */
  router.post("/advisor-status/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const { statusId } = req.body;

      logger.info(`[Status-change] 🎯 POST /api/admin/advisor-status/${userId} - statusId: ${statusId}`);

       if(!statusId) {
        res.status(400).json({ error: "statusId is required" });
        return;
      }

      const assignment = await adminDb.setAdvisorStatus(userId, statusId);
      const status = await adminDb.getAdvisorStatusById(statusId);

      // 🐛 BUG FIX #4: When status ACTUALLY changes, return ALL chats to queue
      if (assignment.statusChanged) {
        logger.info(`[Status-change] 🔄 Status changed for ${userId} - returning ALL chats to queue`);
        const { advisorPresence } = await import("../crm/advisor-presence");
        await advisorPresence.returnAllChatsToQueue(userId);
      }

      // Emit real-time presence update via WebSocket
      const gateway = getCrmGateway();
       if(gateway) {
        const { buildPresencePayload } = await import("../crm/ws");
        const { crmDb } = await import("../crm/db-postgres");
        const presencePayload = await buildPresencePayload(userId);

         if(presencePayload) {
          gateway.emitAdvisorPresenceUpdate(presencePayload);

          // CREATE STATUS CHANGE MESSAGES: Create system message in all advisor's conversations
          const conversations = await crmDb.listConversations();
          const user = await adminDb.getUserById(userId);
          const advisorConversations = conversations.filter(
            conv => conv.assignedTo === userId && (conv.status === "attending" || conv.status === "active")
          );

           if(status && advisorConversations.length > 0) {
            logger.info(`[Status-change] Creating status change messages for ${advisorConversations.length} conversations`);

             for(const conv of advisorConversations) {
              const statusMessage = await crmDb.appendMessage({
                convId: conv.id,
                direction: "outgoing",
                type: "system",
                text: `${user?.name || user?.username} cambió su estado a ${status.name.toUpperCase()}`,
                mediaUrl: null,
                mediaThumb: null,
                repliedToId: null,
                status: "sent",
                providerMetadata: {
                  backgroundColor: status.color
                }
              });

              // Emit the message via WebSocket
              gateway.emitNewMessage({ message: statusMessage, attachment: null });
            }

            logger.info(`[Status-change] ✅ Created ${advisorConversations.length} status change messages for ${status.name}`);
          }

          // 🐛 BUG FIX #4: OLD LOGIC COMMENTED OUT
          // The new logic above (returnAllChatsToQueue) already handles returning ALL chats to queue
          // when status changes, regardless of the action type. This old logic is no longer needed.
          /*
          // RELEASE CONVERSATIONS: If advisor becomes unavailable, release assigned conversations
           if(status?.action === "pause" || status?.action === "redirect") {
            // Filter only attending conversations for release
            const attendingConversations = advisorConversations.filter(conv => conv.status === "attending");

             if(attendingConversations.length > 0) {
              logger.info(`[Status-change] Advisor ${userId} is now ${status.action}. Releasing ${attendingConversations.length} conversation(s)`);

               for(const conv of attendingConversations) {
                // Release conversation (back to active/queue)
                await crmDb.releaseConversation(conv.id);

                // If status has redirectToQueue, assign to that queue
                 if(status.action === "redirect" && status.redirectToQueue) {
                  crmDb.updateConversationQueue(conv.id, status.redirectToQueue);
                  logger.info(`[Status-change] ✅ Conversation ${conv.id} redirected to queue: ${status.redirectToQueue}`);
                } else {
                  // CRITICAL FIX: If no redirectToQueue, reassign to fallback queue of the WhatsApp number
                  // This ensures conversations don't get "lost" when advisor releases them
                  try {
                    // Get the conversation's display number to find fallback queue
                    const whatsappNumbers = await adminDb.getAllWhatsAppNumbers();
                    const normalizePhone = (phone: string) => phone.replace(/[\s\+\-\(\)]/g, '');
                    const normalizedDisplay = normalizePhone(conv.displayNumber || '');

                    const numberConfig = whatsappNumbers.find(num =>
                      normalizePhone(num.phoneNumber) === normalizedDisplay
                    );

                    if (numberConfig && numberConfig.queueId) {
                      await crmDb.updateConversationQueue(conv.id, numberConfig.queueId);
                      logger.info(`[Status-change] ✅ Conversation ${conv.id} released back to fallback queue: ${numberConfig.queueId}`);
                    } else {
                      logger.warn(`[Status-change] ⚠️ No fallback queue found for ${conv.displayNumber} - conversation ${conv.id} released without queue`);
                    }
                  } catch (error) {
                    logger.error(`[Status-change] Error reassigning conversation ${conv.id} to fallback queue:`, error);
                  }
                }

                // Emit WebSocket update
                gateway.emitConversationUpdate({
                  conversation: await crmDb.getConversationById(conv.id)!
                });

                // Create system message
                await crmDb.appendMessage({
                  convId: conv.id,
                  direction: "outgoing",
                  type: "system",
                  text: `⏸️ Asesor ${user.name || user.username} cambió su estado - Conversación reasignada`,
                  mediaUrl: null,
                  mediaThumb: null,
                  repliedToId: null,
                  status: "sent",
                });
              }

              // Try to reassign IMMEDIATELY to other available advisors
              const allQueues = await adminDb.getAllQueues();
              for (const conv of attendingConversations) {
                const updatedConv = await crmDb.getConversationById(conv.id);
                if (updatedConv && updatedConv.queueId) {
                  const queue = allQueues.find(q => q.id === updatedConv.queueId);
                  if (queue) {
                    // Find available advisor in this queue
                    for (const advisorId of queue.assignedAdvisors) {
                      if (advisorId === userId) continue; // Skip the advisor who just went unavailable

                      const otherAdvisorStatus = await adminDb.getAdvisorStatus(advisorId);
                      if (otherAdvisorStatus && otherAdvisorStatus.status) {
                        // ✅ CRITICAL FIX: Check BOTH status AND isOnline()
                        const isOnline = advisorPresence.isOnline(advisorId);
                        if (otherAdvisorStatus.status.action === "accept" && isOnline) {
                          await crmDb.assignConversation(updatedConv.id, advisorId);
                          logger.info(`[Status-change] 🎯 Auto-reassigned conversation ${updatedConv.id} to advisor ${advisorId} (online & available)`);

                          gateway.emitConversationUpdate({
                            conversation: await crmDb.getConversationById(updatedConv.id)!
                          });
                          break;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          */ // End of commented out release logic

          // AUTO-ASSIGNMENT: If advisor becomes available AND is online, assign waiting conversations
          if (status?.action === "accept" && advisorPresence.isOnline(userId)) {
            // Find queues where this advisor is assigned
            const allQueues = await adminDb.getAllQueues();
            const advisorQueues = allQueues.filter(q => q.assignedAdvisors.includes(userId));

            if (advisorQueues.length > 0) {
              logger.info(`[Auto-assign] Advisor ${userId} is now available. Checking queues:`, advisorQueues.map(q => q.id));

              // Process each queue
              for (const queue of advisorQueues) {
                const waitingConversations = conversations.filter(
                  conv => conv.queueId === queue.id &&
                          conv.status === "active" &&
                          !conv.assignedTo
                );

                if (waitingConversations.length > 0) {
                  // Calculate fair quota: divide waiting chats among ALL advisors in queue
                  const totalAdvisorsInQueue = queue.assignedAdvisors.length;
                  const quota = Math.ceil(waitingConversations.length / totalAdvisorsInQueue);

                  logger.info(`[Auto-assign] 📊 Queue "${queue.name}": ${waitingConversations.length} waiting, ${totalAdvisorsInQueue} advisors total → Quota: ${quota} chats per advisor`);

                  // Sort by creation time (oldest first)
                  waitingConversations.sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                  );

                  // Assign quota amount of conversations to this advisor
                  const conversationsToAssign = waitingConversations.slice(0, quota);

                  logger.info(`[Auto-assign] 🎯 Assigning ${conversationsToAssign.length} conversations to advisor ${userId} from queue ${queue.name}`);

                  for (const conv of conversationsToAssign) {
                    await crmDb.assignConversation(conv.id, userId);
                    logger.info(`[Auto-assign] ✅ Assigned conversation ${conv.id} to advisor ${userId}`);

                    // Emit WebSocket update for each assigned conversation
                    const updatedConv = await crmDb.getConversationById(conv.id);
                    if (updatedConv) {
                      gateway.emitConversationUpdate({ conversation: updatedConv });
                    }
                  }

                  logger.info(`[Auto-assign] 📦 Total assigned to ${userId}: ${conversationsToAssign.length} conversations from queue ${queue.name}`);
                }
              }
            }
          }
        }
      }

      res.json({ assignment, status });
    } catch (error) {
      console.error("[Admin] Error setting advisor status:", error);
      res.status(500).json({ error: "Failed to set advisor status" });
    }
  });

  // ============================================
  // WHATSAPP NUMBER ASSIGNMENTS ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/whatsapp-numbers
   * Get all WhatsApp number assignments
   */
  router.get("/whatsapp-numbers", async (req, res) => {
    try {
      const numbers = await adminDb.getAllWhatsAppNumbers();
      res.json({ numbers });
    } catch (error) {
      logger.error("[Admin] Error getting WhatsApp numbers:", error);
      res.status(500).json({ error: "Failed to get WhatsApp numbers" });
    }
  });

  /**
   * POST /api/admin/whatsapp-numbers
   * Add new WhatsApp number assignment
   */
  router.post("/whatsapp-numbers", async (req, res) => {
    try {
      const { displayName, phoneNumber, queueId } = req.body;

      if (!displayName || !phoneNumber) {
        res.status(400).json({ error: "displayName and phoneNumber are required" });
        return;
      }

      const number = await adminDb.createWhatsAppNumber({
        displayName,
        phoneNumber,
        queueId,
      });

      res.status(201).json({ number });
    } catch (error) {
      logger.error("[Admin] Error creating WhatsApp number:", error);
      res.status(500).json({ error: "Failed to create WhatsApp number" });
    }
  });

  /**
   * PUT /api/admin/whatsapp-numbers/:id
   * Update WhatsApp number assignment
   */
  router.put("/whatsapp-numbers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { displayName, phoneNumber, queueId } = req.body;

      const number = await adminDb.updateWhatsAppNumber(id, {
        displayName,
        phoneNumber,
        queueId,
      });

      if (!number) {
        res.status(404).json({ error: "WhatsApp number not found" });
        return;
      }

      res.json({ number });
    } catch (error) {
      logger.error("[Admin] Error updating WhatsApp number:", error);
      res.status(500).json({ error: "Failed to update WhatsApp number" });
    }
  });

  /**
   * DELETE /api/admin/whatsapp-numbers/:id
   * Delete WhatsApp number assignment
   */
  router.delete("/whatsapp-numbers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await adminDb.deleteWhatsAppNumber(id);

      if (!deleted) {
        res.status(404).json({ error: "WhatsApp number not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("[Admin] Error deleting WhatsApp number:", error);
      res.status(500).json({ error: "Failed to delete WhatsApp number" });
    }
  });

  // ============================================
  // ADVISOR PRESENCE ENDPOINT
  // ============================================

  /**
   * GET /api/admin/advisor-presence
   * Get real-time presence status of all advisors
   * Shows: online status, current status (disponible, ocupado, etc), active conversations count
   */
  router.get("/advisor-presence", async (req, res) => {
    try {
      const { crmDb } = await import("../crm/db-postgres");
      const { advisorPresence } = await import("../crm/advisor-presence");
      const users = await adminDb.getAllUsers();
      const statuses = await adminDb.getAllAdvisorStatuses();

      // Filter only advisors and supervisors
      const advisorUsers = users.filter(u => u.role === "asesor" || u.role === "supervisor");

      const allConversations = await crmDb.listConversations();

      const advisorPresenceList = await Promise.all(advisorUsers.map(async user => {
        // Get current status assignment
        const assignment = await adminDb.getAdvisorStatus(user.id);
        const status = assignment?.status || null;

        // Count active conversations for this advisor
        const activeConversations = allConversations.filter(
          conv => conv.assignedTo === user.id && conv.status === "attending"
        ).length;

        // Use REAL WebSocket presence tracking
        const isOnline = advisorPresence.isOnline(user.id);

        return {
          userId: user.id,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role
          },
          status,
          isOnline,
          activeConversations
        };
      }));

      res.json({ advisors: advisorPresenceList });
    } catch (error) {
      logger.error("[Admin] Error getting advisor presence:", error);
      res.status(500).json({ error: "Failed to get advisor presence" });
    }
  });

  /**
   * GET /api/admin/advisor-stats
   * Get advisor statistics (total chats, avg response time, etc)
   */
  router.get("/advisor-stats", async (req, res) => {
    try {
      const { crmDb } = await import("../crm/db-postgres");

      // Get all users and filter advisors
      const users = await adminDb.getAllUsers();
      const advisorUsers = users.filter(u => u.role === "asesor" || u.role === "supervisor");

      // Get all conversations
      const allConversations = await crmDb.listConversations();

      // Get all queues
      const allQueues = await adminDb.getAllQueues();
      const queues = allQueues.map(q => ({
        id: q.id,
        name: q.name,
        description: q.description || '',
      }));

      // Build advisor stats
      const advisors = await Promise.all(advisorUsers.map(async (user) => {
        // Get advisor's current status
        const assignment = await adminDb.getAdvisorStatus(user.id);
        const status = assignment ? await adminDb.getAdvisorStatusById(assignment.statusId) : null;

        // Get conversations for this advisor
        const advisorConversations = allConversations.filter(conv => conv.assignedTo === user.id);

        // Group conversations by queue
        const conversationsByQueue: Record<string, number> = {};
        advisorConversations.forEach(conv => {
          const queueId = conv.queueId || "sin-cola";
          conversationsByQueue[queueId] = (conversationsByQueue[queueId] || 0) + 1;
        });

        // Simple online detection: if status is NOT "offline", consider online
        const isOnline = status ? status.id !== "status-offline" : false;

        return {
          userId: user.id,
          userName: user.name || user.username,
          email: user.email,
          role: user.role,
          isOnline,
          status: status ? {
            id: status.id,
            name: status.name,
            color: status.color,
            action: status.action,
          } : null,
          conversationsByQueue,
          totalConversations: advisorConversations.length,
        };
      }));

      res.json({ advisors, queues });
    } catch (error) {
      logger.error("[Admin] Error getting advisor stats:", error);
      res.status(500).json({ error: "Failed to get advisor stats" });
    }
  });

  /**
   * GET /api/admin/advisor-activity-logs
   * Get advisor activity logs (login, logout, status changes)
   */
  router.get("/advisor-activity-logs", async (req, res) => {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        user: process.env.POSTGRES_USER || 'whatsapp_user',
        host: process.env.POSTGRES_HOST || 'localhost',
        database: process.env.POSTGRES_DB || 'flowbuilder_crm',
        password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
      });

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      // Only show events from last 48 hours to keep history clean
      const hoursToShow = parseInt(req.query.hours as string) || 48;

      const result = await pool.query(
        `SELECT id, user_id, user_name, event_type, status_id, status_name, timestamp, metadata
         FROM advisor_activity_logs
         WHERE timestamp > NOW() - INTERVAL '${hoursToShow} hours'
         ORDER BY timestamp DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const logs = result.rows.map(row => {
        // Convert UTC timestamp to Lima timezone by formatting as ISO string
        // The timestamp from DB is in UTC, but we want to show it in Lima time
        const timestamp = row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp;

        return {
          id: row.id,
          userId: row.user_id,
          userName: row.user_name,
          eventType: row.event_type,
          statusId: row.status_id,
          statusName: row.status_name,
          timestamp,
          metadata: row.metadata || {},
        };
      });

      await pool.end();
      res.json({ logs, total: logs.length });
    } catch (error) {
      logger.error("[Admin] Error getting advisor activity logs:", error);
      res.status(500).json({ error: "Failed to get advisor activity logs" });
    }
  });

  /**
   * GET /api/admin/categories
   * Get all conversation categories
   */
  router.get("/categories", async (req, res) => {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        user: process.env.POSTGRES_USER || 'whatsapp_user',
        host: process.env.POSTGRES_HOST || 'localhost',
        database: process.env.POSTGRES_DB || 'flowbuilder_crm',
        password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
      });

      const result = await pool.query('SELECT id, name, description, icon, color, "order" FROM crm_categories ORDER BY "order"');
      const categories = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description || '',
        icon: row.icon || '',
        color: row.color || '',
        order: row.order || 0,
        visible: true, // Always visible by default
        visibleForRoles: [], // Visible for all roles
      }));

      await pool.end();
      res.json({ categories });
    } catch (error) {
      logger.error("[Admin] Error getting categories:", error);
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  // ============================================
  // BOT CONFIG ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/bot-config
   * Get bot configuration (timeout and fallback queue per flow)
   */
  router.get("/bot-config", async (req, res) => {
    try {
      const { getBotTimeoutScheduler } = await import("../index");
      const scheduler = getBotTimeoutScheduler();
      const config = scheduler.getConfig();
      res.json(config);
    } catch (error) {
      logger.error("[Admin] Error getting bot config:", error);
      res.status(500).json({ error: "Failed to get bot config" });
    }
  });

  /**
   * PUT /api/admin/bot-config
   * Update bot configuration
   */
  router.put("/bot-config", requireAdmin, async (req, res) => {
    try {
      const { getBotTimeoutScheduler } = await import("../index");
      const scheduler = getBotTimeoutScheduler();
      scheduler.saveConfig(req.body);
      res.json({ success: true });
    } catch (error) {
      logger.error("[Admin] Error saving bot config:", error);
      res.status(500).json({ error: "Failed to save bot config" });
    }
  });

  // ============================================
  // AI REPORTS ENDPOINTS (ADMIN ONLY)
  // ============================================

  /**
   * GET /api/admin/ai-reports/:type
   * Generate AI report in TOON format
   * Types: daily, weekly, performance, problems
   * ADMIN ONLY - Protegido con requireAdmin
   */
  router.get("/ai-reports/:type", requireAdmin, async (req, res) => {
    try {
      const { aiReportsService } = await import("../services/ai-reports-service");
      const { type } = req.params;

      let report;
      switch (type) {
        case 'daily':
          report = await aiReportsService.generateDailyReport();
          break;
        case 'weekly':
          report = await aiReportsService.generateWeeklyReport();
          break;
        case 'performance':
          report = await aiReportsService.generatePerformanceReport();
          break;
        case 'problems':
          report = await aiReportsService.generateProblemsReport();
          break;
        default:
          res.status(400).json({ error: 'Invalid report type. Use: daily, weekly, performance, or problems' });
          return;
      }

      logger.info(`[AI Reports] Generated ${type} report for admin ${req.user?.id}`);
      res.json(report);
    } catch (error) {
      logger.error("[AI Reports] Error generating report:", error);
      res.status(500).json({ error: "Failed to generate AI report" });
    }
  });

  /**
   * GET /api/admin/ai-reports
   * Get list of available report types
   */
  router.get("/ai-reports", requireAdmin, async (req, res) => {
    try {
      res.json({
        reports: [
          {
            type: 'daily',
            name: 'Reporte Diario',
            description: 'Resumen de las últimas 24 horas',
            icon: '📊'
          },
          {
            type: 'weekly',
            name: 'Reporte Semanal',
            description: 'Análisis de los últimos 7 días',
            icon: '📈'
          },
          {
            type: 'performance',
            name: 'Performance',
            description: 'Métricas de rendimiento de asesores',
            icon: '⚡'
          },
          {
            type: 'problems',
            name: 'Problemas Actuales',
            description: 'Detección de problemas en tiempo real',
            icon: '🚨'
          }
        ],
        metabaseUrl: 'https://wsp.azaleia.com.pe/metabase',
        instructions: 'Copia el reporte TOON y pégalo en ChatGPT/Claude para obtener análisis inteligentes'
      });
    } catch (error) {
      logger.error("[AI Reports] Error getting report list:", error);
      res.status(500).json({ error: "Failed to get report list" });
    }
  });

  return router;
}
