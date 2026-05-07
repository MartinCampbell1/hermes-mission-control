import type { Message, MessageKind, MessageRole, ToolStatus } from '../../../../entities/message';

export interface LiveTimelineState {
  runId: string | null;
  status: string;
  assistantText: string;
  thinkingText: string;
  events: Message[];
  error: string | null;
}

export const initialLiveTimelineState: LiveTimelineState = {
  runId: null,
  status: '',
  assistantText: '',
  thinkingText: '',
  events: [],
  error: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function stringValue(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' ? value : null;
}

function bindRunId(state: LiveTimelineState, event: Record<string, unknown>): LiveTimelineState | null {
  const incomingRunId = stringValue(event, 'runId');
  if (!state.runId && incomingRunId) return { ...state, runId: incomingRunId };
  if (state.runId && incomingRunId && incomingRunId !== state.runId) return null;
  return state;
}

function makeTimelineMessage(event: Record<string, unknown>, index: number): Message {
  const kind = (stringValue(event, 'kind') || 'status') as MessageKind;
  const role = (stringValue(event, 'role') || (kind === 'reasoning' ? 'assistant' : 'tool')) as MessageRole;
  const toolCallId = stringValue(event, 'toolCallId');
  const syntheticId = [
    'live',
    stringValue(event, 'runId') || 'run',
    kind,
    toolCallId || index,
  ].join(':');

  return {
    _id: syntheticId,
    conversationId: '',
    text: stringValue(event, 'text') || '',
    thinking: kind === 'reasoning' ? stringValue(event, 'text') || '' : null,
    files: [],
    role,
    kind,
    sourceSessionId: stringValue(event, 'sourceSessionId'),
    toolName: stringValue(event, 'toolName'),
    toolCallId,
    toolStatus: (stringValue(event, 'toolStatus') as ToolStatus) || null,
    finishReason: stringValue(event, 'finishReason'),
    runId: stringValue(event, 'runId'),
    upstreamRunId: stringValue(event, 'upstreamRunId'),
    clientTurnId: stringValue(event, 'clientTurnId'),
    provisional: true,
    metadata: (asRecord(event.metadata) || {}) as Record<string, unknown>,
    hidden: false,
    createdAt: new Date().toISOString(),
  };
}

export function finalizeRunningTools(
  state: LiveTimelineState,
  status: 'completed' | 'error' | 'cancelled' = 'completed'
): LiveTimelineState {
  const terminalStatus: ToolStatus = status === 'error' ? 'error' : 'done';
  return {
    ...state,
    events: state.events.map((event) => (
      event.kind === 'tool_call' && event.toolStatus === 'running'
        ? { ...event, toolStatus: terminalStatus }
        : event
    )),
  };
}

export function reduceLiveTimeline(
  state: LiveTimelineState,
  value: unknown
): LiveTimelineState {
  const event = asRecord(value);
  if (!event) return state;
  const type = stringValue(event, 'type');
  const bound = bindRunId(state, event);
  if (!bound) return state;
  state = bound;

  if (type === 'run.started') {
    return { ...state, status: 'Hermes is starting...' };
  }

  if (type === 'run.status') {
    return { ...state, status: stringValue(event, 'status') || state.status };
  }

  if (type === 'response.output_text.delta') {
    const delta = stringValue(event, 'delta') || '';
    return { ...state, assistantText: state.assistantText + delta, status: '' };
  }

  if (type === 'response.thinking.delta') {
    const delta = stringValue(event, 'delta') || '';
    return {
      ...state,
      thinkingText: state.thinkingText + delta,
      status: 'Hermes is thinking...',
    };
  }

  if (type === 'response.error') {
    return {
      ...state,
      error: stringValue(event, 'delta') || stringValue(event, 'message') || 'Stream error',
      status: '',
    };
  }

  if (type === 'timeline.event') {
    const next = makeTimelineMessage(event, state.events.length);
    if (next.kind === 'tool_call') {
      const existingIndex = state.events.findIndex((item) => (
        item.kind === 'tool_call' &&
        item.toolCallId &&
        item.toolCallId === next.toolCallId
      ));
      if (existingIndex >= 0) {
        const events = [...state.events];
        events[existingIndex] = { ...events[existingIndex], ...next };
        return { ...state, events, status: next.toolName ? `Running tool: ${next.toolName}` : 'Running tool...' };
      }
      return { ...state, events: [...state.events, next], status: next.toolName ? `Running tool: ${next.toolName}` : 'Running tool...' };
    }

    if (next.kind === 'tool_result') {
      const events = state.events.map((item) => (
        item.kind === 'tool_call' &&
        item.toolCallId &&
        item.toolCallId === next.toolCallId
          ? { ...item, toolStatus: next.toolStatus === 'error' ? 'error' : 'done' as ToolStatus }
          : item
      ));
      return { ...state, events: [...events, next], status: next.toolStatus === 'error' ? 'Tool failed.' : 'Tool finished.' };
    }

    return { ...state, events: [...state.events, next] };
  }

  if (type === 'run.completed') {
    const status = (stringValue(event, 'status') || 'completed') as 'completed' | 'error' | 'cancelled';
    return {
      ...finalizeRunningTools(state, status),
      status: status === 'error' ? 'Hermes stopped with an error.' : 'Saving response...',
    };
  }

  return state;
}
