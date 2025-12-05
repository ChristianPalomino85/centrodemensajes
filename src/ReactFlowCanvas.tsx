import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  type XYPosition,
  useReactFlow,
} from '@xyflow/react';
import type { FinalConnectionState } from '@xyflow/system';
import '@xyflow/react/dist/style.css';
import type { Flow, NodeType } from './flow/types';
import { type ConnectionCreationKind } from './flow/utils/flow';
import NodePalette from './components/NodePalette';
import {
  buildReactFlowGraph,
  type CanvasEdgeData,
  type CanvasNodeData,
} from './flow/adapters/reactFlow';
import { useRightMousePan } from './flow/hooks/useRightMousePan';
import type { RuntimeNode } from './flow/components/nodes/types';
import { MenuNode } from './flow/components/nodes/MenuNode';
import { SimpleMenuNode } from './flow/components/nodes/SimpleMenuNode';
import { TextMenuNode } from './flow/components/nodes/TextMenuNode';
import { MessageNode } from './flow/components/nodes/MessageNode';
import { ActionNode } from './flow/components/nodes/ActionNode';
import { EndFlowNode } from './flow/components/nodes/EndFlowNode';
import { StartNode } from './flow/components/nodes/StartNode';
import { QuestionNode } from './flow/components/nodes/QuestionNode';
import { ValidationNode } from './flow/components/nodes/ValidationNode';
import { ValidationBitrixNode } from './flow/components/nodes/ValidationBitrixNode';
import { ConditionNode } from './flow/components/nodes/ConditionNode';
import { CustomEdge } from './flow/components/edges/CustomEdge';
import {
  Target,
  Eye,
  EyeOff,
  Menu,
  MessageSquare,
  CheckSquare,
  HelpCircle,
  Paperclip,
  Webhook,
  Download,
  UserPlus,
  Users,
  Clock,
  Timer,
  Shield,
  Bot,
  Wrench,
  Flag,
  GitBranch,
  Database,
} from 'lucide-react';

const NODE_TYPES: Record<string, ComponentType<NodeProps<RuntimeNode>>> = {
  start: StartNode,
  menu: MenuNode,
  'simple-menu': MenuNode,
  'text-menu': TextMenuNode,
  message: MessageNode,
  question: QuestionNode,
  validation: ValidationNode,
  validation_bitrix: ValidationBitrixNode,
  condition: ConditionNode,
  action: ActionNode,
  end: EndFlowNode,
};

type PositionMap = Record<string, { x: number; y: number }>;

type RuntimeEdge = Edge<CanvasEdgeData>;

type ConnectStartParams = {
  nodeId?: string | null;
  handleId?: string | null;
};

type QuickCreateState = {
  sourceId: string;
  handleId: string;
  position: { x: number; y: number };
  screen: { x: number; y: number };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidPosition = (position?: XYPosition | null): position is XYPosition =>
  Boolean(position && isFiniteNumber(position.x) && isFiniteNumber(position.y));

export interface ReactFlowCanvasProps {
  flow: Flow;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string, type: NodeType) => void;
  onDeleteNode: (id: string) => void;
  onDuplicateNode: (id: string) => void | Promise<void>;
  onInsertBetween: (parentId: string, childId: string) => void;
  onDeleteEdge: (parentId: string, childId: string) => void;
  onConnectHandle: (sourceId: string, handleId: string, targetId: string | null) => boolean;
  onCreateForHandle: (sourceId: string, handleId: string, kind: ConnectionCreationKind) => string | null;
  onAttachToMessage: (nodeId: string, files: FileList) => void;
  onInvalidConnection: (message: string) => void;
  invalidMessageIds: Set<string>;
  soloRoot: boolean;
  toggleScope: () => void;
  nodePositions: PositionMap;
  onPositionsChange: (
    updater:
      | PositionMap
      | ((prev: PositionMap) => PositionMap),
  ) => void;
  onRegisterFitView?: (fn: (() => void) | null) => void;
}

