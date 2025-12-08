import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadFlow, saveFlow } from "./data/persistence";
import { debounce } from "./utils/debounce";
import { DEFAULT_BUTTON_LIMIT } from "./flow/channelLimits";
import { ReactFlowCanvas } from "./ReactFlowCanvas";
import { testWebhookOut, generateWebhookInUrl, type WebhookResponse } from "./flow/webhooks";
import { UnifiedMetricsPanel } from "./components/UnifiedMetricsPanel";
import { NodeSearchModal } from "./components/NodeSearchModal";
import { TemplateSelector } from "./components/TemplateSelector";
import { FlowsGallery } from "./components/FlowsGallery";
import { useUndoRedo } from "./hooks/useUndoRedo";
import type { FlowTemplate } from "./templates/flowTemplates";
import { toPng } from './utils/htmlToImage';
import { ConfigurationPanel } from "./components/ConfigurationPanel";
import { BotChannelAssignment } from "./components/BotChannelAssignment";
import { WhatsAppNumbersPanel } from "./components/WhatsAppNumbersPanel";
import { useAuth } from "./hooks/useAuth";
import { usePermissions } from "./hooks/usePermissions";
import LoginPage from "./components/LoginPage";
import WelcomeSplash from "./components/WelcomeSplash";
import { LogOut, User, Bug, ListChecks } from "lucide-react";
import { ThemeToggle } from "./components/ThemeToggle";
import { AdvisorStatusButton } from "./crm/AdvisorStatusButton";
import { AdvisorStatusPanel } from "./crm/AdvisorStatusPanel";
import { createCrmSocket, type CrmSocket } from "./crm/socket";
import { BitrixCRMInspector } from "./components/BitrixCRMInspector";
import UserProfile from "./crm/UserProfile";
import CRMWorkspace from "./crm";
import { AdminTicketsPanel } from "./components/AdminTicketsPanel";
import { TicketFormModal } from "./components/TicketFormModal";
import { MyTicketsPanel } from "./components/MyTicketsPanel";
import { MaintenanceControlPanel } from "./components/MaintenanceAlert";
import { AIReportsPanel } from "./components/AIReportsPanel";
import { apiUrl } from "./lib/apiBase";
const CampaignsPage = React.lazy(() => import("./campaigns/CampaignsPage"));
const TemplateCreatorPage = React.lazy(() => import("./templates/TemplateCreatorPage"));
const AgendaPage = React.lazy(() => import("./agenda/AgendaPage"));
import {
  ConnectionCreationKind,
  STRICTEST_LIMIT,
  applyHandleAssignment,
  convertButtonsOverflowToList,
  createButtonOption,
  createMenuOption,
  createId,
  getAskData,
  getConditionData,
  getButtonsData,
  getHandleAssignments,
  getMenuOptions,
  getOutputHandleSpecs,
  getSchedulerData,
  nextChildId,
  normalizeButtonsData,
  normalizeFlow,
  normalizeSchedulerData,
  sanitizeTimeWindow,
} from "./flow/utils/flow";
import type {
  ActionKind,
  ButtonOption,
  ButtonsActionData,
  Flow,
  FlowNode,
  MenuOption,
  NodeType,
  AskActionData,
  ConditionActionData,
  SchedulerMode,
  SchedulerNodeData,
  TimeWindow,
  DateException,
  Weekday,
  ValidationKeywordGroup,
  KeywordGroupLogic,
} from "./flow/types";
import { validateCustomSchedule } from "./flow/scheduler";

const NODE_W = 300;
const NODE_H = 128;
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

const WEEKDAY_CHOICES: { value: Weekday; label: string; title: string }[] = [
  { value: 1, label: "L", title: "Lunes" },
  { value: 2, label: "Ma", title: "Martes" },
  { value: 3, label: "Mi", title: "Miércoles" },
  { value: 4, label: "J", title: "Jueves" },
  { value: 5, label: "V", title: "Viernes" },
  { value: 6, label: "S", title: "Sábado" },
  { value: 7, label: "D", title: "Domingo" },
];

const demoFlow: Flow = normalizeFlow({
  version: 1,
  id: "flow-demo",
  name: "Azaleia · Menú principal",
  rootId: "root",
  nodes: {
    root: {
      id: "root",
      label: "Inicio del flujo",
      type: "start",
      action: { kind: "start" },
      children: [],
    },
  },
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizePositionMap(
  positions: Record<string, { x: unknown; y: unknown }> | null | undefined,
): Record<string, { x: number; y: number }> {
  if (!positions) {
    return {};
  }

  const sanitized: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    if (pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) {
      sanitized[id] = { x: pos.x, y: pos.y };
    }
  }
  return sanitized;
}

function computeLayout(flow: Flow) {
  const pos: Record<string, { x: number; y: number }> = {};
  const levels: Record<number, string[]> = {};
  const seen = new Set<string>();
  function dfs(id: string, d: number) {
    if (seen.has(id)) return;
    seen.add(id);
    (levels[d] ||= []).push(id);
    const n = flow.nodes[id];
    if (!n) return;
    for (const cid of n.children) dfs(cid, d + 1);
  }
  dfs(flow.rootId, 0);
  const colW = 340, rowH = 170;
  Object.entries(levels).forEach(([depth, ids]) => {
    (ids as string[]).forEach((id, i) => { pos[id] = { x: Number(depth) * colW, y: i * rowH }; });
  });
  return pos;
}

function ensureStartNode(flow: Flow): Flow {
  const root = flow.nodes[flow.rootId];
  if (!root) {
    return flow;
  }
  const requiresUpdate = root.type !== 'start' || root.action?.kind !== 'start';
  if (!requiresUpdate) {
    return flow;
  }
  const updatedRoot: FlowNode = {
    ...root,
    type: 'start',
    action: root.action?.kind === 'start' ? root.action : { kind: 'start' },
  };
  const nextNodes: Flow['nodes'] = {
    ...flow.nodes,
    [flow.rootId]: { ...updatedRoot, menuOptions: undefined },
  };
  return { ...flow, nodes: nextNodes };
}

function inferAttachmentType(mimeType: string | undefined | null): 'image' | 'audio' | 'video' | 'file' {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reader.abort();
      reject(new Error('No se pudo leer el archivo'));
    };
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
  });
}

type NodePreviewProps = {
  node: FlowNode;
  flow: Flow;
  channel: 'whatsapp' | 'facebook' | 'instagram' | 'tiktok';
};

