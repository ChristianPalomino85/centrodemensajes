import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConversationList from "./ConversationList";
import ChatWindow from "./ChatWindow";
import WelcomeScreen from "./WelcomeScreen";
import type { Attachment, Conversation, Message } from "./types";
import { fetchConversations, fetchMessages, sendMessage, uploadAttachment } from "./crmApi";
import { createCrmSocket, type CrmSocket } from "./socket";
import { useNotifications } from "./useNotifications";
import { useSoundNotifications } from "./useSoundNotifications";
import { useDarkMode } from "./DarkModeContext";
import { useKeyboardShortcuts, KEYBOARD_SHORTCUTS } from "./useKeyboardShortcuts";
import { useAuth } from "../hooks/useAuth";

interface ConversationState {
  messages: Message[];
  attachments: Attachment[];
}

export default function CRMPage() {
  const { user } = useAuth();
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationData, setConversationData] = useState<Record<string, ConversationState>>({});
  const [loadingConversations, setLoadingConversations] = useState(true);
  const socketRef = useRef<CrmSocket | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    const saved = localStorage.getItem("crm:notifications:enabled");
    return saved ? JSON.parse(saved) : true;
  });
  const [showNotificationPreview, setShowNotificationPreview] = useState(() => {
    const saved = localStorage.getItem("crm:notifications:preview");
    return saved ? JSON.parse(saved) : true;
  });
  // Sound notifications permanently disabled
  const soundEnabled = false;
  const soundVolume = 0;
  const fetchedConversationsRef = useRef<Set<string>>(new Set());
  const [isDetached, setIsDetached] = useState(false);
  const detachedWindowRef = useRef<Window | null>(null);

  // Resizable conversation list
  const [conversationListWidth, setConversationListWidth] = useState(() => {
    const saved = localStorage.getItem("crm:conversationListWidth");
    return saved ? parseInt(saved, 10) : 380;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isHoveringResizer, setIsHoveringResizer] = useState(false);

  // Handle detach/reattach
  const handleDetach = useCallback(() => {
    if (!selectedConversationId) return;

    const conversation = conversations.find((c) => c.id === selectedConversationId);
    if (!conversation) return;

    // Store data in localStorage for the detached window
    const data = {
      conversation,
      messages: conversationData[selectedConversationId]?.messages ?? [],
      attachments: conversationData[selectedConversationId]?.attachments ?? [],
    };
    localStorage.setItem(`detached-chat-${selectedConversationId}`, JSON.stringify(data));

    // Open detached window
    const width = 500;
    const height = 700;
    const left = window.screen.width - width - 50;
    const top = 50;

    const detachedWindow = window.open(
      `/?mode=detached&conversationId=${selectedConversationId}`,
      `detached-chat-${selectedConversationId}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    );

    if (detachedWindow) {
      detachedWindowRef.current = detachedWindow;
      setIsDetached(true);

      // Listen for reattach events
      const channel = new BroadcastChannel("crm-chat-sync");
      channel.onmessage = (event) => {
        if (event.data.type === "reattach-request") {
          setIsDetached(false);
          detachedWindowRef.current = null;
          channel.close();
        }
      };

      // Check if window is closed
      const checkClosed = setInterval(() => {
        if (detachedWindow.closed) {
          setIsDetached(false);
          detachedWindowRef.current = null;
          clearInterval(checkClosed);
        }
      }, 500);
    }
  }, [selectedConversationId, conversations, conversationData]);

  // Handle resize of conversation list
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      // Min 280px, Max 600px
      const clampedWidth = Math.max(280, Math.min(600, newWidth));
      setConversationListWidth(clampedWidth);
      localStorage.setItem("crm:conversationListWidth", clampedWidth.toString());
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // SYNC DISABLED - Causaba error #321
  // useEffect(() => {
  //   if (isDetached && selectedConversationId && detachedWindowRef.current) {
  //     const conversation = conversations.find((c) => c.id === selectedConversationId);
  //     if (conversation) {
  //       const channel = new BroadcastChannel("crm-chat-sync");
  //       channel.postMessage({
  //         type: "sync-data",
  //         conversationId: selectedConversationId,
  //         conversation,
  //         messages: conversationData[selectedConversationId]?.messages ?? [],
  //         attachments: conversationData[selectedConversationId]?.attachments ?? [],
  //       });
  //       channel.close();
  //     }
  //   }
  // }, [isDetached, selectedConversationId, conversations, conversationData]);

  // Use notifications hook for current conversation
  const currentMessages = selectedConversationId ? conversationData[selectedConversationId]?.messages ?? [] : [];
  useNotifications(currentMessages, {
    enabled: notificationsEnabled,
    showPreview: showNotificationPreview,
  });

  // Use sound notifications hook - now monitors ALL conversations except the current one
  useSoundNotifications(conversationData, selectedConversationId, {
    enabled: soundEnabled,
    volume: soundVolume,
  });

  // Use keyboard shortcuts hook
  useKeyboardShortcuts({
    onSearch: () => {
      // Focus search input - we'll need to pass a ref to ConversationList
      const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
      searchInput?.focus();
    },
    onToggleSettings: () => {
      setShowSettings((prev) => !prev);
    },
    onEscape: () => {
      setShowSettings(false);
    },
  });

  // Save notification preferences to localStorage
  useEffect(() => {
    localStorage.setItem("crm:notifications:enabled", JSON.stringify(notificationsEnabled));
  }, [notificationsEnabled]);

  useEffect(() => {
    localStorage.setItem("crm:notifications:preview", JSON.stringify(showNotificationPreview));
  }, [showNotificationPreview]);

  // Sound localStorage effects removed - sounds permanently disabled

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoadingConversations(true);
      try {
        console.log('[CRM] Fetching conversations...');
        const items = await fetchConversations();
        console.log('[CRM] Loaded conversations:', items.length);
        if (!ignore) {
          setConversations(sortConversations(items));
          console.log('[CRM] Set conversations in state:', items.length);
          // Don't auto-select first conversation - let user choose
          // setSelectedConversationId((prev) => prev ?? items[0].id);
        }
      } catch (error) {
        console.error("[CRM] No se pudieron cargar conversaciones", error);
      } finally {
        if (!ignore) {
          setLoadingConversations(false);
        }
      }
    };
    load();
    return () => {
      ignore = true;
    };
  }, []);

  // Check for conversation ID parameter from Agenda navigation
  useEffect(() => {
    const conversationToOpen = sessionStorage.getItem('crm_open_conversation');
    if (conversationToOpen && conversations.length > 0) {
      console.log('[CRM] Opening conversation:', conversationToOpen);

      // Find conversation by ID
      const conversation = conversations.find(conv => conv.id === conversationToOpen);

      if (conversation) {
        console.log('[CRM] Found conversation:', conversation.id);
        setSelectedConversationId(conversation.id);
      } else {
        console.log('[CRM] Conversation not found:', conversationToOpen);
      }

      // Clear the parameter
      sessionStorage.removeItem('crm_open_conversation');
    }
  }, [conversations]);

  useEffect(() => {
    const socket = createCrmSocket();
    socketRef.current = socket;

    socket.on("crm:msg:new", ({ message, attachment }) => {
      console.log('[CRM Page] 🔔 WebSocket event: crm:msg:new', {
        messageId: message.id,
        convId: message.convId,
        text: message.text?.substring(0, 50),
        direction: message.direction
      });
      setConversationData((prev) => updateConversationData(prev, message.convId, (state) => ({
        messages: [...state.messages, message],
        attachments: attachment ? [...state.attachments, attachment] : state.attachments,
      })));
    });

    socket.on("crm:msg:update", ({ message, attachment }) => {
      console.log('[CRM Page] 🔔 WebSocket event: crm:msg:update', {
        messageId: message.id,
        convId: message.convId,
        status: message.status,
      });
      setConversationData((prev) => updateConversationData(prev, message.convId, (state) => {
        const found = state.messages.some((item) => item.id === message.id);
        console.log(`[CRM Page] Message ${message.id} found in state: ${found}`);
        return {
          messages: state.messages.map((item) => (item.id === message.id ? message : item)),
          attachments: attachment
            ? [...state.attachments.filter((item) => item.id !== attachment.id), attachment]
            : state.attachments,
        };
      }));
    });

    socket.on("crm:msg:deleted", ({ messageId, convId }) => {
      console.log('[CRM Page] 🔔 WebSocket event: crm:msg:deleted', { messageId, convId });
      setConversationData((prev) => updateConversationData(prev, convId, (state) => ({
        messages: state.messages.filter((msg) => msg.id !== messageId),
        attachments: state.attachments,
      })));
    });

    socket.on("crm:conv:update", ({ conversation }) => {
      console.log('[CRM Page] 🔔 WebSocket event: crm:conv:update', {
        convId: conversation.id,
        phone: conversation.phone,
        status: conversation.status,
        assignedTo: conversation.assignedTo,
        queueId: conversation.queueId,
        category: conversation.category,
        pinned: conversation.pinned
      });
      setConversations((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === conversation.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          const oldConv = next[existingIndex];

          console.log('[CRM Page] 📌 Pin comparison:', {
            convId: conversation.id,
            oldPinned: oldConv.pinned,
            newPinned: conversation.pinned,
            oldPinnedAt: oldConv.pinnedAt,
            newPinnedAt: conversation.pinnedAt,
            oldLastMessage: oldConv.lastMessageAt,
            newLastMessage: conversation.lastMessageAt
          });

          // Replace the entire conversation object (backend sends complete object)
          next[existingIndex] = conversation;

          // Reordenar si cambió lastMessageAt (mensaje nuevo), pinned (pin/unpin), o pinnedAt
          const shouldReorder =
            oldConv.lastMessageAt !== conversation.lastMessageAt ||
            oldConv.pinned !== conversation.pinned ||
            oldConv.pinnedAt !== conversation.pinnedAt;

          console.log('[CRM Page] 🔄 Should reorder?', shouldReorder);

          if (shouldReorder) {
            console.log('[CRM Page] ⚡ CALLING sortConversations');
            const sorted = sortConversations(next);
            console.log('[CRM Page] ✅ sortConversations returned', sorted.length, 'items');
            return sorted;
          }

          console.log('[CRM Page] ⏭️ SKIPPING reorder');
          return next;
        }
        // Nueva conversación - agregar al principio
        return sortConversations([...prev, conversation]);
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const convId = selectedConversationId;
    if (!convId) return;

    // Skip if we've already fetched or are currently fetching this conversation
    if (fetchedConversationsRef.current.has(convId)) {
      return;
    }

    // Mark as being fetched
    fetchedConversationsRef.current.add(convId);

    // Fetch messages for this conversation
    fetchMessages(convId)
      .then((data) => {
        setConversationData((prev) => ({
          ...prev,
          [convId]: {
            messages: data.messages,
            attachments: data.attachments,
          },
        }));
      })
      .catch((error) => {
        console.error("[CRM] Error cargando mensajes", error);
        // Remove from set if fetch failed so it can be retried
        fetchedConversationsRef.current.delete(convId);
      });
  }, [selectedConversationId]);

  useEffect(() => {
    const convId = selectedConversationId;
    if (!convId) return;
    const socket = socketRef.current;
    socket?.emit("crm:read", convId);
    setConversations((prev) => prev.map((item) => (item.id === convId ? { ...item, unread: 0 } : item)));
  }, [selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const currentState = selectedConversationId ? conversationData[selectedConversationId] : undefined;

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    setSelectedConversationId(conversation.id);
  }, []);

  const handleSend = useCallback(
    async (payload: { text: string; files?: File[]; replyToId?: string | null; isInternal?: boolean }) => {
      if (!selectedConversation) {
        console.log('[CRM] ❌ No selectedConversation, aborting');
        return;
      }
      console.log('[CRM] 📨 handleSend started - convId:', selectedConversation.id, 'files:', payload.files?.length || 0);
      try {
        // Handle multiple file uploads
        const attachmentIds: string[] = [];
        if (payload.files && payload.files.length > 0) {
          console.log('[CRM] 📎 Starting file uploads - count:', payload.files.length);
          for (const file of payload.files) {
            console.log('[CRM] 📎 Uploading file:', file.name, 'size:', file.size, 'type:', file.type);
            const { attachment } = await uploadAttachment(file);
            console.log('[CRM] ✅ File uploaded successfully - attachmentId:', attachment.id);
            attachmentIds.push(attachment.id);
          }
          console.log('[CRM] ✅ All files uploaded - attachmentIds:', attachmentIds);
        }

        // Send messages - one for each attachment, or one text-only message
        if (attachmentIds.length === 0) {
          console.log('[CRM] 📤 Sending text-only message');
          // Send single text message
          const result = await sendMessage({
            convId: selectedConversation.id,
            text: payload.text,
            replyToId: payload.replyToId ?? undefined,
            isInternal: payload.isInternal ?? false,
          });
          setConversationData((prev) => updateConversationData(prev, selectedConversation.id, (state) => ({
            messages: [...state.messages, result.message],
            attachments: state.attachments,
          })));
          setConversations((prev) => sortConversations(
            prev.map((item) =>
              item.id === selectedConversation.id
                ? {
                    ...item,
                    lastMessageAt: result.message.createdAt,
                    lastMessagePreview: result.message.text ?? item.lastMessagePreview,
                  }
                : item,
            ),
          ));
        } else {
          // Send multiple messages - one per attachment with optional text in first message
          console.log('[CRM] 📤 Sending messages with attachments - count:', attachmentIds.length);
          const newMessages: Message[] = [];
          const newAttachments: Attachment[] = [];

          for (let i = 0; i < attachmentIds.length; i++) {
            const isFirst = i === 0;
            console.log('[CRM] 📤 Sending message', i + 1, 'of', attachmentIds.length, '- attachmentId:', attachmentIds[i]);
            const result = await sendMessage({
              convId: selectedConversation.id,
              text: isFirst ? payload.text : "", // Only include text in first message
              replyToId: isFirst ? (payload.replyToId ?? undefined) : undefined, // Only reply in first message
              attachmentId: attachmentIds[i],
              isInternal: payload.isInternal ?? false,
            });
            console.log('[CRM] ✅ Message sent successfully - messageId:', result.message.id, 'status:', result.message.status);
            newMessages.push(result.message);
            if (result.attachment) {
              newAttachments.push(result.attachment);
            }
          }
          console.log('[CRM] ✅ All messages sent - total:', newMessages.length);

          setConversationData((prev) => updateConversationData(prev, selectedConversation.id, (state) => ({
            messages: [...state.messages, ...newMessages],
            attachments: [...state.attachments, ...newAttachments],
          })));
          setConversations((prev) => sortConversations(
            prev.map((item) =>
              item.id === selectedConversation.id
                ? {
                    ...item,
                    lastMessageAt: newMessages[newMessages.length - 1].createdAt,
                    lastMessagePreview: newMessages[newMessages.length - 1].text ?? item.lastMessagePreview,
                  }
                : item,
            ),
          ));
        }
      } catch (error) {
        console.error("[CRM] ⚠️ ERROR ENVIANDO MENSAJE:", error);
        if (error instanceof Error) {
          console.error("[CRM] ⚠️ Error message:", error.message);
          console.error("[CRM] ⚠️ Error stack:", error.stack);
        }
        // Re-throw para que el usuario vea el error
        alert(`Error enviando mensaje: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [selectedConversation],
  );

  return (
    <div className={`flex h-full flex-col overflow-hidden ${isResizing ? 'select-none' : ''}`}>
      <div className="flex flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div
            className="flex-shrink-0 h-full relative"
            style={{ width: `${conversationListWidth}px` }}
          >
            {loadingConversations && conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Cargando conversaciones…
              </div>
            ) : (
              <ConversationList
                conversations={conversations}
                selectedId={selectedConversationId}
                onSelect={handleSelectConversation}
                currentUserEmail={user?.id}
                currentUserRole={user?.role}
              />
            )}

            {/* Ultra Elegant Resizer */}
            <div
              className="absolute top-0 right-0 h-full w-3 -mr-1.5 cursor-col-resize flex items-center justify-center group"
              onMouseDown={handleMouseDown}
              onMouseEnter={() => setIsHoveringResizer(true)}
              onMouseLeave={() => setIsHoveringResizer(false)}
              style={{ zIndex: 10 }}
            >
              {/* Invisible hit area for better UX */}
              <div className="absolute inset-0"></div>

              {/* Main resizer line */}
              <div
                className={`w-px h-full transition-all duration-300 ease-out ${
                  isResizing
                    ? 'bg-gradient-to-b from-blue-400 via-blue-500 to-blue-400 shadow-lg shadow-blue-500/50'
                    : isHoveringResizer
                    ? 'bg-gradient-to-b from-slate-300 via-slate-400 to-slate-300'
                    : 'bg-slate-200/50'
                }`}
              >
                {/* Glow effect when active */}
                {(isHoveringResizer || isResizing) && (
                  <div className="absolute inset-0 bg-gradient-to-b from-blue-400/20 via-blue-500/20 to-blue-400/20 blur-sm"></div>
                )}
              </div>

              {/* Floating handle indicator */}
              <div
                className={`absolute top-1/2 -translate-y-1/2 transition-all duration-300 ease-out ${
                  isHoveringResizer || isResizing
                    ? 'opacity-100 scale-100 translate-x-0'
                    : 'opacity-0 scale-90 -translate-x-2'
                }`}
              >
                <div className="relative">
                  {/* Backdrop blur effect */}
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-full scale-110"></div>

                  {/* Main handle */}
                  <div
                    className={`relative w-3.5 h-16 rounded-full shadow-xl transition-all duration-300 ${
                      isResizing
                        ? 'bg-gradient-to-r from-blue-400 to-blue-500 shadow-blue-500/40 scale-105'
                        : 'bg-gradient-to-r from-slate-400 to-slate-500 shadow-slate-500/30'
                    }`}
                  >
                    {/* Shine effect */}
                    <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent rounded-full"></div>

                    {/* Grip dots */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 py-4">
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className={`w-0.5 h-0.5 rounded-full transition-all duration-300 ${
                            isResizing ? 'bg-white shadow-sm' : 'bg-white/70'
                          }`}
                          style={{
                            transitionDelay: `${i * 20}ms`
                          }}
                        ></div>
                      ))}
                    </div>

                    {/* Pulse animation when resizing */}
                    {isResizing && (
                      <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-20"></div>
                    )}
                  </div>

                  {/* Subtle outer glow */}
                  <div
                    className={`absolute -inset-2 rounded-full blur-md transition-opacity duration-300 ${
                      isResizing
                        ? 'bg-blue-400/30 opacity-100'
                        : 'bg-slate-400/20 opacity-0'
                    }`}
                  ></div>
                </div>
              </div>
            </div>
          </div>
          {isDetached ? (
            <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-purple-50 to-white">
              <div className="text-center p-8 max-w-md">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Chat Desacoplado</h3>
                <p className="text-slate-600 mb-4">
                  La ventana de chat se abrió en una ventana separada. Puedes posicionarla donde necesites mientras trabajas.
                </p>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-left">
                  <p className="text-xs font-semibold text-purple-900 mb-2">💡 Tip:</p>
                  <p className="text-xs text-purple-800">
                    Haz clic en "Pinear" en la ventana desacoplada para mantenerla siempre visible encima de otras aplicaciones.
                  </p>
                </div>
              </div>
            </div>
          ) : selectedConversation ? (
            <ChatWindow
              conversation={selectedConversation}
              messages={currentState?.messages ?? []}
              attachments={currentState?.attachments ?? []}
              onSend={handleSend}
              onDetach={handleDetach}
              isDetached={false}
            />
          ) : (
            <WelcomeScreen
              conversations={conversations}
              userName={user?.name || user?.username}
              userRole={user?.role}
            />
          )}

        {/* Settings Panel - Removed floating button, settings now accessed via main menu */}
        {showSettings && (
          <div className="absolute bottom-20 left-4 z-20 w-80 bg-white rounded-xl border-2 border-slate-200 shadow-2xl">
            <div className="bg-gradient-to-r from-blue-50 to-white px-4 py-3 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Configuración CRM</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-slate-400 hover:text-slate-600 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Notifications Section */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Notificaciones</h4>
                <div className="space-y-3">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">Activar notificaciones</p>
                      <p className="text-xs text-slate-500 mt-0.5">Recibir alertas de nuevos mensajes</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notificationsEnabled}
                      onChange={(e) => setNotificationsEnabled(e.target.checked)}
                      className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">Mostrar vista previa</p>
                      <p className="text-xs text-slate-500 mt-0.5">Ver contenido del mensaje en la notificación</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={showNotificationPreview}
                      onChange={(e) => setShowNotificationPreview(e.target.checked)}
                      disabled={!notificationsEnabled}
                      className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                </div>
              </div>

              {notificationsEnabled && "Notification" in window && Notification.permission === "denied" && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                  <p className="text-xs font-semibold text-amber-900">Permisos bloqueados</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Las notificaciones están bloqueadas. Por favor, habilítalas en la configuración de tu navegador.
                  </p>
                </div>
              )}

              {/* Appearance Section */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Apariencia</h4>
                <div className="space-y-3">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">Modo oscuro</p>
                      <p className="text-xs text-slate-500 mt-0.5">Cambiar a tema oscuro</p>
                    </div>
                    <button
                      onClick={toggleDarkMode}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        isDarkMode ? "bg-blue-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isDarkMode ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>

              {/* Keyboard Shortcuts Section */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Atajos de Teclado</h4>
                <div className="space-y-2">
                  {KEYBOARD_SHORTCUTS.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <span className="text-sm text-slate-700">{shortcut.description}</span>
                      <div className="flex gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <kbd
                            key={keyIndex}
                            className="px-2 py-1 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded shadow-sm"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 p-3">
                  <p className="text-xs text-blue-900">
                    <span className="font-semibold">Tip:</span> En Mac, usa Cmd en lugar de Ctrl
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function updateConversationData(
  current: Record<string, ConversationState>,
  convId: string,
  updater: (state: ConversationState) => ConversationState,
): Record<string, ConversationState> {
  const base = current[convId] ?? { messages: [], attachments: [] };
  const updated = updater(base);
  const uniqueMessages = dedupeById(updated.messages);
  const uniqueAttachments = dedupeById(updated.attachments);
  return {
    ...current,
    [convId]: { messages: uniqueMessages, attachments: uniqueAttachments },
  };
}

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => {
    // Pinned conversations always come first
    if (a.pinned !== b.pinned) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    }
    // If both are pinned, sort by pinnedAt (most recently pinned first)
    if (a.pinned && b.pinned) {
      return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    }
    // Otherwise sort by last message time
    return b.lastMessageAt - a.lastMessageAt;
  });
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}
