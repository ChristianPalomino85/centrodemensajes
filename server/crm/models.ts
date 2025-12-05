export type ConversationStatus = "active" | "attending" | "closed";

export type ChannelType = "whatsapp" | "facebook" | "instagram" | "tiktok";

export interface AIAnalysis {
  summary?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  topics?: string[];
  keywords?: string[];
}

export interface AdReferralData {
  sourceUrl?: string;        // URL del anuncio/post de Facebook
  sourceId?: string;         // ID del anuncio (Ad ID)
  sourceType?: string;       // "ad" o "post"
  headline?: string;         // Título del anuncio
  body?: string;             // Descripción del anuncio
  mediaType?: string;        // "image" o "video"
  imageUrl?: string;         // URL de imagen del anuncio
  videoUrl?: string;         // URL de video del anuncio
  thumbnailUrl?: string;     // URL de thumbnail
  ctwaClid?: string;         // Click ID de Meta (CRÍTICO para medir ROI)
}

export interface Conversation {
  id: string;
  phone: string;
  contactName: string | null;
  bitrixId: string | null;
  bitrixDocument: string | null;  // Número de documento del contacto en Bitrix
  autorizaPublicidad: string | null;  // ID del campo UF_CRM_1753421555 (Si/No/Por confirmar)
  avatarUrl: string | null;        // URL de la foto de perfil (WhatsApp o Bitrix)
  lastMessageAt: number;
  lastClientMessageAt?: number | null;  // Timestamp del último mensaje incoming (del cliente) - para ventana 24h
  unread: number;
  status: ConversationStatus;
  closedReason: string | null;     // Reason for closing (archived, completed, timeout, etc.)
  lastMessagePreview: string | null;
  assignedTo: string | null;       // Advisor email/ID who accepted the conversation
  assignedAt: number | null;       // Timestamp when assigned
  queuedAt: number | null;         // Timestamp when entered queue (first "active" status)
  queueId: string | null;          // CRITICAL: Queue ID - prevents conversations from going to limbo when bot transfers
  channel: ChannelType;            // CRITICAL: Channel type (whatsapp, facebook, etc)
  channelConnectionId: string | null;  // CRITICAL: ID of the specific WhatsApp number/connection
  displayNumber: string | null;    // Display number for this connection (e.g., "+51 1 6193636")
  attendedBy: string[];            // Array of advisor userIds who have attended this conversation
  ticketNumber: number | null;     // Número correlativo del ticket/chat
  category: string | null;         // Categoría de la conversación (cat-masivos, cat-en-cola-bot, etc)
  campaignIds: string[];           // Array de IDs de campañas masivas recibidas
  aiAnalysis?: AIAnalysis;         // AI-powered conversation analysis
  adReferral?: AdReferralData;     // Datos de tracking de anuncios de Facebook/Instagram
}

export type MessageDirection = "incoming" | "outgoing";

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "system";

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface Message {
  id: string;
  convId: string;
  direction: MessageDirection;
  type: MessageType;
  text: string | null;
  mediaUrl: string | null;
  mediaThumb: string | null;
  repliedToId: string | null;
  status: MessageStatus;
  createdAt: number;
  metadata?: Record<string, unknown>;  // Metadata adicional (ej: backgroundColor para mensajes del sistema)
  sentBy?: string | null;  // Nombre del asesor que envió el mensaje (solo para mensajes outgoing, no visible para el cliente)
  eventType?: string;  // Tipo de evento del sistema (conversation_accepted, conversation_transferred, etc.)
}

export interface Attachment {
  id: string;
  msgId: string | null;
  filename: string;
  mime: string;
  size: number;
  url: string;
  thumbUrl: string | null;
  createdAt: number;
}

export interface CRMEmitMessage {
  message: Message;
  attachment?: Attachment | null;
}

export interface CRMEmitConversation {
  conversation: Conversation;
}

export interface UploadResult {
  attachment: Attachment;
}
