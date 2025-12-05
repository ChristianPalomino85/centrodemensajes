export type ConversationStatus = "active" | "attending" | "closed";

export type ChannelType = "whatsapp" | "facebook" | "instagram" | "tiktok";

export interface Conversation {
  id: string;
  phone: string;
  contactName: string | null;
  bitrixId: string | null;
  bitrixDocument: string | null;  // Número de documento del contacto en Bitrix
  autorizaPublicidad?: string | null;  // ID del campo UF_CRM_1753421555 (Si/No/Por confirmar)
  avatarUrl: string | null;        // URL de la foto de perfil (WhatsApp o Bitrix)
  lastMessageAt: number;
  lastClientMessageAt?: number | null;  // Timestamp del último mensaje incoming (del cliente) - para ventana 24h
  unread: number;
  status: ConversationStatus;
  lastMessagePreview: string | null;
  assignedTo: string | null;       // Advisor email/ID who accepted the conversation (primary)
  assignedAt: number | null;       // Timestamp when assigned
  readAt?: number | null;          // Timestamp when advisor opened the chat (marks as "read")
  transferredFrom?: string | null; // TEMPORARY: UserID of advisor who transferred this chat (cleared on finalize)
  transferredAt?: number | null;   // TEMPORARY: Timestamp when transferred (cleared on finalize)
  queuedAt: number | null;         // Timestamp when entered queue
  queueId: string | null;          // CRITICAL: Queue ID - prevents conversations from going to limbo
  channel: ChannelType;            // CRITICAL: Channel type (whatsapp, facebook, etc)
  channelConnectionId: string | null;  // CRITICAL: ID of the specific WhatsApp number/connection
  displayNumber: string | null;    // Display number for this connection (e.g., "+51 1 6193636")
  attendedBy?: string[];           // Array of advisor userIds who have attended this conversation (optional for backwards compatibility)
  activeAdvisors?: string[];       // Array of advisor IDs currently active in this conversation (for collaboration)
  ticketNumber?: number | null;    // Número correlativo del ticket/chat
  isFavorite?: boolean;            // Marcado como favorito por algún asesor
  pinned?: boolean;                // Conversación fijada/pineada arriba de la lista
  pinnedAt?: number | null;        // Timestamp cuando se pineó (para ordenar múltiples pineados)
  botStartedAt?: number | null;    // Timestamp cuando el bot inició la atención
  botFlowId?: string | null;       // ID del flujo que está atendiendo el bot
  category?: string | null;        // Categoría personalizada (ej: "desconocido" para envíos masivos)
  campaignId?: string | null;      // ID de campaña masiva (si el chat viene de un envío masivo)
  closedReason?: string | null;    // Razón de cierre ('manual', 'archived', etc.)
  // Bounce system removed - distribution happens on advisor connection
}

export type MessageDirection = "incoming" | "outgoing";

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "system"
  | "event" // Eventos de trazabilidad
  | "template"; // Plantillas de WhatsApp

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
  sentBy?: string | null;  // Nombre del asesor que envió el mensaje (solo visible internamente)
  sentByUserId?: string | null;  // ID del asesor que envió (para avatares y colores)
  eventType?: EventType;  // Tipo de evento de trazabilidad (solo para type === "event")
  eventData?: Record<string, any>;  // Datos adicionales del evento
  metadata?: Record<string, any>;  // Metadata adicional (ej: backgroundColor para mensajes del sistema)
}

// Tipos de eventos de trazabilidad
export type EventType =
  | "conversation_accepted"      // Asesor aceptó el chat
  | "conversation_rejected"      // Asesor rechazó el chat
  | "conversation_transferred"   // Chat transferido a otro asesor/bot/cola
  | "advisor_joined"             // Asesor se unió al chat
  | "advisor_left"               // Asesor salió del chat
  | "conversation_queued"        // Chat derivado a una cola
  | "conversation_archived"      // LEGACY: Chat cerrado (servidor usa status='closed', no envía este evento)
  | "conversation_reopened"      // Chat reabierto
  | "note_added";                // Nota interna agregada

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

export interface ConversationBundle {
  conversation: Conversation;
  messages: Message[];
  attachments: Attachment[];
}
