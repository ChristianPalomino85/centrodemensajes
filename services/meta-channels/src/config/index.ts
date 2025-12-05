/**
 * Configuration loader for Meta Channels Microservice
 */

import dotenv from 'dotenv';
import path from 'path';
import type { ServiceConfig } from '../types';

// Load .env from service directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config: ServiceConfig = {
  port: parseInt(process.env.META_CHANNELS_PORT || '3005', 10),
  flowBuilderUrl: process.env.FLOW_BUILDER_URL || 'http://localhost:3001',

  channels: {
    whatsapp: {
      enabled: process.env.WHATSAPP_ENABLED === 'true',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      appSecret: process.env.META_APP_SECRET || '',
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
      whatsapp: {
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      },
    },

    instagram: {
      enabled: process.env.INSTAGRAM_ENABLED === 'true',
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '',
      appSecret: process.env.META_APP_SECRET || '',
      verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || '',
      instagram: {
        pageId: process.env.INSTAGRAM_PAGE_ID || '',
        igUserId: process.env.INSTAGRAM_USER_ID || '',
      },
    },

    facebook: {
      enabled: process.env.FACEBOOK_ENABLED === 'true',
      accessToken: process.env.FACEBOOK_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '',
      appSecret: process.env.META_APP_SECRET || '',
      verifyToken: process.env.FACEBOOK_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || '',
      facebook: {
        pageId: process.env.FACEBOOK_PAGE_ID || '',
        pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      },
    },
  },

  bitrix: {
    enabled: process.env.BITRIX_ENABLED === 'true',
    domain: process.env.BITRIX_DOMAIN || '',
    accessToken: process.env.BITRIX_ACCESS_TOKEN || '',
    refreshToken: process.env.BITRIX_REFRESH_TOKEN || '',
    webhookUrl: process.env.BITRIX_WEBHOOK_URL || '',
    connectorId: process.env.BITRIX_CONNECTOR_ID || 'meta_channels',
  },
};

/**
 * Validate configuration
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if at least one channel is enabled
  const enabledChannels = Object.entries(config.channels)
    .filter(([_, cfg]) => cfg.enabled)
    .map(([name]) => name);

  if (enabledChannels.length === 0) {
    errors.push('At least one channel must be enabled');
  }

  // Validate WhatsApp config
  if (config.channels.whatsapp.enabled) {
    if (!config.channels.whatsapp.accessToken) {
      errors.push('WhatsApp: WHATSAPP_ACCESS_TOKEN is required');
    }
    if (!config.channels.whatsapp.whatsapp?.phoneNumberId) {
      errors.push('WhatsApp: WHATSAPP_PHONE_NUMBER_ID is required');
    }
  }

  // Validate Instagram config
  if (config.channels.instagram.enabled) {
    if (!config.channels.instagram.accessToken) {
      errors.push('Instagram: INSTAGRAM_ACCESS_TOKEN or META_ACCESS_TOKEN is required');
    }
    if (!config.channels.instagram.instagram?.pageId) {
      errors.push('Instagram: INSTAGRAM_PAGE_ID is required');
    }
  }

  // Validate Facebook config
  if (config.channels.facebook.enabled) {
    if (!config.channels.facebook.accessToken) {
      errors.push('Facebook: FACEBOOK_ACCESS_TOKEN or META_ACCESS_TOKEN is required');
    }
    if (!config.channels.facebook.facebook?.pageId) {
      errors.push('Facebook: FACEBOOK_PAGE_ID is required');
    }
  }

  // Validate Bitrix config
  if (config.bitrix.enabled) {
    if (!config.bitrix.domain) {
      errors.push('Bitrix: BITRIX_DOMAIN is required');
    }
    if (!config.bitrix.accessToken && !config.bitrix.webhookUrl) {
      errors.push('Bitrix: BITRIX_ACCESS_TOKEN or BITRIX_WEBHOOK_URL is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default config;
