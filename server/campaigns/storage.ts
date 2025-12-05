import fs from 'fs';
import path from 'path';
import type { Campaign, CampaignMetrics, CampaignMessageDetail } from './models';

interface CampaignStore {
  campaigns: Campaign[];
  metrics: Record<string, CampaignMetrics>; // campaignId -> metrics
}

export class CampaignStorage {
  private readonly storageFile: string;
  private store: CampaignStore;

  constructor(dataDir: string = './data') {
    this.storageFile = path.join(dataDir, 'campaigns.json');
    this.ensureDir(dataDir);
    this.store = this.loadStore();
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadStore(): CampaignStore {
    if (!fs.existsSync(this.storageFile)) {
      return { campaigns: [], metrics: {} };
    }
    try {
      const data = fs.readFileSync(this.storageFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('[CampaignStorage] Error loading campaigns:', error);
      return { campaigns: [], metrics: {} };
    }
  }

  private saveStore(): void {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (error) {
      console.error('[CampaignStorage] Error saving campaigns:', error);
    }
  }

  // ============================================
  // CAMPAIGNS CRUD
  // ============================================

  createCampaign(campaign: Campaign): Campaign {
    this.store.campaigns.push(campaign);

    // Initialize metrics
    this.store.metrics[campaign.id] = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      totalRecipients: campaign.recipients.length,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      responded: 0,
      clicked: 0,
      details: campaign.recipients.map(phone => ({
        phone,
        status: 'pending',
      })),
    };

    this.saveStore();
    console.log(`[CampaignStorage] Created campaign: ${campaign.id} - ${campaign.name}`);
    return campaign;
  }

  getCampaign(id: string): Campaign | undefined {
    return this.store.campaigns.find(c => c.id === id);
  }

  getAllCampaigns(): Campaign[] {
    return [...this.store.campaigns].sort((a, b) => b.createdAt - a.createdAt);
  }

  updateCampaignStatus(id: string, status: Campaign['status']): void {
    const campaign = this.store.campaigns.find(c => c.id === id);
    if (!campaign) return;

    campaign.status = status;

    if (status === 'sending' && !campaign.startedAt) {
      campaign.startedAt = Date.now();
    }

    if ((status === 'completed' || status === 'failed' || status === 'cancelled') && !campaign.completedAt) {
      campaign.completedAt = Date.now();
    }

    this.saveStore();
  }

  deleteCampaign(id: string): boolean {
    const index = this.store.campaigns.findIndex(c => c.id === id);
    if (index === -1) return false;

    this.store.campaigns.splice(index, 1);
    delete this.store.metrics[id];
    this.saveStore();
    return true;
  }

  // ============================================
  // METRICS
  // ============================================

  getCampaignMetrics(id: string): CampaignMetrics | undefined {
    return this.store.metrics[id];
  }

  updateMessageStatus(
    campaignId: string,
    phone: string,
    status: CampaignMessageDetail['status'],
    extraData?: Partial<CampaignMessageDetail>
  ): void {
    const metrics = this.store.metrics[campaignId];
    if (!metrics) return;

    const detail = metrics.details.find(d => d.phone === phone);
    if (!detail) return;

    const oldStatus = detail.status;
    detail.status = status;

    // Update timestamps
    if (status === 'sent' && !detail.sentAt) {
      detail.sentAt = Date.now();
    }
    if (status === 'delivered' && !detail.deliveredAt) {
      detail.deliveredAt = Date.now();
    }
    if (status === 'read' && !detail.readAt) {
      detail.readAt = Date.now();
    }

    // Apply extra data
    if (extraData) {
      Object.assign(detail, extraData);
      if (extraData.messageId && !detail.messageId) {
        detail.messageId = extraData.messageId;
      }
    }

    // Update counters
    if (oldStatus !== status) {
      // Decrement old status
      if (oldStatus === 'sent') metrics.sent--;
      else if (oldStatus === 'delivered') metrics.delivered--;
      else if (oldStatus === 'read') metrics.read--;
      else if (oldStatus === 'failed') metrics.failed--;

      // Increment new status
      if (status === 'sent') metrics.sent++;
      else if (status === 'delivered') metrics.delivered++;
      else if (status === 'read') metrics.read++;
      else if (status === 'failed') metrics.failed++;
    }

    // Update response/click counters
    if (extraData?.responded && !detail.responded) {
      metrics.responded++;
    }
    if (extraData?.clickedButton && !detail.clickedButton) {
      metrics.clicked++;
    }

    this.saveStore();
  }

  getAllMetrics(): CampaignMetrics[] {
    return Object.values(this.store.metrics).sort((a, b) => {
      const campaignA = this.getCampaign(a.campaignId);
      const campaignB = this.getCampaign(b.campaignId);
      return (campaignB?.createdAt || 0) - (campaignA?.createdAt || 0);
    });
  }
}

// MIGRATION COMPLETE: PostgreSQL only (JSON fallback removed)
import { campaignStorageDB } from './storage-db';

console.log('[Campaigns] 🐘 Using PostgreSQL storage (JSON mode deprecated)');

// Force PostgreSQL - JSON fallback has been removed
export const campaignStorage = campaignStorageDB;
