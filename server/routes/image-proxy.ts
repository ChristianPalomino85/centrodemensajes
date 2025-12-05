/**
 * Image Proxy Route
 * Proxies external images (like Facebook CDN) to bypass CORS and referrer restrictions
 */

import { Router } from 'express';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import logger from '../utils/logger';

export function createImageProxyRouter(): Router {
  const router = Router();

  /**
   * GET /image-proxy
   * Proxies an image from an external URL
   * Query params: url (the image URL to proxy)
   */
  router.get('/image-proxy', async (req, res) => {
    try {
      const imageUrl = req.query.url as string;

      if (!imageUrl) {
        res.status(400).json({ error: 'Missing url parameter' });
        return;
      }

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch (error) {
        res.status(400).json({ error: 'Invalid URL' });
        return;
      }

      // Only allow HTTPS URLs from Facebook CDN
      if (parsedUrl.protocol !== 'https:') {
        res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
        return;
      }

      if (!parsedUrl.hostname.includes('fbcdn.net')) {
        res.status(400).json({ error: 'Only Facebook CDN URLs are allowed' });
        return;
      }

      // Make request to external URL
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const proxyReq = protocol.get(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Referer': 'https://www.facebook.com/',
          'Origin': 'https://www.facebook.com',
        },
        timeout: 10000, // 10 seconds
      }, (proxyRes) => {
        // Check status code
        if (proxyRes.statusCode !== 200) {
          logger.error(`[ImageProxy] Failed to fetch image: ${proxyRes.statusCode}`);
          res.status(proxyRes.statusCode || 500).json({
            error: 'Failed to fetch image',
            statusCode: proxyRes.statusCode
          });
          return;
        }

        // Set cache headers (cache for 1 hour)
        res.set({
          'Content-Type': proxyRes.headers['content-type'] || 'image/png',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        });

        // Pipe the image data to response
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (error) => {
        logger.error('[ImageProxy] Request error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to fetch image' });
        }
      });

      proxyReq.on('timeout', () => {
        logger.error('[ImageProxy] Request timeout');
        proxyReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({ error: 'Request timeout' });
        }
      });

    } catch (error) {
      logger.error('[ImageProxy] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  return router;
}
