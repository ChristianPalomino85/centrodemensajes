/**
 * Image Downloader Service
 * Downloads and stores external images (Facebook CDN) locally
 */

import https from 'https';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from '../utils/logger';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'ad-images');

/**
 * Ensures the upload directory exists
 */
async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Downloads an image from a URL and saves it locally
 * @param imageUrl The URL of the image to download
 * @returns The local path to the saved image, or null if failed
 */
export async function downloadAndStoreImage(imageUrl: string): Promise<string | null> {
  try {
    await ensureUploadDir();

    // Generate unique filename based on URL hash
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const filename = `${hash}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    // Check if file already exists
    try {
      await fs.access(filepath);
      logger.info(`[ImageDownloader] Image already exists: ${filename}`);
      return `/uploads/ad-images/${filename}`;
    } catch {
      // File doesn't exist, continue with download
    }

    // Download image
    const parsedUrl = new URL(imageUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = protocol.get(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'image/*,*/*;q=0.8',
          'Referer': 'https://www.facebook.com/',
        },
        timeout: 15000,
      }, (res) => {
        if (res.statusCode !== 200) {
          logger.error(`[ImageDownloader] Failed to download: ${res.statusCode}`);
          resolve(null);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            await fs.writeFile(filepath, buffer);
            logger.info(`[ImageDownloader] ✅ Saved image: ${filename} (${buffer.length} bytes)`);
            resolve(`/uploads/ad-images/${filename}`);
          } catch (error) {
            logger.error('[ImageDownloader] Error saving file:', error);
            resolve(null);
          }
        });
      });

      req.on('error', (error) => {
        logger.error('[ImageDownloader] Download error:', error);
        resolve(null);
      });

      req.on('timeout', () => {
        logger.error('[ImageDownloader] Download timeout');
        req.destroy();
        resolve(null);
      });
    });
  } catch (error) {
    logger.error('[ImageDownloader] Error:', error);
    return null;
  }
}

/**
 * Downloads multiple images concurrently
 */
export async function downloadMultipleImages(urls: string[]): Promise<(string | null)[]> {
  return Promise.all(urls.map(url => downloadAndStoreImage(url)));
}