export function ReactFlowCanvas(props: ReactFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function ReactFlowCanvasInner(props: ReactFlowCanvasProps) {
  const {
    flow,
    selectedId,
    onSelect,
    onAddChild,
    onDeleteNode,
    onDuplicateNode,
    onDeleteEdge,
    onConnectHandle,
    onCreateForHandle,
    onAttachToMessage,
    onInvalidConnection,
    invalidMessageIds,
    soloRoot,
    nodePositions,
    onPositionsChange,
    onRegisterFitView,
  } = props;
  const { screenToFlowPosition, fitView } = useReactFlow<RuntimeNode, RuntimeEdge>();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [wrapperReady, setWrapperReady] = useState(false);
  const handleWrapperRef = useCallback((node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    setWrapperReady(Boolean(node));
  }, []);
  const [nodes, setNodes] = useState<RuntimeNode[]>([]);
  const [edges, setEdges] = useState<RuntimeEdge[]>([]);
  const pendingSourceRef = useRef<{ sourceId: string; handleId: string } | null>(null);
  const [quickCreateState, setQuickCreateState] = useState<QuickCreateState | null>(null);
  const [visibleNodeIds, setVisibleNodeIds] = useState<string[]>([]);
  const initialFitViewDone = useRef(false); // Track si ya hicimos el fitView inicial
  const lastFlowId = useRef<string>(flow.id); // Track flow ID changes
  const rightMousePan = useRightMousePan();

  const graph = useMemo(() => {
    return buildReactFlowGraph({
      flow,
      soloRoot,
      invalidMessageIds,
      nodePositions,
    });
  }, [flow, soloRoot, invalidMessageIds, nodePositions]);

  const handleCreateNodeFromEdge = useCallback(
    (sourceId: string, targetId: string, handleId: string) => {
      props.onInsertBetween(sourceId, targetId);
    },
    [props],
  );

  const edgeTypes = useMemo(
    () => ({
      step: (edgeProps: any) => (
        <CustomEdge
          {...edgeProps}
          onDeleteEdge={onDeleteEdge}
          onCreateNode={handleCreateNodeFromEdge}
        />
      ),
    }),
    [onDeleteEdge, handleCreateNodeFromEdge],
  );

  const handleAttach = useCallback(
    (nodeId: string, files: FileList) => {
      if (files.length === 0) return;
      onAttachToMessage(nodeId, files);
    },
    [onAttachToMessage],
  );

  const handleShowNodeTypeSelector = useCallback(
    (parentId: string, handleId: string, buttonElement: HTMLElement) => {
      const rect = buttonElement.getBoundingClientRect();
      const flowPosition = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      });
      setQuickCreateState({
        sourceId: parentId,
        handleId,
        position: flowPosition,
        screen: { x: rect.left + rect.width / 2, y: rect.bottom + 8 },
      });
      pendingSourceRef.current = { sourceId: parentId, handleId };
    },
    [screenToFlowPosition],
  );

  const decoratedNodes = useMemo(() => {
    return graph.nodes.map((node) => ({
      ...node,
      data: {
        ...(node.data as CanvasNodeData),
        isSelected: node.id === selectedId,
        onSelect,
        onAddChild,
        onShowNodeTypeSelector: handleShowNodeTypeSelector,
        onDuplicate: onDuplicateNode,
        onDelete: onDeleteNode,
        onAttach: handleAttach,
      },
    })) as RuntimeNode[];
  }, [graph.nodes, selectedId, onSelect, onAddChild, handleShowNodeTypeSelector, onDuplicateNode, onDeleteNode, handleAttach]);

  useEffect(() => {
    setNodes(decoratedNodes);
  }, [decoratedNodes]);

  useEffect(() => {
    if (!onRegisterFitView || !wrapperReady) {
      return () => undefined;
    }
    const register = () => {
      if (!wrapperRef.current) {
        return;
      }
      fitView({ padding: 0.25, duration: 200 });
    };
    onRegisterFitView(register);
    return () => {
      onRegisterFitView(null);
    };
  }, [fitView, onRegisterFitView, wrapperReady]);

  // Reset auto-fit flag when flow ID changes (new flow loaded)
  useEffect(() => {
    if (flow.id !== lastFlowId.current) {
      initialFitViewDone.current = false;
      lastFlowId.current = flow.id;
    }
  }, [flow.id]);

  // Auto-fit view on initial load or when new flow is loaded - DISABLED
  // useEffect(() => {
  //   if (decoratedNodes.length > 0 && !initialFitViewDone.current && wrapperReady) {
  //     fitView({ padding: 0.2, duration: 200 });
  //     initialFitViewDone.current = true;
  //   }
  // }, [decoratedNodes, fitView, wrapperReady]);

  useEffect(() => {
    setEdges(
      graph.edges.map((edge) => ({
        ...edge,
        selectable: true,
        style: { strokeWidth: 2 },
        className: 'flow-edge',
      })),
    );
    setVisibleNodeIds(graph.visibleNodeIds);
  }, [graph.edges, graph.visibleNodeIds]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<RuntimeNode>[]) => {
      setNodes((nds) => applyNodeChanges<RuntimeNode>(changes, nds));
      const updates: PositionMap = {};
      changes.forEach((change) => {
        if (change.type === 'position' && isValidPosition(change.position)) {
          updates[change.id] = { x: change.position.x, y: change.position.y };
        }
      });
      if (Object.keys(updates).length > 0) {
        onPositionsChange((prev) => ({ ...prev, ...updates }));
      }
    },
    [onPositionsChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<RuntimeEdge>[]) => {
      setEdges((eds) => applyEdgeChanges<RuntimeEdge>(changes, eds));
    },
    [],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.sourceHandle) return;
      const ok = onConnectHandle(connection.source, connection.sourceHandle, connection.target ?? null);
      if (!ok) {
        onInvalidConnection('No se pudo crear la conexión. Verifica los tipos de nodos.');
      }
      pendingSourceRef.current = null;
      setQuickCreateState(null);
    },
    [onConnectHandle, onInvalidConnection],
  );

  const handleEdgesDelete = useCallback(
    (deleted: RuntimeEdge[]) => {
      deleted.forEach((edge) => {
        if (edge.source && edge.target) {
          onDeleteEdge(edge.source, edge.target);
        }
      });
    },
    [onDeleteEdge],
  );

  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
  }, []);

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: ConnectStartParams) => {
      if (!params?.nodeId || !params.handleId) {
        pendingSourceRef.current = null;
        return;
      }
      pendingSourceRef.current = { sourceId: params.nodeId, handleId: params.handleId };
    },
    [],
  );

  const handleConnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      connectionState?: FinalConnectionState,
    ) => {
      const pending = pendingSourceRef.current;
      if (!pending) {
        setQuickCreateState(null);
        return;
      }
      const targetNode = connectionState?.toNode;
      if (targetNode) {
        pendingSourceRef.current = null;
        setQuickCreateState(null);
        return;
      }
      const clientPoint = 'clientX' in event
        ? { x: event.clientX, y: event.clientY }
        : {
            x: event.changedTouches[0]?.clientX ?? 0,
            y: event.changedTouches[0]?.clientY ?? 0,
          };
      const flowPoint = connectionState?.to ?? screenToFlowPosition(clientPoint);
      const rect = wrapperRef.current?.getBoundingClientRect();
      const screenPosition = rect
        ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
        : clientPoint;
      setQuickCreateState({
        sourceId: pending.sourceId,
        handleId: pending.handleId,
        position: flowPoint,
        screen: screenPosition,
      });
    },
    [screenToFlowPosition],
  );

  const quickCreateOptions = useMemo<ConnectionCreationKind[]>(
    () => [
      'menu',
      'message',
      'buttons',
      'question',
      'condition',
      'attachment',
      'webhook_out',
      'webhook_in',
      'bitrix_crm',
      'bitrix_create',
      'transfer',
      'handoff',
      'scheduler',
      'delay',
      'validation',
      'validation_bitrix',
      'ia_rag',
      'ia_agent',
      'tool',
      'end',
    ],
    [],
  );

  const handleQuickCreate = useCallback(
    (kind: ConnectionCreationKind) => {
      setQuickCreateState((current) => {
        if (!current) return null;
        const createdId = onCreateForHandle(current.sourceId, current.handleId, kind);
        if (createdId) {
          // Calcular posición inteligente cerca del nodo padre
          const parentPosition = nodePositions[current.sourceId];
          let newPosition = current.position;

          if (parentPosition) {
            // Colocar el nuevo nodo a la derecha del padre
            // Offset: 400px derecha, 50px abajo
            newPosition = {
              x: parentPosition.x + 400,
              y: parentPosition.y + 50,
            };
          }

          onPositionsChange((prev) => ({ ...prev, [createdId]: newPosition }));
          onSelect(createdId);
        }
        pendingSourceRef.current = null;
        return null;
      });
    },
    [onCreateForHandle, onPositionsChange, onSelect, nodePositions],
  );

  const handleSelectionChange = useCallback(
    (params: { nodes?: RuntimeNode[]; edges?: RuntimeEdge[] }) => {
      if (!params.nodes || params.nodes.length === 0) return;
      const latest = params.nodes[params.nodes.length - 1];
      onSelect(latest.id);
    },
    [onSelect],
  );

  return (
    <div
      ref={handleWrapperRef}
      className="relative h-full w-full"
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (event.button === 2 && target?.closest('.react-flow__pane')) {
          rightMousePan.onPaneMouseDown(event);
        }
      }}
      onMouseMove={(event) => {
        if ((event.buttons & 2) === 2) {
          rightMousePan.onPaneMouseMove(event);
        }
      }}
      onMouseUp={() => {
        rightMousePan.onPaneMouseUp();
      }}
      onMouseLeave={() => {
        rightMousePan.onPaneMouseUp();
      }}
      onContextMenu={handlePaneContextMenu}
      onWheel={(e) => {
        // Prevent page scroll when mouse is over canvas
        e.preventDefault();
      }}
    >
      <ReactFlow<RuntimeNode, RuntimeEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'step', animated: false, className: 'flow-edge' }}
        className="h-full"
        style={{ width: '100%', height: '100%', background: '#f8fafc' }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onPaneContextMenu={handlePaneContextMenu}
        onSelectionChange={handleSelectionChange}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        selectionOnDrag
        elevateEdgesOnSelect
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.05}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#cbd5f5" />
        {/* <Controls position="bottom-left" /> */}
        <MiniMap pannable zoomable />
        {quickCreateState && (
          <QuickCreatePopover
            position={quickCreateState.screen}
            options={quickCreateOptions}
            onSelect={handleQuickCreate}
            onDismiss={() => {
              setQuickCreateState(null);
              pendingSourceRef.current = null;
            }}
          />
        )}
      </ReactFlow>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs shadow">
        <span>{visibleNodeIds.length} nodos visibles</span>
        <button
          type="button"
          className="rounded-full border border-emerald-200 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50 flex items-center gap-1.5"
          onClick={props.toggleScope}
        >
          {props.soloRoot ? (
            <>
              <Eye className="w-3.5 h-3.5" />
              Mostrar todo
            </>
          ) : (
            <>
              <EyeOff className="w-3.5 h-3.5" />
              Solo raíz
            </>
          )}
        </button>
        <button
          type="button"
          className="rounded-full border border-blue-200 px-2 py-1 font-medium text-blue-700 hover:bg-blue-50 flex items-center gap-1.5"
          onClick={() => fitView({ padding: 0.2, duration: 300 })}
          title="Centrar y ajustar vista"
        >
          <Target className="w-3.5 h-3.5" />
          Centrar
        </button>
      </div>
      <NodePalette onNodeCreate={(nodeType) => {
        // Create as child of root node with the specified type
        if (flow.rootId) {
          props.onAddChild(flow.rootId, nodeType as any);
        }
      }} />
    </div>
  );
}

