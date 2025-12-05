import {
  type AskActionData,
  type ButtonsActionData,
  type ButtonOption,
  type ConditionActionData,
  type CustomSchedule,
  type DateException,
  type Flow,
  type FlowNode,
  type FlowAction,
  type MenuOption,
  type SchedulerMode,
  type SchedulerNodeData,
  type TimeWindow,
  type ValidationActionData,
  type ValidationKeywordGroup,
  type Weekday,
} from '../types';
import { CHANNEL_BUTTON_LIMITS, DEFAULT_BUTTON_LIMIT } from '../channelLimits';

export const DEFAULT_TIMEZONE = 'America/Lima';

export const DEFAULT_SCHEDULE_WINDOW: TimeWindow = {
  weekdays: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '18:00',
  overnight: false,
};

export function sanitizeWeekdays(weekdays: Weekday[] | undefined): Weekday[] {
  if (!Array.isArray(weekdays)) {
    return [...DEFAULT_SCHEDULE_WINDOW.weekdays];
  }
  const filtered = weekdays.filter((day): day is Weekday => typeof day === 'number' && day >= 1 && day <= 7);
  return Array.from(new Set(filtered));
}

export function sanitizeTimeWindow(window: Partial<TimeWindow> | undefined): TimeWindow {
  if (!window) {
    return { ...DEFAULT_SCHEDULE_WINDOW };
  }
  const weekdayList =
    window.weekdays === undefined ? DEFAULT_SCHEDULE_WINDOW.weekdays : sanitizeWeekdays(window.weekdays);
  return {
    weekdays: weekdayList,
    start: typeof window.start === 'string' && window.start.trim() ? window.start : DEFAULT_SCHEDULE_WINDOW.start,
    end: typeof window.end === 'string' && window.end.trim() ? window.end : DEFAULT_SCHEDULE_WINDOW.end,
    overnight: Boolean(window.overnight),
  };
}

export function sanitizeExceptions(exceptions: DateException[] | undefined): DateException[] {
  if (!exceptions) return [];
  return exceptions
    .filter((item) => typeof item?.date === 'string' && item.date.trim().length > 0)
    .map((item) => ({
      date: item.date,
      closed: Boolean(item.closed),
      start: item.start,
      end: item.end,
    }));
}

export function normalizeSchedulerData(data?: Partial<SchedulerNodeData> | null): SchedulerNodeData {
  const mode: SchedulerMode = data?.mode === 'bitrix' ? 'bitrix' : 'custom';
  const baseCustom: CustomSchedule = {
    timezone: typeof data?.custom?.timezone === 'string' ? data.custom.timezone : DEFAULT_TIMEZONE,
    windows:
      data?.custom?.windows && data.custom.windows.length > 0
        ? data.custom.windows.map((window) => sanitizeTimeWindow(window))
        : [sanitizeTimeWindow(undefined)],
    exceptions: sanitizeExceptions(data?.custom?.exceptions),
  };
  return {
    mode,
    custom: mode === 'custom' ? baseCustom : data?.custom ?? baseCustom,
    inWindowTargetId: typeof data?.inWindowTargetId === 'string' ? data.inWindowTargetId : null,
    outOfWindowTargetId: typeof data?.outOfWindowTargetId === 'string' ? data.outOfWindowTargetId : null,
  };
}

export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMenuOption(index: number, overrides: Partial<MenuOption> = {}): MenuOption {
  return {
    id: overrides.id ?? createId(`menu-${index + 1}`),
    label: overrides.label ?? `Opción ${index + 1}`,
    value: overrides.value,
    targetId: overrides.targetId ?? null,
  };
}

export function createButtonOption(index: number, overrides: Partial<ButtonOption> = {}): ButtonOption {
  const baseValue = `BTN_${index + 1}`;
  return {
    id: overrides.id ?? createId(`btn-${index + 1}`),
    label: overrides.label ?? `Botón ${index + 1}`,
    value: overrides.value ?? baseValue,
    targetId: overrides.targetId ?? null,
  };
}

export function normalizeButtonsData(data?: Partial<ButtonsActionData> | null): ButtonsActionData {
  const items = (data?.items ?? []).map((item, idx) => ({
    ...createButtonOption(idx, item),
  }));
  const ensuredItems = items.length > 0 ? items : [createButtonOption(0)];
  const maxButtons = data?.maxButtons ?? DEFAULT_BUTTON_LIMIT;
  const moreTargetId = data?.moreTargetId ?? null;
  return { items: ensuredItems, maxButtons, moreTargetId };
}

