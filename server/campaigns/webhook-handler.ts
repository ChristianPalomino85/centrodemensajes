/**
 * WhatsApp Status Updates Handler for Campaigns
 *
 * Processes WhatsApp webhooks for message status updates (delivered, read, failed)
 * and updates campaign metrics accordingly.
 */

import { campaignStorage } from './storage';
import { promises as fs } from 'fs';
import path from 'path';

interface WhatsAppStatus {
  id: string; // message_id
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
  }>;
}

interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        statuses?: WhatsAppStatus[];
      };
      field: string;
    }>;
  }>;
}

export class CampaignWebhookHandler {
  /**
   * Process WhatsApp webhook for status updates
   */
  async processWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    try {
      if (!payload.entry || payload.entry.length === 0) {
        return;
      }

      for (const entry of payload.entry) {
        for (const change of entry.changes) {
          const statuses = change.value?.statuses;

          if (statuses && statuses.length > 0) {
            await this.processStatusUpdates(statuses);
          }
        }
      }
    } catch (error) {
      console.error('[CampaignWebhook] Error processing webhook:', error);
    }
  }

  /**
   * Process status updates from WhatsApp
   */
  private async processStatusUpdates(statuses: WhatsAppStatus[]): Promise<void> {
    for (const status of statuses) {
      try {
        const messageId = status.id;
        const newStatus = status.status;
        const recipientPhone = status.recipient_id;

        console.log(`[CampaignWebhook] Status update: messageId=${messageId}, status=${newStatus}, phone=${recipientPhone}`);

        // Persist raw webhook status to log file for audit/backfill
        try {
          const logDir = path.join(process.cwd(), 'logs');
          await fs.mkdir(logDir, { recursive: true });
          const logLine = JSON.stringify({
            ts: Date.now(),
            messageId,
            status: newStatus,
            phone: recipientPhone,
            timestamp: status.timestamp,
            errors: status.errors,
          }) + '\n';
          await fs.appendFile(path.join(logDir, 'campaign-webhooks.log'), logLine, 'utf8');
        } catch (logErr) {
          console.error('[CampaignWebhook] Failed to log status to file:', logErr);
        }

        // Find which campaign this message belongs to
        const campaign = await this.findCampaignByMessageId(messageId, recipientPhone);

        if (campaign) {
          console.log(`[CampaignWebhook] ✅ Found campaign: ${campaign.id} - Updating status to '${newStatus}'`);

          // Update campaign metrics
          await campaignStorage.updateMessageStatus(
            campaign.id,
            recipientPhone,
            newStatus,
            {
              messageId: messageId,
              errorCode: status.errors?.[0]?.code,
              errorTitle: status.errors?.[0]?.title,
            }
          );
        } else {
          console.log(`[CampaignWebhook] ℹ️  Message ${messageId} not found in any campaign (might be regular CRM message)`);
        }
      } catch (error) {
        console.error('[CampaignWebhook] Error processing status:', error);
      }
    }
  }

  /**
   * Find campaign that contains a specific message ID and recipient phone
   */
  private async findCampaignByMessageId(messageId: string, recipientPhone: string): Promise<{ id: string } | null> {
    try {
      // Query database directly for better performance
      const result = await campaignStorage.findCampaignByMessageId(messageId, recipientPhone);
      return result;
    } catch (error) {
      console.error('[CampaignWebhook] Error finding campaign:', error);
      return null;
    }
  }
}

export const campaignWebhookHandler = new CampaignWebhookHandler();
