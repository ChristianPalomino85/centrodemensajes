/**
 * Cleanup Service
 * Automatic cleanup of old files to manage disk space
 *
 * Directories are configurable via environment variables (Claude fix)
 */

import fs from 'fs/promises';
import path from 'path';

// Configurable directories via environment variables (fixes hardcoded paths)
const UPLOADS_DIR = process.env.CLEANUP_UPLOADS_DIR || 'data/uploads';
const LOGS_DIR = process.env.CLEANUP_LOGS_DIR || 'logs';
const TMP_DIR = process.env.CLEANUP_TMP_DIR || 'tmp';

// Retention periods in days (configurable)
const UPLOADS_RETENTION_DAYS = parseInt(process.env.CLEANUP_UPLOADS_DAYS || '30', 10);
const LOGS_RETENTION_DAYS = parseInt(process.env.CLEANUP_LOGS_DAYS || '14', 10);
const TMP_RETENTION_DAYS = parseInt(process.env.CLEANUP_TMP_DAYS || '1', 10);

// Metrics for monitoring
let cleanupMetrics = {
  lastRun: null as Date | null,
  filesDeleted: 0,
  bytesFreed: 0,
  errors: 0,
  consecutiveFailures: 0,
};

export function getCleanupMetrics() {
  return { ...cleanupMetrics };
}

/**
 * Delete files older than specified days in a directory
 */
async function cleanupDirectory(
  dirPath: string,
  retentionDays: number,
  recursive = true
): Promise<{ deleted: number; bytesFreed: number; errors: number }> {
  const result = { deleted: 0, bytesFreed: 0, errors: 0 };
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const fullPath = path.join(process.cwd(), dirPath);

    // Check if directory exists
    try {
      await fs.access(fullPath);
    } catch {
      // Directory doesn't exist, nothing to clean
      return result;
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(fullPath, entry.name);

      try {
        if (entry.isDirectory() && recursive) {
          // Recursively clean subdirectories
          const subResult = await cleanupDirectory(
            path.join(dirPath, entry.name),
            retentionDays,
            recursive
          );
          result.deleted += subResult.deleted;
          result.bytesFreed += subResult.bytesFreed;
          result.errors += subResult.errors;

          // Try to remove empty directory (with race condition handling)
          try {
            const remaining = await fs.readdir(entryPath);
            if (remaining.length === 0) {
              await fs.rmdir(entryPath);
            }
          } catch (rmdirError: any) {
            // Handle race condition: files created between check and delete
            if (rmdirError.code !== 'ENOTEMPTY' && rmdirError.code !== 'ENOENT') {
              console.warn(`[Cleanup] Warning removing directory ${entryPath}:`, rmdirError.message);
            }
          }
        } else if (entry.isFile()) {
          const stats = await fs.stat(entryPath);

          if (stats.mtimeMs < cutoffTime) {
            await fs.unlink(entryPath);
            result.deleted++;
            result.bytesFreed += stats.size;
          }
        }
      } catch (error: any) {
        // Handle race condition: file deleted between readdir and operation
        if (error.code !== 'ENOENT') {
          console.error(`[Cleanup] Error processing ${entryPath}:`, error.message);
          result.errors++;
        }
      }
    }
  } catch (error: any) {
    console.error(`[Cleanup] Error cleaning directory ${dirPath}:`, error.message);
    result.errors++;
  }

  return result;
}

/**
 * Run cleanup for all configured directories
 */
export async function runCleanup(): Promise<void> {
  console.log('[Cleanup] 🧹 Starting scheduled cleanup...');
  const startTime = Date.now();

  let totalDeleted = 0;
  let totalBytesFreed = 0;
  let totalErrors = 0;

  // Cleanup uploads (oldest first)
  const uploadsResult = await cleanupDirectory(UPLOADS_DIR, UPLOADS_RETENTION_DAYS);
  totalDeleted += uploadsResult.deleted;
  totalBytesFreed += uploadsResult.bytesFreed;
  totalErrors += uploadsResult.errors;

  if (uploadsResult.deleted > 0) {
    console.log(`[Cleanup] 📁 Uploads: deleted ${uploadsResult.deleted} files (${formatBytes(uploadsResult.bytesFreed)})`);
  }

  // Cleanup logs
  const logsResult = await cleanupDirectory(LOGS_DIR, LOGS_RETENTION_DAYS);
  totalDeleted += logsResult.deleted;
  totalBytesFreed += logsResult.bytesFreed;
  totalErrors += logsResult.errors;

  if (logsResult.deleted > 0) {
    console.log(`[Cleanup] 📋 Logs: deleted ${logsResult.deleted} files (${formatBytes(logsResult.bytesFreed)})`);
  }

  // Cleanup temp files
  const tmpResult = await cleanupDirectory(TMP_DIR, TMP_RETENTION_DAYS);
  totalDeleted += tmpResult.deleted;
  totalBytesFreed += tmpResult.bytesFreed;
  totalErrors += tmpResult.errors;

  if (tmpResult.deleted > 0) {
    console.log(`[Cleanup] 🗑️ Temp: deleted ${tmpResult.deleted} files (${formatBytes(tmpResult.bytesFreed)})`);
  }

  // Update metrics
  cleanupMetrics.lastRun = new Date();
  cleanupMetrics.filesDeleted += totalDeleted;
  cleanupMetrics.bytesFreed += totalBytesFreed;
  cleanupMetrics.errors += totalErrors;

  // Track consecutive failures for alerting
  if (totalErrors > 0 && totalDeleted === 0) {
    cleanupMetrics.consecutiveFailures++;
  } else {
    cleanupMetrics.consecutiveFailures = 0;
  }

  const duration = Date.now() - startTime;
  console.log(`[Cleanup] ✅ Completed in ${duration}ms. Total: ${totalDeleted} files, ${formatBytes(totalBytesFreed)} freed, ${totalErrors} errors`);

  // Alert if too many consecutive failures
  if (cleanupMetrics.consecutiveFailures >= 3) {
    console.error(`[Cleanup] ⚠️ ALERT: ${cleanupMetrics.consecutiveFailures} consecutive cleanup failures!`);
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