export function convertButtonsOverflowToList(
  flow: Flow,
  nodeId: string,
): { nextFlow: Flow; listNodeId: string | null } {
  const source = flow.nodes[nodeId];
  if (!source || source.action?.kind !== 'buttons') {
    return { nextFlow: flow, listNodeId: null };
  }
  const normalized = normalizeButtonsData(source.action.data as Partial<ButtonsActionData> | undefined);
  if (normalized.items.length <= normalized.maxButtons) {
    return { nextFlow: flow, listNodeId: null };
  }
  const overflowItems = normalized.items.slice(normalized.maxButtons);
  if (overflowItems.length === 0) {
    return { nextFlow: flow, listNodeId: null };
  }
  const next: Flow = JSON.parse(JSON.stringify(flow));
  const target = next.nodes[nodeId];
  if (!target || target.action?.kind !== 'buttons') {
    return { nextFlow: flow, listNodeId: null };
  }
  const listNodeId = nextChildId(next, nodeId);
  const listOptions = overflowItems.map((item, idx) =>
    createMenuOption(idx, { label: item.label, value: item.value, targetId: item.targetId ?? null }),
  );
  const listNode: FlowNode = {
    id: listNodeId,
    label: `${target.label} · Lista`,
    type: 'menu',
    children: listOptions.map((option) => option.targetId).filter((id): id is string => Boolean(id)),
    menuOptions: listOptions,
  } as FlowNode;
  next.nodes[listNodeId] = listNode;
  const trimmedItems = normalized.items.slice(0, normalized.maxButtons);
  target.action = {
    ...target.action,
    data: { ...normalized, items: trimmedItems, moreTargetId: listNodeId },
  } as FlowAction;
  target.children = Array.from(new Set([...(target.children ?? []), listNodeId, ...listNode.children]));
  return { nextFlow: normalizeFlow(next), listNodeId };
}

export function getMenuOptions(node: FlowNode): MenuOption[] {
  if (node.type !== 'menu') return [];
  const options = node.menuOptions && node.menuOptions.length > 0 ? node.menuOptions : [createMenuOption(0)];
  return options.map((option, idx) => ({
    ...createMenuOption(idx, option),
  }));
}

export function getButtonsData(node: FlowNode): ButtonsActionData | null {
  if (node.action?.kind !== 'buttons') return null;
  return normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
}

export function getAskData(node: FlowNode): AskActionData | null {
  if (node.action?.kind !== 'ask') return null;
  const data = node.action.data ?? {};
  const questionText = typeof data.questionText === 'string' ? data.questionText : '¿Cuál es tu respuesta?';
  const varName = typeof data.varName === 'string' && data.varName.trim() ? data.varName : 'respuesta';
  const varType = data.varType === 'number' || data.varType === 'option' ? data.varType : 'text';
  const validation: AskActionData['validation'] = data.validation ?? { type: 'none' };
  const retryMessage =
    typeof data.retryMessage === 'string' && data.retryMessage.trim()
      ? data.retryMessage
      : 'Lo siento, ¿puedes intentarlo de nuevo?';
  const answerTargetId = typeof data.answerTargetId === 'string' ? data.answerTargetId : null;
  const invalidTargetId = typeof data.invalidTargetId === 'string' ? data.invalidTargetId : null;
  return {
    questionText,
    varName,
    varType,
    validation,
    retryMessage,
    answerTargetId,
    invalidTargetId,
  };
}

export function getSchedulerData(node: FlowNode): SchedulerNodeData | null {
  if (node.action?.kind !== 'scheduler') return null;
  const data = node.action.data as Partial<SchedulerNodeData> | undefined;
  return normalizeSchedulerData(data ?? undefined);
}

function sanitizeKeywordGroup(index: number, raw: Partial<ValidationKeywordGroup> | undefined): ValidationKeywordGroup {
  const fallbackId = createId(`kw-group-${index + 1}`);
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id : fallbackId;
  const mode = raw?.mode === 'exact' ? 'exact' : 'contains';
  const keywords = Array.isArray(raw?.keywords)
    ? raw!.keywords.map((kw) => (typeof kw === 'string' ? kw.trim() : '')).filter((kw) => kw.length > 0)
    : [];
  const label = typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;
  return { id, mode, keywords, label };
}

