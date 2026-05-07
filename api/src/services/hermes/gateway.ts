import { Response } from 'express';
import { EffectiveSessionSettings } from './chat';
import { normalizeGatewayEvent } from './eventNormalizer';
import { createCliStreamSanitizer } from './streamSanitizer';
import {
  configureSse,
  emitRunCompleted,
  emitRunStarted,
  emitRunStatus,
  writeSse,
} from './runState';

export interface GatewayRunOptions {
  upstream?: string;
  sessionId: string;
  input: string;
  conversationHistory: { role: 'user' | 'assistant' | 'system'; content: string }[];
  settings?: EffectiveSessionSettings;
  runId?: string;
}

export interface GatewayRunResult {
  sessionId: string;
  externalId?: string;
  text: string;
  error?: string;
}

export type SendAdapter = 'dry-run' | 'gateway' | 'cli';

interface GatewayRunStart {
  id?: string;
  run_id?: string;
  session_id?: string;
}

interface GatewayEvent {
  type?: string;
  event?: string;
  delta?: string;
  text?: string;
  content?: string;
  session_id?: string;
  sessionId?: string;
  error?: string;
  message?: string;
}

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8642';

export function shouldUseGatewayAdapter(sessionId: string | null | undefined): boolean {
  const adapterMode =
    process.env.HERMES_API_SESSION_ADAPTER || process.env.HERMES_USE_GATEWAY_FOR_API_SESSIONS;
  const gatewayOptIn = adapterMode === 'gateway' || adapterMode === '1' || adapterMode === 'true';
  return gatewayOptIn && !!sessionId?.startsWith('api-');
}

type GatewayProbe = (opts: {
  upstream?: string;
  sessionId: string | null;
  timeoutMs?: number;
}) => Promise<boolean>;

export async function selectSendAdapter(opts: {
  dryRun: boolean;
  sessionId: string | null | undefined;
  upstream?: string;
  timeoutMs?: number;
  canUseGateway?: GatewayProbe;
}): Promise<SendAdapter> {
  if (opts.dryRun) return 'dry-run';
  const sessionId = opts.sessionId ?? null;
  if (!shouldUseGatewayAdapter(sessionId)) return 'cli';
  const canUseGateway = opts.canUseGateway || canUseGatewayForSession;
  return (await canUseGateway({
    upstream: opts.upstream,
    sessionId,
    timeoutMs: opts.timeoutMs,
  }))
    ? 'gateway'
    : 'cli';
}

function gatewayUrl(opts: GatewayRunOptions): string {
  return (opts.upstream || process.env.HERMES_GATEWAY_URL || process.env.UPSTREAM || DEFAULT_GATEWAY_URL)
    .replace(/\/+$/, '');
}

function parseGatewayEvent(raw: string): GatewayEvent | null {
  if (!raw || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw) as GatewayEvent;
  } catch {
    return null;
  }
}

function splitComma(value: string | null | undefined): string[] | undefined {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function compactSettings(settings: EffectiveSessionSettings | undefined): Record<string, unknown> {
  const body = {
    model: settings?.modelOverride || undefined,
    provider: settings?.providerOverride || undefined,
    skills: splitComma(settings?.skillsOverride),
    toolsets: splitComma(settings?.toolsetsOverride),
    reasoningLevel: settings?.reasoningLevel || undefined,
    thinkingLevel: settings?.thinkingLevel || undefined,
    fastMode: settings?.fastMode ?? undefined,
    verboseLevel: settings?.verboseLevel || undefined,
  };
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null && value !== 'inherit')
  );
}