type QuickCreatePopoverProps = {
  position: { x: number; y: number };
  options: ConnectionCreationKind[];
  onSelect: (kind: ConnectionCreationKind) => void;
  onDismiss: () => void;
};

function QuickCreatePopover({ position, options, onSelect, onDismiss }: QuickCreatePopoverProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Organize options by category
  const categorizedOptions = {
    estructura: options.filter(opt => opt === 'menu'),
    mensajes: options.filter(opt => ['message', 'buttons', 'question', 'attachment'].includes(opt)),
    integraciones: options.filter(opt => ['webhook_out', 'webhook_in', 'bitrix_crm', 'bitrix_create'].includes(opt)),
    logica: options.filter(opt => ['condition', 'validation', 'validation_bitrix', 'scheduler', 'handoff', 'transfer'].includes(opt)),
    ia: options.filter(opt => ['ia_rag', 'ia_agent', 'tool'].includes(opt)),
    control: options.filter(opt => ['delay', 'end'].includes(opt)),
  };

  return (
    <div
      className="pointer-events-auto absolute z-20 w-56 rounded-lg border border-slate-200 bg-white shadow-xl max-h-[500px] overflow-y-auto"
      style={{ left: position.x, top: position.y }}
    >
      <div className="sticky top-0 border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 bg-white">
        Crear nuevo nodo
      </div>
      <div className="divide-y divide-slate-100">
        {categorizedOptions.estructura.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Estructura</div>
            {categorizedOptions.estructura.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
        {categorizedOptions.mensajes.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Mensajes</div>
            {categorizedOptions.mensajes.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
        {categorizedOptions.integraciones.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Integraciones</div>
            {categorizedOptions.integraciones.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
        {categorizedOptions.logica.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Lógica</div>
            {categorizedOptions.logica.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-sky-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
        {categorizedOptions.ia.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Inteligencia Artificial</div>
            {categorizedOptions.ia.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-purple-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
        {categorizedOptions.control.length > 0 && (
          <div className="p-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1">Control</div>
            {categorizedOptions.control.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 rounded"
                onClick={() => onSelect(option)}
              >
                {renderOptionLabel(option)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderOptionLabel(option: ConnectionCreationKind): React.ReactNode {
  switch (option) {
    case 'menu':
      return <span className="flex items-center gap-2"><Menu className="w-4 h-4" /> Menú</span>;
    case 'message':
      return <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Mensaje</span>;
    case 'buttons':
      return <span className="flex items-center gap-2"><CheckSquare className="w-4 h-4" /> Botones</span>;
    case 'question':
      return <span className="flex items-center gap-2"><HelpCircle className="w-4 h-4" /> Pregunta al cliente</span>;
    case 'condition':
      return <span className="flex items-center gap-2"><GitBranch className="w-4 h-4" /> Condicional</span>;
    case 'attachment':
      return <span className="flex items-center gap-2"><Paperclip className="w-4 h-4" /> Adjunto</span>;
    case 'webhook_out':
      return <span className="flex items-center gap-2"><Webhook className="w-4 h-4" /> Webhook OUT</span>;
    case 'webhook_in':
      return <span className="flex items-center gap-2"><Download className="w-4 h-4" /> Webhook IN</span>;
    case 'bitrix_crm':
      return <span className="flex items-center gap-2"><Database className="w-4 h-4" /> Bitrix CRM</span>;
    case 'bitrix_create':
      return <span className="flex items-center gap-2"><Database className="w-4 h-4" /> Bitrix (legacy)</span>;
    case 'transfer':
      return <span className="flex items-center gap-2"><UserPlus className="w-4 h-4" /> Transferir</span>;
    case 'handoff':
      return <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Handoff (Humano)</span>;
    case 'scheduler':
      return <span className="flex items-center gap-2"><Clock className="w-4 h-4" /> Scheduler</span>;
    case 'delay':
      return <span className="flex items-center gap-2"><Timer className="w-4 h-4" /> Delay (Espera)</span>;
    case 'validation':
      return <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Validación</span>;
    case 'validation_bitrix':
      return <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Validación Bitrix</span>;
    case 'ia_rag':
      return <span className="flex items-center gap-2"><Bot className="w-4 h-4" /> IA · RAG</span>;
    case 'ia_agent':
      return <span className="flex items-center gap-2"><Bot className="w-4 h-4" /> Agente IA</span>;
    case 'tool':
      return <span className="flex items-center gap-2"><Wrench className="w-4 h-4" /> Tool/Acción externa</span>;
    case 'end':
      return <span className="flex items-center gap-2"><Flag className="w-4 h-4" /> Finalizar flujo</span>;
    default:
      return option;
  }
}