export function getConditionData(node: FlowNode): ConditionActionData | null {
  if (node.action?.kind !== 'condition') return null;
  const data = node.action.data as Partial<ConditionActionData> | undefined;

  if (!data) {
    return {
      rules: [],
      matchMode: 'any',
      defaultTargetId: null,
      bitrixConfig: undefined,
      keywordGroups: [],
      keywordGroupLogic: 'or',
      matchTargetId: null,
      noMatchTargetId: null,
      errorTargetId: null,
    };
  }

  return {
    rules: Array.isArray(data.rules) ? data.rules : [],
    matchMode: data.matchMode === 'all' ? 'all' : 'any',
    defaultTargetId: typeof data.defaultTargetId === 'string' ? data.defaultTargetId : null,
    bitrixConfig: sanitizeBitrixConfig(data.bitrixConfig),
    keywordGroups: Array.isArray(data.keywordGroups)
      ? data.keywordGroups.map((group, index) => sanitizeKeywordGroup(index, group))
      : [],
    keywordGroupLogic: data.keywordGroupLogic === 'and' ? 'and' : 'or',
    matchTargetId: typeof data.matchTargetId === 'string' ? data.matchTargetId : null,
    noMatchTargetId: typeof data.noMatchTargetId === 'string' ? data.noMatchTargetId : null,
    errorTargetId: typeof data.errorTargetId === 'string' ? data.errorTargetId : null,
  };
}

export function getValidationData(node: FlowNode): ValidationActionData | null {
  if (node.action?.kind !== 'validation') return null;
  const data = node.action.data as Partial<ValidationActionData> | undefined;

  if (!data) {
    return {
      validationType: 'keywords',
      keywordGroups: [],
      validTargetId: null,
      invalidTargetId: null,
      noMatchTargetId: null,
    };
  }

  return {
    validationType: data.validationType ?? 'keywords',
    keywordGroups: Array.isArray(data.keywordGroups)
      ? data.keywordGroups.map((group: any, index: number) => sanitizeKeywordGroup(index, group))
      : [],
    validTargetId: typeof data.validTargetId === 'string' ? data.validTargetId : null,
    invalidTargetId: typeof data.invalidTargetId === 'string' ? data.invalidTargetId : null,
    noMatchTargetId: typeof data.noMatchTargetId === 'string' ? data.noMatchTargetId : null,
    formatType: data.formatType,
    groupTargetIds: data.groupTargetIds,
  };
}

