export type ShellStreamEvent =
  | { type: 'run.started'; runId: string; sessionId?: string | null; upstreamRunId?: string | null }
  | { type: 'run.status'; runId: string; status: string; sessionId?: string | null; upstreamRunId?: string | null }
  | { type: 'response.thinking.delta'; runId: string; delta: string; upstreamRunId?: string | null }
  | { type: 'response.output_text.delta'; runId: string; delta: string; upstreamRunId?: string | null }
  | {
    type: 'timeline.event';
    runId: string;
    role: 'tool' | 'assistant' | 'system';
    kind: 'tool_call' | 'tool_result' | 'reasoning' | 'status';
    text?: string;
    toolName?: string | null;
    toolCallId?: string | null;
    toolStatus?: 'running' | 'done' | 'error' | null;
    metadata?: Record<string, unknown>;
    upstreamRunId?: string | null;
  }
  | { type: 'run.completed'; runId: string; status: 'completed' | 'error' | 'cancelled'; error?: string; upstreamRunId?: string | null }
  | { type: 'response.error'; runId: string; delta: string; upstreamRunId?: string | null };

interface NormalizeIds {
  runId: string;
  upstreamRunId?: string | null;
  sessionId?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function firstString(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function eventType(raw: Record<string, unknown>): string {
  return firstString(raw, ['type', 'event', 'name']).toLowerCase();
}

function callId(raw: Record<string, unknown>): string | null {
  return firstString(raw, ['toolCallId', 'tool_call_id', 'call_id', 'id']) || null;
}

function toolName(raw: Record<string, unknown>): string | null {
  return firstString(raw, ['toolName', 'tool_name', 'name']) || null;
}

function metadata(raw: Record<string, unknown>): Record<string, unknown> {
  const input = raw.input ?? raw.arguments ?? raw.args;
  const output = raw.output ?? raw.result;
  return { raw, input, output };
}

export function normalizeGatewayEvent(
  value: unknown,
  ids: NormalizeIds
): ShellStreamEvent | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const type = eventType(raw);
  const upstreamRunId = ids.upstreamRunId ?? null;
  const delta = firstString(raw, ['delta', 'text', 'content', 'message']);
  const error = firstString(raw, ['error', 'message', 'detail']);

  if (type === 'run.started') {
    return { type: 'run.started', runId: ids.runId, sessionId: ids.sessionId ?? null, upstreamRunId };
  }

  if (type === 'run.completed' || type === 'response.completed' || type === 'completed') {
    return { type: 'run.completed', runId: ids.runId, status: 'completed', upstreamRunId };
  }

  if (type === 'run.failed' || type === 'run.error' || type === 'response.error' || type === 'error') {
    return { type: 'response.error', runId: ids.runId, delta: error || 'Gateway run failed', upstreamRunId };
  }

  if (type === 'response.output_text.delta' || type === 'output_text.delta' || type === 'message.delta') {
    return delta ? { type: 'response.output_text.delta', runId: ids.runId, delta, upstreamRunId } : null;
  }

  if (type === 'reasoning.delta' || type === 'response.thinking.delta' || type === 'thinking.delta') {
    return delta ? { type: 'response.thinking.delta', runId: ids.runId, delta, upstreamRunId } : null;
  }

  if (type === 'tool.started' || type === 'tool_call.started' || type === 'tool.call.started') {
    return {
      type: 'timeline.event',
      runId: ids.runId,
      role: 'tool',
      kind: 'tool_call',
      text: delta,
      toolName: toolName(raw),
      toolCallId: callId(raw),
      toolStatus: 'running',
      metadata: metadata(raw),
      upstreamRunId,
    };
  }

  if (type === 'tool.completed' || type === 'tool_result.completed' || type === 'tool.result.completed') {
    return {
      type: 'timeline.event',
      runId: ids.runId,
      role: 'tool',
      kind: 'tool_result',
      text: delta,
      toolName: toolName(raw),
      toolCallId: callId(raw),
      toolStatus: 'done',
      metadata: metadata(raw),
      upstreamRunId,
    };
  }

  if (type === 'tool.error' || type === 'tool_result.error' || type === 'tool.result.error') {
    return {
      type: 'timeline.event',
      runId: ids.runId,
      role: 'tool',
      kind: 'tool_result',
      text: error || delta,
      toolName: toolName(raw),
      toolCallId: callId(raw),
      toolStatus: 'error',
      metadata: metadata(raw),
      upstreamRunId,
    };
  }

  return null;
}