function NodePreview({ node, flow, channel }: NodePreviewProps) {
  if (node.type === "menu") {
    const options = getMenuOptions(node);
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-slate-700">Menú · {node.label}</div>
        <ol className="text-[11px] space-y-1 list-decimal list-inside">
          {options.map((option) => {
            const target = option.targetId ? flow.nodes[option.targetId] : null;
            return (
              <li key={option.id} className="flex justify-between gap-2">
                <span className="truncate">{option.label}</span>
                <span className="text-slate-400">{target ? target.label : "sin destino"}</span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  if (node.action?.kind === "buttons") {
    const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
    const visible = data.items.slice(0, data.maxButtons);
    const overflow = data.items.slice(data.maxButtons);
    return (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-slate-700">Botones interactivos</div>
        <div className="flex flex-wrap gap-1">
          {visible.map((item) => (
            <span key={item.id} className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700">
              {item.label}
            </span>
          ))}
          {overflow.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-violet-50 text-violet-700">Lista (+{overflow.length})</span>
          )}
        </div>
        <div className="text-[10px] text-slate-400">
          Límite base: {STRICTEST_LIMIT.max} (WhatsApp / Messenger). Canal actual: {channel}.
        </div>
      </div>
    );
  }

  if (node.action?.kind === "ask") {
    const ask = getAskData(node);
    return ask ? (
      <div className="space-y-1 text-[11px]">
        <div className="text-xs font-semibold text-slate-700">Pregunta al cliente</div>
        <div className="text-slate-600">{ask.questionText}</div>
        <div className="text-[10px] text-slate-400">
          Variable: {ask.varName} · Tipo: {ask.varType}
        </div>
      </div>
    ) : null;
  }

  if (node.action?.kind === "scheduler") {
    return (
      <div className="space-y-1 text-[11px]">
        <div className="text-xs font-semibold text-slate-700">Horario inteligente</div>
        <div className="text-slate-600">Configura destinos dentro/fuera de horario.</div>
      </div>
    );
  }

  if (node.action?.kind === "message") {
    const rawText = typeof node.action?.data?.text === "string" ? node.action.data.text : "";
    const trimmed = rawText.trim();
    return (
      <div className="text-[11px] space-y-1">
        <div className="text-xs font-semibold text-slate-700">Mensaje</div>
        <div className={trimmed ? "text-slate-600" : "text-rose-600 font-medium"}>
          {trimmed || "Mensaje sin contenido"}
        </div>
        {!trimmed && <div className="text-[10px] text-rose-500">Completa este mensaje para publicar.</div>}
      </div>
    );
  }

  if (node.action?.kind === "end") {
    const note = typeof node.action?.data?.note === "string" ? node.action.data.note : "";
    return (
      <div className="space-y-1 text-[11px]">
        <div className="text-xs font-semibold text-emerald-700">Fin del flujo</div>
        <div className="text-slate-600">{note || "Finaliza la conversación sin pasos adicionales."}</div>
      </div>
    );
  }

  return (
    <div className="text-[11px] text-slate-500">
      Vista previa no disponible para {node.action?.kind ?? node.type}.
    </div>
  );
}

type PersistedState = {
  flow: Flow;
  positions: Record<string, { x: number; y: number }>;
};

type Toast = { id: number; message: string; type: "success" | "error" };

export default function App(): JSX.Element {
  // Authentication state
  const { isAuthenticated, isLoading, user, checkAuth } = useAuth();
  const { hasPermission } = usePermissions(user?.role);
  const [showWelcomeSplash, setShowWelcomeSplash] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [userRoleName, setUserRoleName] = useState<string>('');

  // Fetch user role name
  useEffect(() => {
    if (!user?.role) return;

    const fetchRoleName = async () => {
      try {
        const response = await fetch(apiUrl("/api/admin/roles"), {
          credentials: "include",
        });
        if (response.ok) {
          const data = await response.json();
          const roles = data.roles || [];
          const roleObj = roles.find((r: any) => r.id === user.role);
          setUserRoleName(roleObj?.name?.toLowerCase() || user.role.toLowerCase());
        }
      } catch (error) {
        console.error("[App] Error loading role name:", error);
        setUserRoleName(user.role.toLowerCase());
      }
    };

    fetchRoleName();
  }, [user?.role]);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [showTicketsPanel, setShowTicketsPanel] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [showTicketForm, setShowTicketForm] = useState(false);
  const [showMyTickets, setShowMyTickets] = useState(false);

  const [flow, setFlowState] = useState<Flow>(demoFlow);
  const [positionsState, setPositionsState] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedId, setSelectedId] = useState(flow.rootId);
  const [soloRoot, setSoloRoot] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(flow.id || 'flow-demo');
  const [toast, setToast] = useState<Toast | null>(null);
  const [webhookTestResult, setWebhookTestResult] = useState<WebhookResponse | null>(null);
  const [webhookTesting, setWebhookTesting] = useState(false);
  // Default tab will be set by useEffect based on user role or from localStorage
  const [mainTab, setMainTab] = useState<'canvas' | 'crm' | 'campaigns' | 'templates' | 'agenda' | 'advisors' | 'metrics' | 'config' | 'ai-reports'>(() => {
    // Try to restore from localStorage first
    const saved = localStorage.getItem('flowbuilder_mainTab');
    if (saved && ['canvas', 'crm', 'campaigns', 'templates', 'agenda', 'advisors', 'metrics', 'config', 'ai-reports'].includes(saved)) {
      return saved as any;
    }
    return 'crm';
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFlowName, setSaveFlowName] = useState(flow.name);

  const [bitrixFieldOptions, setBitrixFieldOptions] = useState<string[]>([]);
  const [bitrixFieldsLoading, setBitrixFieldsLoading] = useState(false);
  const [bitrixFieldsError, setBitrixFieldsError] = useState<string | null>(null);

  // WhatsApp numbers management - Load from API
  const [whatsappNumbers, setWhatsappNumbers] = useState<import('./flow/types').WhatsAppNumberAssignment[]>([]);

  // All flows - for detecting duplicate number assignments
  const [allFlows, setAllFlows] = useState<Flow[]>([]);

  // Queues and advisors for transfer node
  const [queues, setQueues] = useState<Array<{ id: string; name: string }>>([]);
  const [advisors, setAdvisors] = useState<Array<{ id: string; name: string; email: string; isOnline: boolean }>>([]);

  // Global WebSocket for real-time advisor presence updates (always active)
  const [globalAdvisorSocket, setGlobalAdvisorSocket] = useState<CrmSocket | null>(null);

  // Check for URL parameters to navigate to specific tabs (e.g., ?tab=crm)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');

    if (tabParam === 'crm' || tabParam === 'campaigns' || tabParam === 'templates' ||
        tabParam === 'agenda' || tabParam === 'advisors' || tabParam === 'metrics' ||
        tabParam === 'config') {
      setMainTab(tabParam as any);
      // Clean URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Save mainTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('flowbuilder_mainTab', mainTab);
  }, [mainTab]);

  // Create GLOBAL WebSocket connection for real-time advisor presence updates
  // This socket stays active regardless of which tab is visible
  useEffect(() => {
    console.log('[App] 🔌 Creating GLOBAL WebSocket for real-time advisor presence...');
    const socket = createCrmSocket();

    // Listen for real-time advisor presence updates
    socket.on('crm:advisor:presence', (presence: any) => {
      console.log('[App] 📡 Advisor presence update received (REAL-TIME):', presence);

      // Update advisors state IMMEDIATELY when presence changes
      setAdvisors(prev => {
        const index = prev.findIndex(a => a.id === presence.userId);

        if (index === -1) {
          // New advisor, add to list
          console.log(`[App] ➕ Adding new advisor: ${presence.userId}`);
          return [...prev, {
            id: presence.userId,
            name: presence.user.name || presence.user.username,
            email: presence.user.email,
            isOnline: presence.isOnline
          }];
        } else {
          // Update existing advisor
          console.log(`[App] 🔄 Updating advisor ${presence.userId}: isOnline=${presence.isOnline}`);
          const updated = [...prev];
          updated[index] = {
            id: presence.userId,
            name: presence.user.name || presence.user.username,
            email: presence.user.email,
            isOnline: presence.isOnline
          };
          return updated;
        }
      });
    });

    setGlobalAdvisorSocket(socket);
    console.log('[App] ✅ Global advisor presence WebSocket connected');

    return () => {
      console.log('[App] 🔌 Disconnecting global advisor socket (App unmount)');
      socket.disconnect();
      setGlobalAdvisorSocket(null);
    };
  }, []); // Only run once on mount, never disconnect until app closes

  // Set default tab based on user role when user is loaded (only if not already set from localStorage)
  useEffect(() => {
    const saved = localStorage.getItem('flowbuilder_mainTab');
    if (saved) {
      // Already have a saved preference, don't override
      return;
    }

    if (user?.role === 'admin') {
      setMainTab('canvas');
    } else {
      // Advisors and supervisors see CRM (CHATS) by default
      setMainTab('crm');
    }
  }, [user?.role]);

  // Load WhatsApp numbers and all flows from API on mount
  useEffect(() => {
    const loadWhatsAppNumbers = async () => {
      try {
        const response = await fetch('/api/admin/whatsapp-numbers');
        if (response.ok) {
          const data = await response.json();
          if (data.numbers && Array.isArray(data.numbers)) {
            // Map API format to frontend format
            setWhatsappNumbers(data.numbers.map((n: any) => ({
              numberId: n.numberId,
              displayName: n.displayName,
              phoneNumber: n.phoneNumber,
              queueId: n.queueId,
            })));
          }
        }
      } catch (error) {
        console.error('Failed to load WhatsApp numbers:', error);
      }
    };

    const loadAllFlows = async () => {
      try {
        const response = await fetch('/api/flows');
        if (response.ok) {
          const data = await response.json();
          if (data.flows && Array.isArray(data.flows)) {
            setAllFlows(data.flows);
          }
        }
      } catch (error) {
        console.error('Failed to load flows:', error);
      }
    };

    loadWhatsAppNumbers();
    loadAllFlows();

    // Reload every 10 seconds to keep in sync with changes made in Configuration
    const interval = setInterval(() => {
      loadWhatsAppNumbers();
      loadAllFlows();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load queues and advisors for transfer node
  useEffect(() => {
    const loadQueuesAndAdvisors = async () => {
      try {
        // Load queues
        const queuesRes = await fetch('/api/admin/queues', {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (queuesRes.ok) {
          const queuesData = await queuesRes.json();
          setQueues((queuesData.queues || []).map((q: any) => ({ id: q.id, name: q.name })));
        } else {
          console.error('Failed to load queues:', queuesRes.status, await queuesRes.text());
        }

        // Load advisors with presence
        const advisorsRes = await fetch('/api/admin/advisor-presence', {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (advisorsRes.ok) {
          const advisorsData = await advisorsRes.json();
          setAdvisors((advisorsData.advisors || []).map((a: any) => ({
            id: a.userId,
            name: a.user.name || a.user.username,
            email: a.user.email,
            isOnline: a.isOnline
          })));
        } else {
          console.error('Failed to load advisors:', advisorsRes.status, await advisorsRes.text());
        }
      } catch (error) {
        console.error('Failed to load queues and advisors:', error);
      }
    };

    loadQueuesAndAdvisors();
    // Refresh every 5 minutes (only as backup - WebSocket provides real-time updates)
    const interval = setInterval(loadQueuesAndAdvisors, 300000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  // Update flow channel assignments
  const updateFlowChannelAssignments = useCallback((assignments: import('./flow/types').FlowChannelAssignment[]) => {
    setFlow((prev) => {
      const updated = { ...prev, channelAssignments: assignments };
      setDirty(true);
      return updated;
    });
  }, []);

  // Undo/Redo system
  type EditorState = {
    flow: Flow;
    positions: Record<string, { x: number; y: number }>;
  };

  const [editorState, undoRedoActions] = useUndoRedo<EditorState>({
    flow: demoFlow,
    positions: {},
  });

  // Track if we're applying undo/redo to prevent infinite loops
  const isApplyingHistory = useRef(false);

  // Copy/Paste system
  const [clipboard, setClipboard] = useState<FlowNode | null>(null);

  // Node Search system
  const [showNodeSearch, setShowNodeSearch] = useState(false);

  // Template selector
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showFlowsGallery, setShowFlowsGallery] = useState(false);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ id: Date.now(), message, type });
  }, []);

  const suppressDirtyRef = useRef(false);
  const flowRef = useRef(flow);
  const positionsRef = useRef(positionsState);
  const dirtyRef = useRef(dirty);
  const workspaceIdRef = useRef(workspaceId);

  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => { positionsRef.current = positionsState; }, [positionsState]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { workspaceIdRef.current = workspaceId; }, [workspaceId]);

  const setFlow = useCallback((updater: Flow | ((prev: Flow) => Flow)) => {
    setFlowState((prev) => {
      const candidate = typeof updater === "function" ? (updater as (prev: Flow) => Flow)(prev) : updater;
      const next = ensureStartNode(normalizeFlow(candidate));
      if (!suppressDirtyRef.current && next !== prev) {
        setDirty(true);
      }
      return next;
    });
  }, []);

  const setPositions = useCallback(
    (
      updater:
        | Record<string, { x: number; y: number }>
        | ((prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>)
    ) => {
      setPositionsState((prev) => {
        const nextRaw =
          typeof updater === "function"
            ? (updater as (prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>)(prev)
            : updater;
        const sanitized = sanitizePositionMap(nextRaw);
        const sameSize = Object.keys(prev).length === Object.keys(sanitized).length;
        const identical =
          sameSize &&
          Object.entries(sanitized).every(([id, position]) => {
            const existing = prev[id];
            return existing?.x === position.x && existing?.y === position.y;
          });
        if (identical) {
          return prev;
        }
        if (!suppressDirtyRef.current) {
          setDirty(true);
        }
        return sanitized;
      });
    },
    []
  );

  // Sync flow and positions changes to undo/redo history
  useEffect(() => {
    if (!isApplyingHistory.current) {
      const timeoutId = setTimeout(() => {
        undoRedoActions.set({ flow, positions: positionsState });
      }, 300); // Debounce to avoid too many history entries
      return () => clearTimeout(timeoutId);
    }
  }, [flow, positionsState, undoRedoActions]);

  // Apply undo/redo state changes
  useEffect(() => {
    if (editorState.flow !== flow || JSON.stringify(editorState.positions) !== JSON.stringify(positionsState)) {
      isApplyingHistory.current = true;
      suppressDirtyRef.current = true;

      setFlowState(editorState.flow);
      setPositionsState(editorState.positions);

      suppressDirtyRef.current = false;
      isApplyingHistory.current = false;
    }
  }, [editorState]);

  // Keyboard shortcuts for undo/redo and copy/paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        if (undoRedoActions.canUndo) {
          undoRedoActions.undo();
          showToast('Deshecho', 'success');
        }
      }
      // Redo: Ctrl+Y or Cmd+Shift+Z
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        if (!isTyping) {
          e.preventDefault();
          if (undoRedoActions.canRedo) {
            undoRedoActions.redo();
            showToast('Rehecho', 'success');
          }
        }
      }

      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isTyping) {
        e.preventDefault();
        const selected = flow.nodes[selectedId];
        if (selected && selected.id !== flow.rootId) {
          // Deep clone the node
          const cloned: FlowNode = JSON.parse(JSON.stringify(selected));
          setClipboard(cloned);
          showToast(`Copiado: ${selected.label}`, 'success');
        }
      }

      // Paste: Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isTyping) {
        e.preventDefault();
        if (clipboard) {
          // Create a duplicate of the clipboard node
          const newId = createId(`${clipboard.id}-copy`);
          const newNode: FlowNode = {
            ...JSON.parse(JSON.stringify(clipboard)),
            id: newId,
            label: `${clipboard.label} (Copia)`,
            children: [], // Reset children
          };

          // Add the new node to the flow
          setFlow((prev) => {
            const nextNodes = { ...prev.nodes, [newId]: newNode };
            return { ...prev, nodes: nextNodes };
          });

          // Position it near the original if we have position data
          const originalPosition = positionsState[clipboard.id];
          if (originalPosition) {
            setPositions((prev) => ({
              ...prev,
              [newId]: {
                x: originalPosition.x + 50,
                y: originalPosition.y + 50,
              },
            }));
          }

          setSelectedId(newId);
          showToast(`Pegado: ${newNode.label}`, 'success');
        }
      }

      // Search: Ctrl+F or Cmd+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowNodeSearch(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoRedoActions, showToast, selectedId, flow, clipboard, positionsState, setFlow, setPositions]);

  const replaceFlow = useCallback((nextFlow: Flow, nextPositions: Record<string, { x: number; y: number }> = {}) => {
    suppressDirtyRef.current = true;
    const normalized = ensureStartNode(normalizeFlow(nextFlow));
    setFlowState(normalized);
    setPositionsState(sanitizePositionMap(nextPositions));
    suppressDirtyRef.current = false;
    setSelectedId(normalized.rootId);
    // Asegurar que workspaceId siempre tenga un valor válido
    setWorkspaceId(normalized.id || 'flow-demo');
    setDirty(false);
  }, []);

  const handleSelectTemplate = useCallback((template: FlowTemplate) => {
    replaceFlow(template.flow, {});
    setDirty(true);
    showToast(`Template "${template.name}" cargado`, 'success');
  }, [replaceFlow, showToast]);

  const handleSelectFlow = useCallback(async (flowId: string) => {
    // Validación: Evitar llamadas con flowId undefined o vacío
    if (!flowId || flowId === 'undefined' || flowId.trim() === '') {
      console.error('Error: Attempted to load flow with invalid ID:', flowId);
      showToast('Error: ID de flujo inválido', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/flows/${flowId}`);
      if (!response.ok) {
        throw new Error(`Failed to load flow: ${response.status}`);
      }
      const flowData = await response.json();
      replaceFlow(flowData.flow || flowData, flowData.positions || {});
      setDirty(false);
      showToast(`Flujo "${flowData.flow?.name || flowData.name || flowId}" cargado`, 'success');
    } catch (error) {
      console.error('Error loading flow:', error);
      showToast('Error al cargar el flujo', 'error');
    }
  }, [replaceFlow, showToast]);

  const handleExportPNG = useCallback(async () => {
    const canvasElement = document.querySelector('.react-flow__viewport');
    if (!canvasElement) {
      showToast('No se pudo encontrar el canvas', 'error');
      return;
    }

    try {
      const dataUrl = await toPng(canvasElement as HTMLElement, {
        cacheBust: true,
        backgroundColor: '#f8fafc',
      });

      const link = document.createElement('a');
      link.download = `${flow.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();

      showToast('Flujo exportado como PNG', 'success');
    } catch (error) {
      console.error('Error exporting PNG:', error);
      showToast('Error al exportar PNG', 'error');
    }
  }, [flow.name, showToast]);

  const selected = flow.nodes[selectedId] ?? flow.nodes[flow.rootId];
  const emptyMessageNodes = useMemo(() => {
    const ids = new Set<string>();
    for (const node of Object.values(flow.nodes)) {
      if (node.action?.kind === "message") {
        const text = typeof node.action.data?.text === "string" ? node.action.data.text.trim() : "";
        if (!text) {
          ids.add(node.id);
        }
      }
    }
    return ids;
  }, [flow.nodes]);
  const hasBlockingErrors = emptyMessageNodes.size > 0;
  const selectedHasMessageError = emptyMessageNodes.has(selected.id);
  const menuOptionsForSelected = selected.type === "menu" ? getMenuOptions(selected) : [];
  const buttonsDataForSelected = getButtonsData(selected);
  const askDataForSelected = getAskData(selected);
  const askValidationOptions =
    askDataForSelected?.validation?.type === "options" ? askDataForSelected.validation.options : [];
  const schedulerDataForSelected = getSchedulerData(selected);
  const validationDataForSelected = getConditionData(selected);
  const conditionTargetOptions = useMemo(() => {
    return Object.values(flow.nodes)
      .filter((node) => node.id !== selectedId)
      .map((node) => ({ id: node.id, label: node.label || node.id }));
  }, [flow.nodes, selectedId]);

  type ConditionTargetKey = "matchTargetId" | "noMatchTargetId" | "errorTargetId" | "defaultTargetId";



  useEffect(() => {
    if (selected.action?.kind !== 'condition') {
      return;
    }
    let cancelled = false;
    const loadFields = async () => {
      try {
        setBitrixFieldsLoading(true);
        setBitrixFieldsError(null);
        const response = await fetch('/api/bitrix/fields');
        if (!response.ok) {
          throw new Error('No se pudo cargar el catálogo de campos');
        }
        const payload = await response.json();
        const fields = Array.isArray(payload?.fields) ? payload.fields : [];
        if (!cancelled) {
          setBitrixFieldOptions(fields.map((field: string) => String(field)));
        }
      } catch (error) {
        console.error('Error fetching Bitrix fields', error);
        if (!cancelled) {
          setBitrixFieldsError(error instanceof Error ? error.message : 'Error desconocido');
          setBitrixFieldOptions([
            'NAME',
            'LAST_NAME',
            'EMAIL',
            'PHONE',
            'UF_CRM_CUSTOM',
          ]);
        }
      } finally {
        if (!cancelled) {
          setBitrixFieldsLoading(false);
        }
      }
    };

    void loadFields();
    return () => {
      cancelled = true;
    };
  }, [selected.action?.kind]);

  const handleMenuOptionUpdate = useCallback(
    (optionId: string, patch: Partial<MenuOption>) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.type !== "menu") return next;
        const options = getMenuOptions(node);
        const index = options.findIndex((opt) => opt.id === optionId);
        if (index >= 0) {
          options[index] = { ...options[index], ...patch };
          node.menuOptions = options;
        }
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleAddMenuOption = useCallback(() => {
    console.log('🔵 handleAddMenuOption llamado, selectedId:', selectedId);
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      const node = next.nodes[selectedId];
      console.log('🔵 Nodo encontrado:', node);
      if (!node) {
        console.log('🔴 ERROR: No hay nodo seleccionado');
        return next;
      }
      console.log('🔵 Tipo de nodo:', node.type);
      if (node.type !== "menu") {
        console.log('🔴 ERROR: Tipo de nodo no es menu');
        return next;
      }
      const options = getMenuOptions(node);
      console.log('🔵 Opciones actuales:', options);
      options.push(createMenuOption(options.length));
      console.log('🔵 Opciones después de push:', options);
      node.menuOptions = options;
      console.log('🔵 Nodo actualizado:', node);
      return next;
    });
  }, [selectedId, setFlow]);

  const handleRemoveMenuOption = useCallback(
    (optionId: string) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.type !== "menu") return next;
        const options = getMenuOptions(node);
        const option = options.find((opt) => opt.id === optionId);
        if (!option || option.targetId) return next;
        const remaining = options.filter((opt) => opt.id !== optionId);
        node.menuOptions = remaining.map((opt, idx) => createMenuOption(idx, opt));
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleButtonUpdate = useCallback(
    (buttonId: string, patch: Partial<ButtonOption>) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.action?.kind !== "buttons") return next;
        const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
        const index = data.items.findIndex((item) => item.id === buttonId);
        if (index >= 0) {
          data.items[index] = { ...data.items[index], ...patch };
          node.action = { ...node.action, data };
        }
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleAddButton = useCallback(() => {
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      const node = next.nodes[selectedId];
      if (!node || node.action?.kind !== "buttons") return next;
      const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
      data.items.push(createButtonOption(data.items.length));
      node.action = { ...node.action, data };
      return next;
    });
  }, [selectedId, setFlow]);

  const handleRemoveButton = useCallback(
    (buttonId: string) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.action?.kind !== "buttons") return next;
        const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
        const button = data.items.find((item) => item.id === buttonId);
        if (!button || button.targetId) return next;
        data.items = data.items.filter((item) => item.id !== buttonId).map((item, idx) => createButtonOption(idx, item));
        node.action = { ...node.action, data };
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleConvertButtonsToList = useCallback(() => {
    let createdId: string | null = null;
    setFlow((prev) => {
      const { nextFlow, listNodeId } = convertButtonsOverflowToList(prev, selectedId);
      createdId = listNodeId;
      return nextFlow;
    });
    if (createdId) {
      setSelectedId(createdId);
      showToast("Se movieron las opciones extra a un bloque Lista", "success");
    } else {
      showToast("No hay botones adicionales para convertir", "error");
    }
  }, [selectedId, setFlow, setSelectedId, showToast]);

  const handleAttachmentUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;

      // Show uploading state
      console.log('[FlowBuilder] Uploading file to server:', file.name);

      const reader = new FileReader();
      reader.onload = async () => {
        const payload = typeof reader.result === "string" ? reader.result : "";
        const base64Data = payload.split(',')[1]; // Remove "data:mime;base64," prefix

        try {
          // Upload file to server storage
          const response = await fetch('/api/crm/attachments/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              filename: file.name,
              mime: file.type,
              data: base64Data
            })
          });

          if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
          }

          const { attachment } = await response.json();
          console.log('[FlowBuilder] File uploaded successfully:', attachment);

          // Determine correct attType based on file mime type
          let attType = "file"; // default
          if (file.type.startsWith('image/')) {
            attType = "image";
          } else if (file.type.startsWith('audio/')) {
            attType = "audio";
          } else if (file.type.startsWith('video/')) {
            attType = "video";
          }

          // Create absolute URL for WhatsApp (requires public HTTPS URL)
          const absoluteUrl = `${window.location.origin}${attachment.url}`;

          // Update node with URL (NOT fileData)
          setFlow((prev) => {
            const next: Flow = JSON.parse(JSON.stringify(prev));
            const node = next.nodes[selectedId];
            if (!node || node.action?.kind !== "attachment") return prev;
            node.action = {
              ...node.action,
              data: {
                ...(node.action.data || {}),
                attType, // Auto-detect correct type
                fileName: file.name,
                mimeType: file.type,
                fileSize: file.size,
                url: absoluteUrl, // Store URL, not fileData
                name: node.action.data?.name || file.name, // Keep existing name or use filename
                // Don't store fileData to keep flow size small!
              },
            };
            return next;
          });
        } catch (error) {
          console.error('[FlowBuilder] File upload failed:', error);
          alert(`Error al subir el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`);
        }
      };
      reader.readAsDataURL(file);
    },
    [selectedId, setFlow]
  );

  const handleAttachmentClear = useCallback(() => {
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      const node = next.nodes[selectedId];
      if (!node || node.action?.kind !== "attachment") return next;
      node.action = {
        ...node.action,
        data: {
          ...(node.action.data || {}),
          fileName: "",
          mimeType: "",
          fileSize: 0,
          fileData: "",
          url: "", // Also clear URL
        },
      };
      return next;
    });
  }, [selectedId, setFlow]);

  const handleMessageAttachments = useCallback(
    (nodeId: string, files: FileList) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const target = flowRef.current.nodes[nodeId];
      if (!target || target.action?.kind !== "message") {
        showToast("Solo puedes adjuntar archivos a bloques de mensaje", "error");
        return;
      }

      const baseChildCount = Array.isArray(target.children) ? target.children.length : 0;

      void (async () => {
        const processed = await Promise.all(
          fileArray.map(async (file) => {
            try {
              const dataUrl = await readFileAsDataUrl(file);
              return { file, dataUrl };
            } catch (error) {
              console.error("Error leyendo adjunto", error);
              return null;
            }
          }),
        );

        const successful = processed.filter((entry): entry is { file: File; dataUrl: string } => Boolean(entry));
        if (successful.length === 0) {
          showToast("No se pudieron procesar los archivos seleccionados", "error");
          return;
        }

        const created: Array<{ id: string; file: File }> = [];

        setFlow((prev) => {
          const next: Flow = JSON.parse(JSON.stringify(prev));
          const parent = next.nodes[nodeId];
          if (!parent || parent.action?.kind !== "message") {
            return prev;
          }

          const children = Array.isArray(parent.children) ? [...parent.children] : [];

          for (const { file, dataUrl } of successful) {
            const newId = nextChildId(next, nodeId);
            created.push({ id: newId, file });
            children.push(newId);
            const displayName = file.name || "archivo";
            next.nodes[newId] = {
              id: newId,
              label: `Adjunto · ${displayName}`,
              type: "action",
              children: [],
              action: {
                kind: "attachment",
                data: {
                  attType: inferAttachmentType(file.type),
                  url: "",
                  name: displayName,
                  fileName: displayName,
                  mimeType: file.type || "application/octet-stream",
                  fileSize: file.size,
                  fileData: dataUrl,
                },
              },
            } satisfies FlowNode;
          }

          parent.children = children;

          return next;
        });

        if (created.length === 0) {
          showToast("No se pudo crear el adjunto", "error");
          return;
        }

        const parentPosition =
          positionsRef.current[nodeId] ?? computeLayout(flowRef.current)[nodeId] ?? { x: 0, y: 0 };
        setPositions((prev) => {
          const nextPositions = { ...prev };
          created.forEach(({ id }, index) => {
            const offsetIndex = baseChildCount + index;
            nextPositions[id] = {
              x: parentPosition.x + NODE_W + 40,
              y: parentPosition.y + offsetIndex * (NODE_H + 40),
            };
          });
          return nextPositions;
        });

        setSelectedId(created[created.length - 1]?.id ?? nodeId);

        if (successful.length < fileArray.length) {
          showToast("Algunos archivos no se pudieron adjuntar", "error");
        }

        showToast(
          created.length > 1
            ? `${created.length} adjuntos agregados al mensaje`
            : "Adjunto agregado al mensaje",
          "success",
        );
      })();
    },
    [setFlow, setPositions, setSelectedId, showToast],
  );

  const updateSelectedAction = useCallback(
    (kind: ActionKind, data?: unknown) => {
      setFlow((prev) => {
        const currentNode = prev.nodes[selectedId];
        if (!currentNode) {
          return prev;
        }

        const actionData =
          data === undefined || data === null ? undefined : (data as Record<string, any>);
        const nextNode: FlowNode = {
          ...currentNode,
          action: actionData !== undefined ? { kind, data: actionData } : { kind },
        };

        if (kind === "end") {
          nextNode.children = [];
        }

        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [selectedId]: nextNode,
          },
        };
      });
    },
    [selectedId, setFlow],
  );

  const handleValidationUpdate = useCallback(
    (updater: ConditionActionData | ((prev: ConditionActionData) => ConditionActionData)) => {
      setFlow((prev) => {
        const currentNode = prev.nodes[selectedId];
        if (!currentNode || currentNode.action?.kind !== "condition") {
          return prev;
        }

        const base = getConditionData(currentNode);
        if (!base) {
          return prev;
        }

        const nextData =
          typeof updater === "function"
            ? (updater as (prev: ConditionActionData) => ConditionActionData)(base)
            : updater;

        const sanitized = getConditionData({
          ...currentNode,
          action: { kind: "condition", data: nextData },
        });

        const nextNode: FlowNode = {
          ...currentNode,
          action: { kind: "condition", data: sanitized ?? nextData },
        };

        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [selectedId]: nextNode,
          },
        };
      });
    },
    [selectedId, setFlow],
  );

  const handleValidationTargetChange = useCallback(
    (key: ConditionTargetKey, targetId: string | null) => {
      handleValidationUpdate((prev) => {
        const next = { ...prev } as ConditionActionData;
        next[key] = targetId;
        return next;
      });
    },
    [handleValidationUpdate],
  );

  const handleKeywordGroupChange = useCallback(
    (groupId: string, updater: (group: ValidationKeywordGroup) => ValidationKeywordGroup) => {
      handleValidationUpdate((prev) => {
        const groups = [...(prev.keywordGroups ?? [])];
        const index = groups.findIndex((group) => group.id === groupId);
        if (index === -1) {
          return prev;
        }
        const current = groups[index];
        const nextGroups = [...groups];
        nextGroups[index] = updater(current);
        return { ...prev, keywordGroups: nextGroups };
      });
    },
    [handleValidationUpdate],
  );

  const handleAddKeywordGroup = useCallback(() => {
    handleValidationUpdate((prev) => {
      const nextGroups = [...(prev.keywordGroups ?? [])];
      nextGroups.push({
        id: createId("kw"),
        label: `Grupo ${nextGroups.length + 1}`,
        mode: "contains",
        keywords: ["palabra"],
      });
      return { ...prev, keywordGroups: nextGroups };
    });
  }, [handleValidationUpdate]);

  const handleRemoveKeywordGroup = useCallback(
    (groupId: string) => {
      handleValidationUpdate((prev) => {
        const groups = (prev.keywordGroups ?? []).filter((group) => group.id !== groupId);
        return { ...prev, keywordGroups: groups };
      });
    },
    [handleValidationUpdate],
  );

  const handleKeywordLogicChange = useCallback(
    (logic: KeywordGroupLogic) => {
      handleValidationUpdate((prev) => ({
        ...prev,
        keywordGroupLogic: logic,
      }));
    },
    [handleValidationUpdate],
  );

  const handleAddKeywordToGroup = useCallback(
    (groupId: string) => {
      handleKeywordGroupChange(groupId, (group) => ({
        ...group,
        keywords: [...(group.keywords ?? []), "palabra"],
      }));
    },
    [handleKeywordGroupChange],
  );

  const handleKeywordValueChange = useCallback(
    (groupId: string, index: number, value: string) => {
      handleKeywordGroupChange(groupId, (group) => {
        const keywords = [...(group.keywords ?? [])];
        keywords[index] = value;
        return { ...group, keywords };
      });
    },
    [handleKeywordGroupChange],
  );

  const handleRemoveKeyword = useCallback(
    (groupId: string, index: number) => {
      handleKeywordGroupChange(groupId, (group) => {
        const keywords = (group.keywords ?? []).filter((_, idx) => idx !== index);
        return { ...group, keywords };
      });
    },
    [handleKeywordGroupChange],
  );

  const renderConditionTargetSelector = useCallback(
    ({
      label,
      helper,
      key,
      value,
      tone,
    }: {
      label: string;
      helper?: string;
      key: ConditionTargetKey;
      value: string | null;
      tone: "default" | "success" | "warning" | "danger";
    }) => {
      const toneClasses: Record<"default" | "success" | "warning" | "danger", string> = {
        default: "border-slate-200",
        success: "border-emerald-200 bg-emerald-50/60",
        warning: "border-amber-200 bg-amber-50/60",
        danger: "border-rose-200 bg-rose-50/70",
      };
      const accent = toneClasses[tone] ?? toneClasses.default;
      return (
        <div key={key} className={`rounded-lg border ${accent} p-2 space-y-2`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold text-slate-600">{label}</div>
              {helper && <p className="text-[10px] text-slate-400">{helper}</p>}
            </div>
            {value && (
              <button
                type="button"
                className="px-2 py-0.5 text-[10px] border rounded"
                onClick={() => setSelectedId(value)}
              >
                Ver nodo
              </button>
            )}
          </div>
          <select
            className="w-full border rounded px-2 py-1 text-[12px]"
            value={value ?? ""}
            onChange={(event) =>
              handleValidationTargetChange(
                key,
                event.target.value ? event.target.value : null,
              )
            }
          >
            <option value="">Sin destino</option>
            {conditionTargetOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    },
    [conditionTargetOptions, handleValidationTargetChange, setSelectedId],
  );

  const handleAskUpdate = useCallback(
    (patch: Partial<Record<string, any>>) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.action?.kind !== "ask") return next;
        node.action = { ...node.action, data: { ...node.action.data, ...patch } };
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleSchedulerUpdate = useCallback(
    (updater: (current: SchedulerNodeData) => SchedulerNodeData) => {
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const node = next.nodes[selectedId];
        if (!node || node.action?.kind !== "scheduler") return next;
        const current = getSchedulerData(node);
        if (!current) return next;
        const updated = normalizeSchedulerData(updater(current));
        node.action = { ...node.action, data: updated };
        return next;
      });
    },
    [selectedId, setFlow]
  );

  const handleSchedulerModeChange = useCallback(
    (mode: SchedulerMode) => {
      handleSchedulerUpdate((current) => ({ ...current, mode }));
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerTimezoneChange = useCallback(
    (timezone: string) => {
      handleSchedulerUpdate((current) => ({
        ...current,
        custom: current.custom ? { ...current.custom, timezone } : undefined,
      }));
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerWindowChange = useCallback(
    (index: number, patch: Partial<TimeWindow>) => {
      handleSchedulerUpdate((current) => {
        const windows = [...(current.custom?.windows ?? [])];
        if (!windows[index]) return current;
        windows[index] = sanitizeTimeWindow({ ...windows[index], ...patch });
        return {
          ...current,
          custom: current.custom ? { ...current.custom, windows } : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerToggleWeekday = useCallback(
    (index: number, day: Weekday) => {
      handleSchedulerUpdate((current) => {
        const windows = [...(current.custom?.windows ?? [])];
        const target = windows[index];
        if (!target) return current;
        const set = new Set(target.weekdays);
        if (set.has(day)) {
          set.delete(day);
        } else {
          set.add(day);
        }
        const nextWeekdays = Array.from(set).sort((a, b) => a - b) as Weekday[];
        windows[index] = { ...target, weekdays: nextWeekdays };
        return {
          ...current,
          custom: current.custom ? { ...current.custom, windows } : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerToggleOvernight = useCallback(
    (index: number) => {
      handleSchedulerUpdate((current) => {
        const windows = [...(current.custom?.windows ?? [])];
        const target = windows[index];
        if (!target) return current;
        windows[index] = { ...target, overnight: !target.overnight };
        return {
          ...current,
          custom: current.custom ? { ...current.custom, windows } : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerAddWindow = useCallback(() => {
    handleSchedulerUpdate((current) => ({
      ...current,
      custom: current.custom
        ? { ...current.custom, windows: [...current.custom.windows, sanitizeTimeWindow(undefined)] }
        : undefined,
    }));
  }, [handleSchedulerUpdate]);

  const handleSchedulerRemoveWindow = useCallback(
    (index: number) => {
      handleSchedulerUpdate((current) => {
        const windows = [...(current.custom?.windows ?? [])];
        windows.splice(index, 1);
        return {
          ...current,
          custom: current.custom
            ? { ...current.custom, windows: windows.length > 0 ? windows : [sanitizeTimeWindow(undefined)] }
            : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerExceptionChange = useCallback(
    (index: number, patch: Partial<DateException>) => {
      handleSchedulerUpdate((current) => {
        const exceptions = [...(current.custom?.exceptions ?? [])];
        if (!exceptions[index]) return current;
        exceptions[index] = { ...exceptions[index], ...patch };
        return {
          ...current,
          custom: current.custom ? { ...current.custom, exceptions } : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  const handleSchedulerAddException = useCallback(() => {
    handleSchedulerUpdate((current) => ({
      ...current,
      custom: current.custom
        ? {
            ...current.custom,
            exceptions: [
              ...(current.custom.exceptions ?? []),
              { date: "", closed: true } as DateException,
            ],
          }
        : undefined,
    }));
  }, [handleSchedulerUpdate]);

  const handleSchedulerRemoveException = useCallback(
    (index: number) => {
      handleSchedulerUpdate((current) => {
        const exceptions = [...(current.custom?.exceptions ?? [])];
        exceptions.splice(index, 1);
        return {
          ...current,
          custom: current.custom ? { ...current.custom, exceptions } : undefined,
        };
      });
    },
    [handleSchedulerUpdate]
  );

  useEffect(() => {
    if (!toast || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const performSave = useCallback(async (flowId: string, flowName: string, message?: string) => {
    const updatedFlow = { ...flowRef.current, id: flowId, name: flowName };
    const payload: PersistedState = { flow: updatedFlow, positions: positionsRef.current };
    try {
      await saveFlow(flowId, payload);

      // Update current flow state
      setFlow(updatedFlow);
      flowRef.current = updatedFlow;
      setWorkspaceId(flowId);
      workspaceIdRef.current = flowId;

      setDirty(false);
      if (message) showToast(message, "success");
    } catch (error) {
      showToast("Error al guardar", "error");
      throw error;
    }
  }, [showToast]);

  const debouncedManualSave = useMemo(() => debounce(() => {
    performSave(workspaceIdRef.current, flowRef.current.name, "Flujo guardado").catch(() => {});
  }, 300), [performSave]);

  useEffect(() => {
    return () => {
      debouncedManualSave.cancel?.();
    };
  }, [debouncedManualSave]);

  const handleSaveClick = useCallback(() => {
    setSaveFlowName(flowRef.current.name);
    setShowSaveModal(true);
  }, []);

  const handleConfirmSave = useCallback(() => {
    const originalId = workspaceIdRef.current;
    const originalName = flowRef.current.name;

    // Generate new ID if name changed
    const flowId = saveFlowName !== originalName
      ? `${saveFlowName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36).slice(-6)}`
      : originalId;

    performSave(flowId, saveFlowName, saveFlowName !== originalName ? "Flujo guardado como nuevo" : "Flujo guardado")
      .then(() => {
        setShowSaveModal(false);
      })
      .catch(() => {});
  }, [saveFlowName, performSave]);

  const handleExport = useCallback(() => {
    if (typeof window === "undefined") {
      showToast("Exportación no disponible", "error");
      return;
    }
    try {
      const state: PersistedState = { flow: flowRef.current, positions: positionsRef.current };
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${workspaceIdRef.current || "flow"}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Flujo exportado", "success");
    } catch (error) {
      showToast("Error al exportar", "error");
    }
  }, [showToast]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<PersistedState>;
      if (!parsed || !parsed.flow) throw new Error("Invalid file");
      replaceFlow(parsed.flow, parsed.positions ?? {});
      showToast("Flujo importado", "success");
    } catch (error) {
      showToast("Error al importar", "error");
    } finally {
      event.target.value = "";
    }
  }, [replaceFlow, showToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const interval = window.setInterval(() => {
      if (!dirtyRef.current) return;
      performSave(workspaceIdRef.current, flowRef.current.name, "Auto-guardado").catch(() => {});
    }, AUTO_SAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [performSave]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadFlow<PersistedState>(workspaceIdRef.current);
        if (!stored || !stored.flow || cancelled) return;
        replaceFlow(stored.flow, stored.positions ?? {});
        // Toast removed - no need to notify users on auto-load
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [replaceFlow, showToast]);

  function addChildTo(parentId: string, type: NodeType) {
    console.log('🟢 addChildTo llamado con parentId:', parentId, 'type:', type);
    const parent = flow.nodes[parentId];
    if (!parent) return;
    const nid = nextChildId(flow, parentId);

    // Si el tipo es "simple-menu", convertirlo a "menu" con menuType: "text"
    const isSimpleMenu = type === "simple-menu";

    // Determinar si el nodo es de tipo "menu" o "action"
    let actualType: "menu" | "action";
    let actionKind: ActionKind | undefined;
    let actionData: any = undefined;
    let label = "Nueva acción";

    if (isSimpleMenu || type === "menu") {
      actualType = "menu";
      label = "Nuevo submenú";
    } else if (type === "action") {
      actualType = "action";
      actionKind = "message";
      actionData = { text: "Respuesta…" };
      label = "Nuevo mensaje";
    } else {
      // Todos los demás tipos son "action" con action.kind = type
      actualType = "action";
      actionKind = type as any as ActionKind; // NodePalette envía strings que no están en NodeType

      // Inicializar data según el actionKind
      const kindStr = type as string;
      if (kindStr === "buttons") {
        actionData = { items: [], maxButtons: 3 };
        label = "Nuevos botones";
      } else if (kindStr === "validation") {
        actionData = {
          validationType: "keywords",
          keywordGroups: [],
          validTargetId: null,
          invalidTargetId: null,
        };
        label = "Nueva validación";
      } else if (kindStr === "scheduler") {
        actionData = normalizeSchedulerData(undefined);
        label = "Nuevo scheduler";
      } else if (kindStr === "transfer") {
        actionData = { target: "queue", destination: "" };
        label = "Nueva transferencia";
      } else if (kindStr === "handoff") {
        actionData = {};
        label = "Nuevo handoff";
      } else {
        actionData = {};
        label = `Nueva acción`;
      }
    }

    const newNode: FlowNode = {
      id: nid,
      label,
      type: actualType,
      children: [],
      action: actualType === "action" ? { kind: actionKind!, data: actionData } : undefined,
      menuOptions: actualType === "menu" ? [] : undefined,
      menuType: isSimpleMenu ? "text" : undefined,
    };
    console.log('🟢 Nuevo nodo creado:', newNode);
    let linked = false;
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      next.nodes[nid] = newNode;
      const parentNode = next.nodes[parentId];
      if (!parentNode) return next;

      if (parentNode.type === "menu") {
        const options = getMenuOptions(parentNode);
        let optionIndex = options.findIndex((opt) => !opt.targetId);
        if (optionIndex === -1) {
          optionIndex = options.length;
          options.push(createMenuOption(optionIndex));
        }
        options[optionIndex] = { ...options[optionIndex], targetId: nid };
        parentNode.menuOptions = options;
        linked = true;
      } else if (parentNode.action?.kind === "buttons") {
        const data = normalizeButtonsData(parentNode.action.data as Partial<ButtonsActionData> | undefined);
        let assigned = false;
        for (const item of data.items) {
          if (!item.targetId) {
            item.targetId = nid;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          if (data.items.length < data.maxButtons) {
            const newIndex = data.items.length;
            data.items.push(createButtonOption(newIndex, { targetId: nid }));
            assigned = true;
          } else if (!data.moreTargetId) {
            data.moreTargetId = nid;
            assigned = true;
          }
        }
        if (assigned) {
          parentNode.action = { ...parentNode.action, data };
          linked = true;
        }
      } else if (parentNode.action?.kind === "ask") {
        const ask = getAskData(parentNode);
        if (ask) {
          const updated: AskActionData = { ...ask };
          if (!updated.answerTargetId) {
            updated.answerTargetId = nid;
            linked = true;
          } else if (!updated.invalidTargetId) {
            updated.invalidTargetId = nid;
            linked = true;
          }
          if (linked) {
            parentNode.action = { ...parentNode.action, data: updated };
          }
        }
      } else if (parentNode.action?.kind === "scheduler") {
        const scheduler = getSchedulerData(parentNode);
        if (scheduler) {
          const updated: SchedulerNodeData = { ...scheduler };
          if (!updated.inWindowTargetId) {
            updated.inWindowTargetId = nid;
            linked = true;
          } else if (!updated.outOfWindowTargetId) {
            updated.outOfWindowTargetId = nid;
            linked = true;
          }
          if (linked) {
            parentNode.action = { ...parentNode.action, data: updated };
          }
        }
      } else {
        linked = true;
      }

      if (linked) {
        parentNode.children = Array.from(new Set([...(parentNode.children ?? []), nid]));
      } else {
        delete next.nodes[nid];
      }
      return next;
    });
    if (linked) {
      // Posicionar el nuevo nodo cerca del padre
      const parentPosition =
        positionsRef.current[parentId] ?? computeLayout(flowRef.current)[parentId] ?? { x: 0, y: 0 };

      setPositions((prev) => ({
        ...prev,
        [nid]: {
          x: parentPosition.x + NODE_W + 40,
          y: parentPosition.y,
        },
      }));

      setSelectedId(nid);
    }
  }

  function addActionOfKind(
    parentId: string,
    kind:
      | "message"
      | "buttons"
      | "attachment"
      | "webhook_out"
      | "webhook_in"
      | "transfer"
      | "handoff"
      | "ia_rag"
      | "tool"
      | "question"
      | "validation"
      | "scheduler"
      | "delay"
      | "end",
  ) {
    let createdId: string | null = null;
    let failure: string | null = null;

    setFlow((prev) => {
      const parent = prev.nodes[parentId];
      if (!parent) {
        failure = "Selecciona un nodo válido para agregar acciones";
        return prev;
      }

      const handleSpecs = getOutputHandleSpecs(parent);
      if (handleSpecs.length === 0) {
        failure = "Este nodo no admite más conexiones";
        return prev;
      }

      const nid = nextChildId(prev, parentId);

      const defaults: Record<typeof kind, any> = {
        message: { text: "Mensaje" },
        buttons: normalizeButtonsData({
          items: [
            createButtonOption(0, { label: "Sí", value: "YES" }),
            createButtonOption(1, { label: "No", value: "NO" }),
          ],
          maxButtons: DEFAULT_BUTTON_LIMIT,
        }),
        attachment: { attType: "image", url: "", name: "archivo", fileName: "", mimeType: "", fileSize: 0, fileData: "" },
        webhook_out: {
          method: "POST",
          url: "https://api.ejemplo.com/webhook",
          headers: [{ k: "Content-Type", v: "application/json" }],
          body: '{\n  "user_id": "{{user.id}}",\n  "input": "{{last_message}}"\n}',
        },
        webhook_in: { path: "/hooks/inbound", secret: "", sample: "{ id: 123, text: 'hola' }" },
        transfer: { target: "queue", destination: "" },
        handoff: { queue: "agentes", note: "pasar a humano" },
        ia_rag: { provider: "openai", model: "gpt-4o", prompt: "Responde la pregunta del usuario basándote en el contexto", temperature: 0.7 },
        tool: { name: "mi-tool", args: {} },
        question: {
          questionText: "¿Cuál es tu respuesta?",
          varName: "respuesta",
          varType: "text",
          validation: { type: "none" },
          retryMessage: "Lo siento, ¿puedes intentarlo de nuevo?",
          answerTargetId: null,
          invalidTargetId: null,
        },
        validation: {
          rules: [],
          matchMode: "any",
          defaultTargetId: null,
          bitrixConfig: {
            entityType: "lead",
            identifierField: "PHONE",
            fieldsToCheck: ["NAME", "LAST_NAME"],
          },
          keywordGroups: [
            {
              id: createId("kw"),
              label: "Grupo 1",
              mode: "contains",
              keywords: ["keyword"],
            },
          ],
          keywordGroupLogic: "or",
          matchTargetId: null,
          noMatchTargetId: null,
          errorTargetId: null,
        },
        scheduler: normalizeSchedulerData(undefined),
        delay: { delaySeconds: 5, note: "Espera de 5 segundos" },
        end: { note: "Fin del flujo" },
      };

      const labelMap: Record<typeof kind, string> = {
        message: "Mensaje",
        buttons: "Botones",
        attachment: "Adjunto",
        webhook_out: "Webhook OUT",
        webhook_in: "Webhook IN",
        transfer: "Transferir",
        handoff: "Handoff",
        ia_rag: "IA RAG",
        tool: "Herramienta",
        question: "Pregunta",
        validation: "Validación",
        scheduler: "Scheduler",
        delay: "Delay",
        end: "Fin del flujo",
      };

      const actionKindMap: Record<typeof kind, ActionKind> = {
        message: "message",
        buttons: "buttons",
        attachment: "attachment",
        webhook_out: "webhook_out",
        webhook_in: "webhook_in",
        transfer: "transfer",
        handoff: "handoff",
        ia_rag: "ia_rag",
        tool: "tool",
        question: "ask",
        validation: "condition",
        scheduler: "scheduler",
        delay: "delay",
        end: "end",
      };

      const newNode: FlowNode = {
        id: nid,
        label: labelMap[kind] ?? `Acción · ${kind}`,
        type: "action",
        children: [],
        action: { kind: actionKindMap[kind], data: defaults[kind] },
      };

      const nextNodes: Flow["nodes"] = { ...prev.nodes };
      const parentClone: FlowNode = {
        ...parent,
        children: Array.isArray(parent.children) ? [...parent.children] : [],
      };
      if (parent.menuOptions) {
        parentClone.menuOptions = parent.menuOptions.map((option, idx) => createMenuOption(idx, option));
      }
      if (parent.action) {
        parentClone.action = {
          ...parent.action,
          data:
            parent.action.data && typeof parent.action.data === "object"
              ? JSON.parse(JSON.stringify(parent.action.data))
              : parent.action.data,
        };
      }

      nextNodes[parentId] = parentClone;
      nextNodes[nid] = newNode;

      const nextFlow: Flow = { ...prev, nodes: nextNodes };
      const assignments = getHandleAssignments(parentClone);
      const availableHandle =
        handleSpecs.find((spec) => !assignments[spec.id])?.id ?? handleSpecs[0]?.id ?? "out:default";

      if (!availableHandle || !applyHandleAssignment(nextFlow, parentId, availableHandle, nid)) {
        failure = "No hay salidas disponibles en este nodo.";
        return prev;
      }

      createdId = nid;
      return nextFlow;
    });

    if (createdId) {
      // Posicionar el nuevo nodo cerca del padre
      const nodeId = createdId;
      const parentPosition =
        positionsRef.current[parentId] ?? computeLayout(flowRef.current)[parentId] ?? { x: 0, y: 0 };

      setPositions((prev) => ({
        ...prev,
        [nodeId]: {
          x: parentPosition.x + NODE_W + 40,
          y: parentPosition.y,
        },
      }));

      setSelectedId(nodeId);
    } else if (failure) {
      showToast(failure, "error");
    }
  }


  function deleteNode(id:string){
    if (id===flow.rootId) return;
    const parentEntry = Object.values(flow.nodes).find(n=>n.children.includes(id));
    const parentId = parentEntry?.id;
    const next: Flow = JSON.parse(JSON.stringify(flow));
    const removed = next.nodes[id];
    if (!removed) return;
    const preservedChildren = removed.children.filter((childId) => Boolean(next.nodes[childId]));
    delete next.nodes[id];

    if (parentId) {
      const parentNode = next.nodes[parentId];
      if (parentNode) {
        const fallbackTarget = preservedChildren[0] ?? null;
        const originalChildren = parentNode.children.filter((childId) => childId !== id);
        const insertionIndex = parentNode.children.indexOf(id);
        const sanitized = preservedChildren.filter((childId) => Boolean(next.nodes[childId]));
        if (sanitized.length > 0) {
          if (insertionIndex >= 0 && insertionIndex <= originalChildren.length) {
            originalChildren.splice(insertionIndex, 0, ...sanitized);
          } else {
            originalChildren.push(...sanitized);
          }
        }
        parentNode.children = Array.from(new Set(originalChildren));

        if (parentNode.type === "menu" && parentNode.menuOptions) {
          parentNode.menuOptions = parentNode.menuOptions.map((option, idx) =>
            createMenuOption(idx, {
              ...option,
              targetId: option.targetId === id ? fallbackTarget : option.targetId,
            })
          );
        } else if (parentNode.action?.kind === "buttons") {
          const data = normalizeButtonsData(parentNode.action.data as Partial<ButtonsActionData> | undefined);
          data.items = data.items.map((item, idx) =>
            createButtonOption(idx, {
              ...item,
              targetId: item.targetId === id ? fallbackTarget : item.targetId,
            })
          );
          if (data.moreTargetId === id) {
            data.moreTargetId = fallbackTarget;
          }
          parentNode.action = { ...parentNode.action, data };
        } else if (parentNode.action?.kind === "ask") {
          const ask = getAskData(parentNode);
          if (ask) {
            const updated: AskActionData = { ...ask };
            if (updated.answerTargetId === id) {
              updated.answerTargetId = fallbackTarget;
            }
            if (updated.invalidTargetId === id) {
              updated.invalidTargetId = fallbackTarget;
            }
            parentNode.action = { ...parentNode.action, data: updated };
          }
        } else if (parentNode.action?.kind === "condition") {
          const condition = getConditionData(parentNode);
          if (condition) {
            const updated: ConditionActionData = { ...condition };
            if (updated.matchTargetId === id) {
              updated.matchTargetId = fallbackTarget;
            }
            if (updated.noMatchTargetId === id) {
              updated.noMatchTargetId = fallbackTarget;
            }
            if (updated.errorTargetId === id) {
              updated.errorTargetId = fallbackTarget;
            }
            if (updated.defaultTargetId === id) {
              updated.defaultTargetId = fallbackTarget;
            }
            parentNode.action = { ...parentNode.action, data: updated };
          }
        } else if (parentNode.action?.kind === "scheduler") {
          const scheduler = getSchedulerData(parentNode);
          if (scheduler) {
            const updated: SchedulerNodeData = { ...scheduler };
            if (updated.inWindowTargetId === id) {
              updated.inWindowTargetId = fallbackTarget;
            }
            if (updated.outOfWindowTargetId === id) {
              updated.outOfWindowTargetId = fallbackTarget;
            }
            parentNode.action = { ...parentNode.action, data: updated };
          }
        }
      }
    }

    for (const node of Object.values(next.nodes)){
      node.children = node.children
        .filter((childId)=>childId !== id)
        .filter((childId)=>Boolean(next.nodes[childId]));
      if (node.type === "menu" && node.menuOptions) {
        node.menuOptions = node.menuOptions.map((option, idx) =>
          createMenuOption(idx, {
            ...option,
            targetId: option.targetId && next.nodes[option.targetId] ? option.targetId : null,
          })
        );
      }
      if (node.action?.kind === "buttons") {
        const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
        data.items = data.items.map((item, idx) =>
          createButtonOption(idx, {
            ...item,
            targetId: item.targetId && next.nodes[item.targetId] ? item.targetId : null,
          })
        );
        if (data.moreTargetId && !next.nodes[data.moreTargetId]) {
          data.moreTargetId = null;
        }
        node.action = { ...node.action, data };
      }
      if (node.action?.kind === "ask") {
        const ask = getAskData(node);
        if (ask) {
          const updated: AskActionData = { ...ask };
          if (updated.answerTargetId && !next.nodes[updated.answerTargetId]) {
            updated.answerTargetId = null;
          }
          if (updated.invalidTargetId && !next.nodes[updated.invalidTargetId]) {
            updated.invalidTargetId = null;
          }
          node.action = { ...node.action, data: updated };
        }
      }
      if (node.action?.kind === "scheduler") {
        const scheduler = getSchedulerData(node);
        if (scheduler) {
          const updated: SchedulerNodeData = { ...scheduler };
          if (updated.inWindowTargetId && !next.nodes[updated.inWindowTargetId]) {
            updated.inWindowTargetId = null;
          }
          if (updated.outOfWindowTargetId && !next.nodes[updated.outOfWindowTargetId]) {
            updated.outOfWindowTargetId = null;
          }
          node.action = { ...node.action, data: updated };
        }
      }
    }
    setFlow(next);
    setSelectedId(parentId && next.nodes[parentId] ? parentId : next.rootId);
    setPositions((prev) => {
      const updated = { ...prev };
      let changed = false;
      for (const key of Object.keys(prev)) {
        if (!next.nodes[key]) {
          delete updated[key];
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }

  function duplicateNode(id:string){
    const parentId = Object.values(flow.nodes).find(n=>n.children.includes(id))?.id;
    if (!parentId) return;
    const basis = flow.nodes[id];
    const nid = nextChildId(flow, parentId);
    const clone: FlowNode = JSON.parse(JSON.stringify({ ...basis, id:nid }));
    clone.children = [];
    if (clone.menuOptions) {
      clone.menuOptions = clone.menuOptions.map((option, idx) => createMenuOption(idx, { ...option, targetId: null }));
    }
    if (clone.action?.kind === "buttons") {
      const data = normalizeButtonsData(clone.action.data as Partial<ButtonsActionData> | undefined);
      data.items = data.items.map((item, idx) => createButtonOption(idx, { ...item, targetId: null }));
      data.moreTargetId = null;
      clone.action = { ...clone.action, data };
    }
    if (clone.action?.kind === "ask") {
      const ask = getAskData(clone);
      const normalized: AskActionData = ask
        ? { ...ask, answerTargetId: null, invalidTargetId: null }
        : {
            questionText: "¿Cuál es tu respuesta?",
            varName: "respuesta",
            varType: "text",
            validation: { type: "none" },
            retryMessage: "Lo siento, ¿puedes intentarlo de nuevo?",
            answerTargetId: null,
            invalidTargetId: null,
          };
      clone.action = {
        ...clone.action,
        data: normalized,
      };
    }
    if (clone.action?.kind === "scheduler") {
      const scheduler = getSchedulerData(clone);
      const normalized: SchedulerNodeData = scheduler
        ? { ...scheduler, inWindowTargetId: null, outOfWindowTargetId: null }
        : normalizeSchedulerData(undefined);
      clone.action = {
        ...clone.action,
        data: normalized,
      };
    }
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      next.nodes[nid] = clone;
      const parentNode = next.nodes[parentId];
      if (!parentNode) return next;
      parentNode.children = Array.from(new Set([...(parentNode.children ?? []), nid]));
      if (parentNode.type === "menu") {
        const options = getMenuOptions(parentNode);
        let optionIndex = options.findIndex((opt) => !opt.targetId);
        if (optionIndex === -1) {
          optionIndex = options.length;
          options.push(createMenuOption(optionIndex));
        }
        options[optionIndex] = { ...options[optionIndex], targetId: nid };
        parentNode.menuOptions = options;
      } else if (parentNode.action?.kind === "buttons") {
        const data = normalizeButtonsData(parentNode.action.data as Partial<ButtonsActionData> | undefined);
        let assigned = false;
        for (const item of data.items) {
          if (!item.targetId) {
            item.targetId = nid;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          if (data.items.length < data.maxButtons) {
            const newIndex = data.items.length;
            data.items.push(createButtonOption(newIndex, { targetId: nid }));
            assigned = true;
          } else if (!data.moreTargetId) {
            data.moreTargetId = nid;
            assigned = true;
          }
        }
        parentNode.action = { ...parentNode.action, data };
      } else if (parentNode.action?.kind === "ask") {
        const ask = getAskData(parentNode);
        if (ask) {
          const updated: AskActionData = { ...ask };
          if (!updated.answerTargetId) {
            updated.answerTargetId = nid;
          } else if (!updated.invalidTargetId) {
            updated.invalidTargetId = nid;
          }
          parentNode.action = { ...parentNode.action, data: updated };
        }
      }
      return next;
    });
    setSelectedId(nid);
  }

  const handleConnectHandle = useCallback(
    (sourceId: string, handleId: string, targetId: string | null) => {
      if (targetId && targetId === flowRef.current.rootId) {
        showToast('El nodo inicial no acepta conexiones entrantes', 'error');
        return false;
      }
      let updated = false;
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        if (targetId && !next.nodes[targetId]) {
          return prev;
        }
        if (!applyHandleAssignment(next, sourceId, handleId, targetId ?? null)) {
          return prev;
        }
        updated = true;
        return next;
      });
      return updated;
    },
    [setFlow, showToast]
  );

  const handleCreateForHandle = useCallback(
    (sourceId: string, handleId: string, kind: ConnectionCreationKind) => {
      let createdId: string | null = null;
      setFlow((prev) => {
        const next: Flow = JSON.parse(JSON.stringify(prev));
        const source = next.nodes[sourceId];
        if (!source) return prev;
        const nid = nextChildId(next, sourceId);

        const labelMap: Partial<Record<ConnectionCreationKind, string>> = {
          menu: "Nuevo submenú",
          message: "Mensaje",
          buttons: "Botones",
          question: "Pregunta al cliente",
          condition: "Condición",
          validation: "Validación",
          validation_bitrix: "Validación Bitrix",
          attachment: "Adjunto",
          webhook_out: "Webhook OUT",
          webhook_in: "Webhook IN",
          bitrix_crm: "CRM Bitrix",
          bitrix_create: "CRM Bitrix (legacy)",
          transfer: "Transferencia",
          handoff: "Handoff (Humano)",
          scheduler: "Scheduler",
          delay: "Delay (Espera)",
          ia_rag: "IA · RAG",
          ia_agent: "Agente IA",
          tool: "Tool/Acción externa",
          end: "Fin del flujo",
        };

        let newNode: FlowNode;
        if (kind === "menu") {
          newNode = { id: nid, label: labelMap.menu ?? "Submenú", type: "menu", children: [], menuOptions: [] } as FlowNode;
        } else {
          const actionKindMap: Partial<Record<ConnectionCreationKind, ActionKind>> = {
            message: "message",
            buttons: "buttons",
            question: "ask",
            condition: "condition",
            validation: "validation",
            validation_bitrix: "validation_bitrix",
            attachment: "attachment",
            webhook_out: "webhook_out",
            webhook_in: "webhook_in",
            bitrix_crm: "bitrix_crm",
            bitrix_create: "bitrix_create",
            transfer: "transfer",
            handoff: "handoff",
            scheduler: "scheduler",
            delay: "delay",
            ia_rag: "ia_rag",
            ia_agent: "ia_agent",
            tool: "tool",
            end: "end",
          };

          const dataDefaults: Partial<Record<ConnectionCreationKind, any>> = {
            message: { text: "Mensaje" },
            buttons: normalizeButtonsData({
              items: [
                createButtonOption(0, { label: "Opción 1", value: "OP_1" }),
                createButtonOption(1, { label: "Opción 2", value: "OP_2" }),
              ],
              maxButtons: DEFAULT_BUTTON_LIMIT,
            }),
            question: {
              questionText: "¿Cuál es tu respuesta?",
              varName: "respuesta",
              varType: "text",
              validation: { type: "none" },
              retryMessage: "Lo siento, ¿puedes intentarlo de nuevo?",
              answerTargetId: null,
              invalidTargetId: null,
            },
            condition: {
              rules: [
                {
                  id: createId("rule"),
                  source: "user_message",
                  operator: "contains",
                  compareValue: "",
                  keywords: ["keyword"],
                  keywordMode: "contains",
                  caseSensitive: false,
                  targetId: null,
                },
              ],
              matchMode: "any",
              defaultTargetId: null,
              matchTargetId: null,
              noMatchTargetId: null,
              errorTargetId: null,
            },
            validation: {
              validationType: "keywords",
              keywordGroups: [
                {
                  id: createId("kw"),
                  label: "Grupo 1",
                  mode: "contains",
                  keywords: ["keyword"],
                },
              ],
              keywordGroupLogic: "or",
              validTargetId: null,
              invalidTargetId: null,
              groupTargetIds: {},
              noMatchTargetId: null,
            },
            validation_bitrix: {
              validationType: "exists",
              entityType: "lead",
              identifierField: "PHONE",
              fieldChecks: [],
              matchMode: "any",
              matchTargetId: null,
              noMatchTargetId: null,
              errorTargetId: null,
            },
            attachment: { attType: "image", url: "", name: "archivo", fileName: "", mimeType: "", fileSize: 0, fileData: "" },
            webhook_out: {
              method: "POST",
              url: "https://api.ejemplo.com/webhook",
              headers: [{ k: "Content-Type", v: "application/json" }],
              body: '{\n  "user_id": "{{user.id}}",\n  "input": "{{last_message}}"\n}',
            },
            webhook_in: { path: "/hooks/inbound", secret: "", sample: "{ id: 123, text: 'hola' }" },
            bitrix_crm: {
              operation: "create",
              entityType: "lead",
              fields: [],
              successTargetId: null,
              errorTargetId: null,
              foundTargetId: null,
              notFoundTargetId: null,
            },
            bitrix_create: {
              operation: "create",
              entityType: "lead",
              fields: [],
              successTargetId: null,
              errorTargetId: null,
              foundTargetId: null,
              notFoundTargetId: null,
            },
            transfer: { target: "queue", destination: "" },
            handoff: { queue: "agentes", note: "Pasar a un agente humano" },
            scheduler: normalizeSchedulerData(undefined),
            delay: { delaySeconds: 5, note: "Espera de 5 segundos" },
            ia_rag: {
              provider: "openai",
              model: "gpt-4o",
              prompt: "Responde la pregunta del usuario basándote en el contexto",
              knowledgeBase: "default",
              temperature: 0.7
            },
            ia_agent: {
              agentId: null,
              tools: [],
              messageGrouping: false,
              fallbackTargetId: null,
            },
            tool: {
              toolName: "custom_action",
              endpoint: "https://api.ejemplo.com/action",
              method: "POST",
              params: {}
            },
            end: { note: "Fin del flujo" },
          };

          const actionKind = actionKindMap[kind] ?? "message";
          const actionData = dataDefaults[kind] ?? { text: "Mensaje" };
          const label = labelMap[kind] ?? `Acción · ${kind}`;

          newNode = {
            id: nid,
            label,
            type: "action",
            children: [],
            action: { kind: actionKind, data: actionData },
          } as FlowNode;
        }

        next.nodes[nid] = newNode;
        if (!applyHandleAssignment(next, sourceId, handleId, nid)) {
          delete next.nodes[nid];
          return prev;
        }
        createdId = nid;
        return next;
      });
      if (createdId) {
        const parentPos = positionsRef.current[sourceId] ?? computeLayout(flowRef.current)[sourceId] ?? { x: 0, y: 0 };
        setPositions((prev) => ({
          ...prev,
          [createdId as string]: { x: parentPos.x + NODE_W + 40, y: parentPos.y + NODE_H + 40 },
        }));
        setSelectedId(createdId);
      }
      return createdId;
    },
    [setFlow, setPositions, setSelectedId],
  );

  function insertBetween(parentId:string, childId:string){
    const nid = nextChildId(flow, parentId);
    setFlow(prev=>{
      const next: Flow = JSON.parse(JSON.stringify(prev));
      next.nodes[nid] = { id:nid, label:"Nueva acción", type:"action", children:[], action:{ kind:"message", data:{text:"Mensaje"} } };
      const arr = next.nodes[parentId].children;
      const idx = arr.indexOf(childId);
      if (idx>=0){
        arr.splice(idx,1,nid);
        next.nodes[nid].children.push(childId);
        const parentNode = next.nodes[parentId];
        if (parentNode.type === "menu" && parentNode.menuOptions) {
          parentNode.menuOptions = parentNode.menuOptions.map((option, optionIdx) =>
            createMenuOption(optionIdx, {
              ...option,
              targetId: option.targetId === childId ? nid : option.targetId,
            })
          );
        } else if (parentNode.action?.kind === "buttons") {
          const data = normalizeButtonsData(parentNode.action.data as Partial<ButtonsActionData> | undefined);
          data.items = data.items.map((item, itemIdx) =>
            createButtonOption(itemIdx, {
              ...item,
              targetId: item.targetId === childId ? nid : item.targetId,
            })
          );
          if (data.moreTargetId === childId) {
            data.moreTargetId = nid;
          }
          parentNode.action = { ...parentNode.action, data };
      } else if (parentNode.action?.kind === "ask") {
        const ask = getAskData(parentNode);
        if (ask) {
          const updated: AskActionData = { ...ask };
          if (updated.answerTargetId === childId) {
            updated.answerTargetId = nid;
          } else if (updated.invalidTargetId === childId) {
            updated.invalidTargetId = nid;
          }
          parentNode.action = { ...parentNode.action, data: updated };
        }
      }
      }
      return next;
    });
  }

  function deleteEdge(parentId:string, childId:string){
    setFlow((prev) => {
      const next: Flow = JSON.parse(JSON.stringify(prev));
      const parentNode = next.nodes[parentId];
      if (!parentNode) return next;
      parentNode.children = parentNode.children.filter((c) => c !== childId);
      if (parentNode.type === "menu" && parentNode.menuOptions) {
        parentNode.menuOptions = parentNode.menuOptions.map((option, idx) =>
          createMenuOption(idx, {
            ...option,
            targetId: option.targetId === childId ? null : option.targetId,
          })
        );
      } else if (parentNode.action?.kind === "buttons") {
        const data = normalizeButtonsData(parentNode.action.data as Partial<ButtonsActionData> | undefined);
        data.items = data.items.map((item, idx) =>
          createButtonOption(idx, {
            ...item,
            targetId: item.targetId === childId ? null : item.targetId,
          })
        );
        if (data.moreTargetId === childId) {
          data.moreTargetId = null;
        }
        parentNode.action = { ...parentNode.action, data };
      } else if (parentNode.action?.kind === "ask") {
        const ask = getAskData(parentNode);
        if (ask) {
          const updated: AskActionData = { ...ask };
          if (updated.answerTargetId === childId) {
            updated.answerTargetId = null;
          }
          if (updated.invalidTargetId === childId) {
            updated.invalidTargetId = null;
          }
          parentNode.action = { ...parentNode.action, data: updated };
        }
      } else if (parentNode.action?.kind === "scheduler") {
        const scheduler = getSchedulerData(parentNode);
        if (scheduler) {
          const updated: SchedulerNodeData = { ...scheduler };
          if (updated.inWindowTargetId === childId) {
            updated.inWindowTargetId = null;
          }
          if (updated.outOfWindowTargetId === childId) {
            updated.outOfWindowTargetId = null;
          }
          parentNode.action = { ...parentNode.action, data: updated };
        }
      }
      return next;
    });
  }

  function updateSelected(patch: Partial<FlowNode>){
    setFlow(prev=>({
      ...prev,
      nodes:{ ...prev.nodes, [selectedId]: { ...prev.nodes[selectedId], ...patch } }
    }));
  }

  const handleTestWebhook = useCallback(async () => {
    const selected = flow.nodes[selectedId];
    if (!selected || selected.action?.kind !== 'webhook_out') return;

    const data = selected.action.data;
    if (!data?.url) {
      showToast('Configure la URL del webhook primero', 'error');
      return;
    }

    const config = {
      method: (data.method || 'POST') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: data.url,
      headers: data.headers || [],
      body: data.body,
    };

    setWebhookTesting(true);
    setWebhookTestResult(null);

    try {
      const result = await testWebhookOut(config);
      setWebhookTestResult(result);
      if (result.success) {
        showToast(`Webhook exitoso (${result.duration}ms)`, 'success');
      } else {
        showToast(result.error || 'Error en webhook', 'error');
      }
    } catch (error: any) {
      showToast(error.message || 'Error ejecutando webhook', 'error');
    } finally {
      setWebhookTesting(false);
    }
  }, [flow, selectedId, showToast]);

  const handleCopyWebhookInUrl = useCallback(() => {
    const selected = flow.nodes[selectedId];
    if (!selected || selected.action?.kind !== 'webhook_in') return;

    const secret = selected.action.data?.secret;
    const url = generateWebhookInUrl(flow.id, selectedId, secret);

    navigator.clipboard.writeText(url).then(() => {
      showToast('URL copiada al portapapeles', 'success');
    }).catch(() => {
      showToast('Error copiando URL', 'error');
    });
  }, [flow, selectedId, showToast]);

  function seedDemo(){
    setFlow(prev=>{
      const root = prev.nodes[prev.rootId];
      if (!root || root.children.length>0) return prev;
      const next: Flow = JSON.parse(JSON.stringify(prev));
      const a = nextChildId(next, next.rootId);
      next.nodes[a] = { id:a, label:"Submenú demo", type:"menu", children:[] } as FlowNode;
      next.nodes[next.rootId].children.push(a);
      const b = nextChildId(next, next.rootId);
      next.nodes[b] = { id:b, label:"Acción demo", type:"action", children:[], action:{ kind:"message", data:{ text:"Hola 👋" } } } as FlowNode;
      next.nodes[next.rootId].children.push(b);
      setTimeout(()=>setSelectedId(a),0);
      return next;
    });
  }

  // Handle successful login - show splash then authenticate
  const handleLoginSuccess = () => {
    setShowWelcomeSplash(true);
    // Check auth after showing splash
    setTimeout(() => {
      checkAuth();
    }, 100);
  };

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="mt-4 text-sm text-slate-600">Cargando...</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Show welcome splash after login
  if (showWelcomeSplash) {
    return (
      <WelcomeSplash
        userName={user?.name || user?.username || "Usuario"}
        onComplete={() => setShowWelcomeSplash(false)}
      />
    );
  }

  // Show logout animation
  if (isLoggingOut) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center z-50 overflow-hidden">
        {/* Animated Bubbles Background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="bubble bubble-1"></div>
          <div className="bubble bubble-2"></div>
          <div className="bubble bubble-3"></div>
          <div className="bubble bubble-4"></div>
          <div className="bubble bubble-5"></div>
          <div className="bubble bubble-6"></div>
        </div>

        <div className="relative z-10 text-center">
          <div className="glass-card rounded-3xl px-16 py-12 shadow-2xl border border-white/20 backdrop-blur-xl bg-white/10 animate-fade-in">
            <div className="mb-8 animate-wave">
              <div className="inline-block text-9xl">👋</div>
            </div>

            <h2 className="text-5xl font-bold text-white mb-4 animate-slide-up">
              ¡Hasta pronto!
            </h2>
            <p className="text-2xl text-white/90 animate-slide-up animation-delay-200">
              {user?.name || user?.username || "Usuario"}
            </p>
          </div>
        </div>

        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); }
            25% { transform: translateY(-80px) translateX(60px) rotate(90deg) scale(1.2); }
            50% { transform: translateY(-40px) translateX(-60px) rotate(180deg) scale(0.8); }
            75% { transform: translateY(-100px) translateX(40px) rotate(270deg) scale(1.1); }
          }

          @keyframes fade-in {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
          }

          @keyframes wave {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(20deg); }
            75% { transform: rotate(-20deg); }
          }

          @keyframes slide-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .bubble {
            position: absolute;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(214, 84, 54, 0.7), rgba(249, 211, 73, 0.7));
            filter: blur(20px);
            animation: float 15s ease-in-out infinite;
            opacity: 0.8;
          }

          .bubble-1 {
            width: 300px;
            height: 300px;
            top: 10%;
            left: 10%;
            animation-delay: 0s;
            animation-duration: 12s;
          }

          .bubble-2 {
            width: 220px;
            height: 220px;
            top: 60%;
            right: 15%;
            animation-delay: 2s;
            animation-duration: 10s;
            background: linear-gradient(135deg, rgba(249, 211, 73, 0.7), rgba(214, 84, 54, 0.6));
          }

          .bubble-3 {
            width: 260px;
            height: 260px;
            bottom: 15%;
            left: 15%;
            animation-delay: 4s;
            animation-duration: 14s;
          }

          .bubble-4 {
            width: 200px;
            height: 200px;
            top: 25%;
            right: 20%;
            animation-delay: 6s;
            animation-duration: 9s;
            background: linear-gradient(135deg, rgba(255, 165, 0, 0.7), rgba(255, 215, 0, 0.7));
          }

          .bubble-5 {
            width: 240px;
            height: 240px;
            bottom: 20%;
            right: 10%;
            animation-delay: 8s;
            animation-duration: 13s;
          }

          .bubble-6 {
            width: 180px;
            height: 180px;
            top: 45%;
            left: 8%;
            animation-delay: 10s;
            animation-duration: 11s;
            background: linear-gradient(135deg, rgba(214, 84, 54, 0.7), rgba(249, 211, 73, 0.6));
          }

          .glass-card {
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          }

          .animate-fade-in {
            animation: fade-in 0.6s ease-out;
          }

          .animate-wave {
            animation: wave 2s ease-in-out infinite;
          }

          .animate-slide-up {
            animation: slide-up 0.6s ease-out;
          }

          .animation-delay-200 {
            animation-delay: 0.2s;
            opacity: 0;
            animation-fill-mode: forwards;
          }
        `}</style>
      </div>
    );
  }

  // Main application (only shown when authenticated and splash completed)
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background transition-colors duration-300">
      {toast && (
        <div className="fixed bottom-6 right-6 z-40 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl text-sm font-medium ${toast.type === "success" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>
            {toast.type === "success" && (
              <svg className="w-5 h-5 animate-in zoom-in duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
      {/* Compact Modern Header */}
      <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-b-2 border-slate-200 dark:border-slate-700 px-3 py-1 flex-shrink-0 transition-colors duration-300 shadow-md">
        <div className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap ml-2">
            {/* Animated Logo Carousel */}
            <div style={{
              position: 'relative',
              display: 'inline-block',
              height: '38px',
              width: '150px',
              overflow: 'hidden'
            }}>
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes logoFade {
                  0%, 45% { opacity: 1; transform: scale(1); }
                  50%, 95% { opacity: 0; transform: scale(0.95); }
                  100% { opacity: 1; transform: scale(1); }
                }
                .logo-azaleia {
                  animation: logoFade 8s ease-in-out infinite;
                }
                .logo-olympikus {
                  animation: logoFade 8s ease-in-out infinite;
                  animation-delay: 4s;
                }
              `}} />

              {/* Logo Azaleia */}
              <div className="logo-azaleia" style={{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <img
                  src="/logos/azaleia-logo.svg"
                  alt="Azaleia"
                  style={{
                    height: '32px',
                    width: 'auto',
                    filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15))'
                  }}
                />
              </div>

              {/* Logo Olympikus */}
              <div className="logo-olympikus" style={{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0
              }}>
                <img
                  src="/logos/olympikus-logo.png"
                  alt="Olympikus"
                  style={{
                    height: '32px',
                    width: 'auto',
                    filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15))'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Tabs Pills - Centrados */}
          <div className="flex gap-1.5 flex-1 justify-center flex-wrap">
            {/* Canvas tab - Oculto para GERENCIA */}
            {hasPermission('canvas.view') && userRoleName !== 'gerencia' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'canvas'
                    ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white border border-slate-300 dark:border-slate-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:border dark:border-slate-700'
                }`}
                onClick={() => setMainTab('canvas')}
                type="button"
              >
                📄 Canvas
              </button>
            )}
            {/* Chat - Visible para GERENCIA */}
            {hasPermission('crm.view') && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'crm'
                    ? 'bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700'
                    : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-950 dark:text-green-400 dark:hover:bg-green-900 dark:border dark:border-green-800'
                }`}
                onClick={() => setMainTab('crm')}
                type="button"
              >
                💬 Chat
              </button>
            )}
            {/* Campañas - Oculto para GERENCIA */}
            {hasPermission('campaigns.view') && userRoleName !== 'gerencia' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'campaigns'
                    ? 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700'
                    : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900 dark:border dark:border-red-800'
                }`}
                onClick={() => setMainTab('campaigns')}
                type="button"
              >
                📢 Campañas
              </button>
            )}
            {/* Plantillas - Oculto para GERENCIA */}
            {hasPermission('templates.view') && userRoleName !== 'gerencia' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'templates'
                    ? 'bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700'
                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:hover:bg-purple-900 dark:border dark:border-purple-800'
                }`}
                onClick={() => setMainTab('templates')}
                type="button"
              >
                📝 Plantillas
              </button>
            )}
            {/* Agenda - Oculto para GERENCIA */}
            {hasPermission('agenda.view') && userRoleName !== 'gerencia' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'agenda'
                    ? 'bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700'
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900 dark:border dark:border-blue-800'
                }`}
                onClick={() => setMainTab('agenda')}
                type="button"
              >
                📅 Agenda
              </button>
            )}
            {/* Asesores - Visible para GERENCIA */}
            {hasPermission('advisors.view') && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'advisors'
                    ? 'bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700'
                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:hover:bg-purple-900 dark:border dark:border-purple-800'
                }`}
                onClick={() => setMainTab('advisors')}
                type="button"
              >
                👥 Asesores
              </button>
            )}
            {/* Métricas - Visible para GERENCIA */}
            {hasPermission('metrics.view') && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'metrics'
                    ? 'bg-pink-200 text-pink-800 dark:bg-pink-900 dark:text-pink-200 border border-pink-300 dark:border-pink-700'
                    : 'bg-pink-100 text-pink-700 hover:bg-pink-200 dark:bg-pink-950 dark:text-pink-400 dark:hover:bg-pink-900 dark:border dark:border-pink-800'
                }`}
                onClick={() => setMainTab('metrics')}
                type="button"
              >
                📊 Métricas
              </button>
            )}
            {/* Config - Oculto para GERENCIA */}
            {hasPermission('config.view') && userRoleName !== 'gerencia' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'config'
                    ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white border border-slate-300 dark:border-slate-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:border dark:border-slate-700'
                }`}
                onClick={() => setMainTab('config')}
                type="button"
              >
                ⚙️ Config
              </button>
            )}
            {/* AI Reports - SOLO ADMIN */}
            {user && user.role === 'admin' && (
              <button
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  mainTab === 'ai-reports'
                    ? 'bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700'
                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:hover:bg-purple-900 dark:border dark:border-purple-800'
                }`}
                onClick={() => setMainTab('ai-reports')}
                type="button"
              >
                🤖 Informes IA
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap justify-end">
          {/* Reportes Button (Asesores/Supervisores only - NOT admins) */}
          {user && user.role !== 'admin' && (
            <div className="relative">
              <button
                onClick={() => setShowReportMenu(!showReportMenu)}
                className="p-2 rounded-md text-blue-600 hover:bg-blue-50 transition-colors"
                type="button"
                title="Reportes"
              >
                <Bug size={18} />
              </button>

              {/* Dropdown Menu */}
              {showReportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                  <button
                    onClick={() => {
                      setShowTicketForm(true);
                      setShowReportMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
                  >
                    <Bug size={16} className="text-blue-600" />
                    <span className="text-gray-700">Reportar Problema</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowMyTickets(true);
                      setShowReportMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
                  >
                    <ListChecks size={16} className="text-green-600" />
                    <span className="text-gray-700">Mis Reportes</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Admin Reportes Panel Button */}
          {user?.role === 'admin' && (
            <button
              onClick={() => setShowTicketsPanel(true)}
              className="px-3 py-1 rounded-md text-xs font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
              type="button"
            >
              🎫 REPORTES
            </button>
          )}

          {/* Advisor Status Button for ADMIN - left of Editar */}
          {user?.id && mainTab === 'crm' && user?.role === 'admin' && (
            <AdvisorStatusButton userId={user.id} compact={true} />
          )}

          {/* Menú de Edición compacto - Canvas tab */}
          {mainTab === 'canvas' && hasPermission('canvas.undo_redo') && (
          <div className="relative group">
            <button
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Editar</span>
              <svg className="w-3 h-3 transition-transform group-hover:rotate-180 duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="absolute right-0 mt-2 w-56 glass rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-[9999] dropdown-curtain">
              <div className="py-2">
                <button
                  onClick={undoRedoActions.undo}
                  disabled={!undoRedoActions.canUndo}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-indigo-50 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  <span>Deshacer</span>
                  <span className="ml-auto text-xs text-slate-400">⌘Z</span>
                </button>
                <button
                  onClick={undoRedoActions.redo}
                  disabled={!undoRedoActions.canRedo}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-indigo-50 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                  </svg>
                  <span>Rehacer</span>
                  <span className="ml-auto text-xs text-slate-400">⌘Y</span>
                </button>
                <div className="border-t border-slate-200 my-1"></div>
                <button
                  onClick={() => setShowFlowsGallery(true)}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-indigo-50 flex items-center gap-3 transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>Ver Flujos</span>
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Menú de Archivo compacto - Canvas tab */}
          {mainTab === 'canvas' && (hasPermission('canvas.export') || hasPermission('canvas.import')) && (
          <div className="relative group">
            <button
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-cyan-100 text-cyan-700 hover:bg-cyan-200 transition-colors"
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>Archivo</span>
              <svg className="w-3 h-3 transition-transform group-hover:rotate-180 duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="absolute right-0 mt-2 w-56 glass rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-[9999] dropdown-curtain">
              <div className="py-2">
                <button
                  onClick={handleExportPNG}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-3 transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Exportar PNG</span>
                </button>
                <button
                  onClick={handleImportClick}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-3 transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3v-6" />
                  </svg>
                  <span>Importar JSON</span>
                </button>
                <button
                  onClick={handleExport}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-3 transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>Exportar JSON</span>
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Botón Acciones compacto - Canvas tab */}
          {mainTab === 'canvas' && hasPermission('canvas.save') && (
          <div className="relative group">
            <button
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Acciones</span>
              <svg className="w-3 h-3 transition-transform group-hover:rotate-180 duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="absolute right-0 mt-2 w-56 glass rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-[9999] dropdown-curtain">
              <div className="py-2">
                <button
                  onClick={handleSaveClick}
                  disabled={hasBlockingErrors}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  type="button"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Advisor Status Button for NO-ADMIN - left of Salir */}
          {user?.id && mainTab === 'crm' && user?.role !== 'admin' && (
            <AdvisorStatusButton userId={user.id} compact={true} />
          )}

          {/* Theme Toggle - Dark Mode */}
          <ThemeToggle />

          {/* Botón Perfil de Usuario - TODOS */}
          <button
            onClick={() => setShowUserProfile(true)}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            type="button"
            title="Mi Perfil"
          >
            <User className="w-4 h-4" />
            <span>Perfil</span>
          </button>

          {/* Botón Salir compacto - TODOS */}
          <button
            onClick={async () => {
              try {
                setIsLoggingOut(true);
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                setTimeout(() => {
                  window.location.href = '/';
                }, 2000);
              } catch (err) {
                console.error('Logout error:', err);
                setIsLoggingOut(false);
              }
            }}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
            type="button"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
            <span>Salir</span>
          </button>
        </div>
        </div>
        {hasBlockingErrors && (
          <div className="text-xs text-rose-600 flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200">
            <span aria-hidden="true">⚠️</span>
            <span className="font-medium">Completa los mensajes vacíos antes de guardar.</span>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />

      {/* Content area - all tabs */}
      <div className="flex-1 overflow-hidden px-2 md:px-4 py-2">
      {mainTab === 'canvas' && hasPermission('canvas.view') && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start h-full">
        <div className="order-2 lg:order-1 lg:col-span-9 lg:col-start-1 flex flex-col h-full relative">
          <div className="app-card flex-1 flex flex-col overflow-hidden">
              <div className="app-card-header flex items-center gap-3">
                <span>Canvas de flujo</span>
                <BotChannelAssignment
                  flowId={flow.id}
                  flowName={flow.name}
                  assignments={flow.channelAssignments || []}
                  availableNumbers={whatsappNumbers}
                  allFlows={allFlows}
                  onUpdate={updateFlowChannelAssignments}
                />
              </div>
            <div className="flex-1 overflow-hidden">
              <ReactFlowCanvas
                flow={flow}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddChild={addChildTo}
                onDeleteNode={deleteNode}
                onDuplicateNode={duplicateNode}
                onInsertBetween={insertBetween}
                onDeleteEdge={deleteEdge}
                onConnectHandle={handleConnectHandle}
                onCreateForHandle={handleCreateForHandle}
                  onAttachToMessage={handleMessageAttachments}
                  onInvalidConnection={(message) => showToast(message, "error")}
                  soloRoot={soloRoot}
                  toggleScope={() => setSoloRoot((s) => !s)}
                  nodePositions={positionsState}
                  onPositionsChange={setPositions}
                  invalidMessageIds={emptyMessageNodes}
                />
              </div>
            </div>
          </div>

        <div className="order-1 lg:order-2 lg:col-span-3 lg:col-start-10 lg:self-start">
          <div className="flex flex-col gap-4 min-w-0">
            <div className="app-card flex flex-col max-h-screen">
              <div className="app-card-header">Inspector</div>
              <div className="app-card-content space-y-3 text-sm overflow-y-auto flex-1">
                <div className="text-xs text-slate-500">ID: {selected.id}</div>
                <label className="block text-xs mb-1">Etiqueta</label>
                <input className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300" value={selected.label} onChange={(e)=>updateSelected({ label:e.target.value })} />

                <label className="block text-xs mb-1">Tipo</label>
                {selected.id === flow.rootId ? (
                  <div className="w-full rounded px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200">
                    Inicio de flujo
                  </div>
                ) : (
                  <select
                    className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    value={selected.type}
                    onChange={(e) => updateSelected({ type: e.target.value as any })}
                  >
                    <option value="menu">Menú</option>
                    <option value="action">Acción</option>
                  </select>
                )}

                {/* Delay/Timer configuration */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selected.delay && selected.delay > 0)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateSelected({ delay: 5 }); // Default 5 seconds
                          } else {
                            updateSelected({ delay: 0 });
                          }
                        }}
                        className="rounded"
                      />
                      <span className="font-medium">⏱️ Retraso antes del siguiente paso</span>
                    </label>
                  </div>
                  {selected.delay && selected.delay > 0 && (
                    <div className="space-y-2 pl-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={selected.delay || 5}
                          onChange={(e) => updateSelected({ delay: Math.max(1, parseInt(e.target.value) || 5) })}
                          className="w-20 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                        <span className="text-xs text-slate-600">segundos</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        El bot esperará {selected.delay} segundo{selected.delay !== 1 ? 's' : ''} antes de ejecutar el siguiente nodo.
                      </p>
                    </div>
                  )}
                </div>

                {selected.type === "menu" && (
                  <div className="mt-2 space-y-2">
                    <div className="space-y-2">
                      <label className="block text-xs font-medium">Tipo de menú</label>
                      <select
                        className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        value={selected.menuType || "interactive"}
                        onChange={(e) => updateSelected({ menuType: e.target.value as "interactive" | "text" })}
                      >
                        <option value="interactive">Botones interactivos</option>
                        <option value="text">Texto plano (digitable)</option>
                      </select>
                      <p className="text-xs text-slate-500">
                        {selected.menuType === "text"
                          ? "El cliente verá un mensaje de texto con opciones numeradas y deberá digitar el número."
                          : "El cliente verá botones interactivos que puede presionar."}
                      </p>
                      {selected.menuType === "text" && menuOptionsForSelected.length > 0 && (
                        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <div className="text-[10px] font-semibold text-slate-600 mb-2">Vista previa del mensaje:</div>
                          <div className="text-xs text-slate-700 whitespace-pre-line font-mono">
                            {selected.description || selected.label || "Selecciona una opción"}{"\n\n"}
                            {menuOptionsForSelected.map((opt, idx) => (
                              `${idx + 1}. ${opt.label || `Opción ${idx + 1}`}\n`
                            )).join('')}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>Opciones del menú</span>
                      <button
                        className="px-2 py-1 border rounded bg-white hover:bg-emerald-50 border-emerald-200"
                        onClick={handleAddMenuOption}
                      >
                        + opción
                      </button>
                    </div>
                    <div className="space-y-2">
                      {menuOptionsForSelected.length === 0 && (
                        <div className="text-xs text-slate-500 border rounded p-2">Sin opciones configuradas.</div>
                      )}
                      {menuOptionsForSelected.map((option, index) => (
                        <div key={option.id} className="border rounded p-2 space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                            <span>
                              {index + 1}. {option.label || `Opción ${index + 1}`}
                            </span>
                            <div className="flex items-center gap-2">
                              {option.targetId ? (
                                <button
                                  className="px-2 py-0.5 border rounded bg-emerald-50 text-emerald-700"
                                  onClick={() => option.targetId && setSelectedId(option.targetId)}
                                >
                                  Ver destino
                                </button>
                              ) : (
                                <span className="text-slate-400">sin destino</span>
                              )}
                              <button
                                className="px-2 py-0.5 border rounded"
                                disabled={Boolean(option.targetId) || menuOptionsForSelected.length <= 1}
                                onClick={() => handleRemoveMenuOption(option.id)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[11px] text-slate-500">Etiqueta</label>
                            <input
                              className="w-full border rounded px-2 py-1 text-xs"
                              value={option.label}
                              onChange={(e) => handleMenuOptionUpdate(option.id, { label: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[11px] text-slate-500">Valor</label>
                            <input
                              className="w-full border rounded px-2 py-1 text-xs"
                              value={option.value ?? ""}
                              onChange={(e) => handleMenuOptionUpdate(option.id, { value: e.target.value })}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.type==="action" && (
                  <div className="mt-2 space-y-3">
                    <label className="block text-xs mb-1">Tipo de acción</label>
                    <select
                      className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      value={selected.action?.kind ?? "message"}
                      onChange={(e) => {
                        const nextKind = e.target.value as ActionKind;
                        if (nextKind === 'ask') {
                          updateSelectedAction('ask', {
                            questionText: '¿Cuál es tu respuesta?',
                            varName: 'respuesta',
                            varType: 'text',
                            validation: { type: 'none' },
                            retryMessage: 'Lo siento, ¿puedes intentarlo de nuevo?',
                            answerTargetId: null,
                            invalidTargetId: null,
                          });
                        } else if (nextKind === 'validation') {
                          updateSelectedAction('validation', {
                            validationType: 'keywords',
                            keywordGroups: [],
                            validTargetId: null,
                            invalidTargetId: null,
                            noMatchTargetId: null,
                          });
                        } else if (nextKind === 'condition') {
                          updateSelectedAction('condition', {
                            rules: [],
                            matchMode: 'any',
                            defaultTargetId: null,
                            bitrixConfig: { entityType: 'lead', identifierField: 'PHONE', fieldsToCheck: ['NAME', 'LAST_NAME'] },
                            keywordGroups: [{ id: createId('kw'), label: 'Grupo 1', mode: 'contains', keywords: ['keyword'] }],
                            keywordGroupLogic: 'or',
                            matchTargetId: null,
                            noMatchTargetId: null,
                            errorTargetId: null,
                          });
                        } else if (nextKind === 'scheduler') {
                          updateSelectedAction('scheduler', normalizeSchedulerData(undefined));
                        } else if (nextKind === 'bitrix_crm') {
                          updateSelectedAction('bitrix_crm', {
                            operation: 'create',
                            entityType: 'lead',
                            fields: []
                          });
                        } else {
                          updateSelectedAction(nextKind, selected.action?.data ?? {});
                        }
                      }}
                    >
                      <option value="message">Mensaje</option>
                      <option value="buttons">Botones</option>
                      <option value="attachment">Adjunto</option>
                      <option value="webhook_out">Webhook OUT</option>
                      <option value="webhook_in">Webhook IN</option>
                      <option value="bitrix_crm">Bitrix CRM</option>
                      <option value="transfer">Transferencia</option>
                      <option value="handoff">Handoff (Humano)</option>
                      <option value="ia_rag">IA · RAG</option>
                      <option value="tool">Tool/Acción externa</option>
                      <option value="ask">Pregunta al cliente</option>
                      <option value="validation">Validación (Palabras clave)</option>
                      <option value="condition">Validación Bitrix</option>
                      <option value="scheduler">Scheduler</option>
                      <option value="end">Finalizar flujo</option>
                    </select>

                    {(selected.action?.kind ?? "message")==="message" && (
                      <div className="space-y-1">
                        <label className="block text-xs mb-1">Mensaje</label>
                        <textarea
                          className={`w-full border rounded px-3 py-2 text-sm leading-relaxed resize-y min-h-[140px] focus:outline-none focus:ring-2 ${
                            selectedHasMessageError
                              ? "border-rose-300 focus:ring-rose-300"
                              : "focus:ring-emerald-300"
                          }`}
                          aria-invalid={selectedHasMessageError}
                          value={selected.action?.data?.text ?? ""}
                          onChange={(e)=>updateSelected({ action:{ kind:"message", data:{ text:e.target.value } } })}
                          placeholder="Escribe el mensaje que recibirá el cliente..."
                        />
                        {selectedHasMessageError && (
                          <p className="text-[11px] text-rose-600">Este mensaje no puede estar vacío.</p>
                        )}
                      </div>
                    )}

                    {selected.action?.kind === "end" && (
                      <div className="space-y-2 text-xs border border-emerald-200 rounded-lg p-3 bg-emerald-50/60">
                        <div className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
                          <span>🏁 Este bloque termina el flujo</span>
                        </div>
                        <p className="text-[11px] text-emerald-700/80">
                          Cuando un cliente llegue a este punto, la conversación se marcará como finalizada y no se buscará un siguiente paso.
                        </p>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-700">Mensaje de despedida (opcional)</label>
                          <textarea
                            className="w-full border rounded px-2 py-1 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            value={selected.action?.data?.message ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"end", data:{ ...(selected.action?.data||{}), message:e.target.value } } })}
                            placeholder="Ej: Gracias por contactarnos. ¡Hasta pronto! 👋"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Nota interna (opcional)</label>
                          <textarea
                            className="w-full border rounded px-2 py-1 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            value={selected.action?.data?.note ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"end", data:{ ...(selected.action?.data||{}), note:e.target.value } } })}
                            placeholder="Anota detalles para tu equipo sobre el cierre del flujo..."
                          />
                        </div>
                      </div>
                    )}

                    {selected.action?.kind === "buttons" && buttonsDataForSelected && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span>Lista de botones</span>
                          <button
                            className="px-2 py-1 border rounded bg-white hover:bg-emerald-50 border-emerald-200"
                            onClick={handleAddButton}
                          >
                            + botón
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Máximo visible: {buttonsDataForSelected.maxButtons} · Se usa la política más restrictiva (WhatsApp/Facebook).
                        </div>
                        {buttonsDataForSelected.items.length > buttonsDataForSelected.maxButtons && (
                          <div className="border rounded p-2 text-[11px] bg-amber-50 text-amber-700 space-y-2">
                            <div className="font-semibold">
                              Superaste el límite de {buttonsDataForSelected.maxButtons} botones visibles.
                            </div>
                            <div>Convierte las opciones adicionales en una lista para cumplir con la política multi-canal.</div>
                            <button
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700"
                              onClick={handleConvertButtonsToList}
                            >
                              Convertir a lista automáticamente
                            </button>
                          </div>
                        )}
                        {buttonsDataForSelected.items.map((item, idx) => {
                          const isOverflow = idx >= buttonsDataForSelected.maxButtons;
                          return (
                            <div
                              key={item.id}
                              className={`border rounded p-2 space-y-2 ${isOverflow ? "bg-slate-50" : "bg-white"}`}
                            >
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                                <span>
                                  Botón {idx + 1}
                                  {isOverflow ? " · Lista" : ""}
                                </span>
                                <div className="flex items-center gap-2">
                                  {item.targetId ? (
                                    <button
                                      className="px-2 py-0.5 border rounded bg-emerald-50 text-emerald-700"
                                      onClick={() => item.targetId && setSelectedId(item.targetId)}
                                    >
                                      Ver destino
                                    </button>
                                  ) : (
                                    <span className="text-slate-400">sin destino</span>
                                  )}
                                  <button
                                    className="px-2 py-0.5 border rounded"
                                    disabled={Boolean(item.targetId)}
                                    onClick={() => handleRemoveButton(item.id)}
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="space-y-1">
                                  <label className="block text-[11px] text-slate-500">Etiqueta</label>
                                  <input
                                    className="w-full border rounded px-2 py-1"
                                    value={item.label}
                                    onChange={(e) => handleButtonUpdate(item.id, { label: e.target.value })}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-[11px] text-slate-500">Valor</label>
                                  <input
                                    className="w-full border rounded px-2 py-1"
                                    value={item.value}
                                    onChange={(e) => handleButtonUpdate(item.id, { value: e.target.value })}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {buttonsDataForSelected.items.length > buttonsDataForSelected.maxButtons && (
                          <div className="border rounded p-2 text-[11px] bg-violet-50 text-violet-700 space-y-1">
                            <div className="flex items-center justify-between font-semibold">
                              <span>Opción "Lista"</span>
                              {buttonsDataForSelected.moreTargetId ? (
                                <button
                                  className="px-2 py-0.5 border rounded bg-white"
                                  onClick={() => buttonsDataForSelected.moreTargetId && setSelectedId(buttonsDataForSelected.moreTargetId)}
                                >
                                  Ver destino
                                </button>
                              ) : (
                                <span className="text-violet-500">sin destino</span>
                              )}
                            </div>
                            <div>
                              Contiene: {buttonsDataForSelected.items.slice(buttonsDataForSelected.maxButtons).map((item) => item.label).join(", ") || "(vacío)"}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selected.action?.kind === "ask" && askDataForSelected && (
                      <div className="space-y-2 text-xs">
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Pregunta</label>
                          <textarea
                            className="w-full border rounded px-2 py-1 h-16"
                            value={askDataForSelected.questionText}
                            onChange={(e) => handleAskUpdate({ questionText: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="block text-[11px] text-slate-500">Variable</label>
                            <input
                              className="w-full border rounded px-2 py-1"
                              value={askDataForSelected.varName}
                              onChange={(e) => handleAskUpdate({ varName: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[11px] text-slate-500">Tipo</label>
                            <select
                              className="w-full border rounded px-2 py-1"
                              value={askDataForSelected.varType}
                              onChange={(e) => handleAskUpdate({ varType: e.target.value })}
                            >
                              <option value="text">Texto</option>
                              <option value="number">Número</option>
                              <option value="option">Opción</option>
                            </select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Validación</label>
                          <select
                            className="w-full border rounded px-2 py-1"
                            value={askDataForSelected.validation?.type ?? "none"}
                            onChange={(e) => {
                              const type = e.target.value as "none" | "regex" | "options";
                              if (type === "regex") {
                                handleAskUpdate({ validation: { type: "regex", pattern: "" } });
                              } else if (type === "options") {
                                handleAskUpdate({ validation: { type: "options", options: ["Sí", "No"] } });
                              } else {
                                handleAskUpdate({ validation: { type: "none" } });
                              }
                            }}
                          >
                            <option value="none">Sin validación</option>
                            <option value="regex">Expresión regular</option>
                            <option value="options">Lista de opciones</option>
                          </select>
                        </div>
                        {askDataForSelected.validation?.type === "regex" && (
                          <div className="space-y-1">
                            <label className="block text-[11px] text-slate-500">Patrón (RegExp)</label>
                            <input
                              className="w-full border rounded px-2 py-1"
                              value={askDataForSelected.validation.pattern}
                              onChange={(e) => handleAskUpdate({ validation: { type: "regex", pattern: e.target.value } })}
                            />
                          </div>
                        )}
                        {askDataForSelected.validation?.type === "options" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                              <span>Opciones esperadas</span>
                              <button
                                className="px-2 py-0.5 border rounded"
                                onClick={() => {
                                  handleAskUpdate({
                                    validation: { type: "options", options: [...askValidationOptions, "Nueva opción"] },
                                  });
                                }}
                              >
                                + opción
                              </button>
                            </div>
                            <div className="space-y-2">
                              {askValidationOptions.map((value: string, idx: number) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <input
                                    className="flex-1 border rounded px-2 py-1"
                                    value={value}
                                    onChange={(e) => {
                                      const nextOptions = [...askValidationOptions];
                                      nextOptions[idx] = e.target.value;
                                      handleAskUpdate({ validation: { type: "options", options: nextOptions } });
                                    }}
                                  />
                                  <button
                                    className="px-2 py-0.5 border rounded"
                                    disabled={askValidationOptions.length <= 1}
                                    onClick={() => {
                                      const nextOptions = askValidationOptions.filter(
                                        (_: string, optionIdx: number) => optionIdx !== idx
                                      );
                                      handleAskUpdate({ validation: { type: "options", options: nextOptions } });
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Mensaje de reintento</label>
                          <textarea
                            className="w-full border rounded px-2 py-1 h-14"
                            value={askDataForSelected.retryMessage}
                            onChange={(e) => handleAskUpdate({ retryMessage: e.target.value })}
                          />
                        </div>
                      </div>
                    )}

                    {selected.action?.kind === "condition" && validationDataForSelected && (
                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] text-slate-500 font-semibold">Entidad de Bitrix</label>
                            {bitrixFieldsLoading && <span className="text-[10px] text-slate-400">Cargando campos…</span>}
                          </div>
                          <select
                            className="w-full border rounded px-2 py-1"
                            value={validationDataForSelected.bitrixConfig?.entityType ?? 'lead'}
                            onChange={(e) =>
                              handleValidationUpdate((prev) => ({
                                ...prev,
                                bitrixConfig: {
                                  entityType: e.target.value as 'lead' | 'deal' | 'contact' | 'company',
                                  identifierField: prev.bitrixConfig?.identifierField ?? 'PHONE',
                                  fieldsToCheck: prev.bitrixConfig?.fieldsToCheck ?? ['NAME', 'LAST_NAME'],
                                },
                              }))
                            }
                          >
                            <option value="lead">Lead</option>
                            <option value="deal">Deal</option>
                            <option value="contact">Contacto</option>
                            <option value="company">Empresa</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 font-semibold">Campo identificador</label>
                          <input
                            className="w-full border rounded px-2 py-1"
                            value={validationDataForSelected.bitrixConfig?.identifierField ?? 'PHONE'}
                            onChange={(e) =>
                              handleValidationUpdate((prev) => ({
                                ...prev,
                                bitrixConfig: {
                                  entityType: prev.bitrixConfig?.entityType ?? 'lead',
                                  identifierField: e.target.value || 'PHONE',
                                  fieldsToCheck: prev.bitrixConfig?.fieldsToCheck ?? ['NAME', 'LAST_NAME'],
                                },
                              }))
                            }
                          />
                        </div>
                        {bitrixFieldsError && (
                          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                            {bitrixFieldsError}
                          </div>
                        )}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500 font-semibold">Campos a revisar</span>
                            <div className="flex items-center gap-2">
                              <select
                                className="border rounded px-2 py-1 text-[10px]"
                                defaultValue=""
                                onChange={(e) => {
                                  const field = e.target.value;
                                  if (!field) return;
                                  handleValidationUpdate((prev) => ({
                                    ...prev,
                                    bitrixConfig: {
                                      entityType: prev.bitrixConfig?.entityType ?? 'lead',
                                      identifierField: prev.bitrixConfig?.identifierField ?? 'PHONE',
                                      fieldsToCheck: Array.from(new Set([...(prev.bitrixConfig?.fieldsToCheck ?? []), field])),
                                    },
                                  }));
                                  e.target.value = '';
                                }}
                              >
                                <option value="">Agregar campo…</option>
                                {bitrixFieldOptions.map((field) => (
                                  <option key={field} value={field}>
                                    {field}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="px-2 py-0.5 text-[10px] border rounded"
                                onClick={() =>
                                  handleValidationUpdate((prev) => ({
                                    ...prev,
                                    bitrixConfig: {
                                      entityType: prev.bitrixConfig?.entityType ?? 'lead',
                                      identifierField: prev.bitrixConfig?.identifierField ?? 'PHONE',
                                      fieldsToCheck: Array.from(new Set([...(prev.bitrixConfig?.fieldsToCheck ?? []), 'EMAIL'])),
                                    },
                                  }))
                                }
                              >
                                + EMAIL
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(validationDataForSelected.bitrixConfig?.fieldsToCheck ?? []).map((field) => (
                              <span key={field} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[10px] text-slate-600 border border-slate-200">
                                {field}
                                <button
                                  className="text-[10px] text-rose-500"
                                  onClick={() =>
                                    handleValidationUpdate((prev) => ({
                                      ...prev,
                                      bitrixConfig: {
                                        entityType: prev.bitrixConfig?.entityType ?? 'lead',
                                        identifierField: prev.bitrixConfig?.identifierField ?? 'PHONE',
                                        fieldsToCheck: (prev.bitrixConfig?.fieldsToCheck ?? []).filter((item) => item !== field),
                                      },
                                    }))
                                  }
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          {validationDataForSelected.bitrixConfig?.fieldsToCheck?.length === 0 && (
                            <span className="text-[11px] text-slate-400">Sin campos seleccionados</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 font-semibold">Modo de coincidencia</label>
                          <select
                            className="w-full border rounded px-2 py-1"
                            value={validationDataForSelected.matchMode ?? 'any'}
                            onChange={(event) =>
                              handleValidationUpdate((prev) => ({
                                ...prev,
                                matchMode: event.target.value === 'all' ? 'all' : 'any',
                              }))
                            }
                          >
                            <option value="any">Coincide con cualquiera (OR)</option>
                            <option value="all">Debe cumplir todas (AND)</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-500 font-semibold">Evaluación de grupos de keywords</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              className={`px-2 py-1 text-xs rounded border ${
                                (validationDataForSelected.keywordGroupLogic ?? 'or') === 'or'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 text-slate-500'
                              }`}
                              onClick={() => handleKeywordLogicChange('or')}
                            >
                              Cualquiera (OR)
                            </button>
                            <button
                              type="button"
                              className={`px-2 py-1 text-xs rounded border ${
                                validationDataForSelected.keywordGroupLogic === 'and'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 text-slate-500'
                              }`}
                              onClick={() => handleKeywordLogicChange('and')}
                            >
                              Todas (AND)
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500 font-semibold">Grupos de palabras clave</span>
                            <button
                              type="button"
                              className="px-2 py-0.5 text-[10px] border rounded"
                              onClick={handleAddKeywordGroup}
                            >
                              + grupo
                            </button>
                          </div>
                          {(validationDataForSelected.keywordGroups ?? []).length === 0 && (
                            <div className="text-[11px] text-slate-400">Añade grupos para evaluar keywords por temas.</div>
                          )}
                          {(validationDataForSelected.keywordGroups ?? []).map((group, idx) => (
                            <div key={group.id} className="border border-slate-200 rounded-lg p-2 space-y-2 bg-white">
                              <div className="flex items-center justify-between gap-2">
                                <input
                                  className="flex-1 border rounded px-2 py-1 text-[12px]"
                                  value={group.label ?? `Grupo ${idx + 1}`}
                                  onChange={(event) =>
                                    handleKeywordGroupChange(group.id, (current) => ({
                                      ...current,
                                      label: event.target.value,
                                    }))
                                  }
                                  placeholder="Nombre interno"
                                />
                                <button
                                  type="button"
                                  className="px-2 py-0.5 text-[10px] border rounded"
                                  onClick={() => handleRemoveKeywordGroup(group.id)}
                                >
                                  Eliminar
                                </button>
                              </div>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="text-slate-500">Modo</span>
                                <select
                                  className="border rounded px-2 py-1 text-[11px]"
                                  value={group.mode ?? 'contains'}
                                  onChange={(event) =>
                                    handleKeywordGroupChange(group.id, (current) => ({
                                      ...current,
                                      mode: event.target.value === 'exact' ? 'exact' : 'contains',
                                    }))
                                  }
                                >
                                  <option value="contains">Contiene</option>
                                  <option value="exact">Exacto</option>
                                </select>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span>Palabras clave ({group.keywords?.length ?? 0})</span>
                                  <button
                                    type="button"
                                    className="px-2 py-0.5 text-[10px] border rounded"
                                    onClick={() => handleAddKeywordToGroup(group.id)}
                                  >
                                    + palabra
                                  </button>
                                </div>
                                {(group.keywords ?? []).length === 0 && (
                                  <div className="text-[11px] text-slate-400">Aún no hay palabras en este grupo.</div>
                                )}
                                {(group.keywords ?? []).map((keyword, keywordIdx) => (
                                  <div key={`${group.id}-${keywordIdx}`} className="flex items-center gap-2">
                                    <input
                                      className="flex-1 border rounded px-2 py-1 text-[12px]"
                                      value={keyword}
                                      onChange={(event) =>
                                        handleKeywordValueChange(group.id, keywordIdx, event.target.value)
                                      }
                                      placeholder="Palabra clave"
                                    />
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[10px] border rounded"
                                      onClick={() => handleRemoveKeyword(group.id, keywordIdx)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {renderConditionTargetSelector({
                            label: 'Destino si coincide',
                            helper: 'Se usará cuando las reglas o keywords hagan match',
                            key: 'matchTargetId',
                            value: validationDataForSelected.matchTargetId ?? null,
                            tone: 'success',
                          })}
                          {renderConditionTargetSelector({
                            label: 'Destino sin coincidencia',
                            helper: 'Se usará cuando no haya ninguna coincidencia',
                            key: 'noMatchTargetId',
                            value: validationDataForSelected.noMatchTargetId ?? null,
                            tone: 'default',
                          })}
                          {renderConditionTargetSelector({
                            label: 'Destino por error',
                            helper: 'Errores de integración, timeouts u otros fallos',
                            key: 'errorTargetId',
                            value: validationDataForSelected.errorTargetId ?? null,
                            tone: 'danger',
                          })}
                          {renderConditionTargetSelector({
                            label: 'Fallback (sin reglas)',
                            helper: 'Cuando no hay reglas configuradas se usará este camino',
                            key: 'defaultTargetId',
                            value: validationDataForSelected.defaultTargetId ?? null,
                            tone: 'warning',
                          })}
                        </div>
                      </div>
                      </div>
                    )}

                    {selected.action?.kind === "validation" && (
                      <div className="space-y-3 text-xs">
                        <div className="space-y-2">
                          <label className="text-[11px] text-slate-500 font-semibold">Tipo de validación</label>
                          <select
                            className="w-full border rounded px-2 py-1"
                            value={selected.action?.data?.validationType ?? "keywords"}
                            onChange={(e) =>
                              updateSelected({
                                action: {
                                  kind: "validation",
                                  data: { ...selected.action?.data, validationType: e.target.value },
                                },
                              })
                            }
                          >
                            <option value="keywords">Palabras clave</option>
                            <option value="format">Formato (email, teléfono, etc.)</option>
                          </select>
                        </div>

                        {selected.action?.data?.validationType === "keywords" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-slate-500 font-semibold">Grupos de palabras clave</span>
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[10px] border rounded hover:bg-emerald-50"
                                onClick={() => {
                                  const groups = [...(selected.action?.data?.keywordGroups ?? [])];
                                  groups.push({
                                    id: createId('kw'),
                                    label: `Grupo ${groups.length + 1}`,
                                    mode: 'contains',
                                    keywords: ['palabra'],
                                  });
                                  updateSelected({
                                    action: {
                                      kind: "validation",
                                      data: { ...selected.action?.data, keywordGroups: groups },
                                    },
                                  });
                                }}
                              >
                                + grupo
                              </button>
                            </div>

                            {(!selected.action?.data?.keywordGroups || selected.action?.data?.keywordGroups.length === 0) && (
                              <div className="text-[11px] text-slate-400 border rounded p-2">
                                Añade grupos de palabras clave para detectar
                              </div>
                            )}

                            {(selected.action?.data?.keywordGroups ?? []).map((group: any, idx: number) => (
                              <div key={group.id} className="border border-slate-200 rounded-lg p-2 space-y-2 bg-white">
                                <div className="flex items-center justify-between gap-2">
                                  <input
                                    className="flex-1 border rounded px-2 py-1 text-[12px]"
                                    value={group.label ?? `Grupo ${idx + 1}`}
                                    onChange={(e) => {
                                      const groups = [...(selected.action?.data?.keywordGroups ?? [])];
                                      groups[idx] = { ...groups[idx], label: e.target.value };
                                      updateSelected({
                                        action: {
                                          kind: "validation",
                                          data: { ...selected.action?.data, keywordGroups: groups },
                                        },
                                      });
                                    }}
                                    placeholder={`Grupo ${idx + 1}`}
                                  />
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-[10px] border rounded text-rose-600 hover:bg-rose-50"
                                    onClick={() => {
                                      const groups = (selected.action?.data?.keywordGroups ?? []).filter((_: any, i: number) => i !== idx);
                                      updateSelected({
                                        action: {
                                          kind: "validation",
                                          data: { ...selected.action?.data, keywordGroups: groups },
                                        },
                                      });
                                    }}
                                  >
                                    Eliminar
                                  </button>
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[10px] text-slate-500">Modo de coincidencia</label>
                                  <select
                                    className="w-full border rounded px-2 py-1 text-[11px]"
                                    value={group.mode ?? 'contains'}
                                    onChange={(e) => {
                                      const groups = [...(selected.action?.data?.keywordGroups ?? [])];
                                      groups[idx] = { ...groups[idx], mode: e.target.value };
                                      updateSelected({
                                        action: {
                                          kind: "validation",
                                          data: { ...selected.action?.data, keywordGroups: groups },
                                        },
                                      });
                                    }}
                                  >
                                    <option value="contains">Contiene</option>
                                    <option value="exact">Exacta</option>
                                  </select>
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[10px] text-slate-500">Palabras clave (separadas por coma)</label>
                                  <input
                                    className="w-full border rounded px-2 py-1 text-[11px]"
                                    value={(group.keywords ?? []).join(', ')}
                                    onChange={(e) => {
                                      const groups = [...(selected.action?.data?.keywordGroups ?? [])];
                                      groups[idx] = {
                                        ...groups[idx],
                                        keywords: e.target.value.split(',').map((k: string) => k.trim()).filter(Boolean),
                                      };
                                      updateSelected({
                                        action: {
                                          kind: "validation",
                                          data: { ...selected.action?.data, keywordGroups: groups },
                                        },
                                      });
                                    }}
                                    placeholder="ayuda, help, soporte"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="text-[10px] text-slate-500 bg-slate-50 border rounded p-2">
                          💡 Usa los handles del nodo para conectar cada grupo a su destino. Si no coincide ninguno, irá al handle "No coincide".
                        </div>
                      </div>
                    )}

                      {selected.action?.kind==="attachment" && (
                      <div className="space-y-3 text-xs">
                        <div className="flex gap-2">
                          <select
                            className="border rounded px-2 py-1"
                            value={selected.action?.data?.attType ?? "image"}
                            onChange={(e)=>updateSelected({ action:{ kind:"attachment", data:{ ...(selected.action?.data||{}), attType:e.target.value } } })}
                          >
                            <option value="image">Imagen</option>
                            <option value="file">Archivo</option>
                            <option value="audio">Audio</option>
                            <option value="video">Video</option>
                          </select>
                          <input
                            className="flex-1 border rounded px-2 py-1"
                            placeholder="URL pública (opcional)"
                            value={selected.action?.data?.url ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"attachment", data:{ ...(selected.action?.data||{}), url:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Nombre visible</label>
                          <input
                            className="w-full border rounded px-2 py-1"
                            placeholder="Documento promocional"
                            value={selected.action?.data?.name ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"attachment", data:{ ...(selected.action?.data||{}), name:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Subir archivo desde tu PC</label>
                          <input
                            type="file"
                            className="block w-full text-[11px] text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-100 file:px-3 file:py-1 file:text-emerald-700 hover:file:bg-emerald-200"
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              handleAttachmentUpload(file);
                              event.target.value = "";
                            }}
                          />
                          <p className="text-[10px] text-slate-400">El archivo se subirá al servidor y se guardará la URL en el flujo.</p>
                        </div>
                        {(selected.action?.data?.url || selected.action?.data?.fileData) && (
                          <div className="border rounded-lg p-2 bg-emerald-50 text-emerald-700 space-y-1">
                            <div className="font-semibold flex items-center gap-2">
                              <span>📎 {selected.action?.data?.fileName || selected.action?.data?.name || "Archivo sin nombre"}</span>
                            </div>
                            <div className="text-[10px] text-emerald-700/80">
                              {selected.action?.data?.mimeType || "tipo desconocido"} ·
                              {` ${Math.max(1, Math.round(((selected.action?.data?.fileSize ?? 0) / 1024) || 0))} KB`}
                              {selected.action?.data?.url && " · ✓ Subido al servidor"}
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="px-2 py-0.5 border border-emerald-300 rounded bg-white text-emerald-700 hover:bg-emerald-100"
                                onClick={handleAttachmentClear}
                              >
                                Quitar archivo
                              </button>
                              {selected.action?.data?.url && (
                                <a
                                  className="px-2 py-0.5 border border-emerald-300 rounded bg-white text-emerald-700 hover:bg-emerald-100"
                                  href={selected.action.data.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Ver archivo
                                </a>
                              )}
                              {typeof selected.action?.data?.fileData === "string" && selected.action?.data?.fileData && !selected.action?.data?.url && (
                                <a
                                  className="px-2 py-0.5 border border-emerald-300 rounded bg-white text-emerald-700 hover:bg-emerald-100"
                                  href={selected.action.data.fileData}
                                  download={selected.action?.data?.fileName || "archivo"}
                                >
                                  Descargar
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selected.action?.kind === "scheduler" && schedulerDataForSelected && (
                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="block text-[11px] text-slate-500">Modo</label>
                          <select
                            className="w-full border rounded px-2 py-1"
                            value={schedulerDataForSelected.mode}
                            onChange={(event) => handleSchedulerModeChange(event.target.value as SchedulerMode)}
                          >
                            <option value="custom">Horario personalizado</option>
                            <option value="bitrix">Bitrix (compatibilidad)</option>
                          </select>
                        </div>
                        {schedulerDataForSelected.mode === "custom" && schedulerDataForSelected.custom && (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="block text-[11px] text-slate-500">Zona horaria (IANA)</label>
                              <input
                                className="w-full border rounded px-2 py-1"
                                value={schedulerDataForSelected.custom.timezone}
                                onChange={(event) => handleSchedulerTimezoneChange(event.target.value)}
                                placeholder="America/Lima"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-600">Ventanas horarias</span>
                                <button
                                  type="button"
                                  className="px-2 py-0.5 border rounded"
                                  onClick={handleSchedulerAddWindow}
                                >
                                  + ventana
                                </button>
                              </div>
                              {schedulerDataForSelected.custom.windows.map((window, idx) => (
                                <div key={idx} className="border rounded p-2 space-y-2">
                                  <div className="flex items-center justify-between text-[11px] font-medium">
                                    <span>Ventana {idx + 1}</span>
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 border rounded"
                                      onClick={() => handleSchedulerRemoveWindow(idx)}
                                    >
                                      Eliminar
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {WEEKDAY_CHOICES.map((choice) => {
                                      const active = window.weekdays.includes(choice.value);
                                      return (
                                        <button
                                          key={choice.value}
                                          type="button"
                                          title={choice.title}
                                          className={`px-2 py-0.5 rounded border ${
                                            active
                                              ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                              : "border-slate-200 text-slate-500"
                                          }`}
                                          onClick={() => handleSchedulerToggleWeekday(idx, choice.value)}
                                        >
                                          {choice.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                      <label className="block text-[11px] text-slate-500">Inicio</label>
                                      <input
                                        className="w-full border rounded px-2 py-1"
                                        value={window.start}
                                        onChange={(event) => handleSchedulerWindowChange(idx, { start: event.target.value })}
                                        placeholder="09:00"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-[11px] text-slate-500">Fin</label>
                                      <input
                                        className="w-full border rounded px-2 py-1"
                                        value={window.end}
                                        onChange={(event) => handleSchedulerWindowChange(idx, { end: event.target.value })}
                                        placeholder="18:00"
                                      />
                                    </div>
                                  </div>
                                  <label className="flex items-center gap-2 text-[11px] text-slate-500">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(window.overnight)}
                                      onChange={() => handleSchedulerToggleOvernight(idx)}
                                    />
                                    Cruza medianoche
                                  </label>
                                </div>
                              ))}
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-600">Excepciones</span>
                                <button
                                  type="button"
                                  className="px-2 py-0.5 border rounded"
                                  onClick={handleSchedulerAddException}
                                >
                                  + excepción
                                </button>
                              </div>
                              {(schedulerDataForSelected.custom.exceptions ?? []).map((exception, idx) => (
                                <div key={idx} className="border rounded p-2 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <input
                                      type="date"
                                      className="flex-1 border rounded px-2 py-1"
                                      value={exception.date}
                                      onChange={(event) =>
                                        handleSchedulerExceptionChange(idx, { date: event.target.value })
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="ml-2 px-2 py-0.5 border rounded"
                                      onClick={() => handleSchedulerRemoveException(idx)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <label className="flex items-center gap-2 text-[11px] text-slate-500">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(exception.closed)}
                                      onChange={(event) =>
                                        handleSchedulerExceptionChange(idx, { closed: event.target.checked })
                                      }
                                    />
                                    Cerrado todo el día
                                  </label>
                                  {!exception.closed && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        className="border rounded px-2 py-1"
                                        value={exception.start ?? ""}
                                        onChange={(event) =>
                                          handleSchedulerExceptionChange(idx, { start: event.target.value })
                                        }
                                        placeholder="Inicio"
                                      />
                                      <input
                                        className="border rounded px-2 py-1"
                                        value={exception.end ?? ""}
                                        onChange={(event) =>
                                          handleSchedulerExceptionChange(idx, { end: event.target.value })
                                        }
                                        placeholder="Fin"
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                            {schedulerDataForSelected.mode === "custom" && (
                              <div className="text-[11px] text-rose-500 space-y-1">
                                {validateCustomSchedule(schedulerDataForSelected.custom).map((error) => (
                                  <div key={error}>{error}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {selected.action?.kind==="webhook_out" && (
                      <div className="space-y-2">
                        <div className="flex gap-2 text-xs">
                          <select className="border rounded px-2 py-1" value={selected.action?.data?.method ?? "POST"} onChange={(e)=>updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), method:e.target.value } } })}>
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                          <input className="flex-1 border rounded px-2 py-1" placeholder="https://..." value={selected.action?.data?.url ?? ""} onChange={(e)=>updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), url:e.target.value } } })} />
                        </div>
                        <div className="text-xs">Headers</div>
                        {(selected.action?.data?.headers ?? []).map((h:any, idx:number)=>(
                          <div key={idx} className="flex gap-2 text-xs">
                            <input className="flex-1 border rounded px-2 py-1" placeholder="Clave" value={h.k} onChange={(e)=>{ const headers=[...(selected.action?.data?.headers||[])]; headers[idx] = {...headers[idx], k:e.target.value}; updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), headers } } }); }} />
                            <input className="flex-1 border rounded px-2 py-1" placeholder="Valor" value={h.v} onChange={(e)=>{ const headers=[...(selected.action?.data?.headers||[])]; headers[idx] = {...headers[idx], v:e.target.value}; updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), headers } } }); }} />
                            <button className="px-2 py-1 border rounded" onClick={()=>{ const headers=[...(selected.action?.data?.headers||[])]; headers.splice(idx,1); updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), headers } } }); }}>✕</button>
                          </div>
                        ))}
                        <button className="px-2 py-1 border rounded text-xs" onClick={()=>{ const headers=[...(selected.action?.data?.headers||[])]; headers.push({k:"X-Key", v:"value"}); updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), headers } } }); }}>+ header</button>
                        <label className="block text-xs mt-2">Body (JSON)</label>
                        <textarea className="w-full border rounded px-2 py-1 text-xs h-24 font-mono" value={selected.action?.data?.body ?? ""} onChange={(e)=>updateSelected({ action:{ kind:"webhook_out", data:{ ...(selected.action?.data||{}), body:e.target.value } } })} />

                        {/* Botón de test */}
                        <button
                          className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={handleTestWebhook}
                          disabled={webhookTesting || !selected.action?.data?.url}
                        >
                          {webhookTesting ? '⏳ Probando...' : '🧪 Probar Webhook'}
                        </button>

                        {/* Resultados del test */}
                        {webhookTestResult && (
                          <div className={`p-3 rounded-lg text-xs ${webhookTestResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <div className="font-semibold mb-2 flex items-center justify-between">
                              <span>{webhookTestResult.success ? '✅ Éxito' : '❌ Error'}</span>
                              <span className="text-gray-500">{webhookTestResult.duration}ms</span>
                            </div>
                            {webhookTestResult.status && (
                              <div className="mb-1"><span className="font-medium">Status:</span> {webhookTestResult.status}</div>
                            )}
                            {webhookTestResult.error && (
                              <div className="text-red-700 mb-1"><span className="font-medium">Error:</span> {webhookTestResult.error}</div>
                            )}
                            {webhookTestResult.data && (
                              <div className="mt-2">
                                <div className="font-medium mb-1">Respuesta:</div>
                                <pre className="bg-white p-2 rounded border overflow-auto max-h-40 text-[10px]">
                                  {JSON.stringify(webhookTestResult.data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {selected.action?.kind==="webhook_in" && (
                      <div className="space-y-2">
                        <label className="block text-xs font-medium">Path</label>
                        <input className="w-full border rounded px-2 py-1 text-xs" placeholder="/hooks/inbound" value={selected.action?.data?.path ?? ""} onChange={(e)=>updateSelected({ action:{ kind:"webhook_in", data:{ ...(selected.action?.data||{}), path:e.target.value } } })} />

                        <label className="block text-xs font-medium">Secret (opcional)</label>
                        <input className="w-full border rounded px-2 py-1 text-xs" placeholder="Secret opcional" type="password" value={selected.action?.data?.secret ?? ""} onChange={(e)=>updateSelected({ action:{ kind:"webhook_in", data:{ ...(selected.action?.data||{}), secret:e.target.value } } })} />

                        {/* URL generada */}
                        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-xs font-medium mb-1">URL del Webhook:</div>
                          <div className="flex gap-2">
                            <input
                              className="flex-1 border rounded px-2 py-1 text-xs font-mono bg-white"
                              value={generateWebhookInUrl(flow.id, selectedId, selected.action?.data?.secret)}
                              readOnly
                            />
                            <button
                              className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition"
                              onClick={handleCopyWebhookInUrl}
                            >
                              📋 Copiar
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-500 mt-2">
                            ℹ️ Esta URL está lista para recibir POST requests desde servicios externos como n8n
                          </div>
                        </div>
                      </div>
                    )}

                    {selected.action?.kind==="bitrix_crm" && (
                      <BitrixCRMInspector
                        data={selected.action.data}
                        onChange={(newData)=>updateSelected({ action:{ kind:"bitrix_crm", data:newData } })}
                      />
                    )}

                    {selected.action?.kind==="transfer" && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Tipo de transferencia</label>
                          <select className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            value={selected.action?.data?.target ?? "queue"}
                            onChange={(e)=>updateSelected({ action:{ kind:"transfer", data:{ target:e.target.value, destination:"" } } })}>
                            <option value="queue">Cola de asesores</option>
                            <option value="advisor">Asesor específico</option>
                            <option value="bot">Bot / Flujo</option>
                          </select>
                        </div>

                        {selected.action?.data?.target === "queue" && (
                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-500">Cola</label>
                            <select className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                              value={selected.action?.data?.destination ?? ""}
                              onChange={(e)=>updateSelected({ action:{ kind:"transfer", data:{ ...(selected.action?.data||{}), destination:e.target.value } } })}>
                              <option value="">-- Selecciona una cola --</option>
                              {queues.map(q => (
                                <option key={q.id} value={q.id}>{q.name}</option>
                              ))}
                            </select>
                            <p className="text-[10px] text-slate-400">
                              La conversación se asignará automáticamente al siguiente asesor disponible en la cola
                            </p>
                          </div>
                        )}

                        {selected.action?.data?.target === "advisor" && (
                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-500">Asesor</label>
                            <select className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                              value={selected.action?.data?.destination ?? ""}
                              onChange={(e)=>updateSelected({ action:{ kind:"transfer", data:{ ...(selected.action?.data||{}), destination:e.target.value } } })}>
                              <option value="">-- Selecciona un asesor --</option>
                              {advisors.map(a => (
                                <option key={a.id} value={a.id}>
                                  {a.isOnline ? "🟢" : "⚫"} {a.name} ({a.email})
                                </option>
                              ))}
                            </select>
                            <p className="text-[10px] text-slate-400">
                              {selected.action?.data?.destination && advisors.find(a => a.id === selected.action?.data?.destination)?.isOnline === false && (
                                <span className="text-amber-600">⚠️ El asesor está desconectado. Leerá el mensaje cuando se conecte.</span>
                              )}
                              {(!selected.action?.data?.destination || advisors.find(a => a.id === selected.action?.data?.destination)?.isOnline) && (
                                <span>La conversación se asignará directamente a este asesor</span>
                              )}
                            </p>
                          </div>
                        )}

                        {selected.action?.data?.target === "bot" && (
                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-500">Bot / Flujo</label>
                            <select className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                              value={selected.action?.data?.destination ?? ""}
                              onChange={(e)=>updateSelected({ action:{ kind:"transfer", data:{ ...(selected.action?.data||{}), destination:e.target.value } } })}>
                              <option value="">-- Selecciona un flujo --</option>
                              {allFlows.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                              ))}
                            </select>
                            <p className="text-[10px] text-slate-400">
                              El bot ejecutará el flujo seleccionado desde el principio
                            </p>
                          </div>
                        )}

                        <div className="space-y-1 mt-3 pt-3 border-t">
                          <label className="block text-[11px] font-medium text-slate-700">Mensaje antes de transferir (opcional)</label>
                          <textarea
                            className="w-full border rounded px-2 py-1 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            value={selected.action?.data?.message ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"transfer", data:{ ...(selected.action?.data||{}), message:e.target.value } } })}
                            placeholder="Ej: Un momento, te voy a conectar con un agente... 🤝"
                          />
                        </div>
                      </div>
                    )}

                    {selected.action?.kind==="handoff" && (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                          🤝 El Handoff transfiere la conversación a un agente humano. El bot dejará de responder automáticamente.
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Cola de agentes</label>
                          <input
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            placeholder="Ej: agentes, soporte, ventas"
                            value={selected.action?.data?.queue ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"handoff", data:{ ...(selected.action?.data||{}), queue:e.target.value } } })}
                          />
                          <p className="text-[10px] text-slate-400">Nombre de la cola donde se asignará la conversación</p>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Nota interna (opcional)</label>
                          <textarea
                            className="w-full border rounded px-3 py-2 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            placeholder="Información adicional para el agente..."
                            value={selected.action?.data?.note ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"handoff", data:{ ...(selected.action?.data||{}), note:e.target.value } } })}
                          />
                        </div>
                      </div>
                    )}

                    {selected.action?.kind==="ia_rag" && (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-[11px] text-purple-800">
                          🤖 IA · RAG usa inteligencia artificial para responder consultando tu base de conocimiento
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Proveedor</label>
                          <select
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                            value={selected.action?.data?.provider ?? "openai"}
                            onChange={(e)=>updateSelected({ action:{ kind:"ia_rag", data:{ ...(selected.action?.data||{}), provider:e.target.value } } })}>
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic (Claude)</option>
                            <option value="gemini">Google Gemini</option>
                            <option value="ollama">Ollama (Local)</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Modelo</label>
                          <select
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                            value={selected.action?.data?.model ?? "gpt-4"}
                            onChange={(e)=>updateSelected({ action:{ kind:"ia_rag", data:{ ...(selected.action?.data||{}), model:e.target.value } } })}>
                            {/* OpenAI Models */}
                            {(selected.action?.data?.provider ?? "openai") === "openai" && (
                              <>
                                <optgroup label="GPT-4o (Más reciente - Recomendado)">
                                  <option value="gpt-4o">GPT-4o (Latest)</option>
                                  <option value="gpt-4o-2024-11-20">GPT-4o (Nov 2024)</option>
                                  <option value="gpt-4o-2024-08-06">GPT-4o (Aug 2024)</option>
                                  <option value="gpt-4o-2024-05-13">GPT-4o (May 2024)</option>
                                </optgroup>
                                <optgroup label="GPT-4o Mini (Económico)">
                                  <option value="gpt-4o-mini">GPT-4o Mini (Latest)</option>
                                  <option value="gpt-4o-mini-2024-07-18">GPT-4o Mini (Jul 2024)</option>
                                </optgroup>
                                <optgroup label="GPT-4 Turbo">
                                  <option value="gpt-4-turbo">GPT-4 Turbo (Latest)</option>
                                  <option value="gpt-4-turbo-2024-04-09">GPT-4 Turbo (Apr 2024)</option>
                                  <option value="gpt-4-turbo-preview">GPT-4 Turbo Preview</option>
                                  <option value="gpt-4-0125-preview">GPT-4 Turbo (Jan 2024)</option>
                                  <option value="gpt-4-1106-preview">GPT-4 Turbo (Nov 2023)</option>
                                </optgroup>
                                <optgroup label="GPT-4 Clásico">
                                  <option value="gpt-4">GPT-4 (Latest)</option>
                                  <option value="gpt-4-0613">GPT-4 (Jun 2023)</option>
                                </optgroup>
                                <optgroup label="GPT-3.5 Turbo">
                                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Latest)</option>
                                  <option value="gpt-3.5-turbo-0125">GPT-3.5 Turbo (Jan 2024)</option>
                                  <option value="gpt-3.5-turbo-1106">GPT-3.5 Turbo (Nov 2023)</option>
                                </optgroup>
                                <optgroup label="Modelos o1 (Razonamiento)">
                                  <option value="o1-preview">o1 Preview</option>
                                  <option value="o1-mini">o1 Mini</option>
                                </optgroup>
                              </>
                            )}
                            {/* Anthropic Claude Models */}
                            {selected.action?.data?.provider === "anthropic" && (
                              <>
                                <optgroup label="Claude 3.5">
                                  <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Más reciente)</option>
                                  <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Rápido)</option>
                                </optgroup>
                                <optgroup label="Claude 3">
                                  <option value="claude-3-opus-20240229">Claude 3 Opus (Más capaz)</option>
                                  <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                                  <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                                </optgroup>
                              </>
                            )}
                            {/* Google Gemini Models */}
                            {selected.action?.data?.provider === "gemini" && (
                              <>
                                <optgroup label="Gemini 2.0 (Más reciente)">
                                  <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Experimental)</option>
                                </optgroup>
                                <optgroup label="Gemini 1.5 Pro (Más capaz)">
                                  <option value="gemini-1.5-pro-latest">Gemini 1.5 Pro (Latest)</option>
                                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                  <option value="gemini-1.5-pro-002">Gemini 1.5 Pro (002)</option>
                                  <option value="gemini-1.5-pro-001">Gemini 1.5 Pro (001)</option>
                                </optgroup>
                                <optgroup label="Gemini 1.5 Flash (Rápido)">
                                  <option value="gemini-1.5-flash-latest">Gemini 1.5 Flash (Latest)</option>
                                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                  <option value="gemini-1.5-flash-002">Gemini 1.5 Flash (002)</option>
                                  <option value="gemini-1.5-flash-001">Gemini 1.5 Flash (001)</option>
                                </optgroup>
                                <optgroup label="Gemini 1.5 Flash-8B (Ultra rápido)">
                                  <option value="gemini-1.5-flash-8b-latest">Gemini 1.5 Flash-8B (Latest)</option>
                                  <option value="gemini-1.5-flash-8b">Gemini 1.5 Flash-8B</option>
                                </optgroup>
                                <optgroup label="Gemini 1.0 Pro">
                                  <option value="gemini-1.0-pro-latest">Gemini 1.0 Pro (Latest)</option>
                                  <option value="gemini-1.0-pro">Gemini 1.0 Pro</option>
                                </optgroup>
                              </>
                            )}
                            {/* Ollama Models */}
                            {selected.action?.data?.provider === "ollama" && (
                              <>
                                <optgroup label="Meta Llama (Recomendado)">
                                  <option value="llama3.3">Llama 3.3 (70B - Más reciente)</option>
                                  <option value="llama3.2">Llama 3.2 (11B/90B)</option>
                                  <option value="llama3.1">Llama 3.1 (8B/70B/405B)</option>
                                  <option value="llama3">Llama 3 (8B/70B)</option>
                                  <option value="llama2">Llama 2 (7B/13B/70B)</option>
                                </optgroup>
                                <optgroup label="Alibaba Qwen">
                                  <option value="qwen2.5">Qwen 2.5 (0.5B-72B)</option>
                                  <option value="qwen2.5-coder">Qwen 2.5 Coder (1.5B-32B)</option>
                                  <option value="qwen2">Qwen 2 (0.5B-72B)</option>
                                  <option value="qwen">Qwen (7B/14B)</option>
                                </optgroup>
                                <optgroup label="Mistral AI">
                                  <option value="mistral">Mistral (7B)</option>
                                  <option value="mistral-nemo">Mistral Nemo (12B)</option>
                                  <option value="mistral-small">Mistral Small (22B)</option>
                                  <option value="mistral-large">Mistral Large (123B)</option>
                                </optgroup>
                                <optgroup label="Microsoft Phi">
                                  <option value="phi4">Phi-4 (14B - Más reciente)</option>
                                  <option value="phi3">Phi-3 (3.8B/14B)</option>
                                  <option value="phi3.5">Phi-3.5 (3.8B)</option>
                                </optgroup>
                                <optgroup label="Google Gemma">
                                  <option value="gemma2">Gemma 2 (2B/9B/27B)</option>
                                  <option value="gemma">Gemma (2B/7B)</option>
                                </optgroup>
                                <optgroup label="Especializados en Código">
                                  <option value="deepseek-coder">DeepSeek Coder (1.3B-33B)</option>
                                  <option value="codellama">CodeLlama (7B/13B/34B/70B)</option>
                                  <option value="codegemma">CodeGemma (2B/7B)</option>
                                  <option value="starcoder2">StarCoder2 (3B/7B/15B)</option>
                                </optgroup>
                                <optgroup label="Otros Modelos">
                                  <option value="yi">Yi (6B/9B/34B)</option>
                                  <option value="solar">Solar (10.7B)</option>
                                  <option value="dolphin-mixtral">Dolphin Mixtral (8x7B)</option>
                                  <option value="neural-chat">Neural Chat (7B)</option>
                                  <option value="openchat">OpenChat (7B)</option>
                                  <option value="vicuna">Vicuna (7B/13B/33B)</option>
                                  <option value="orca-mini">Orca Mini (3B/7B/13B)</option>
                                </optgroup>
                              </>
                            )}
                          </select>
                          <p className="text-[10px] text-slate-400">
                            {(selected.action?.data?.provider ?? "openai") === "openai" && "⚙️ Configurar API Key en: Configuración → Inteligencia Artificial → OpenAI"}
                            {selected.action?.data?.provider === "anthropic" && "⚙️ Configurar API Key en: Configuración → Inteligencia Artificial → Anthropic"}
                            {selected.action?.data?.provider === "gemini" && "⚙️ Configurar API Key en: Configuración → Inteligencia Artificial → Gemini"}
                            {selected.action?.data?.provider === "ollama" && "⚙️ Instalar Ollama desde ollama.com y ejecutar: ollama pull <modelo>"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Prompt del sistema</label>
                          <textarea
                            className="w-full border rounded px-3 py-2 text-xs resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-purple-300"
                            placeholder="Ej: Responde la pregunta del usuario basándote en el contexto..."
                            value={selected.action?.data?.prompt ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"ia_rag", data:{ ...(selected.action?.data||{}), prompt:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Base de conocimiento</label>
                          <input
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                            placeholder="default"
                            value={selected.action?.data?.knowledgeBase ?? "default"}
                            onChange={(e)=>updateSelected({ action:{ kind:"ia_rag", data:{ ...(selected.action?.data||{}), knowledgeBase:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Temperatura (0-1)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="1"
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                            value={selected.action?.data?.temperature ?? 0.7}
                            onChange={(e)=>updateSelected({ action:{ kind:"ia_rag", data:{ ...(selected.action?.data||{}), temperature:parseFloat(e.target.value) } } })}
                          />
                          <p className="text-[10px] text-slate-400">Mayor = más creativo, Menor = más preciso</p>
                        </div>
                      </div>
                    )}

                    {selected.action?.kind==="tool" && (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-[11px] text-blue-800">
                          🔧 Tool/Acción externa ejecuta una función personalizada o integración externa
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Nombre del tool</label>
                          <input
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                            placeholder="Ej: custom_action, api_call, process_data"
                            value={selected.action?.data?.toolName ?? selected.action?.data?.name ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"tool", data:{ ...(selected.action?.data||{}), toolName:e.target.value, name:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Endpoint (opcional)</label>
                          <input
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                            placeholder="https://api.ejemplo.com/action"
                            value={selected.action?.data?.endpoint ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"tool", data:{ ...(selected.action?.data||{}), endpoint:e.target.value } } })}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Método</label>
                          <select
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                            value={selected.action?.data?.method ?? "POST"}
                            onChange={(e)=>updateSelected({ action:{ kind:"tool", data:{ ...(selected.action?.data||{}), method:e.target.value } } })}>
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Parámetros (JSON)</label>
                          <textarea
                            className="w-full border rounded px-3 py-2 text-xs resize-y min-h-[80px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                            placeholder='{\n  "param1": "value1",\n  "param2": "value2"\n}'
                            value={JSON.stringify(selected.action?.data?.params ?? selected.action?.data?.args ?? {}, null, 2)}
                            onChange={(e)=>{ let val={}; try{ val=JSON.parse(e.target.value||"{}"); }catch{} updateSelected({ action:{ kind:"tool", data:{ ...(selected.action?.data||{}), params:val, args:val } } }); }}
                          />
                        </div>
                      </div>
                    )}

                    {selected.action?.kind==="delay" && (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-[11px] text-sky-800">
                          ⏱️ Delay pausa el flujo durante el tiempo especificado antes de continuar al siguiente nodo
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Tiempo de espera (segundos)</label>
                          <input
                            type="number"
                            min="1"
                            max="300"
                            className="w-full border rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                            placeholder="5"
                            value={selected.action?.data?.delaySeconds ?? 5}
                            onChange={(e)=>updateSelected({ action:{ kind:"delay", data:{ ...(selected.action?.data||{}), delaySeconds:parseInt(e.target.value)||5 } } })}
                          />
                          <p className="text-[10px] text-slate-400">Entre 1 y 300 segundos (5 minutos máximo)</p>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-medium text-slate-500">Nota interna (opcional)</label>
                          <textarea
                            className="w-full border rounded px-3 py-2 text-xs resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-sky-300"
                            placeholder="Ej: Esperar para simular que un agente está escribiendo..."
                            value={selected.action?.data?.note ?? ""}
                            onChange={(e)=>updateSelected({ action:{ kind:"delay", data:{ ...(selected.action?.data||{}), note:e.target.value } } })}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
      )}

      {mainTab === 'crm' && hasPermission('crm.view') && (
        <div className="h-full overflow-hidden">
          <CRMWorkspace />
        </div>
      )}

      {/* Campaigns Tab */}
      {mainTab === 'campaigns' && hasPermission('campaigns.view') && (
        <div className="mt-2 h-[calc(100vh-70px)] overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex h-[calc(100vh-70px)] items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-xl">
                Cargando Campañas…
              </div>
            }
          >
            <CampaignsPage />
          </React.Suspense>
        </div>
      )}

      {/* Templates Tab */}
      {mainTab === 'templates' && hasPermission('templates.view') && (
        <div className="mt-2 h-[calc(100vh-70px)] overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex h-[calc(100vh-70px)] items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-xl">
                Cargando Plantillas…
              </div>
            }
          >
            <TemplateCreatorPage />
          </React.Suspense>
        </div>
      )}

      {/* Agenda Tab */}
      {mainTab === 'agenda' && hasPermission('agenda.view') && (
        <div className="mt-2 h-[calc(100vh-70px)] overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex h-[calc(100vh-70px)] items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-xl">
                Cargando Agenda…
              </div>
            }
          >
            <AgendaPage />
          </React.Suspense>
        </div>
      )}

      {/* Advisors Tab */}
      {mainTab === 'advisors' && hasPermission('advisors.view') && (
        <div className="mt-2 h-[calc(100vh-70px)]">
          <div className="h-full max-w-4xl mx-auto">
            <AdvisorStatusPanel socket={globalAdvisorSocket} />
          </div>
        </div>
      )}

      {/* Metrics Tab */}
      {mainTab === 'metrics' && hasPermission('metrics.view') && (
        <div className="h-[calc(100vh-120px)] overflow-hidden">
          <UnifiedMetricsPanel whatsappNumbers={whatsappNumbers} />
        </div>
      )}

      {/* Configuration Tab */}
      {mainTab === 'config' && hasPermission('config.view') && (
        <div className="mt-2 h-[calc(100vh-70px)] overflow-y-auto p-6">
          <ConfigurationPanel
            whatsappNumbers={whatsappNumbers}
            onUpdateWhatsappNumbers={setWhatsappNumbers}
            user={user}
          />
        </div>
      )}

      {/* AI Reports Tab - SOLO ADMIN */}
      {mainTab === 'ai-reports' && user && user.role === 'admin' && (
        <div className="mt-2 h-[calc(100vh-70px)] overflow-y-auto">
          <AIReportsPanel />
        </div>
      )}
      </div>
      {/* End of content area */}

      {/* Modal de búsqueda de nodos */}
      {showNodeSearch && (
        <NodeSearchModal
          flow={flow}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClose={() => setShowNodeSearch(false)}
        />
      )}

      {/* Modal de selección de templates */}
      {showTemplateSelector && (
        <TemplateSelector
          onSelect={handleSelectTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {/* Modal de galería de flujos */}
      {showFlowsGallery && (
        <FlowsGallery
          currentFlowId={workspaceId || flow.id}
          onSelectFlow={handleSelectFlow}
          onClose={() => setShowFlowsGallery(false)}
        />
      )}

      {/* Modal de guardar flujo */}
      {showSaveModal && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-[9998]"
            onClick={() => setShowSaveModal(false)}
          />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                💾 Guardar Flujo
              </h2>
              <p className="text-sm text-slate-600 mb-4">
                Si cambias el nombre, se guardará como un flujo nuevo.
              </p>
              <div className="mb-6">
                <label htmlFor="flow-name" className="block text-sm font-medium text-slate-700 mb-2">
                  Nombre del flujo
                </label>
                <input
                  id="flow-name"
                  type="text"
                  value={saveFlowName}
                  onChange={(e) => setSaveFlowName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="Ej: Mi Flujo de Atención"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmSave();
                    } else if (e.key === 'Escape') {
                      setShowSaveModal(false);
                    }
                  }}
                />
                {saveFlowName !== flowRef.current.name && (
                  <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                    <span>⚠️</span>
                    <span>Se creará un nuevo flujo con este nombre</span>
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmSave}
                  disabled={!saveFlowName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saveFlowName !== flowRef.current.name ? '✨ Guardar como nuevo' : '💾 Guardar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* User Profile Modal */}
      {showUserProfile && user && (
        <UserProfile
          user={{
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            avatarUrl: user.avatarUrl,
          }}
          onClose={() => setShowUserProfile(false)}
        />
      )}

      {/* Tickets Panel (Admin only) */}
      {showTicketsPanel && user?.role === 'admin' && (
        <AdminTicketsPanel
          isOpen={showTicketsPanel}
          onClose={() => setShowTicketsPanel(false)}
        />
      )}

      {/* Ticket Modals */}
      {isAuthenticated && (
        <>
          <TicketFormModal
            isOpen={showTicketForm}
            onClose={() => setShowTicketForm(false)}
          />
          <MyTicketsPanel
            isOpen={showMyTickets}
            onClose={() => setShowMyTickets(false)}
          />
        </>
      )}
    </div>
  );
}
