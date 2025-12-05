/**
 * Unified Types for Multi-Channel Messaging
 * Normalizes messages from WhatsApp, Instagram, and Facebook
 */

// ============ CHANNELS ============

export type ChannelType = 'whatsapp' | 'instagram' | 'facebook';

export type MessageSource =
  | 'whatsapp_dm'
  | 'instagram_dm'
  | 'instagram_comment'
  | 'instagram_story_reply'
  | 'instagram_story_mention'
  | 'facebook_messenger'
  | 'facebook_comment';

// ============ UNIFIED MESSAGE ============

export interface UnifiedMessage {
  id: string;
  externalId: string;  // ID from Meta
  channel: ChannelType;
  source: MessageSource;
  timestamp: Date;

  // Sender info
  from: {
    id: string;
    name?: string;
    username?: string;      // Instagram username
    profilePic?: string;
    phone?: string;         // WhatsApp only
  };

  // Recipient (your business account)
  to: {
    id: string;
    name?: string;
    pageId?: string;        // Facebook/Instagram page ID
    phoneNumberId?: string; // WhatsApp phone number ID
  };

  // Message content
  type: MessageType;
  content: MessageContent;

  // Context
  context?: {
    replyToId?: string;     // ID of message being replied to
    postId?: string;        // For comments: which post
    commentId?: string;     // For replies: which comment
    storyId?: string;       // For story replies/mentions
    adId?: string;          // For ad comments
  };

  // Metadata
  metadata?: Record<string, any>;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'story_reply'
  | 'story_mention'
  | 'comment'
  | 'comment_reply';

export interface MessageContent {
  text?: string;
  caption?: string;

  // Media
  mediaUrl?: string;
  mediaType?: string;
  mediaMimeType?: string;
  thumbnailUrl?: string;

  // Sticker
  stickerId?: string;

  // Location
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  // Contact
  contact?: {
    name: string;
    phone?: string;
    email?: string;
  };

  // Reaction
  reaction?: {
    emoji: string;
    targetMessageId: string;
  };

  // Story context
  storyUrl?: string;
  storyMediaType?: 'image' | 'video';
}

// ============ OUTBOUND MESSAGE ============

export interface OutboundMessage {
  channel: ChannelType;
  recipientId: string;

  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'template' | 'reaction' | 'comment_reply';

  content: {
    text?: string;
    mediaUrl?: string;
    caption?: string;
    templateName?: string;
    templateParams?: Record<string, string>;
    reaction?: string;
  };

  // For comment replies
  context?: {
    commentId?: string;
    postId?: string;
    isPrivateReply?: boolean;  // Send DM instead of public reply
  };

  // Metadata
  metadata?: Record<string, any>;
}

// ============ CONVERSATION ============

export interface Conversation {
  id: string;
  channel: ChannelType;
  source: MessageSource;

  customer: {
    id: string;
    name?: string;
    username?: string;
    phone?: string;
    profilePic?: string;
  };

  business: {
    id: string;
    name?: string;
    pageId?: string;
    phoneNumberId?: string;
  };

  status: 'active' | 'closed' | 'pending';

  // Bitrix integration
  bitrix?: {
    lineId?: string;
    chatId?: string;
    contactId?: string;
    leadId?: string;
  };

  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}

// ============ WEBHOOK EVENTS ============

export interface MetaWebhookEvent {
  object: 'whatsapp_business_account' | 'instagram' | 'page';
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string;
  time: number;
  changes?: MetaWebhookChange[];
  messaging?: MetaMessagingEvent[];
}

export interface MetaWebhookChange {
  field: string;
  value: any;
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: any;
  reaction?: any;
  postback?: any;
  read?: any;
  delivery?: any;
}

// ============ BITRIX OPEN CHANNELS ============

export interface BitrixConnectorConfig {
  connectorId: string;
  connectorName: string;
  lineId?: string;
  handlerUrl: string;
  iconUrl?: string;
}

export interface BitrixMessagePayload {
  CONNECTOR: string;
  LINE: string;
  MESSAGES: BitrixMessage[];
}

export interface BitrixMessage {
  user: {
    id: string;
    name?: string;
    last_name?: string;
    avatar?: string;
    url?: string;
    phone?: string;
  };
  message: {
    id: string;
    date: number;
    text?: string;
    files?: BitrixFile[];
    disable_crm?: 'Y' | 'N';
  };
  chat: {
    id: string;
    name?: string;
    url?: string;
  };
}

export interface BitrixFile {
  name: string;
  link: string;
  type?: string;
}

// ============ SERVICE RESPONSES ============

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  externalId?: string;
  error?: string;
}

export interface ChannelHealth {
  channel: ChannelType;
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: Date;
  latencyMs?: number;
  error?: string;
}

// ============ CONFIGURATION ============

export interface ChannelConfig {
  enabled: boolean;

  // Meta API credentials
  accessToken: string;
  appSecret?: string;
  verifyToken: string;

  // WhatsApp specific
  whatsapp?: {
    phoneNumberId: string;
    businessAccountId: string;
  };

  // Instagram specific
  instagram?: {
    pageId: string;
    igUserId: string;
  };

  // Facebook specific
  facebook?: {
    pageId: string;
    pageAccessToken?: string;
  };
}

export interface BitrixConfig {
  enabled: boolean;
  domain: string;
  accessToken?: string;
  refreshToken?: string;
  webhookUrl?: string;
  connectorId: string;
}

export interface ServiceConfig {
  port: number;
  flowBuilderUrl: string;
  channels: {
    whatsapp: ChannelConfig;
    instagram: ChannelConfig;
    facebook: ChannelConfig;
  };
  bitrix: BitrixConfig;
}
