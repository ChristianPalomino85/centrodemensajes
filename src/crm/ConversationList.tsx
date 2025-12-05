import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { Conversation, ChannelType } from "./types";
import { getChannelColor, getNumberLabel } from "./channelColors";
import { Avatar } from "./Avatar";
import { AvatarWithBadge } from "./AvatarWithBadge";
import { getConversationCategory, type ConversationCategory } from "../../shared/conversation-rules";
// Phone search fix v2

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (conversation: Conversation) => void;
  currentUserEmail?: string;
  currentUserRole?: string;
}

// Generate consistent color for advisor based on their ID
function getAdvisorColor(advisorId: string): string {
  const colors = [
    '#3B82F6', // blue
    '#8B5CF6', // purple
    '#EC4899', // pink
    '#F59E0B', // amber
    '#10B981', // emerald
    '#06B6D4', // cyan
    '#6366F1', // indigo
    '#EF4444', // red
    '#14B8A6', // teal
    '#F97316', // orange
  ];

  // Use hash of ID to select color
  let hash = 0;
  for (let i = 0; i < advisorId.length; i++) {
    hash = advisorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// Get advisor name from ID
function getAdvisorName(advisorId: string | null, advisors?: Array<{ id: string; name: string }>): string | null {
  if (!advisorId || !advisors) return null;
  const advisor = advisors.find((a) => a.id === advisorId);
  return advisor?.name || null;
}

// Get initials from advisor ID (use advisor name if available)
function getAdvisorInitials(advisorId: string, advisors?: Array<{ id: string; name: string }>): string {
  if (advisors) {
    const advisor = advisors.find((a) => a.id === advisorId);
    if (advisor?.name) {
      // Get initials from name (e.g., "Christian Palomino" -> "CP")
      return advisor.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
  }
  // Fallback: first 2 chars of ID
  return advisorId.substring(0, 2).toUpperCase();
}

// Get status color based on conversation state (for the small dot)
function getStatusColor(conversation: Conversation, currentUserEmail?: string): string {
  // Purple for my chats (assigned to me)
  if (currentUserEmail && conversation.attendedBy?.includes(currentUserEmail) && conversation.status !== "closed") {
    return '#8B5CF6'; // purple
  }

  // Status-based colors
  if (conversation.status === "closed") {
    return '#10B981'; // green check
  }
  if (conversation.status === "attending") {
    return '#10B981'; // green
  }
  if (conversation.unread > 0) {
    return '#3B82F6'; // blue
  }

  return '#94A3B8'; // gray (read/no pending)
}

type FilterType = "all" | "unread" | "attending" | "closed" | "assigned_to_me";
type SortType = "recent" | "unread" | "name";
type DateFilter = "all" | "today" | "week" | "month" | "custom";

interface WhatsAppConnection {
  id: string;
  alias: string;
  phoneNumberId: string;
  displayNumber: string | null;
  isActive: boolean;
}

// Channel colors for left border
const CHANNEL_COLORS: Record<ChannelType, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E4405F',
  tiktok: '#000000',
};

export default function ConversationList({ conversations, selectedId, onSelect, currentUserEmail, currentUserRole }: ConversationListProps) {
  // Force cache bust v2025-11-18-13-50 - FIXED closedReason in ALL 7 calls
  console.log('✅ ConversationList cargado - VERSION 2025-11-24-07:37 CON WINDOW BADGE');
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ConversationCategory | "all">("all");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("recent");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [customDateStart, setCustomDateStart] = useState("");
  const [customDateEnd, setCustomDateEnd] = useState("");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Multi-channel filters
  const [channelFilter, setChannelFilter] = useState<ChannelType | "all">("all");
  const [connectionFilter, setConnectionFilter] = useState<string>("all");
  const [whatsappConnections, setWhatsappConnections] = useState<WhatsAppConnection[]>([]);

  // Advisors list for showing real names/initials
  const [advisors, setAdvisors] = useState<Array<{ id: string; name: string; email: string; isOnline: boolean }>>([]);
  const [advisorFilter, setAdvisorFilter] = useState<string>("all");

  // NEW: Allow advisors to see all conversations (not just their own)
  const [showAllChats, setShowAllChats] = useState<boolean>(false);

  // Queues list for transfer dropdown
  const [queues, setQueues] = useState<Array<{ id: string; name: string }>>([]);

  // Pulse animation state for "Todas" tab when new chats arrive
  const [shouldPulseAll, setShouldPulseAll] = useState(false);
  const prevAllCountRef = useRef<number>(0);

  // Auto-reset advisor filter for non-admin users
  useEffect(() => {
    if (currentUserRole && currentUserRole !== 'admin' && currentUserRole !== 'supervisor') {
      if (advisorFilter !== "all") {
        setAdvisorFilter("all");
      }
    }
  }, [currentUserRole]);

  // Load WhatsApp connections for filter dropdown
  useEffect(() => {
    fetch('/api/connections/whatsapp/list')
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          setWhatsappConnections(data.connections);
        }
      })
      .catch(err => console.error('Error loading WhatsApp connections:', err));
  }, []);

  // Load advisors for showing real names/initials and online status
  useEffect(() => {
    const loadAdvisors = () => {
      fetch('/api/admin/advisors', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          if (data.advisors) {
            setAdvisors(data.advisors);
          }
        })
        .catch(err => console.error('Error loading advisors:', err));
    };

    loadAdvisors();
    // Reload every 30 seconds to update online status
    const interval = setInterval(loadAdvisors, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load queues for transfer dropdown
  useEffect(() => {
    fetch('/api/admin/queues', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.queues) {
          setQueues(data.queues);
        }
      })
      .catch(err => console.error('Error loading queues:', err));
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Calculate category counts DESPUÉS de aplicar TODOS los filtros (incluyendo avanzados)
  const categoryCounts = useMemo(() => {
    const counts: Record<ConversationCategory, number> = {
      MASIVOS: 0,
      EN_COLA_BOT: 0,
      POR_TRABAJAR: 0,
      TRABAJANDO: 0,
      FINALIZADOS: 0,
    };

    let conversationsToCount = [...conversations];

    // Aplicar filtro de permisos
    const canViewAll = currentUserRole === 'admin' || currentUserRole === 'supervisor' || showAllChats;
    if (!canViewAll && currentUserEmail) {
      conversationsToCount = conversationsToCount.filter((conv) => {
        const category = getConversationCategory({
          status: conv.status,
          assignedTo: conv.assignedTo,
          botFlowId: conv.botFlowId ?? null,
          queueId: conv.queueId ?? null,
          campaignId: conv.campaignId ?? null,
          closedReason: conv.closedReason ?? null,
        });
        // FINALIZADOS: ver de todos
        if (category === 'FINALIZADOS') {
          return true;
        }
        // Resto: solo los asignados a él
        return conv.assignedTo === currentUserEmail;
      });
    }

    // Apply date filter
    const now = Date.now();
    if (dateFilter === "today") {
      const todayStart = new Date().setHours(0, 0, 0, 0);
      conversationsToCount = conversationsToCount.filter((item) => item.lastMessageAt >= todayStart);
    } else if (dateFilter === "week") {
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      conversationsToCount = conversationsToCount.filter((item) => item.lastMessageAt >= weekAgo);
    } else if (dateFilter === "month") {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      conversationsToCount = conversationsToCount.filter((item) => item.lastMessageAt >= monthAgo);
    } else if (dateFilter === "custom" && customDateStart && customDateEnd) {
      const start = new Date(customDateStart).getTime();
      const end = new Date(customDateEnd).setHours(23, 59, 59, 999);
      conversationsToCount = conversationsToCount.filter((item) => item.lastMessageAt >= start && item.lastMessageAt <= end);
    }

    // Apply search filter
    const term = search.trim().toLowerCase();
    if (term) {
      conversationsToCount = conversationsToCount.filter((item) => {
        const name = item.contactName?.toLowerCase() ?? "";
        // Normalize phone numbers by removing all non-digit characters for comparison
        const phoneNormalized = item.phone.replace(/\D/g, '');
        const termNormalized = term.replace(/\D/g, '');

        const nameMatch = name.includes(term);
        const phoneMatch = item.phone.includes(term) || phoneNormalized.includes(termNormalized);

        return nameMatch || phoneMatch;
      });
    }

    // Apply channel filter
    if (channelFilter !== "all") {
      conversationsToCount = conversationsToCount.filter((item) => item.channel === channelFilter);
    }

    // Apply WhatsApp connection filter
    if (connectionFilter !== "all") {
      conversationsToCount = conversationsToCount.filter((item) => item.channelConnectionId === connectionFilter);
    }

    // Apply manual advisor filter (ONLY for admin/supervisor)
    // Asesores already see only their own conversations via permission filter
    if (advisorFilter !== "all" && canViewAll) {
      conversationsToCount = conversationsToCount.filter((item) => item.assignedTo === advisorFilter);
    }

    // Count by category
    conversationsToCount.forEach((conv) => {
      const category = getConversationCategory({
        status: conv.status,
        assignedTo: conv.assignedTo,
        botFlowId: conv.botFlowId ?? null,
        queueId: conv.queueId ?? null,
        campaignId: conv.campaignId ?? null,
        closedReason: conv.closedReason ?? null,
      });
      // DEBUG: Log específico para el chat problemático
      if (conv.phone === '51956642188') {
        console.log('🔍 DEBUG chat 51956642188:', {
          status: conv.status,
          campaignId: conv.campaignId,
          closedReason: conv.closedReason,
          category: category
        });
      }
      counts[category]++;
    });

    return counts;
  }, [conversations, currentUserEmail, currentUserRole, dateFilter, customDateStart, customDateEnd, search, channelFilter, connectionFilter, advisorFilter, showAllChats]);

  const filtered = useMemo(() => {
    let result = [...conversations];

    // PRIORITY 1: Apply category filter FIRST
    if (categoryFilter !== "all") {
      result = result.filter((item) => {
        const category = getConversationCategory({
          status: item.status,
          assignedTo: item.assignedTo,
          botFlowId: item.botFlowId ?? null,
          queueId: item.queueId ?? null,
          campaignId: item.campaignId ?? null,
          closedReason: item.closedReason ?? null,
        });
        return category === categoryFilter;
      });
    }

    // Apply filter
    // IMPORTANTE: Si ya se filtró por categoría, NO aplicar filtro de status
    if (categoryFilter === "all") {
      if (filter === "assigned_to_me") {
        // "Mis Chats" = conversations I have attended (not closed)
        result = result.filter((item) =>
          currentUserEmail && item.attendedBy && item.attendedBy.includes(currentUserEmail) && item.status !== "closed"
        );
      } else if (filter === "unread") {
        result = result.filter((item) => item.unread > 0 && item.status !== "closed");
      } else if (filter === "attending") {
        result = result.filter((item) => item.status === "attending");
      } else if (filter === "closed") {
        result = result.filter((item) => item.status === "closed");
      } else {
        // "all" - active and attending conversations
        result = result.filter((item) => item.status === "active" || item.status === "attending");
      }
    }

    // Apply date filter
    const now = Date.now();
    if (dateFilter === "today") {
      const todayStart = new Date().setHours(0, 0, 0, 0);
      result = result.filter((item) => item.lastMessageAt >= todayStart);
    } else if (dateFilter === "week") {
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.lastMessageAt >= weekAgo);
    } else if (dateFilter === "month") {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.lastMessageAt >= monthAgo);
    } else if (dateFilter === "custom" && customDateStart && customDateEnd) {
      const start = new Date(customDateStart).getTime();
      const end = new Date(customDateEnd).setHours(23, 59, 59, 999);
      result = result.filter((item) => item.lastMessageAt >= start && item.lastMessageAt <= end);
    }

    // Apply search
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((item) => {
        const name = item.contactName?.toLowerCase() ?? "";
        return name.includes(term) || item.phone.includes(term);
      });
    }

    // Apply channel filter
    if (channelFilter !== "all") {
      result = result.filter((item) => item.channel === channelFilter);
    }

    // Apply WhatsApp connection filter
    if (connectionFilter !== "all") {
      result = result.filter((item) => item.channelConnectionId === connectionFilter);
    }

    // Apply advisor filter (manual) - ONLY for admin/supervisor
    const canViewAll = currentUserRole === 'admin' || currentUserRole === 'supervisor';
    if (advisorFilter !== "all" && canViewAll) {
      // Admin/supervisor filtering by specific advisor
      result = result.filter((item) => item.assignedTo === advisorFilter);
    } else if (!canViewAll && currentUserEmail) {
      // Asesores: aplicar filtro automático por permisos
      result = result.filter((item) => {
        // FINALIZADOS: ver de TODOS
        const category = getConversationCategory({
          status: item.status,
          assignedTo: item.assignedTo,
          botFlowId: item.botFlowId ?? null,
          queueId: item.queueId ?? null,
          campaignId: item.campaignId ?? null,
          closedReason: item.closedReason ?? null,
        });
        if (category === 'FINALIZADOS') {
          return true; // Ver finalizados de todos
        }
        // Resto: solo los asignados a él
        return item.assignedTo === currentUserEmail;
      });
    }

    // Apply sort - IMPORTANT: Create new array to avoid mutation
    if (sort === "recent") {
      result = [...result].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    } else if (sort === "unread") {
      result = [...result].sort((a, b) => b.unread - a.unread || b.lastMessageAt - a.lastMessageAt);
    } else if (sort === "name") {
      result = [...result].sort((a, b) => {
        const nameA = a.contactName || a.phone;
        const nameB = b.contactName || b.phone;
        return nameA.localeCompare(nameB);
      });
    }

    return result;
  }, [conversations, search, filter, sort, dateFilter, customDateStart, customDateEnd, channelFilter, connectionFilter, categoryFilter, advisorFilter, currentUserEmail, currentUserRole]);

  const unreadCount = conversations.filter((c) => c.unread > 0 && c.status !== "closed").length;
  const attendingCount = conversations.filter((c) => c.status === "attending").length;
  const closedCount = conversations.filter((c) => c.status === "closed").length;
  const assignedToMeCount = currentUserEmail
    ? conversations.filter((c) => c.attendedBy && c.attendedBy.includes(currentUserEmail) && c.status !== "closed").length
    : 0;

  // Count of all active/attending conversations (for detecting new chats)
  const allActiveCount = conversations.filter((c) => c.status === "active" || c.status === "attending").length;

  // Trigger pulse animation on "Todas" tab when a new conversation arrives
  useEffect(() => {
    if (allActiveCount > prevAllCountRef.current && prevAllCountRef.current > 0) {
      setShouldPulseAll(true);
      // Remove pulse after 3 seconds
      const timer = setTimeout(() => setShouldPulseAll(false), 3000);
      return () => clearTimeout(timer);
    }
    prevAllCountRef.current = allActiveCount;
  }, [allActiveCount]);

  // Helper: Get conversations for a specific category
  // IMPORTANT: Apply ALL filters (same as filtered useMemo) except category filter
  const getConversationsForCategory = useCallback((category: ConversationCategory) => {
    let result = [...conversations];

    // Apply permission filter FIRST
    const canViewAll = currentUserRole === 'admin' || currentUserRole === 'supervisor' || showAllChats;
    if (!canViewAll && currentUserEmail) {
      result = result.filter((conv) => {
        const convCategory = getConversationCategory({
          status: conv.status,
          assignedTo: conv.assignedTo,
          botFlowId: conv.botFlowId ?? null,
          queueId: conv.queueId ?? null,
          campaignId: conv.campaignId ?? null,
          closedReason: conv.closedReason ?? null,
        });
        // FINALIZADOS: ver de todos
        if (convCategory === 'FINALIZADOS') {
          return true;
        }
        // Resto: solo los asignados a él
        return conv.assignedTo === currentUserEmail;
      });
    }

    // Apply date filter
    const now = Date.now();
    if (dateFilter === "today") {
      const todayStart = new Date().setHours(0, 0, 0, 0);
      result = result.filter((item) => item.lastMessageAt >= todayStart);
    } else if (dateFilter === "week") {
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.lastMessageAt >= weekAgo);
    } else if (dateFilter === "month") {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => item.lastMessageAt >= monthAgo);
    } else if (dateFilter === "custom" && customDateStart && customDateEnd) {
      const start = new Date(customDateStart).getTime();
      const end = new Date(customDateEnd).setHours(23, 59, 59, 999);
      result = result.filter((item) => item.lastMessageAt >= start && item.lastMessageAt <= end);
    }

    // Apply search filter
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((item) => {
        const name = item.contactName?.toLowerCase() ?? "";
        // Normalize phone numbers by removing all non-digit characters for comparison
        const phoneNormalized = item.phone.replace(/\D/g, '');
        const termNormalized = term.replace(/\D/g, '');

        const nameMatch = name.includes(term);
        const phoneMatch = item.phone.includes(term) || phoneNormalized.includes(termNormalized);

        return nameMatch || phoneMatch;
      });
    }

    // Apply channel filter
    if (channelFilter !== "all") {
      result = result.filter((item) => item.channel === channelFilter);
    }

    // Apply WhatsApp connection filter
    if (connectionFilter !== "all") {
      result = result.filter((item) => item.channelConnectionId === connectionFilter);
    }

    // Apply manual advisor filter (ONLY for admin/supervisor)
    // Asesores already see only their own conversations via permission filter
    if (advisorFilter !== "all" && canViewAll) {
      result = result.filter((item) => item.assignedTo === advisorFilter);
    }

    // Filter by category
    result = result.filter((item) => {
      const itemCategory = getConversationCategory({
        status: item.status,
        assignedTo: item.assignedTo,
        botFlowId: item.botFlowId ?? null,
        queueId: item.queueId ?? null,
        campaignId: item.campaignId ?? null,
        closedReason: item.closedReason ?? null,
      });
      return itemCategory === category;
    });

    // Sort by most recent
    return result.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [conversations, currentUserRole, currentUserEmail, dateFilter, customDateStart, customDateEnd, search, channelFilter, connectionFilter, advisorFilter, showAllChats]);

  // Helper: Get badge color based on urgency (time since last message)
  const getUrgencyColor = (lastMessageAt: number, unread: number): string | null => {
    if (unread === 0) return null; // No badge if all read
    const minutesAgo = (Date.now() - lastMessageAt) / 1000 / 60;
    if (minutesAgo <= 5) return 'bg-green-500'; // 0-5 min: green
    if (minutesAgo <= 10) return 'bg-blue-500'; // 5-10 min: blue
    return 'bg-red-500'; // +10 min: red
  };

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-slate-200 space-y-2">
        <div className="relative">
          <input
            type="search"
            placeholder="Buscar contacto o número..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring focus:ring-emerald-100"
          />
          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold border rounded-lg transition ${
            showAdvancedFilters
              ? "text-blue-700 bg-blue-50 border-blue-200"
              : "text-slate-700 bg-white border-slate-200 hover:bg-slate-50"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filtros
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Fecha</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
            >
              <option value="all">Todas las fechas</option>
              <option value="today">Hoy</option>
              <option value="week">Últimos 7 días</option>
              <option value="month">Últimos 30 días</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>

          {dateFilter === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desde</label>
                <input
                  type="date"
                  value={customDateStart}
                  onChange={(e) => setCustomDateStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hasta</label>
                <input
                  type="date"
                  value={customDateEnd}
                  onChange={(e) => setCustomDateEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
                />
              </div>
            </div>
          )}

          {/* Channel Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Canal</label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ChannelType | "all")}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
            >
              <option value="all">Todos los canales</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
            </select>
          </div>

          {/* WhatsApp Connection Filter - Only show when WhatsApp channel is selected */}
          {(channelFilter === "whatsapp" || channelFilter === "all") && whatsappConnections.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Número WhatsApp</label>
              <select
                value={connectionFilter}
                onChange={(e) => setConnectionFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
              >
                <option value="all">Todos los números</option>
                {whatsappConnections.map((conn) => (
                  <option key={conn.id} value={conn.phoneNumberId}>
                    {conn.alias} - {conn.displayNumber || conn.phoneNumberId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Advisor Filter with Online Status (ONLY for admin/supervisor) */}
          {advisors.length > 0 && (currentUserRole === 'admin' || currentUserRole === 'supervisor') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Asesor</label>
              <select
                value={advisorFilter}
                onChange={(e) => setAdvisorFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring focus:ring-blue-100"
              >
                <option value="all">Todos los asesores</option>
                {advisors.map((advisor) => (
                  <option key={advisor.email} value={advisor.id}>
                    {advisor.isOnline ? "🟢" : "⚫"} {advisor.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Ver todos los chats (ONLY for advisors, not admin/supervisor) */}
          {currentUserRole !== 'admin' && currentUserRole !== 'supervisor' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <input
                type="checkbox"
                id="showAllChatsCheckbox"
                checked={showAllChats}
                onChange={(e) => setShowAllChats(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-white border-slate-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              <label htmlFor="showAllChatsCheckbox" className="text-xs font-medium text-slate-700 cursor-pointer select-none">
                Ver todos los chats (de todos los asesores)
              </label>
            </div>
          )}

          {(dateFilter !== "all" || customDateStart || customDateEnd || channelFilter !== "all" || connectionFilter !== "all" || advisorFilter !== "all" || showAllChats) && (
            <button
              onClick={() => {
                setDateFilter("all");
                setCustomDateStart("");
                setCustomDateEnd("");
                setChannelFilter("all");
                setConnectionFilter("all");
                setAdvisorFilter("all");
                setShowAllChats(false);
              }}
              className="w-full px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition"
            >
              Limpiar todos los filtros
            </button>
          )}
        </div>
      )}

      {/* Category Sidebar */}
      <div className="px-3 py-2 border-b border-slate-200 bg-white space-y-2">
        {/* MASIVOS */}
        <div className="border border-orange-400 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newExpanded = new Set(expandedCategories);
              if (newExpanded.has("MASIVOS")) {
                newExpanded.delete("MASIVOS");
              } else {
                newExpanded.add("MASIVOS");
              }
              setExpandedCategories(newExpanded);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition ${
              categoryFilter === "MASIVOS"
                ? "bg-orange-400 text-orange-900"
                : "bg-orange-300 text-orange-900 hover:bg-orange-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3 h-3 transition-transform ${expandedCategories.has("MASIVOS") ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span>📢</span>
              <span>MASIVOS</span>
            </div>
            <span className="text-xs font-bold">{categoryCounts.MASIVOS}</span>
          </button>
          {expandedCategories.has("MASIVOS") && (
            <div className="bg-orange-100 border-t border-b-2 border-orange-400 max-h-[70vh] overflow-y-auto">
              {getConversationsForCategory("MASIVOS").map((conv) => {
                const urgencyColor = getUrgencyColor(conv.lastMessageAt, conv.unread);
                const displayName = conv.contactName || conv.phone;
                const initials = getAdvisorInitials(conv.phone, advisors);
                const lastMsgTime = Date.now() - conv.lastMessageAt;
                const timeAgo = lastMsgTime < 60000 ? 'Ahora' :
                               lastMsgTime < 3600000 ? `${Math.floor(lastMsgTime / 60000)} min` :
                               lastMsgTime < 86400000 ? `${Math.floor(lastMsgTime / 3600000)}h` :
                               `${Math.floor(lastMsgTime / 86400000)}d`;

                const bgColor = selectedId === conv.id ? 'bg-orange-100' : 'bg-orange-50';

                return (
                  <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`px-3 py-3 cursor-pointer border-b border-orange-100 hover:bg-orange-100/70 transition ${bgColor}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar + Ticket Column */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <AvatarWithBadge
                          lastClientMessageAt={conv.lastClientMessageAt}
                          avatarUrl={conv.avatarUrl}
                          contactName={conv.contactName}
                        />
                        <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">#{conv.ticketNumber || 'N/A'}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Name, Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-900 line-clamp-2 break-words">{displayName}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{timeAgo}</span>
                        </div>

                        {/* Line 2: WhatsApp number and Badge */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-xl text-xs">
                              <span>📱</span>
                              <span className="font-bold text-green-600">{conv.displayNumber || 'N/A'}</span>
                            </span>
                            {/* Show assigned advisor when showAllChats is enabled OR for admin/supervisor roles */}
                            {(showAllChats || currentUserRole === 'admin' || currentUserRole === 'supervisor' || currentUserRole === 'gerencia') && conv.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                                <span>👤</span>
                                <span className="font-semibold text-blue-700">{getAdvisorName(conv.assignedTo, advisors) || 'Asesor'}</span>
                              </span>
                            )}
                          </div>
                          {urgencyColor && (
                            <span className={`${urgencyColor} text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0`}>
                              {conv.unread}
                            </span>
                          )}
                        </div>

                        {/* Line 3: Last message preview */}
                        <div className="text-xs text-slate-500 truncate">
                          {conv.lastMessagePreview || 'Sin mensajes'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {getConversationsForCategory("MASIVOS").length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  No hay conversaciones en esta categoría
                </div>
              )}
            </div>
          )}
        </div>

        {/* EN COLA / BOT */}
        <div className="border border-purple-200 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newExpanded = new Set(expandedCategories);
              if (newExpanded.has("EN_COLA_BOT")) {
                newExpanded.delete("EN_COLA_BOT");
              } else {
                newExpanded.add("EN_COLA_BOT");
              }
              setExpandedCategories(newExpanded);
            }}
            style={{
              background: categoryFilter === "EN_COLA_BOT"
                ? 'linear-gradient(to right, #facc15 0%, #facc15 50%, #c084fc 50%, #c084fc 100%)'
                : 'linear-gradient(to right, #fde047 0%, #fde047 50%, #d8b4fe 50%, #d8b4fe 100%)'
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition ${
              categoryFilter === "EN_COLA_BOT"
                ? "text-yellow-900"
                : "text-yellow-800 hover:opacity-90"
            }`}
          >
            <div className="flex items-center justify-between w-full pr-8">
              <div className="flex items-center gap-2">
                <svg
                  className={`w-3 h-3 transition-transform ${expandedCategories.has("EN_COLA_BOT") ? 'rotate-90' : ''}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span>🕐</span>
                <span>EN COLA</span>
              </div>
              <div className="flex items-center gap-2">
                <span>BOT</span>
                <span>🤖</span>
              </div>
            </div>
            <span className="text-xs font-bold">{categoryCounts.EN_COLA_BOT}</span>
          </button>
          {expandedCategories.has("EN_COLA_BOT") && (
            <div className="bg-purple-50/30 border-t border-b-2 border-purple-200 max-h-[70vh] overflow-y-auto">
              {getConversationsForCategory("EN_COLA_BOT").map((conv) => {
                const urgencyColor = getUrgencyColor(conv.lastMessageAt, conv.unread);
                const displayName = conv.contactName || conv.phone;
                const initials = getAdvisorInitials(conv.phone, advisors);
                const lastMsgTime = Date.now() - conv.lastMessageAt;
                const timeAgo = lastMsgTime < 60000 ? 'Ahora' :
                               lastMsgTime < 3600000 ? `${Math.floor(lastMsgTime / 60000)} min` :
                               lastMsgTime < 86400000 ? `${Math.floor(lastMsgTime / 3600000)}h` :
                               `${Math.floor(lastMsgTime / 86400000)}d`;

                // Determine if it's BOT or EN COLA
                const isBot = conv.assignedTo === 'bot' || conv.botFlowId;
                const bgColor = isBot
                  ? (selectedId === conv.id ? 'bg-purple-100' : 'bg-purple-50')
                  : (selectedId === conv.id ? 'bg-yellow-100' : 'bg-yellow-50');
                const borderColor = isBot ? 'border-purple-100' : 'border-yellow-100';
                const hoverColor = isBot ? 'hover:bg-purple-100/70' : 'hover:bg-yellow-100/70';

                return (
                  <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`px-3 py-3 cursor-pointer border-b ${borderColor} ${hoverColor} transition ${bgColor}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar + Ticket Column */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <AvatarWithBadge
                          lastClientMessageAt={conv.lastClientMessageAt}
                          avatarUrl={conv.avatarUrl}
                          contactName={conv.contactName}
                        />
                        <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">#{conv.ticketNumber || 'N/A'}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Name, Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-900 line-clamp-2 break-words">{displayName}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{timeAgo}</span>
                        </div>

                        {/* Line 2: WhatsApp number and Badge */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-xl text-xs">
                              <span>📱</span>
                              <span className="font-bold text-green-600">{conv.displayNumber || 'N/A'}</span>
                            </span>
                            {/* Show queue name when chat is in queue (no advisor assigned) */}
                            {!conv.assignedTo && conv.queueId && (() => {
                              const queue = queues.find(q => q.id === conv.queueId);
                              return queue ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-purple-50 border border-purple-200 rounded-lg text-xs">
                                  <span>📋</span>
                                  <span className="font-semibold text-purple-700">{queue.name}</span>
                                </span>
                              ) : null;
                            })()}
                            {/* Show assigned advisor when showAllChats is enabled OR for admin/supervisor roles */}
                            {(showAllChats || currentUserRole === 'admin' || currentUserRole === 'supervisor' || currentUserRole === 'gerencia') && conv.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                                <span>👤</span>
                                <span className="font-semibold text-blue-700">{getAdvisorName(conv.assignedTo, advisors) || 'Asesor'}</span>
                              </span>
                            )}
                          </div>
                          {urgencyColor && (
                            <span className={`${urgencyColor} text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0`}>
                              {conv.unread}
                            </span>
                          )}
                        </div>

                        {/* Line 3: Last message preview */}
                        <div className="text-xs text-slate-500 truncate">
                          {conv.lastMessagePreview || 'Sin mensajes'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {getConversationsForCategory("EN_COLA_BOT").length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  No hay conversaciones en esta categoría
                </div>
              )}
            </div>
          )}
        </div>

        {/* POR TRABAJAR */}
        <div className="border border-blue-400 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newExpanded = new Set(expandedCategories);
              if (newExpanded.has("POR_TRABAJAR")) {
                newExpanded.delete("POR_TRABAJAR");
              } else {
                newExpanded.add("POR_TRABAJAR");
              }
              setExpandedCategories(newExpanded);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition ${
              categoryFilter === "POR_TRABAJAR"
                ? "bg-blue-400 text-blue-900"
                : "bg-blue-300 text-blue-900 hover:bg-blue-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3 h-3 transition-transform ${expandedCategories.has("POR_TRABAJAR") ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span>🔵</span>
              <span>POR TRABAJAR</span>
            </div>
            <span className="text-xs font-bold">{categoryCounts.POR_TRABAJAR}</span>
          </button>
          {expandedCategories.has("POR_TRABAJAR") && (
            <div className="bg-blue-100 border-t border-b-2 border-blue-400 max-h-[70vh] overflow-y-auto">
              {getConversationsForCategory("POR_TRABAJAR").map((conv) => {
                const urgencyColor = getUrgencyColor(conv.lastMessageAt, conv.unread);
                const displayName = conv.contactName || conv.phone;
                const initials = getAdvisorInitials(conv.phone, advisors);
                const lastMsgTime = Date.now() - conv.lastMessageAt;
                const timeAgo = lastMsgTime < 60000 ? 'Ahora' :
                               lastMsgTime < 3600000 ? `${Math.floor(lastMsgTime / 60000)} min` :
                               lastMsgTime < 86400000 ? `${Math.floor(lastMsgTime / 3600000)}h` :
                               `${Math.floor(lastMsgTime / 86400000)}d`;

                const bgColor = selectedId === conv.id ? 'bg-blue-100' : 'bg-blue-50';

                return (
                  <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`px-3 py-3 cursor-pointer border-b border-blue-100 hover:bg-blue-100/70 transition ${bgColor}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar + Ticket Column */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <AvatarWithBadge
                          lastClientMessageAt={conv.lastClientMessageAt}
                          avatarUrl={conv.avatarUrl}
                          contactName={conv.contactName}
                        />
                        <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">#{conv.ticketNumber || 'N/A'}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Name, Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-900 line-clamp-2 break-words">{displayName}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{timeAgo}</span>
                        </div>

                        {/* Line 2: WhatsApp number and Badge */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-xl text-xs">
                              <span>📱</span>
                              <span className="font-bold text-green-600">{conv.displayNumber || 'N/A'}</span>
                            </span>
                            {/* Show assigned advisor when showAllChats is enabled OR for admin/supervisor roles */}
                            {(showAllChats || currentUserRole === 'admin' || currentUserRole === 'supervisor' || currentUserRole === 'gerencia') && conv.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                                <span>👤</span>
                                <span className="font-semibold text-blue-700">{getAdvisorName(conv.assignedTo, advisors) || 'Asesor'}</span>
                              </span>
                            )}
                          </div>
                          {urgencyColor && (
                            <span className={`${urgencyColor} text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0`}>
                              {conv.unread}
                            </span>
                          )}
                        </div>

                        {/* Line 3: Last message preview */}
                        <div className="text-xs text-slate-500 truncate">
                          {conv.lastMessagePreview || 'Sin mensajes'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {getConversationsForCategory("POR_TRABAJAR").length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  No hay conversaciones en esta categoría
                </div>
              )}
            </div>
          )}
        </div>

        {/* TRABAJANDO */}
        <div className="border border-green-400 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newExpanded = new Set(expandedCategories);
              if (newExpanded.has("TRABAJANDO")) {
                newExpanded.delete("TRABAJANDO");
              } else {
                newExpanded.add("TRABAJANDO");
              }
              setExpandedCategories(newExpanded);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition ${
              categoryFilter === "TRABAJANDO"
                ? "bg-green-400 text-green-900"
                : "bg-green-300 text-green-900 hover:bg-green-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3 h-3 transition-transform ${expandedCategories.has("TRABAJANDO") ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span>✅</span>
              <span>TRABAJANDO</span>
            </div>
            <span className="text-xs font-bold">{categoryCounts.TRABAJANDO}</span>
          </button>
          {expandedCategories.has("TRABAJANDO") && (
            <div className="bg-green-100 border-t border-b-2 border-green-400 max-h-[70vh] overflow-y-auto">
              {getConversationsForCategory("TRABAJANDO").map((conv) => {
                const urgencyColor = getUrgencyColor(conv.lastMessageAt, conv.unread);
                const displayName = conv.contactName || conv.phone;
                const initials = getAdvisorInitials(conv.phone, advisors);
                const lastMsgTime = Date.now() - conv.lastMessageAt;
                const timeAgo = lastMsgTime < 60000 ? 'Ahora' :
                               lastMsgTime < 3600000 ? `${Math.floor(lastMsgTime / 60000)} min` :
                               lastMsgTime < 86400000 ? `${Math.floor(lastMsgTime / 3600000)}h` :
                               `${Math.floor(lastMsgTime / 86400000)}d`;

                const bgColor = selectedId === conv.id ? 'bg-green-100' : 'bg-green-50';

                return (
                  <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`px-3 py-3 cursor-pointer border-b border-green-100 hover:bg-green-100/70 transition ${bgColor}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar + Ticket Column */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <AvatarWithBadge
                          lastClientMessageAt={conv.lastClientMessageAt}
                          avatarUrl={conv.avatarUrl}
                          contactName={conv.contactName}
                        />
                        <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">#{conv.ticketNumber || 'N/A'}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Name, Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-900 line-clamp-2 break-words">{displayName}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{timeAgo}</span>
                        </div>

                        {/* Line 2: WhatsApp number and Badge */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-xl text-xs">
                              <span>📱</span>
                              <span className="font-bold text-green-600">{conv.displayNumber || 'N/A'}</span>
                            </span>
                            {/* Show assigned advisor when showAllChats is enabled OR for admin/supervisor roles */}
                            {(showAllChats || currentUserRole === 'admin' || currentUserRole === 'supervisor' || currentUserRole === 'gerencia') && conv.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                                <span>👤</span>
                                <span className="font-semibold text-blue-700">{getAdvisorName(conv.assignedTo, advisors) || 'Asesor'}</span>
                              </span>
                            )}
                          </div>
                          {urgencyColor && (
                            <span className={`${urgencyColor} text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0`}>
                              {conv.unread}
                            </span>
                          )}
                        </div>

                        {/* Line 3: Last message preview */}
                        <div className="text-xs text-slate-500 truncate">
                          {conv.lastMessagePreview || 'Sin mensajes'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {getConversationsForCategory("TRABAJANDO").length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  No hay conversaciones en esta categoría
                </div>
              )}
            </div>
          )}
        </div>

        {/* FINALIZADOS */}
        <div className="border border-slate-400 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const newExpanded = new Set(expandedCategories);
              if (newExpanded.has("FINALIZADOS")) {
                newExpanded.delete("FINALIZADOS");
              } else {
                newExpanded.add("FINALIZADOS");
              }
              setExpandedCategories(newExpanded);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition ${
              categoryFilter === "FINALIZADOS"
                ? "bg-slate-400 text-slate-900"
                : "bg-slate-300 text-slate-900 hover:bg-slate-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-3 h-3 transition-transform ${expandedCategories.has("FINALIZADOS") ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span>📁</span>
              <span>FINALIZADOS</span>
            </div>
            <span className="text-xs font-bold">{categoryCounts.FINALIZADOS}</span>
          </button>
          {expandedCategories.has("FINALIZADOS") && (
            <div className="bg-slate-100 border-t border-b-2 border-slate-400 max-h-[70vh] overflow-y-auto">
              {getConversationsForCategory("FINALIZADOS").map((conv) => {
                const urgencyColor = getUrgencyColor(conv.lastMessageAt, conv.unread);
                const displayName = conv.contactName || conv.phone;
                const initials = getAdvisorInitials(conv.phone, advisors);
                const lastMsgTime = Date.now() - conv.lastMessageAt;
                const timeAgo = lastMsgTime < 60000 ? 'Ahora' :
                               lastMsgTime < 3600000 ? `${Math.floor(lastMsgTime / 60000)} min` :
                               lastMsgTime < 86400000 ? `${Math.floor(lastMsgTime / 3600000)}h` :
                               `${Math.floor(lastMsgTime / 86400000)}d`;

                const bgColor = selectedId === conv.id ? 'bg-slate-100' : 'bg-slate-50';

                return (
                  <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`px-3 py-3 cursor-pointer border-b border-slate-100 hover:bg-slate-100/70 transition ${bgColor}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar + Ticket Column */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <AvatarWithBadge
                          lastClientMessageAt={conv.lastClientMessageAt}
                          avatarUrl={conv.avatarUrl}
                          contactName={conv.contactName}
                        />
                        <span className="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">#{conv.ticketNumber || 'N/A'}</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Line 1: Name, Time */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-900 line-clamp-2 break-words">{displayName}</span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{timeAgo}</span>
                        </div>

                        {/* Line 2: WhatsApp number and Badge */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-xl text-xs">
                              <span>📱</span>
                              <span className="font-bold text-green-600">{conv.displayNumber || 'N/A'}</span>
                            </span>
                            {/* Show assigned advisor when showAllChats is enabled OR for admin/supervisor roles */}
                            {(showAllChats || currentUserRole === 'admin' || currentUserRole === 'supervisor' || currentUserRole === 'gerencia') && conv.assignedTo && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                                <span>👤</span>
                                <span className="font-semibold text-blue-700">{getAdvisorName(conv.assignedTo, advisors) || 'Asesor'}</span>
                              </span>
                            )}
                          </div>
                          {urgencyColor && (
                            <span className={`${urgencyColor} text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse flex-shrink-0`}>
                              {conv.unread}
                            </span>
                          )}
                        </div>

                        {/* Line 3: Last message preview */}
                        <div className="text-xs text-slate-500 truncate">
                          {conv.lastMessagePreview || 'Sin mensajes'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {getConversationsForCategory("FINALIZADOS").length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-500">
                  No hay conversaciones en esta categoría
                </div>
              )}
            </div>
          )}
        </div>

        {categoryFilter !== "all" && (
          <button
            onClick={() => setCategoryFilter("all")}
            className="w-full px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition mt-2"
          >
            Ver todas las conversaciones
          </button>
        )}
      </div>

      {/* Pulse animation for unread badge */}
      <style>{`
        @keyframes pulse-scale {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.5);
          }
        }
        .animate-pulse-scale {
          animation: pulse-scale 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return "";
  const formatter = new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
  return formatter.format(new Date(timestamp));
}