export function normalizeNode(node: FlowNode): FlowNode {
  let changed = false;
  let next: FlowNode = node;

  if (node.type === 'menu') {
    const rawOptions = node.menuOptions ?? [];
    const options = rawOptions.length > 0 ? rawOptions : [createMenuOption(0)];
    const normalizedOptions = options.map((option, idx) => ({
      ...createMenuOption(idx, option),
    }));
    const normalizedChildren = normalizedOptions
      .map((option) => option.targetId)
      .filter((targetId): targetId is string => Boolean(targetId));
    const childrenChanged =
      normalizedChildren.length !== (node.children?.length ?? 0) ||
      normalizedChildren.some((id, idx) => node.children?.[idx] !== id);
    if (childrenChanged || normalizedOptions.some((option, idx) => option !== rawOptions[idx])) {
      next = {
        ...next,
        menuOptions: normalizedOptions,
        children: normalizedChildren,
      };
      changed = true;
    }
  }

  if (node.action?.kind === 'buttons') {
    const normalized = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
    const prevData = node.action.data as ButtonsActionData | undefined;
    const changedButtons =
      !prevData ||
      normalized.items.length !== prevData.items.length ||
      normalized.items.some((item, idx) => {
        const prev = prevData.items[idx];
        return !prev || prev.id !== item.id || prev.targetId !== item.targetId;
      }) ||
      normalized.maxButtons !== (prevData?.maxButtons ?? DEFAULT_BUTTON_LIMIT) ||
      normalized.moreTargetId !== (prevData?.moreTargetId ?? null);
    const derivedChildren = Array.from(
      new Set([
        ...(normalized.items.map((item) => item.targetId).filter((id): id is string => Boolean(id)) ?? []),
        ...(normalized.moreTargetId ? [normalized.moreTargetId] : []),
      ]),
    );
    const currentChildren = next.children ?? [];
    const childrenChanged =
      derivedChildren.length !== currentChildren.length ||
      derivedChildren.some((id, idx) => currentChildren[idx] !== id);
    if (changedButtons || childrenChanged) {
      next = {
        ...next,
        action: changedButtons ? ({ ...next.action, data: normalized } as FlowAction) : next.action,
        children: derivedChildren,
      };
      changed = true;
    }
  }

  if (node.action?.kind === 'scheduler') {
    const data = node.action.data as Partial<SchedulerNodeData> | undefined;
    const normalized = normalizeSchedulerData(data ?? undefined);
    const childSet = new Set(next.children ?? []);
    if (normalized.inWindowTargetId) childSet.add(normalized.inWindowTargetId);
    if (normalized.outOfWindowTargetId) childSet.add(normalized.outOfWindowTargetId);
    const childList = Array.from(childSet);
    const dataChanged =
      (data?.mode === 'bitrix' ? 'bitrix' : 'custom') !== normalized.mode ||
      (normalized.custom?.timezone ?? DEFAULT_TIMEZONE) !==
        (typeof data?.custom?.timezone === 'string' ? data.custom.timezone : DEFAULT_TIMEZONE) ||
      JSON.stringify((data?.custom?.windows ?? []).map((window) => sanitizeTimeWindow(window))) !==
        JSON.stringify(normalized.custom?.windows ?? []) ||
      JSON.stringify(sanitizeExceptions(data?.custom?.exceptions)) !==
        JSON.stringify(normalized.custom?.exceptions ?? []) ||
      (typeof data?.inWindowTargetId === 'string' ? data.inWindowTargetId : null) !== normalized.inWindowTargetId ||
      (typeof data?.outOfWindowTargetId === 'string' ? data.outOfWindowTargetId : null) !== normalized.outOfWindowTargetId;
    const childrenChanged =
      childList.length !== (node.children?.length ?? 0) ||
      childList.some((id, idx) => node.children?.[idx] !== id);
    if (dataChanged || childrenChanged) {
      next = {
        ...next,
        action: { ...next.action, data: normalized } as FlowAction,
        children: childList,
      };
      changed = true;
    }
  }

  if (node.action?.kind === 'condition') {
    const normalized = getConditionData(node);
    if (normalized) {
      const childSet = new Set(next.children ?? []);
      if (normalized.matchTargetId) childSet.add(normalized.matchTargetId);
      if (normalized.noMatchTargetId) childSet.add(normalized.noMatchTargetId);
      if (normalized.errorTargetId) childSet.add(normalized.errorTargetId);
      if (normalized.defaultTargetId) childSet.add(normalized.defaultTargetId);
      const childList = Array.from(childSet);
      const currentData = node.action.data as Partial<ConditionActionData> | undefined;
      const normalizedData: ConditionActionData = {
        ...normalized,
        rules: Array.isArray(normalized.rules) ? normalized.rules : [],
      };
      const dataChanged = JSON.stringify(currentData ?? null) !== JSON.stringify(normalizedData);
      const childrenChanged =
        childList.length !== (next.children?.length ?? 0) ||
        childList.some((id, idx) => next.children?.[idx] !== id);
      if (dataChanged || childrenChanged) {
        next = {
          ...next,
          action: { ...next.action, data: normalizedData } as FlowAction,
          children: childList,
        };
        changed = true;
      }
    }
  }

  if (node.action?.kind === 'ask') {
    const normalized = getAskData(node);
    if (normalized) {
      const prevData = node.action.data as Partial<AskActionData> | undefined;
      const dataChanged =
        !prevData ||
        prevData.questionText !== normalized.questionText ||
        prevData.varName !== normalized.varName ||
        prevData.varType !== normalized.varType ||
        JSON.stringify(prevData.validation ?? null) !== JSON.stringify(normalized.validation ?? null) ||
        prevData.retryMessage !== normalized.retryMessage ||
        prevData.answerTargetId !== normalized.answerTargetId ||
        prevData.invalidTargetId !== normalized.invalidTargetId;
      const childSet = new Set(next.children ?? []);
      if (normalized.answerTargetId) childSet.add(normalized.answerTargetId);
      if (normalized.invalidTargetId) childSet.add(normalized.invalidTargetId);
      const childList = Array.from(childSet);
      const childrenChanged =
        childList.length !== (next.children?.length ?? 0) ||
        childList.some((id, idx) => next.children?.[idx] !== id);
      if (dataChanged || childrenChanged) {
        next = {
          ...next,
          action: { ...next.action, data: normalized } as FlowAction,
          children: childList,
        };
        changed = true;
      }
    }
  }

  if (node.action?.kind === 'attachment') {
    const data = node.action.data ?? {};
    const normalized = {
      attType: typeof data.attType === 'string' ? data.attType : 'image',
      url: typeof data.url === 'string' ? data.url : '',
      name: typeof data.name === 'string' ? data.name : 'archivo',
      fileName: typeof data.fileName === 'string' ? data.fileName : '',
      mimeType: typeof data.mimeType === 'string' ? data.mimeType : '',
      fileSize: typeof data.fileSize === 'number' ? data.fileSize : 0,
      fileData: typeof data.fileData === 'string' ? data.fileData : '',
    };
    const needsUpdate =
      normalized.attType !== data.attType ||
      normalized.url !== data.url ||
      normalized.name !== data.name ||
      normalized.fileName !== data.fileName ||
      normalized.mimeType !== data.mimeType ||
      normalized.fileSize !== data.fileSize ||
      normalized.fileData !== data.fileData;
    if (needsUpdate) {
      next = { ...next, action: { ...node.action, data: normalized } as FlowAction };
      changed = true;
    }
  }

  if (node.action?.kind === 'end') {
    const data = node.action.data ?? {};
    const normalized = { note: typeof data.note === 'string' ? data.note : '' };
    if (normalized.note !== data.note) {
      next = { ...next, action: { ...node.action, data: normalized } as FlowAction };
      changed = true;
    }
  }

  return changed ? next : node;
}