export async function canUseGatewayForSession(opts: {
  upstream?: string;
  sessionId: string | null;
  timeoutMs?: number;
}): Promise<boolean> {
  if (!shouldUseGatewayAdapter(opts.sessionId)) return false;
  const upstream = (opts.upstream || process.env.HERMES_GATEWAY_URL || process.env.UPSTREAM || DEFAULT_GATEWAY_URL)
    .replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 750;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const path of ['/v1/health', '/health']) {
      try {
        const response = await fetch(`${upstream}${path}`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (response.ok) return true;
      } catch {
        /* try next cheap probe */
      }
    }

    const response = await fetch(upstream, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function pumpGatewayEvents(
  res: Response,
  response: globalThis.Response,
  initialSessionId: string,
  ids: { runId?: string; upstreamRunId?: string | null }
): Promise<GatewayRunResult> {
  const reader = response.body?.getReader();
  if (!reader) return { sessionId: initialSessionId, text: '', error: 'Gateway event stream missing body' };

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let sessionId = initialSessionId;
  let error: string | undefined;
  const localRunId = ids.runId || ids.upstreamRunId || 'gateway-run';
  const outputSanitizer = createCliStreamSanitizer();

  const emitSanitizedOutput = (delta: string): void => {
    const sanitized = outputSanitizer.push(delta);
    if (sanitized.reasoningText) {
      writeSse(res, {
        type: 'response.thinking.delta',
        runId: localRunId,
        delta: sanitized.reasoningText,
        upstreamRunId: ids.upstreamRunId ?? null,
      });
    }
    if (sanitized.outputText) {
      text += sanitized.outputText;
      writeSse(res, {
        type: 'response.output_text.delta',
        runId: localRunId,
        delta: sanitized.outputText,
        upstreamRunId: ids.upstreamRunId ?? null,
      });
    }
  };

  const flushSanitizedOutput = (): void => {
    const sanitized = outputSanitizer.flush();
    if (sanitized.reasoningText) {
      writeSse(res, {
        type: 'response.thinking.delta',
        runId: localRunId,
        delta: sanitized.reasoningText,
        upstreamRunId: ids.upstreamRunId ?? null,
      });
    }
    if (sanitized.outputText) {
      text += sanitized.outputText;
      writeSse(res, {
        type: 'response.output_text.delta',
        runId: localRunId,
        delta: sanitized.outputText,
        upstreamRunId: ids.upstreamRunId ?? null,
      });
    }
  };

  const consumePayload = (payload: string): boolean => {
    if (payload === '[DONE]') return true;
    const event = parseGatewayEvent(payload);
    if (!event) return false;

    const nextSessionId = event.session_id || event.sessionId;
    if (nextSessionId) sessionId = nextSessionId;

    const normalized = normalizeGatewayEvent(event, {
      runId: localRunId,
      upstreamRunId: ids.upstreamRunId ?? null,
      sessionId,
    });
    if (!normalized) return false;

    if (normalized.type === 'response.error') {
      error = normalized.delta || event.error || event.message || 'Gateway run failed';
      writeSse(res, normalized);
      return false;
    }

    if (normalized.type === 'run.completed') {
      return false;
    }

    if (normalized.type === 'response.output_text.delta') {
      emitSanitizedOutput(normalized.delta);
      return false;
    }

    writeSse(res, normalized);
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const payloads = frame
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (payloads.some(consumePayload)) {
        flushSanitizedOutput();
        return { sessionId, text, error };
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const payloads = tail
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    payloads.forEach(consumePayload);
  }

  flushSanitizedOutput();
  return { sessionId, text, error };
}

export async function streamGatewayRun(
  res: Response,
  opts: GatewayRunOptions
): Promise<GatewayRunResult> {
  configureSse(res);
  emitRunStarted(res, { runId: opts.runId, sessionId: opts.sessionId });
  emitRunStatus(res, { runId: opts.runId, sessionId: opts.sessionId }, 'Hermes is starting gateway run...');
  const upstream = gatewayUrl(opts);

  const startResponse = await fetch(`${upstream}/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: opts.input,
      session_id: opts.sessionId,
      conversation_history: opts.conversationHistory,
      settings: compactSettings(opts.settings),
    }),
  });

  if (!startResponse.ok) {
    const errText = await startResponse.text();
    const error = errText || `Gateway returned ${startResponse.status}`;
    writeSse(res, { type: 'response.error', delta: error });
    emitRunCompleted(res, { runId: opts.runId, sessionId: opts.sessionId }, 'error', error);
    return { sessionId: opts.sessionId, text: '', error };
  }

  const run = (await startResponse.json()) as GatewayRunStart;
  const runId = run.run_id || run.id;
  let sessionId = run.session_id || opts.sessionId;
  if (!runId) {
    const error = 'Gateway did not return run id';
    writeSse(res, { type: 'response.error', delta: error });
    emitRunCompleted(res, { runId: opts.runId, sessionId }, 'error', error);
    return { sessionId, text: '', error };
  }

  const eventsResponse = await fetch(`${upstream}/v1/runs/${encodeURIComponent(runId)}/events`);
  if (!eventsResponse.ok) {
    const errText = await eventsResponse.text();
    const error = errText || `Gateway events returned ${eventsResponse.status}`;
    writeSse(res, { type: 'response.error', delta: error });
    emitRunCompleted(res, { runId: opts.runId, sessionId }, 'error', error);
    return { sessionId, text: '', error };
  }

  const result = await pumpGatewayEvents(res, eventsResponse, sessionId, {
    runId: opts.runId,
    upstreamRunId: runId,
  });
  sessionId = result.sessionId || sessionId;
  emitRunCompleted(
    res,
    { runId: opts.runId, sessionId },
    result.error ? 'error' : 'completed',
    result.error
  );
  return { ...result, sessionId };
}
