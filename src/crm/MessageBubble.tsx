import { useState, useEffect } from "react";
import type { Attachment, Message } from "./types";
import AttachmentPreview from "./AttachmentPreview";
import { apiUrl } from "../lib/apiBase";

interface MessageBubbleProps {
  message: Message;
  attachments: Attachment[];
  repliedTo: Message | null;
  repliedAttachments: Attachment[];
  onReply: () => void;
  onScrollToMessage?: (messageId: string) => void;
}

interface ChatTheme {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  incomingBubbleBg: string;
  incomingTextColor: string;
  outgoingBubbleBg: string;
  outgoingTextColor: string;
  chatBackgroundImage?: string;
  chatBackgroundColor?: string;
}

const DEFAULT_THEME: ChatTheme = {
  fontFamily: "system-ui",
  fontSize: "13px",
  fontWeight: "400",
  incomingBubbleBg: "#ffffff",
  incomingTextColor: "#1e293b",
  outgoingBubbleBg: "#10b981",
  outgoingTextColor: "#ffffff",
  chatBackgroundImage: "",
  chatBackgroundColor: "",
};

export default function MessageBubble({ message, attachments, repliedTo, repliedAttachments, onReply, onScrollToMessage }: MessageBubbleProps) {
  const isOutgoing = message.direction === "outgoing" || message.direction === "out";
  const isSystem = message.direction === "system" || message.type === "event";
  const [theme, setTheme] = useState<ChatTheme>(DEFAULT_THEME);

  // Load theme preferences on mount
  useEffect(() => {
    loadTheme();

    // Listen for theme changes
    const handleThemeChange = (event: CustomEvent) => {
      setTheme(event.detail);
    };

    window.addEventListener("chat-theme-changed", handleThemeChange as EventListener);
    return () => {
      window.removeEventListener("chat-theme-changed", handleThemeChange as EventListener);
    };
  }, []);

  const loadTheme = async () => {
    try {
      const response = await fetch(apiUrl("/api/user-profile/chat-theme"), {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.preferences) {
          setTheme(data.preferences);
        }
      }
    } catch (error) {
      console.error("Error loading chat theme:", error);
    }
  };

  const alignment = isOutgoing ? "items-end" : "items-start";
  const containerAlign = isOutgoing ? "ml-auto" : "mr-auto";

  // Get dynamic bubble styles from theme
  const bubbleStyle: React.CSSProperties = {
    backgroundColor: isOutgoing ? theme.outgoingBubbleBg : theme.incomingBubbleBg,
    color: isOutgoing ? theme.outgoingTextColor : theme.incomingTextColor,
    fontFamily: theme.fontFamily,
    fontWeight: theme.fontWeight,
  };

  // Keep border and shadow classes separate for styling
  const bubbleBaseClasses = isOutgoing
    ? "shadow-lg"
    : "border border-slate-200 shadow-md";

  const handleReplyClick = () => {
    if (repliedTo && onScrollToMessage) {
      onScrollToMessage(repliedTo.id);
    }
  };

  // Parse template data if message is a template
  let displayText = message.text;
  let templateComponents: any[] = [];

  if (message.type === 'template' && message.text) {
    try {
      const templateData: { templateName: string; language: string; components?: any[] } = JSON.parse(message.text);
      templateComponents = templateData.components || [];

      // Build display text from template components
      const bodyComponent = templateComponents.find((c: any) => c.type === 'BODY');
      const headerComponent = templateComponents.find((c: any) => c.type === 'HEADER');
      const footerComponent = templateComponents.find((c: any) => c.type === 'FOOTER');

      let parts: string[] = [];

      // Add header if exists
      if (headerComponent?.text) {
        parts.push(`*${headerComponent.text}*`);
      } else if (headerComponent?.format === 'IMAGE') {
        parts.push('🖼️ [Imagen]');
      }

      // Add body
      if (bodyComponent?.text) {
        parts.push(bodyComponent.text);
      }

      // Add footer
      if (footerComponent?.text) {
        parts.push(`_${footerComponent.text}_`);
      }

      displayText = parts.length > 0
        ? parts.join('\n\n')
        : `📋 Plantilla: ${templateData.templateName}`;

    } catch (e) {
      // If JSON parsing fails, just display as-is
      displayText = message.text;
    }
  }

  // Extract buttons and menu options from metadata (for bot messages)
  const metadata = message.metadata as any;
  const buttons = metadata?.buttons || [];
  const menuOptions = metadata?.menuOptions || [];

  // Render system messages differently
  if (isSystem) {
    return (
      <div className="flex justify-center my-3" id={`message-${message.id}`}>
        <div className="max-w-[80%] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-center">
          <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
            {displayText}
          </p>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {new Date(message.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    );
  }

  // Check if message has media URL but no attachments
  const hasMediaUrl = message.mediaUrl || message.mediaThumb;
  const shouldRenderMedia = attachments.length === 0 && hasMediaUrl;

  return (
    <div className={`flex ${alignment}`} id={`message-${message.id}`}>
      <div
        className={`max-w-[75%] rounded-xl px-3 py-2.5 ${bubbleBaseClasses} ${containerAlign} backdrop-blur-sm`}
        style={bubbleStyle}
      >
        {/* Nombre del remitente */}
        {!isOutgoing && (
          <p className="text-[10px] font-semibold mb-1 opacity-90">
            {message.sentBy || "Cliente"}
          </p>
        )}
        {isOutgoing && (
          <p className="text-[10px] font-semibold mb-1 opacity-90">
            {message.sentBy || "Bot"}
          </p>
        )}
        {repliedTo && (
          <div
            className={`mb-2 rounded-lg border-l-3 ${isOutgoing ? "border-white/70" : "border-emerald-500"} bg-black/5 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-black/10 transition-colors`}
            role="button"
            onClick={handleReplyClick}
            title="Click para ir al mensaje original"
          >
            <p className="font-semibold text-[10px] mb-0.5">Respuesta a:</p>
            <ReplyPreview message={repliedTo} attachments={repliedAttachments} />
          </div>
        )}
        {displayText && (
          <p className="whitespace-pre-wrap leading-relaxed" style={{ fontSize: theme.fontSize }}>
            {displayText}
          </p>
        )}
        {/* Render buttons if present */}
        {buttons.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {buttons.map((btn: any, idx: number) => (
              <div
                key={idx}
                className={`px-3 py-2 rounded-lg text-center text-sm font-medium border-2 ${
                  isOutgoing
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}
              >
                {btn.label}
              </div>
            ))}
          </div>
        )}
        {/* Render menu options if present */}
        {menuOptions.length > 0 && (
          <div className="mt-3 space-y-1">
            {menuOptions.map((opt: any, idx: number) => (
              <div
                key={idx}
                className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2 ${
                  isOutgoing
                    ? 'bg-white/10 text-white/90'
                    : 'bg-slate-50 text-slate-700'
                }`}
              >
                <span className={`${isOutgoing ? 'text-white/70' : 'text-emerald-600'}`}>
                  {idx + 1}.
                </span>
                {opt.label}
              </div>
            ))}
          </div>
        )}
        {/* Render attachments array */}
        {attachments.length > 0 && (
          <div className="mt-2 space-y-2">
            {attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} attachment={attachment} compact={false} />
            ))}
          </div>
        )}
        {/* Render media from message.mediaUrl if no attachments */}
        {shouldRenderMedia && (message.type === 'image' || message.type === 'sticker') && (
          <div className="mt-2">
            <img
              src={message.mediaUrl || ''}
              alt={displayText || 'Imagen'}
              className="max-w-full rounded-lg border border-white/20"
              style={{ maxHeight: '300px' }}
            />
          </div>
        )}
        {shouldRenderMedia && message.type === 'document' && (
          <div className="mt-2 flex items-center gap-2 p-3 bg-black/5 rounded-lg border border-white/20">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{displayText || 'Documento'}</p>
              {metadata?.file_size && (
                <p className="text-[10px] opacity-70">{Math.round(metadata.file_size / 1024)} KB</p>
              )}
            </div>
            <a
              href={message.mediaUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
            >
              Abrir
            </a>
          </div>
        )}
        {shouldRenderMedia && message.type === 'location' && metadata?.latitude && (
          <div className="mt-2 p-3 bg-black/5 rounded-lg border border-white/20">
            <p className="text-xs font-medium mb-1">📍 Ubicación compartida</p>
            {metadata.address && (
              <p className="text-[10px] opacity-70">{metadata.address}</p>
            )}
            <a
              href={`https://www.google.com/maps?q=${metadata.latitude},${metadata.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline mt-1 inline-block"
            >
              Ver en mapa
            </a>
          </div>
        )}
        <div className={`mt-1.5 flex items-center gap-2 text-[10px] ${isOutgoing ? "text-white/70" : "text-slate-400"}`}>
          <span>{new Date(message.createdAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>
          {isOutgoing && <StatusBadge status={message.status} />}
          <button
            type="button"
            onClick={onReply}
            className={`ml-1 text-[10px] font-medium underline decoration-dotted underline-offset-2 ${isOutgoing ? "text-white/80 hover:text-white" : "text-emerald-600 hover:text-emerald-700"} transition-colors`}
          >
            Responder
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Message["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1" title="Enviando...">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="3" />
            <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      );
    case "sent":
      return (
        <span className="text-white/90" title="Enviado">
          ✓
        </span>
      );
    case "delivered":
      return (
        <span className="text-white/90" title="Entregado">
          ✓✓
        </span>
      );
    case "read":
      return (
        <span className="text-blue-400 font-bold drop-shadow-[0_0_4px_rgba(96,165,250,0.8)]" title="Leído">
          ✓✓
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-rose-100" title="Falló el envío">
          ⚠️
        </span>
      );
    default:
      return null;
  }
}

function ReplyPreview({ message, attachments }: { message: Message; attachments: Attachment[] }) {
  const hasAttachment = attachments.length > 0;
  const isImageType = message.type === 'image' || message.type === 'sticker';
  const isAudioType = message.type === 'audio';
  const isVideoType = message.type === 'video';
  const isDocumentType = message.type === 'document';

  // Show media from either attachments OR message.mediaUrl/mediaThumb
  const hasMediaUrl = message.mediaUrl || message.mediaThumb;

  return (
    <div className="flex gap-2">
      <div className="flex-1 space-y-1 min-w-0">
        {message.text && <p className="line-clamp-2 text-xs opacity-90">{message.text}</p>}
        {!message.text && isImageType && (
          <p className="text-xs opacity-70 italic">Imagen</p>
        )}
        {!message.text && isAudioType && (
          <p className="text-xs opacity-70 italic">Audio</p>
        )}
        {!message.text && isVideoType && (
          <p className="text-xs opacity-70 italic">Video</p>
        )}
        {!message.text && isDocumentType && (
          <p className="text-xs opacity-70 italic">Documento</p>
        )}
      </div>
      {/* Show attachment preview if available */}
      {hasAttachment && (
        <div className="flex-shrink-0">
          <AttachmentPreview attachment={attachments[0]} compact />
        </div>
      )}
      {/* Show media thumbnail from message if no attachment but has mediaUrl - ALWAYS show for images/videos */}
      {!hasAttachment && hasMediaUrl && (isImageType || isVideoType) && (
        <div className="flex-shrink-0">
          <img
            src={message.mediaThumb || message.mediaUrl || ''}
            alt="Vista previa del multimedia"
            className="h-12 w-12 rounded object-cover border border-white/20"
          />
        </div>
      )}
    </div>
  );
}