export function normalizeFlow(flow: Flow): Flow {
  let mutated = false;
  const nodes: Record<string, FlowNode> = {};
  for (const [id, node] of Object.entries(flow.nodes)) {
    const normalized = normalizeNode(node);
    nodes[id] = normalized;
    if (normalized !== node) mutated = true;
  }
  const version = typeof flow.version === 'number' ? flow.version : 1;
  if (!mutated && version === flow.version) return flow;
  return { ...flow, version, nodes };
}

export function applyHandleAssignment(
  flow: Flow,
  sourceId: string,
  handleId: string,
  targetId: string | null,
): boolean {
  const node = flow.nodes[sourceId];
  if (!node) return false;

  if (node.type === 'menu' && handleId.startsWith('out:menu:')) {
    const options = getMenuOptions(node);
    const index = options.findIndex((option) => `out:menu:${option.id}` === handleId);
    if (index === -1) return false;
    const current = options[index].targetId ?? null;
    if (current === targetId) return false;
    options[index] = { ...options[index], targetId };
    node.menuOptions = options;
    const children = new Set<string>();
    for (const option of options) {
      if (option.targetId) {
        children.add(option.targetId);
      }
    }
    node.children = Array.from(children);
    return true;
  }

  if (node.action?.kind === 'buttons' && handleId.startsWith('out:button:')) {
    const data = normalizeButtonsData(node.action.data as Partial<ButtonsActionData> | undefined);
    const token = handleId.split(':')[2];
    if (!token) return false;
    if (token === 'more') {
      const current = data.moreTargetId ?? null;
      if (current === targetId) return false;
      data.moreTargetId = targetId;
    } else {
      const index = data.items.findIndex((item) => item.id === token);
      if (index === -1) return false;
      const current = data.items[index].targetId ?? null;
      if (current === targetId) return false;
      data.items[index] = { ...data.items[index], targetId };
    }
    node.action = { ...node.action, data } as FlowAction;
    const children = new Set<string>();
    for (const item of data.items) {
      if (item.targetId) {
        children.add(item.targetId);
      }
    }
    if (data.moreTargetId) {
      children.add(data.moreTargetId);
    }
    node.children = Array.from(children);
    return true;
  }

  if (node.action?.kind === 'ask') {
    const ask = getAskData(node);
    if (!ask) return false;
    const updated: AskActionData = { ...ask };
    if (handleId === 'out:answer') {
      if (updated.answerTargetId === targetId) return false;
      updated.answerTargetId = targetId;
    } else if (handleId === 'out:invalid') {
      if (updated.invalidTargetId === targetId) return false;
      updated.invalidTargetId = targetId;
    } else {
      return false;
    }
    node.action = { ...node.action, data: updated } as FlowAction;
    const children = new Set<string>();
    if (updated.answerTargetId) children.add(updated.answerTargetId);
    if (updated.invalidTargetId) children.add(updated.invalidTargetId);
    node.children = Array.from(children);
    return true;
  }

  if (node.action?.kind === 'scheduler') {
    const scheduler = getSchedulerData(node);
    if (!scheduler) return false;
    const updated: SchedulerNodeData = { ...scheduler };
    if (handleId === 'out:schedule:in') {
      if (updated.inWindowTargetId === targetId) return false;
      updated.inWindowTargetId = targetId;
    } else if (handleId === 'out:schedule:out') {
      if (updated.outOfWindowTargetId === targetId) return false;
      updated.outOfWindowTargetId = targetId;
    } else {
      return false;
    }
    node.action = { ...node.action, data: updated } as FlowAction;
    const childSet = new Set(node.children ?? []);
    if (updated.inWindowTargetId) childSet.add(updated.inWindowTargetId);
    if (updated.outOfWindowTargetId) childSet.add(updated.outOfWindowTargetId);
    node.children = Array.from(childSet);
    return true;
  }

  if (node.action?.kind === 'validation') {
    const validation = getValidationData(node);
    if (!validation) return false;
    const updated: ValidationActionData = { ...validation };

    // Handle keyword group connections
    if (handleId.startsWith('out:validation:group:')) {
      const groupId = handleId.split(':')[3];
      if (!groupId) return false;
      const groupTargetIds = { ...(updated.groupTargetIds || {}) };
      if (groupTargetIds[groupId] === targetId) return false;
      groupTargetIds[groupId] = targetId;
      updated.groupTargetIds = groupTargetIds;
    }
    // Handle "No coincide" connection
    else if (handleId === 'out:validation:nomatch') {
      if (updated.noMatchTargetId === targetId) return false;
      updated.noMatchTargetId = targetId;
    } else {
      return false;
    }

    node.action = { ...node.action, data: updated } as FlowAction;
    const childSet = new Set(node.children ?? []);
    Object.values(updated.groupTargetIds || {}).forEach(id => {
      if (id) childSet.add(id);
    });
    if (updated.noMatchTargetId) childSet.add(updated.noMatchTargetId);
    node.children = Array.from(childSet);
    return true;
  }

  if (node.action?.kind === 'condition') {
    const condition = getConditionData(node);
    if (!condition) return false;
    const updated: ConditionActionData = { ...condition };
    if (handleId === 'out:validation:match') {
      if (updated.matchTargetId === targetId) return false;
      updated.matchTargetId = targetId;
    } else if (handleId === 'out:validation:nomatch') {
      if (updated.noMatchTargetId === targetId) return false;
      updated.noMatchTargetId = targetId;
    } else if (handleId === 'out:validation:error') {
      if (updated.errorTargetId === targetId) return false;
      updated.errorTargetId = targetId;
    } else if (handleId === 'out:default') {
      if (updated.defaultTargetId === targetId) return false;
      updated.defaultTargetId = targetId;
    } else {
      return false;
    }
    node.action = { ...node.action, data: updated } as FlowAction;
    const childSet = new Set(node.children ?? []);
    if (updated.matchTargetId) childSet.add(updated.matchTargetId);
    if (updated.noMatchTargetId) childSet.add(updated.noMatchTargetId);
    if (updated.errorTargetId) childSet.add(updated.errorTargetId);
    if (updated.defaultTargetId) childSet.add(updated.defaultTargetId);
    node.children = Array.from(childSet);
    return true;
  }

  if (handleId === 'out:default') {
    const current = node.children?.[0] ?? null;
    if (current === targetId) return false;
    node.children = targetId ? [targetId] : [];
    return true;
  }

  if (!targetId) {
    return false;
  }

  const existing = new Set(node.children ?? []);
  if (existing.has(targetId)) return false;
  existing.add(targetId);
  node.children = Array.from(existing);
  return true;
}

