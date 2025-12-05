/**
 * Sales Sync Job
 * Runs periodically to sync sales with WhatsApp conversations
 */

import { syncSalesWithWhatsApp } from '../services/sales-whatsapp-sync';

let isRunning = false;

export async function runSalesSyncJob() {
  if (isRunning) {
    console.log('[SalesSyncJob] Sync already running, skipping...');
    return;
  }

  isRunning = true;

  try {
    console.log(`[SalesSyncJob] Starting scheduled sync at ${new Date().toISOString()}`);
    const result = await syncSalesWithWhatsApp();
    console.log('[SalesSyncJob] Sync completed successfully:', result);
  } catch (error) {
    console.error('[SalesSyncJob] Sync failed:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start automatic sync job (every 6 hours)
 */
export function startSalesSyncSchedule() {
  console.log('[SalesSyncJob] Starting automatic sync schedule (every 6 hours)');

  // Run immediately on startup
  setTimeout(() => {
    console.log('[SalesSyncJob] Running initial sync on startup...');
    runSalesSyncJob();
  }, 10000); // Wait 10 seconds after server start

  // Then run every 6 hours
  setInterval(() => {
    runSalesSyncJob();
  }, 6 * 60 * 60 * 1000); // 6 hours
}
