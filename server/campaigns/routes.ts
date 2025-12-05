import { Router } from 'express';
import { campaignStorage } from './storage';
import type { Campaign } from './models';
import { sendTemplateMessage } from '../../src/api/whatsapp-sender';
import { getWhatsAppEnv } from '../utils/env';
import { crmDb } from '../crm/db-postgres';
import { adminDb } from '../admin-db';
import { requireSupervisor } from '../middleware/roles';

import type { CrmRealtimeManager } from '../crm/ws';

/**
 * Normalize phone number: remove spaces, dashes, parentheses
 * Example: "+51 961 842 916" -> "+51961842916"
 */
function normalizePhoneNumber(phoneNumber: string | null): string | null {
  if (!phoneNumber) return null;
  return phoneNumber.replace(/[\s\-\(\)]/g, '');
}

export function createCampaignsRouter(socketManager?: CrmRealtimeManager) {
  const router = Router();

  /**
   * POST /campaigns
   * Create a new campaign
   */
  router.post('/', requireSupervisor, async (req, res) => {
    try {
      const { name, whatsappNumberId, templateName, language, recipients, variables, scheduledAt, throttleRate } = req.body;

      if (!name || !whatsappNumberId || !templateName || !recipients || !Array.isArray(recipients)) {
        res.status(400).json({
          error: 'invalid_params',
          message: 'Missing required fields: name, whatsappNumberId, templateName, recipients',
        });
        return;
      }

      // Validate and clean phone numbers
      const cleanedRecipients = recipients
        .map((phone: string) => phone.trim().replace(/\D/g, ''))
        .filter((phone: string) => phone.length >= 9 && phone.length <= 15);

      if (cleanedRecipients.length === 0) {
        res.status(400).json({
          error: 'no_valid_recipients',
          message: 'No valid phone numbers found',
        });
        return;
      }

      // Limit to 1000 recipients per campaign
      if (cleanedRecipients.length > 1000) {
        res.status(400).json({
          error: 'too_many_recipients',
          message: 'Maximum 1000 recipients per campaign',
        });
        return;
      }

      const campaign: Campaign = {
        id: `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        whatsappNumberId,
        templateName,
        language: language || 'es', // Default to Spanish if not specified
        recipients: cleanedRecipients,
        variables: variables || undefined,
        scheduledAt: scheduledAt ? parseInt(scheduledAt, 10) : undefined,
        status: scheduledAt ? 'scheduled' : 'draft',
        createdAt: Date.now(),
        createdBy: req.user?.userId || 'unknown',
        throttleRate: throttleRate || 60, // 60 messages per minute (safe limit)
      };

      const created = await campaignStorage.createCampaign(campaign);

      res.json({ campaign: created });
    } catch (error) {
      console.error('[Campaigns] Error creating campaign:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /campaigns
   * Get all campaigns (accessible to all authenticated users)
   */
  router.get('/', async (req, res) => {
    try {
      const campaigns = await campaignStorage.getAllCampaigns();
      res.json({ campaigns });
    } catch (error) {
      console.error('[Campaigns] Error fetching campaigns:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /campaigns/:id
   * Get a specific campaign (accessible to all authenticated users)
   */
  router.get('/:id', async (req, res) => {
    try {
      const campaign = await campaignStorage.getCampaign(req.params.id);
      if (!campaign) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ campaign });
    } catch (error) {
      console.error('[Campaigns] Error fetching campaign:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /campaigns/:id/send
   * Start sending a campaign
   */
  router.post('/:id/send', requireSupervisor, async (req, res) => {
    try {
      console.log(`[Campaigns] 🚀 POST /campaigns/${req.params.id}/send - Starting campaign send`);
      const campaign = await campaignStorage.getCampaign(req.params.id);
      if (!campaign) {
        console.log(`[Campaigns] ❌ Campaign ${req.params.id} not found`);
        res.status(404).json({ error: 'not_found' });
        return;
      }
      console.log(`[Campaigns] ✅ Found campaign: ${campaign.name}, status: ${campaign.status}`);

      if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
        res.status(400).json({
          error: 'invalid_status',
          message: `Campaign is already ${campaign.status}`,
        });
        return;
      }

      // Update status to sending
      console.log(`[Campaigns] 📝 Updating campaign status to 'sending'`);
      await campaignStorage.updateCampaignStatus(campaign.id, 'sending');
      console.log(`[Campaigns] ✅ Status updated successfully`);

      // Start sending in background (don't await)
      sendCampaignMessages(campaign).catch(async error => {
        console.error(`[Campaigns] Error sending campaign ${campaign.id}:`, error);
        await campaignStorage.updateCampaignStatus(campaign.id, 'failed');
      });

      res.json({ success: true, message: 'Campaign sending started' });
    } catch (error) {
      console.error('[Campaigns] ❌ Error starting campaign:', error);
      console.error('[Campaigns] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        error: error,
      });
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /campaigns/:id
   * Delete a campaign
   */
  router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
      const deleted = await campaignStorage.deleteCampaign(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Campaigns] Error deleting campaign:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /campaigns/:id/metrics
   * Get campaign metrics
   */
  router.get('/:id/metrics', requireSupervisor, async (req, res) => {
    try {
      const metrics = await campaignStorage.getCampaignMetrics(req.params.id);
      if (!metrics) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ metrics });
    } catch (error) {
      console.error('[Campaigns] Error fetching metrics:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /campaigns/metrics/all
   * Get all campaign metrics
   */
  router.get('/metrics/all', requireSupervisor, async (req, res) => {
    try {
      const allMetrics = await campaignStorage.getAllMetrics();
      res.json({ metrics: allMetrics });
    } catch (error) {
      console.error('[Campaigns] Error fetching all metrics:', error);
      res.status(500).json({
        error: 'server_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}

/**
 * Get WhatsApp API config for a specific phoneNumberId
 */
async function getWhatsAppConfigForCampaign(phoneNumberId: string): Promise<any> {
  try {
    // Read from PostgreSQL using whatsapp-connections service
    const { getWhatsAppConnection } = await import('../services/whatsapp-connections');
    const connection = await getWhatsAppConnection(phoneNumberId);

    if (connection && connection.accessToken) {
      const baseEnv = getWhatsAppEnv();
      return {
        accessToken: connection.accessToken,
        phoneNumberId: connection.phoneNumberId,
        apiVersion: baseEnv.apiVersion || "v20.0",
        baseUrl: baseEnv.baseUrl || "https://graph.facebook.com",
      };
    }
  } catch (error) {
    console.error(`[Campaigns] Error loading WhatsApp config for ${phoneNumberId}:`, error);
  }

  // Fallback to default config
  const fallback = getWhatsAppEnv();
  fallback.phoneNumberId = phoneNumberId;
  return fallback;
}

/**
 * Send campaign messages with throttling
 */
async function sendCampaignMessages(campaign: Campaign): Promise<void> {
  const delayMs = (60 * 1000) / campaign.throttleRate; // milliseconds between messages

  console.log(`[Campaigns] Starting campaign ${campaign.id}: ${campaign.recipients.length} recipients at ${campaign.throttleRate} msg/min`);

  // CRITICAL: Get correct WhatsApp config for this phoneNumberId
  const config = await getWhatsAppConfigForCampaign(campaign.whatsappNumberId);

  if (!config.accessToken) {
    console.error(`[Campaigns] No access token found for phoneNumberId: ${campaign.whatsappNumberId}`);
    campaignStorage.updateCampaignStatus(campaign.id, 'failed');
    return;
  }

  console.log(`[Campaigns] Using phoneNumberId: ${config.phoneNumberId} with valid access token`);

  // Fetch template info from Meta to get header_handle if needed
  let templateVariables = campaign.variables || [];

  // Check if variables are empty (can be [], {} or undefined)
  const isEmptyVariables = !templateVariables ||
    (Array.isArray(templateVariables) && templateVariables.length === 0) ||
    (typeof templateVariables === 'object' && !Array.isArray(templateVariables) && Object.keys(templateVariables).length === 0);

  // If no variables provided, try to get template header_handle from Meta and re-upload as media_id
  if (isEmptyVariables) {
    console.log('[Campaigns] No variables provided, attempting to auto-detect and upload template header from Meta');
    try {
      const { fetchMessageTemplates, uploadMedia, getMediaUrl } = await import('../../src/api/whatsapp-sender');
      const { getWhatsAppConnection } = await import('../services/whatsapp-connections');
      const connection = await getWhatsAppConnection(campaign.whatsappNumberId);

      if (connection?.wabaId) {
        const templatesResult = await fetchMessageTemplates(connection.wabaId, config.accessToken);
        if (templatesResult.ok) {
          const template = templatesResult.templates.find(
            t => t.name === campaign.templateName && t.language === campaign.language
          );

          if (template) {
            const headerComp = template.components?.find(c => c.type === 'HEADER' && c.format === 'IMAGE');
            if (headerComp?.example?.header_handle?.[0]) {
              const headerHandle = headerComp.example.header_handle[0];
              console.log(`[Campaigns] Auto-detected template header image URL: ${headerHandle}`);

              // Download image from header_handle and re-upload to WhatsApp to get media_id
              try {
                console.log(`[Campaigns] Downloading image from header_handle...`);
                const imageResponse = await fetch(headerHandle);
                if (!imageResponse.ok) {
                  throw new Error(`Failed to download image: ${imageResponse.status}`);
                }

                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

                console.log(`[Campaigns] Re-uploading image to WhatsApp (${imageBuffer.length} bytes, ${contentType})...`);
                const uploadResult = await uploadMedia(config, imageBuffer, contentType, 'template-header.jpg');

                if (uploadResult.ok && uploadResult.body?.id) {
                  const mediaId = uploadResult.body.id;
                  console.log(`[Campaigns] ✅ Image uploaded successfully! media_id: ${mediaId}`);

                  templateVariables = [
                    {
                      type: 'header',
                      parameters: [
                        {
                          type: 'image',
                          image: {
                            id: mediaId // Use media_id instead of link
                          }
                        }
                      ]
                    }
                  ];
                } else {
                  console.error(`[Campaigns] Failed to upload image to WhatsApp:`, uploadResult);
                }
              } catch (downloadError) {
                console.error(`[Campaigns] Error downloading/uploading header image:`, downloadError);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Campaigns] Could not fetch template info from Meta:', err);
    }
  }

  // FILTRAR DESTINATARIOS: Solo enviar a archived/closed o números nuevos
  console.log('[Campaigns] 🔍 Filtering recipients by status...');
  const eligibleRecipients: string[] = [];

  for (const phone of campaign.recipients) {
    try {
      const conv = await crmDb.getConversationByPhoneAndChannel(phone, 'whatsapp', campaign.whatsappNumberId);
      if (!conv) {
        eligibleRecipients.push(phone);
        console.log(`[Campaigns] ✅ ${phone} - NEW (will create as closed + cat-masivos)`);
      } else if (conv.status === 'closed') {
        eligibleRecipients.push(phone);
        console.log(`[Campaigns] ✅ ${phone} - status: ${conv.status} (eligible)`);
      } else {
        console.log(`[Campaigns] ⏭️  ${phone} - status: ${conv.status} (SKIPPED - only closed/new allowed)`);
      }
    } catch (error) {
      console.error(`[Campaigns] Error checking ${phone}:`, error);
    }
  }

  console.log(`[Campaigns] 📊 Filtered ${eligibleRecipients.length}/${campaign.recipients.length} eligible recipients`);

  if (eligibleRecipients.length === 0) {
    console.log('[Campaigns] ⚠️  No eligible recipients - marking campaign as completed');
    await campaignStorage.updateCampaignStatus(campaign.id, 'completed');
    return;
  }

  for (let i = 0; i < eligibleRecipients.length; i++) {
    const phone = eligibleRecipients[i];

    try {
      // Send template message
      const result = await sendTemplateMessage(
        config,
        phone,
        campaign.templateName,
        campaign.language || 'es', // Use campaign language or default to Spanish
        templateVariables
      );

      if (result.ok) {
        // Try to extract messageId from WhatsApp response body
        const messageId = (result.body as any)?.messages?.[0]?.id;

        await campaignStorage.updateMessageStatus(campaign.id, phone, 'sent', {
          messageId,
        });
        console.log(`[Campaigns] Sent to ${phone} (${i + 1}/${eligibleRecipients.length})`);

        // Register message in CRM
        try {
          let conversation = await crmDb.getConversationByPhoneAndChannel(phone, 'whatsapp', campaign.whatsappNumberId);

          if (!conversation) {
            // Get displayNumber from whatsapp_connections with ROBUST fallback
            const whatsappNumbers = await adminDb.getAllWhatsAppNumbers();
            const connectionConfig = whatsappNumbers.find(num => num.numberId === campaign.whatsappNumberId);

            // ROBUST: Multiple fallbacks to ensure displayNumber is ALWAYS set
            let displayNumber = connectionConfig?.phoneNumber || null;

            // Fallback 1: If not found by phoneNumberId, try to get first available number
            if (!displayNumber && whatsappNumbers.length > 0) {
              displayNumber = whatsappNumbers[0].phoneNumber;
              console.warn(`[Campaigns] ⚠️ Could not find number for phoneNumberId ${campaign.whatsappNumberId}, using first available: ${displayNumber}`);
            }

            // Fallback 2: Hardcoded default as last resort
            if (!displayNumber) {
              displayNumber = '+51961842916'; // Default business number
              console.warn(`[Campaigns] ⚠️ No WhatsApp numbers configured, using default: ${displayNumber}`);
            }

            // NORMALIZE: Always save phone numbers in consistent format (no spaces, dashes, parentheses)
            displayNumber = normalizePhoneNumber(displayNumber);

            // CRITICAL FIX: Crear como CLOSED (no archived) para que categorización funcione
            conversation = await crmDb.createConversation(phone, null, null, 'whatsapp', campaign.whatsappNumberId, displayNumber, null);
            await crmDb.updateConversationMeta(conversation.id, {
              status: 'closed',
              campaignId: campaign.id  // CRITICAL: Usar campo singular campaign_id
              // category se calcula dinámicamente, NO hardcodear
            });
            conversation = await crmDb.getConversationById(conversation.id);
            console.log(`[Campaigns] Created new conversation as closed + campaignId for ${phone}`);
          } else {
            // CRITICAL FIX: Si conversación ya existe, actualizar a closed y setear campaignId
            await crmDb.updateConversationMeta(conversation.id, {
              status: 'closed',
              campaignId: campaign.id
            });
            console.log(`[Campaigns] Updated existing conversation to closed + campaignId for ${phone}`);
          }

          // Agregar campaign.id al array campaign_ids (para historial)
          try {
            await crmDb.addCampaignToConversation(conversation.id, campaign.id);
            console.log(`[Campaigns] Added campaign ${campaign.id} to campaignIds array for ${phone}`);
          } catch (err) {
            console.warn(`[Campaigns] Could not add campaign to campaignIds:`, err);
          }

          // NO reabrir conversación - mantener status actual (archived/closed)

          // CRITICAL: Fetch template definition from Meta to get full components
          let templateComponents: any[] = [];
          try {
            const { fetchMessageTemplates } = await import('../../src/api/whatsapp-sender');
            const { getWhatsAppConnection } = await import('../services/whatsapp-connections');
            const connection = await getWhatsAppConnection(campaign.whatsappNumberId);

            if (connection?.wabaId) {
              const templatesResult = await fetchMessageTemplates(connection.wabaId, config.accessToken);
              if (templatesResult.ok) {
                const template = templatesResult.templates.find(
                  t => t.name === campaign.templateName && t.language === (campaign.language || 'es')
                );
                if (template?.components) {
                  templateComponents = template.components;
                  console.log(`[Campaigns] Fetched ${templateComponents.length} components for template ${campaign.templateName}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[Campaigns] Could not fetch template components from Meta:`, err);
          }

          // Build template data with full structure for proper display in CRM
          const templateData = {
            templateName: campaign.templateName,
            language: campaign.language || 'es',
            components: templateComponents
          };

          // Append outgoing template message to CRM
          const message = await crmDb.appendMessage({
            convId: conversation.id,
            direction: 'outgoing',
            type: 'template',  // FIXED: Use 'template' type instead of 'text'
            text: JSON.stringify(templateData),  // FIXED: Store full template JSON
            mediaUrl: null,
            mediaThumb: null,
            repliedToId: null,
            status: 'sent',
            providerMetadata: {
              campaign_id: campaign.id,
              template_name: campaign.templateName,
            },
          });

          console.log(`[Campaigns] Message registered in CRM for ${phone}`);

          // Emit WebSocket events so frontend shows the template message
          if (socketManager) {
            socketManager.emitNewMessage({ message, attachment: null });
            const updatedConv = await crmDb.getConversationById(conversation.id);
            if (updatedConv) {
              socketManager.emitConversationUpdate({ conversation: updatedConv });
            }
          }
        } catch (crmError) {
          console.error(`[Campaigns] Failed to register message in CRM for ${phone}:`, crmError);
        }
      } else {
        await campaignStorage.updateMessageStatus(campaign.id, phone, 'failed', {
          failReason: `Error ${result.status}`,
        });
        console.error(`[Campaigns] Failed to send to ${phone}: Status ${result.status}`);
      }
    } catch (error) {
      await campaignStorage.updateMessageStatus(campaign.id, phone, 'failed', {
        failReason: error instanceof Error ? error.message : 'Unknown error',
      });
      console.error(`[Campaigns] Error sending to ${phone}:`, error);
    }

    // Throttle: wait before sending next message
    if (i < campaign.recipients.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Mark campaign as completed
  await campaignStorage.updateCampaignStatus(campaign.id, 'completed');
  console.log(`[Campaigns] Campaign ${campaign.id} completed`);
}
