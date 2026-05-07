import { cleanMessageText } from './textCleanup';
import type { MessageKind, MessageRole, ToolStatus } from '../../entities/Message';

export interface HermesTimelineMessage {
  externalId: string;
  sessionId: string;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  thinking: string | null;
  timestamp: Date;
  sourceSessionId: string;
  toolName: string | null;
  toolCallId: string | null;
  toolStatus: ToolStatus;
  finishReason: string | null;
  metadata: Record<string, unknown>;
  hidden: boolean;
}

export interface HermesRawTimelineRow {
  id: number;
  session_id: string;
  role: string;
  content?: string | null;
  timestamp?: number | null;
  tool_calls?: string | null;
  tool_call_id?: string | null;
  tool_name?: string | null;
  finish_reason?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: string | null;
  codex_reasoning_items?: string | null;
  codex_message_items?: string | null;
}

interface ParsedToolCall {
  id: string | null;
  name: string | null;
  arguments: unknown;
  raw: unknown;
}

function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compactString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return null;
}

function containsEncryptedContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsEncryptedContent);
  const record = value as Record<string, unknown>;
  return Object.keys(record).some((key) =>
    key === 'encrypted_content' || key === 'encryptedContent' || containsEncryptedContent(record[key])
  );
}

function collectReasoningText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const parsed = safeJsonParse(value);
    if (parsed && parsed !== value) return collectReasoningText(parsed, out);
    const text = value.trim();
    if (text && !/encrypted_content/i.test(text)) out.push(text);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectReasoningText(item, out));
    return out;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['text', 'summary_text', 'reasoning', 'reasoning_content', 'content']) {
    const raw = record[key];
    if (typeof raw === 'string') collectReasoningText(raw, out);
  }
  for (const key of ['summary', 'summaries', 'items', 'message_items']) {
    const raw = record[key];
    if (raw) collectReasoningText(raw, out);
  }
  return out;
}

function normalizeReasoningCandidate(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = safeJsonParse(text);
  if (!parsed) return /encrypted_content/i.test(text) ? null : text;

  const extracted = collectReasoningText(parsed).join('\n').trim();
  if (extracted) return extracted;
  if (containsEncryptedContent(parsed)) return null;
  return compactString(parsed);
}

function firstReasoningCandidate(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = normalizeReasoningCandidate(value);
    if (text) return text;
  }
  return null;
}

function parseToolCalls(value: string | null | undefined): ParsedToolCall[] {
  const parsed = safeJsonParse(value);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const record = row as Record<string, unknown>;
      const fn = record.function && typeof record.function === 'object'
        ? (record.function as Record<string, unknown>)
        : {};
      const rawArguments = record.arguments ?? fn.arguments ?? record.args ?? fn.args ?? null;
      const parsedArguments =
        typeof rawArguments === 'string' ? safeJsonParse(rawArguments) ?? rawArguments : rawArguments;
      return {
        id: firstNonEmpty(String(record.id || ''), String(record.tool_call_id || '')),
        name: firstNonEmpty(
          String(record.name || ''),
          String(record.tool_name || ''),
          String(fn.name || '')
        ),
        arguments: parsedArguments,
        raw: row,
      };
    });
}

function reasoningText(row: HermesRawTimelineRow): string | null {
  const direct = firstReasoningCandidate(row.reasoning_content, row.reasoning, row.reasoning_details);
  if (direct) return direct;
  return firstReasoningCandidate(row.codex_reasoning_items, row.codex_message_items);
}

function parseToolResult(content: string): {
  text: string;
  status: ToolStatus;
  metadata: Record<string, unknown>;
} {
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== 'object') {
    return { text: content, status: 'done', metadata: {} };
  }
  const record = parsed as Record<string, unknown>;
  const output = firstNonEmpty(
    typeof record.output === 'string' ? record.output : null,
    typeof record.stdout === 'string' ? record.stdout : null,
    typeof record.result === 'string' ? record.result : null,
    typeof record.error === 'string' ? record.error : null
  );
  const status: ToolStatus = record.error ? 'error' : 'done';
  return {
    text: output ?? compactString(parsed),
    status,
    metadata: { raw: parsed },
  };
}

function base(row: HermesRawTimelineRow): Omit<HermesTimelineMessage, 'role' | 'kind'> {
  return {
    externalId: `${row.session_id}:${row.id}`,
    sessionId: String(row.session_id),
    sourceSessionId: String(row.session_id),
    text: '',
    thinking: null,
    timestamp: new Date(Number(row.timestamp || 0) * 1000),
    toolName: null,
    toolCallId: null,
    toolStatus: null,
    finishReason: row.finish_reason ? String(row.finish_reason) : null,
    metadata: {},
    hidden: false,
  };
}

export function mapStateDbMessageRow(row: HermesRawTimelineRow): HermesTimelineMessage {
  const common = base(row);
  const content = String(row.content || '');
  const trimmed = content.trim();
  const role = String(row.role || '');

  if (role === 'user') {
    return {
      ...common,
      role: 'user',
      kind: 'message',
      text: cleanMessageText('user', content),
    };
  }

  if (role === 'tool') {
    const parsed = parseToolResult(content);
    return {
      ...common,
      role: 'tool',
      kind: 'tool_result',
      text: parsed.text,
      toolName: firstNonEmpty(row.tool_name),
      toolCallId: firstNonEmpty(row.tool_call_id),
      toolStatus: parsed.status,
      metadata: parsed.metadata,
    };
  }

  if (role === 'assistant' && trimmed) {
    return {
      ...common,
      role: 'assistant',
      kind: 'message',
      text: cleanMessageText('assistant', content),
      thinking: reasoningText(row),
    };
  }

  const calls = parseToolCalls(row.tool_calls);
  if (role === 'assistant' && calls.length > 0) {
    const call = calls[0];
    return {
      ...common,
      role: 'tool',
      kind: 'tool_call',
      text: call.name ? `Running ${call.name}` : 'Running tool',
      toolName: call.name,
      toolCallId: call.id,
      toolStatus: 'running',
      thinking: reasoningText(row),
      metadata: {
        arguments: call.arguments,
        rawToolCalls: calls.map((item) => item.raw),
      },
    };
  }

  const thinking = reasoningText(row);
  if (role === 'assistant' && thinking) {
    return {
      ...common,
      role: 'assistant',
      kind: 'reasoning',
      text: '',
      thinking,
    };
  }

  return {
    ...common,
    role: role === 'system' ? 'system' : 'assistant',
    kind: 'status',
    hidden: true,
    metadata: { originalRole: role || null },
  };
}

export function isVisibleTimelineMessage(message: Pick<HermesTimelineMessage, 'hidden'>): boolean {
  return !message.hidden;
}
