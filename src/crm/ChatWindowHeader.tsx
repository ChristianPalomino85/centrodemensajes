import { useState, useEffect } from "react";
import { Avatar } from "./Avatar";
import type { Conversation } from "./types";
import QuickActionsButton from "./QuickActionsButton";
import QuickActionsManager from "./QuickActionsManager";

interface ChatWindowHeaderProps {
  conversation: Conversation;
  advisors: Array<{
    id: string;
    name: string;
    email?: string;
    isOnline?: boolean;
  }>;
  queues: Array<{
    id: string;
    name: string;
  }>;
  accepting: boolean;
  rejecting: boolean;
  onAccept: () => void;
  onReject: () => void;
  onTakeOver: () => void;
  takingOver: boolean;
  onTransfer: (type: "advisor" | "bot" | "queue") => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onShowInfo: () => void;
  onDetach?: () => void;
  onJoinAdvisor: () => void;
  onShowTemplates: () => void;
  onCreateLead?: () => void;
  isDetached?: boolean;
  userRole?: string;
}

// Generate consistent color for advisor based on their ID
function getAdvisorColor(advisorId: string): string {
  const colors = [
    '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
    '#06B6D4', '#6366F1', '#EF4444', '#14B8A6', '#F97316',
  ];
  let hash = 0;
  for (let i = 0; i < advisorId.length; i++) {
    hash = advisorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Get initials from advisor
function getAdvisorInitials(advisorId: string, advisors?: Array<{ id: string; name: string }>): string {
  if (advisors) {
    const advisor = advisors.find((a) => a.id === advisorId);
    if (advisor?.name) {
      return advisor.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
  }
  return advisorId.substring(0, 2).toUpperCase();
}

// Get header background color based on conversation state (MATCHES category colors)
function getHeaderColor(conversation: Conversation): string {
  // 1. FINALIZADOS
  if (conversation.status === "closed") {
    return "bg-slate-100";
  }

  // 2. ATENDIENDO
  if (conversation.status === "attending") {
    return "bg-green-100";
  }

  // 3-7. Status "active" - determine category by priority
  if (conversation.status === "active") {
    // 3. FAVORITOS
    if (conversation.isFavorite) {
      return "bg-amber-100";
    }
    // 4. BOT ATENDIENDO (assignedTo starts with bot-)
    if (conversation.assignedTo?.startsWith('bot-')) {
      return "bg-cyan-100";
    }
    // 5. NUEVOS MENSAJES (queueId && !transferredFrom)
    if (conversation.queueId && !conversation.transferredFrom) {
      return "bg-blue-100";
    }
    // 6. TRANSFERIDOS (transferredFrom)
    if (conversation.transferredFrom) {
      return "bg-yellow-100";
    }
    // 7. LEÍDOS (readAt && unread === 0)
    if (conversation.readAt !== null && conversation.unread === 0) {
      return "bg-purple-100";
    }
  }

  return "bg-white"; // Default fallback
}

export default function ChatWindowHeader({
  conversation,
  advisors,
  queues,
  accepting,
  rejecting,
  onAccept,
  onReject,
  onTakeOver,
  takingOver,
  onTransfer,
  onArchive,
  onUnarchive,
  onShowInfo,
  onDetach,
  onJoinAdvisor,
  onShowTemplates,
  onCreateLead,
  isDetached,
  userRole,
}: ChatWindowHeaderProps) {
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(conversation.contactName || '');
  const [savingName, setSavingName] = useState(false);
  const [showQuickActionsManager, setShowQuickActionsManager] = useState(false);

  // Update edited name when conversation changes
  useEffect(() => {
    setEditedName(conversation.contactName || '');
  }, [conversation.contactName]);

  // Toggle favorite status
  const handleToggleFavorite = async () => {
    setTogglingFavorite(true);
    try {
      const response = await fetch(`/api/crm/conversations/${conversation.id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: !conversation.isFavorite }),
        credentials: 'include',
      });
      if (!response.ok) {
        console.error('Error toggling favorite');
      }
      // The conversation will be updated via WebSocket
    } catch (error) {
      console.error('Error toggling favorite:', error);
    } finally {
      setTogglingFavorite(false);
    }
  };

  // Save edited contact name
  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === conversation.contactName) {
      setIsEditingName(false);
      return;
    }

    setSavingName(true);
    try {
      const response = await fetch(`/api/crm/conversations/${conversation.id}/contact-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactName: editedName.trim() }),
        credentials: 'include',
      });
      if (!response.ok) {
        console.error('Error updating contact name');
        setEditedName(conversation.contactName || '');
      }
      // The conversation will be updated via WebSocket
    } catch (error) {
      console.error('Error updating contact name:', error);
      setEditedName(conversation.contactName || '');
    } finally {
      setSavingName(false);
      setIsEditingName(false);
    }
  };

  // Check if user is admin
  const isAdmin = userRole === "admin";

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.actions-menu-container')) {
        setShowActionsMenu(false);
      }
    };

    if (showActionsMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showActionsMenu]);

  // Get active advisors (currently in the conversation)
  // For ACTIVE/ATTENDING: show activeAdvisors (if not empty) or assignedTo
  // For ARCHIVED: show attendedBy (historical record of who attended)
  const activeAdvisorsList = conversation.status === "closed"
    ? (conversation.attendedBy || [])
    : ((conversation.activeAdvisors && conversation.activeAdvisors.length > 0)
        ? conversation.activeAdvisors
        : (conversation.assignedTo ? [conversation.assignedTo] : []));

  // Get header color based on conversation state
  const headerColor = getHeaderColor(conversation);

  return (
    <header className={`flex-shrink-0 border-b border-slate-200 ${headerColor} px-6 py-3`}>
      <div className="flex items-center justify-between">
        {/* Left: Contact info */}
        <div className="flex items-center gap-3">
          <Avatar
            src={conversation.avatarUrl}
            alt={conversation.contactName || conversation.phone}
            size="md"
          />
          <div>
            <div className="flex items-center gap-2">
              {/* Editable Name */}
              {isEditingName ? (
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setEditedName(conversation.contactName || '');
                      setIsEditingName(false);
                    }
                  }}
                  autoFocus
                  disabled={savingName}
                  className="text-sm font-semibold text-slate-900 bg-white border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Nombre del contacto"
                />
              ) : (
                <button
                  onClick={() => setIsEditingName(true)}
                  className="text-sm font-semibold text-slate-900 hover:text-blue-600 transition"
                  title="Haz clic para editar el nombre"
                >
                  {conversation.contactName || 'Sin nombre'}
                </button>
              )}

              {/* Publicidad Badge */}
              {(() => {
                const value = conversation.autorizaPublicidad;
                const siIds = ["96420", "96130"];
                const noIds = ["96422", "96132"];
                if (siIds.includes(String(value))) {
                  return (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-300" title="✓ Autoriza publicidad">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    </span>
                  );
                } else if (noIds.includes(String(value))) {
                  return (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 border border-red-300" title="✗ No autoriza publicidad">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </span>
                  );
                } else {
                  return (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 border border-amber-300" title="? Por confirmar">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                    </span>
                  );
                }
              })()}

              {/* Favorite Star */}
              <button
                onClick={handleToggleFavorite}
                disabled={togglingFavorite}
                className={`flex items-center justify-center w-6 h-6 rounded transition ${
                  conversation.isFavorite
                    ? 'text-amber-500 hover:text-amber-600'
                    : 'text-slate-300 hover:text-amber-400'
                } disabled:opacity-50`}
                title={conversation.isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              >
                {conversation.isFavorite ? '⭐' : '☆'}
              </button>

              {/* EN COLA BOT: Show queue name badge */}
              {!conversation.assignedTo && conversation.queueId && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-[10px] font-bold text-emerald-700"
                  title="En cola esperando asignación"
                >
                  📋 {queues.find(q => q.id === conversation.queueId)?.name || 'Cola'}
                </span>
              )}

              {/* Transfer indicator badges - TEMPORARY (cleared on finalize) */}
              {conversation.transferredFrom && (
                <>
                  {/* Transfer icon badge with advisor name */}
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 border border-orange-300 text-[10px] font-bold text-orange-700"
                    title={`Transferido por ${advisors.find(a => a.id === conversation.transferredFrom)?.name || conversation.transferredFrom}`}
                  >
                    🔄 Transferido por {(advisors.find(a => a.id === conversation.transferredFrom)?.name || 'Asesor').split(' ')[0]}
                  </span>
                  {/* Responsible advisor initial */}
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white shadow-sm border-2 border-orange-200"
                    style={{ backgroundColor: getAdvisorColor(conversation.transferredFrom) }}
                    title={`De: ${advisors.find(a => a.id === conversation.transferredFrom)?.name || conversation.transferredFrom}`}
                  >
                    {getAdvisorInitials(conversation.transferredFrom, advisors)}
                  </span>
                </>
              )}
            </div>
            {/* Display Number and Phone */}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {conversation.displayNumber && (
                <span className="font-medium text-blue-600">
                  📱 {conversation.displayNumber}
                </span>
              )}
              <span>·</span>
              <span>{conversation.phone}</span>
              <span>·</span>
              <span>
                {conversation.channel === "whatsapp" ? "WhatsApp" : conversation.channel}
              </span>
              <span>·</span>
              <span>Hace {getTimeAgo(conversation.lastMessageAt)}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions menu + Active advisors */}
        <div className="flex items-center gap-3">
          {/* Quick Actions Button - Only show when conversation is active */}
          {conversation.status !== "closed" && (
            <QuickActionsButton
              conversationId={conversation.id}
              onOpenManager={() => setShowQuickActionsManager(true)}
            />
          )}

          {/* Actions menu (3 dots) - Visible for all users */}
          <div className="relative actions-menu-container">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowActionsMenu(!showActionsMenu);
                }}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-100 transition text-slate-600"
                title="Acciones"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {showActionsMenu && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] py-1">
                {/* Transfer options */}
                {conversation.status !== "closed" && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Transferir
                    </div>
                    <button
                      onClick={() => {
                        onTransfer("advisor");
                        setShowActionsMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-purple-50 transition flex items-center gap-3"
                    >
                      <span className="text-base">👤</span>
                      <span>A Asesor</span>
                    </button>
                    <button
                      onClick={() => {
                        onTransfer("bot");
                        setShowActionsMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 transition flex items-center gap-3"
                    >
                      <span className="text-base">🤖</span>
                      <span>A Bot</span>
                    </button>
                    <button
                      onClick={() => {
                        onTransfer("queue");
                        setShowActionsMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50 transition flex items-center gap-3"
                    >
                      <span className="text-base">📋</span>
                      <span>A Cola</span>
                    </button>
                    <div className="border-t border-slate-100 my-1"></div>
                  </>
                )}

                {/* Join advisor */}
                {conversation.status !== "closed" && (
                  <button
                    onClick={() => {
                      onJoinAdvisor();
                      setShowActionsMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 transition flex items-center gap-3"
                  >
                    <span className="text-base">➕</span>
                    <span>Unir Asesor al Chat</span>
                  </button>
                )}

                {/* Take over chat */}
                {conversation.status !== "closed" && (
                  <button
                    onClick={() => {
                      onTakeOver();
                      setShowActionsMenu(false);
                    }}
                    disabled={takingOver}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-pink-50 transition flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-base">✋</span>
                    <span>{takingOver ? 'Tomando...' : 'Tomar Chat'}</span>
                  </button>
                )}

                {/* Templates */}
                {conversation.status !== "closed" && (
                  <button
                    onClick={() => {
                      onShowTemplates();
                      setShowActionsMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-cyan-50 transition flex items-center gap-3"
                  >
                    <span className="text-base">📝</span>
                    <span>Plantillas WhatsApp</span>
                  </button>
                )}

                {/* Create Lead in Bitrix24 */}
                {conversation.status !== "closed" && onCreateLead && (
                  <button
                    onClick={() => {
                      onCreateLead();
                      setShowActionsMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 transition flex items-center gap-3"
                  >
                    <span className="text-base">📊</span>
                    <span>Crear Prospecto (Bitrix24)</span>
                  </button>
                )}

                <div className="border-t border-slate-100 my-1"></div>

                {/* Detach window */}
                {!isDetached && onDetach && (
                  <button
                    onClick={() => {
                      onDetach();
                      setShowActionsMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-violet-50 transition flex items-center gap-3"
                  >
                    <span className="text-base">🪟</span>
                    <span>Desacoplar Ventana</span>
                  </button>
                )}

                {/* Bitrix link */}
                {conversation.bitrixId && (
                  <a
                    href={`https://azaleia-peru.bitrix24.es/crm/contact/details/${conversation.bitrixId}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-orange-50 transition flex items-center gap-3"
                    onClick={() => setShowActionsMenu(false)}
                  >
                    <span className="text-base">🔗</span>
                    <span>Ver en Bitrix24</span>
                  </a>
                )}

                {/* Info */}
                <button
                  onClick={() => {
                    onShowInfo();
                    setShowActionsMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition flex items-center gap-3"
                >
                  <span className="text-base">ℹ️</span>
                  <span>Información del Cliente</span>
                </button>

                {/* Archive / Reopen */}
                {conversation.status !== "closed" ? (
                  <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button
                      onClick={() => {
                        onArchive();
                        setShowActionsMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 transition flex items-center gap-3"
                    >
                      <span className="text-base">🗂️</span>
                      <span>Finalizar Conversación</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button
                      onClick={() => {
                        onUnarchive();
                        setShowActionsMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-green-600 hover:bg-green-50 transition flex items-center gap-3"
                    >
                      <span className="text-base">🔓</span>
                      <span>Reabrir Conversación</span>
                    </button>
                  </>
                )}
              </div>
              )}
            </div>

          {/* Advisor initials - AFTER 3 dots menu */}
          {(activeAdvisorsList.length > 0 || (!conversation.assignedTo && conversation.queueId)) && (
            <div className="flex items-center gap-2">
              {/* Transferred badge if applicable */}
              {conversation.transferredFrom && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 border border-yellow-300 text-[10px] font-bold text-yellow-700">
                    🔄 Transferido por {(advisors.find(a => a.id === conversation.transferredFrom)?.name || 'Asesor').split(' ')[0]}
                  </span>
                  {/* Initials of who transferred */}
                  <div
                    className="w-6 h-6 rounded-full border-2 border-yellow-200 flex items-center justify-center text-[9px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: getAdvisorColor(conversation.transferredFrom) }}
                    title={`De: ${advisors.find(a => a.id === conversation.transferredFrom)?.name || conversation.transferredFrom}`}
                  >
                    {getAdvisorInitials(conversation.transferredFrom, advisors)}
                  </div>
                </div>
              )}

              {/* EN COLA BOT: Show robot avatar */}
              {!conversation.assignedTo && conversation.queueId ? (
                <div
                  className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center font-bold shadow-sm"
                  style={{ backgroundColor: '#10B981' }}
                  title="En cola - Bot atendiendo"
                >
                  <span className="text-base">🤖</span>
                </div>
              ) : (
                <>
                  {/* Assigned advisor initials */}
                  {activeAdvisorsList.slice(0, 3).map((advisorId) => {
                    const isBot = advisorId.startsWith('bot-');
                    const color = getAdvisorColor(advisorId);
                    const initials = getAdvisorInitials(advisorId, advisors);
                    const advisor = advisors.find(a => a.id === advisorId);

                    return (
                      <div
                        key={advisorId}
                        className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center font-bold shadow-sm"
                        style={{ backgroundColor: isBot ? '#06B6D4' : color }}
                        title={advisor?.name || advisorId}
                      >
                        {isBot ? (
                          <span className="text-base">🤖</span>
                        ) : (
                          <span className="text-[10px] text-white">{initials}</span>
                        )}
                      </div>
                    );
                  })}
                  {activeAdvisorsList.length > 3 && (
                    <div className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-600 bg-slate-100 shadow-sm">
                      +{activeAdvisorsList.length - 3}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions Manager Modal */}
      <QuickActionsManager
        isOpen={showQuickActionsManager}
        onClose={() => setShowQuickActionsManager(false)}
      />
    </header>
  );
}

// Helper function to get time ago
function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "unos segundos";
  if (minutes < 60) return `${minutes} min`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}