export type HandleSpec = {
  id: string;
  label: string;
  side: 'left' | 'right';
  type: 'input' | 'output';
  order: number;
  variant?: 'default' | 'more' | 'invalid' | 'answer' | 'success' | 'warning' | 'fallback';
};

export const INPUT_HANDLE_SPEC: HandleSpec = {
  id: 'in',
  label: 'Entrada',
  side: 'left',
  type: 'input',
  order: 0,
  variant: 'default',
};

export function getOutputHandleSpecs(node: FlowNode): HandleSpec[] {
  if (node.type === 'start' || node.action?.kind === 'start') {
    return [
      {
        id: 'out:default',
        label: 'Iniciar',
        side: 'right',
        type: 'output',
        order: 0,
        variant: 'default',
      },
    ];
  }
  if (node.type === 'menu') {
    return getMenuOptions(node).map((option, idx) => ({
      id: `out:menu:${option.id}`,
      label: option.label,
      side: 'right',
      type: 'output',
      order: idx,
      variant: 'default',
    }));
  }
  const buttons = getButtonsData(node);
  if (buttons) {
    const visible = buttons.items.slice(0, buttons.maxButtons);
    const handles: HandleSpec[] = visible.map((item, idx) => ({
      id: `out:button:${item.id}`,
      label: item.label,
      side: 'right',
      type: 'output',
      order: idx,
      variant: 'default',
    }));
    if (buttons.items.length > visible.length) {
      handles.push({
        id: 'out:button:more',
        label: 'Lista',
        side: 'right',
        type: 'output',
        order: handles.length,
        variant: 'more',
      });
    }
    return handles;
  }
  const ask = getAskData(node);
  if (ask) {
    return [
      { id: 'out:answer', label: 'Respuesta', side: 'right', type: 'output', order: 0, variant: 'answer' },
      { id: 'out:invalid', label: 'On invalid', side: 'right', type: 'output', order: 1, variant: 'invalid' },
    ];
  }
  const scheduler = getSchedulerData(node);
  if (scheduler) {
    return [
      { id: 'out:schedule:in', label: 'Dentro de horario', side: 'right', type: 'output', order: 0, variant: 'default' },
      { id: 'out:schedule:out', label: 'Fuera de horario', side: 'right', type: 'output', order: 1, variant: 'default' },
    ];
  }
  const validation = getValidationData(node);
  if (validation) {
    const handles: HandleSpec[] = [];

    // Add a handle for each keyword group
    if (validation.keywordGroups && validation.keywordGroups.length > 0) {
      validation.keywordGroups.forEach((group: ValidationKeywordGroup, idx: number) => {
        handles.push({
          id: `out:validation:group:${group.id}`,
          label: group.label || `Grupo ${idx + 1}`,
          side: 'right',
          type: 'output',
          order: idx,
          variant: 'success',
        });
      });
    }

    // Add "No coincide" handle
    handles.push({
      id: 'out:validation:nomatch',
      label: 'No coincide',
      side: 'right',
      type: 'output',
      order: handles.length,
      variant: 'warning',
    });

    return handles;
  }
  const condition = getConditionData(node);
  if (condition) {
    return [
      { id: 'out:validation:match', label: 'Coincide', side: 'right', type: 'output', order: 0, variant: 'success' },
      { id: 'out:validation:nomatch', label: 'Sin coincidencia', side: 'right', type: 'output', order: 1, variant: 'warning' },
      { id: 'out:validation:error', label: 'Error', side: 'right', type: 'output', order: 2, variant: 'invalid' },
      { id: 'out:default', label: 'Fallback', side: 'right', type: 'output', order: 3, variant: 'fallback' },
    ];
  }
  if (node.action?.kind === 'end') {
    return [];
  }
  return [
    { id: 'out:default', label: 'Siguiente', side: 'right', type: 'output', order: 0, variant: 'default' },
  ];
}

