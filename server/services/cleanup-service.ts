import fs from 'fs/promises';
import path from 'path';
import { botLogger } from '../../src/runtime/monitoring';

/**
 * Service to clean up old files and logs to prevent disk saturation
 */
export class CleanupService {
  private readonly UPLOADS_DIR = path.join(process.cwd(), 'uploads');
  private readonly LOGS_DIR = path.join(process.cwd(), 'logs');
  private readonly TEMP_DIR = path.join(process.cwd(), 'tmp');

  // Configuration: Retention periods in days
  private readonly RETENTION_DAYS = {
    uploads: 30, // Keep user uploads for 30 days
    logs: 14,    // Keep logs for 14 days
    tmp: 1       // Keep temp files for 1 day
  };

  /**
   * Run full cleanup routine
   */
  async runCleanup(): Promise<void> {
    console.log('[CleanupService] 🧹 Starting scheduled cleanup...');

    try {
      await this.cleanupDirectory(this.UPLOADS_DIR, this.RETENTION_DAYS.uploads);
      await this.cleanupDirectory(this.LOGS_DIR, this.RETENTION_DAYS.logs);
      await this.cleanupDirectory(this.TEMP_DIR, this.RETENTION_DAYS.tmp);

      console.log('[CleanupService] ✅ Cleanup completed successfully');
    } catch (error) {
      console.error('[CleanupService] ❌ Error during cleanup:', error);
      botLogger.error('[CleanupService] Failed to run cleanup', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Clean a specific directory deleting files older than maxAgeDays
   */
  private async cleanupDirectory(dirPath: string, maxAgeDays: number): Promise<void> {
    try {
      // Check if directory exists
      try {
        await fs.access(dirPath);
      } catch {
        // Directory doesn't exist, skip
        return;
      }

      const files = await fs.readdir(dirPath);
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        // Skip hidden files (.gitkeep, etc)
        if (file.startsWith('.')) continue;

        const filePath = path.join(dirPath, file);

        try {
          const stats = await fs.stat(filePath);

          if (stats.isDirectory()) {
            // Recursively clean subdirectories (e.g. uploads/2023/10)
            await this.cleanupDirectory(filePath, maxAgeDays);

            // Try to remove empty directories
            const subFiles = await fs.readdir(filePath);
            if (subFiles.length === 0) {
              await fs.rmdir(filePath);
            }
            continue;
          }

          const age = now - stats.mtimeMs;

          if (age > maxAgeMs) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (err) {
          console.warn(`[CleanupService] Failed to process file ${file}:`, err);
        }
      }

      if (deletedCount > 0) {
        console.log(`[CleanupService] Deleted ${deletedCount} old files from ${dirPath}`);
      }
    } catch (error) {
      console.error(`[CleanupService] Error cleaning directory ${dirPath}:`, error);
    }
  }
}

export const cleanupService = new CleanupService();