export function getHandleAssignments(node: FlowNode): Record<string, string | null> {
  if (node.type === 'menu') {
    const assignments: Record<string, string | null> = {};
    getMenuOptions(node).forEach((option) => {
      assignments[`out:menu:${option.id}`] = option.targetId ?? null;
    });
    return assignments;
  }
  const buttons = getButtonsData(node);
  if (buttons) {
    const assignments: Record<string, string | null> = {};
    const visible = buttons.items.slice(0, buttons.maxButtons);
    visible.forEach((item) => {
      assignments[`out:button:${item.id}`] = item.targetId ?? null;
    });
    if (buttons.items.length > visible.length) {
      assignments['out:button:more'] = buttons.moreTargetId ?? null;
    }
    return assignments;
  }
  const ask = getAskData(node);
  if (ask) {
    return {
      'out:answer': ask.answerTargetId ?? null,
      'out:invalid': ask.invalidTargetId ?? null,
    };
  }
  const scheduler = getSchedulerData(node);
  if (scheduler) {
    return {
      'out:schedule:in': scheduler.inWindowTargetId ?? null,
      'out:schedule:out': scheduler.outOfWindowTargetId ?? null,
    };
  }
  const validation = getValidationData(node);
  if (validation) {
    const assignments: Record<string, string | null> = {};

    // Assign each keyword group to its target
    if (validation.keywordGroups && validation.keywordGroups.length > 0) {
      validation.keywordGroups.forEach((group: ValidationKeywordGroup) => {
        const targetId = validation.groupTargetIds?.[group.id] ?? null;
        assignments[`out:validation:group:${group.id}`] = targetId;
      });
    }

    // Assign "No coincide" handle
    assignments['out:validation:nomatch'] = validation.noMatchTargetId ?? null;

    return assignments;
  }
  const condition = getConditionData(node);
  if (condition) {
    return {
      'out:validation:match': condition.matchTargetId ?? null,
      'out:validation:nomatch': condition.noMatchTargetId ?? null,
      'out:validation:error': condition.errorTargetId ?? null,
      'out:default': condition.defaultTargetId ?? null,
    };
  }
  return { 'out:default': node.children?.[0] ?? null };
}

export function nextChildId(flow: Flow, parentId: string): string {
  const parent = flow.nodes[parentId];
  if (!parent) {
    return createId('node');
  }
  const siblings = parent.children ?? [];
  let maxIdx = 0;
  for (const sid of siblings) {
    const tail = sid.split('.').pop();
    const n = Number(tail);
    if (!Number.isNaN(n)) maxIdx = Math.max(maxIdx, n);
  }
  const next = maxIdx + 1;
  return parentId === flow.rootId ? String(next) : `${parentId}.${next}`;
}

export type ConnectionCreationKind =
  | 'menu'
  | 'message'
  | 'buttons'
  | 'question'
  | 'condition'
  | 'validation'
  | 'validation_bitrix'
  | 'attachment'
  | 'webhook_out'
  | 'webhook_in'
  | 'transfer'
  | 'handoff'
  | 'scheduler'
  | 'delay'
  | 'ia_rag'
  | 'ia_agent'
  | 'tool'
  | 'bitrix_crm'
  | 'bitrix_create'
  | 'end';

export const STRICTEST_LIMIT = CHANNEL_BUTTON_LIMITS.reduce(
  (best, entry) => (entry.max < best.max ? entry : best),
  CHANNEL_BUTTON_LIMITS[0],
);
const DEFAULT_BITRIX_ENTITY: Required<NonNullable<ConditionActionData['bitrixConfig']>>['entityType'] = 'lead';
const DEFAULT_BITRIX_IDENTIFIER = 'PHONE';
const DEFAULT_BITRIX_FIELDS = ['NAME', 'LAST_NAME'];

function sanitizeBitrixConfig(
  config: ConditionActionData['bitrixConfig'] | undefined,
): ConditionActionData['bitrixConfig'] | undefined {
  if (!config) {
    return undefined;
  }

  const entityType: NonNullable<ConditionActionData['bitrixConfig']>['entityType'] =
    config.entityType === 'deal' ||
    config.entityType === 'contact' ||
    config.entityType === 'company'
      ? config.entityType
      : DEFAULT_BITRIX_ENTITY;

  const identifierField =
    typeof config.identifierField === 'string' && config.identifierField.trim()
      ? config.identifierField.trim().toUpperCase()
      : DEFAULT_BITRIX_IDENTIFIER;

  const fields = Array.isArray(config.fieldsToCheck)
    ? config.fieldsToCheck
        .map((field) => (typeof field === 'string' ? field.trim().toUpperCase() : ''))
        .filter((field): field is string => field.length > 0)
    : [];

  const deduped = Array.from(new Set(fields));
  const safeFields = deduped.length > 0 ? deduped : [...DEFAULT_BITRIX_FIELDS];

  return {
    entityType,
    identifierField,
    fieldsToCheck: safeFields,
  };
}
