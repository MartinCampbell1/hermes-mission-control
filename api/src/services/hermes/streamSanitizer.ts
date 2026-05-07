import { cleanAssistantMessageText } from './textCleanup';

export interface SanitizedCliChunk {
  outputText: string;
  reasoningText: string;
  droppedText: string;
}

export interface CliStreamSanitizer {
  push(chunk: string): SanitizedCliChunk;
  flush(): SanitizedCliChunk;
}

const SERVICE_TUPLE_RE =
  /(?:^|\n)\s*(?:generic:\s*)?(?:"[^"]*"\s*)?\(\s*\d+\s*user\s+messages?\s*,\s*\d+\s*total\s+messages?\s*\)\s*/gi;
const RESUME_BANNER_RE =
  /(?:^|\n)\s*[↻↺\u21BB\u21BA\s]*Resumed session\s+\S+(?:\s+"[^"]*")?(?:\s*\([^)]*\))?\s*/gi;
const SESSION_ID_LINE_RE = /(?:^|\n)\s*(?:Session(?:\s*ID)?|session_id)\s*[:=]\s*\S+\s*/gi;
const GENERIC_SERVICE_LINE_RE = /(?:^|\n)\s*generic:\s*\([^)]*\)\s*/gi;
const REASONING_BLOCK_RE = /┌─\s*Reasoning\b([\s\S]*?)(?:└[─\s]*\n?|$)/gi;
const COMPLETE_SERVICE_TUPLE_RE =
  /\(\s*\d+\s*user\s+messages?\s*,\s*\d+\s*total\s+messages?\s*\)/i;

const EMPTY_CHUNK: SanitizedCliChunk = {
  outputText: '',
  reasoningText: '',
  droppedText: '',
};

function normalizeDropped(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function emptyChunk(): SanitizedCliChunk {
  return { ...EMPTY_CHUNK };
}

function preservedLineBreak(match: string): string {
  return /^[\r\n]/.test(match) ? '\n' : '';
}

function stripNoise(text: string): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  let out = text;
  const strip = (re: RegExp) => {
    out = out.replace(re, (match) => {
      dropped.push(match);
      return preservedLineBreak(match);
    });
  };

  strip(RESUME_BANNER_RE);
  strip(SERVICE_TUPLE_RE);
  strip(GENERIC_SERVICE_LINE_RE);
  strip(SESSION_ID_LINE_RE);

  return { text: out, dropped };
}

function extractReasoning(text: string): { text: string; reasoningText: string; dropped: string[] } {
  const reasoning: string[] = [];
  const dropped: string[] = [];
  const out = text.replace(REASONING_BLOCK_RE, (match, body: string) => {
    dropped.push(match);
    const cleanedBody = String(body || '')
      .split('\n')
      .map((line) => line.replace(/^│\s?/, '').trimEnd())
      .filter((line) => line.trim() && !/^─+$/.test(line.trim()))
      .join('\n')
      .trim();
    if (cleanedBody) reasoning.push(cleanedBody);
    return '';
  });

  return {
    text: out,
    reasoningText: reasoning.join('\n\n'),
    dropped,
  };
}

function consumeNumberPrefix(text: string): { rest: string; incomplete: boolean } | null {
  if (!text) return { rest: '', incomplete: true };
  const match = text.match(/^\d+/);
  if (!match) return null;
  const rest = text.slice(match[0].length).trimStart();
  return rest ? { rest, incomplete: false } : { rest: '', incomplete: true };
}

function consumeLiteralPrefix(
  text: string,
  literals: string[]
): { rest: string; incomplete: boolean } | null {
  for (const literal of literals) {
    if (text.startsWith(literal)) {
      const rest = text.slice(literal.length).trimStart();
      return { rest, incomplete: false };
    }
  }
  for (const literal of literals) {
    if (literal.startsWith(text)) return { rest: '', incomplete: true };
  }
  return null;
}

function isIncompleteServiceTupleBody(text: string): boolean {
  let rest = text.trimStart();
  const userCount = consumeNumberPrefix(rest);
  if (!userCount) return false;
  if (userCount.incomplete) return true;
  rest = userCount.rest;

  const userMessages = consumeLiteralPrefix(rest, ['user messages', 'user message']);
  if (!userMessages) return false;
  if (userMessages.incomplete) return true;
  rest = userMessages.rest;

  if (!rest) return true;
  if (!rest.startsWith(',')) return false;
  rest = rest.slice(1).trimStart();

  const totalCount = consumeNumberPrefix(rest);
  if (!totalCount) return false;
  if (totalCount.incomplete) return true;
  rest = totalCount.rest;

  const totalMessages = consumeLiteralPrefix(rest, ['total messages', 'total message']);
  if (!totalMessages) return false;
  if (totalMessages.incomplete) return true;
  rest = totalMessages.rest;

  if (!rest) return true;
  return !rest.startsWith(')');
}

function isIncompleteServiceTupleCandidate(text: string): boolean {
  let normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimStart()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!normalized) return false;

  if ('generic:'.startsWith(normalized)) return true;
  if (normalized.startsWith('generic:')) {
    normalized = normalized.slice('generic:'.length).trimStart();
    if (!normalized) return true;
  }

  if (normalized.startsWith('"')) {
    const titleEnd = normalized.indexOf('"', 1);
    if (titleEnd === -1) return true;
    normalized = normalized.slice(titleEnd + 1).trimStart();
    if (!normalized) return true;
  }

  if (!normalized.startsWith('(')) return false;
  return isIncompleteServiceTupleBody(normalized.slice(1));
}

function findPendingServiceTupleStart(text: string): number {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }

  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const start = starts[i];
    if (isIncompleteServiceTupleCandidate(text.slice(start))) return start;
  }

  return -1;
}

function normalizeForBannerDetection(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trimStart()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function looksLikeLeadingBannerPrefix(text: string): boolean {
  const normalized = normalizeForBannerDetection(text);
  if (!normalized) return false;
  return (
    normalized.startsWith('"') ||
    normalized.startsWith('generic:') ||
    normalized.startsWith('resumed session') ||
    normalized.startsWith('↻ resumed session') ||
    normalized.startsWith('↺ resumed session')
  );
}

function hasCompleteServiceTuple(text: string): boolean {
  return COMPLETE_SERVICE_TUPLE_RE.test(
    text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}

export function sanitizeCliStreamChunk(chunk: string): SanitizedCliChunk {
  if (!chunk) return emptyChunk();

  const noNoise = stripNoise(chunk);
  const noReasoning = extractReasoning(noNoise.text);
  const outputText = noReasoning.text.trim().length
    ? noReasoning.text
    : '';

  return {
    outputText,
    reasoningText: noReasoning.reasoningText,
    droppedText: [...noNoise.dropped, ...noReasoning.dropped]
      .map(normalizeDropped)
      .filter(Boolean)
      .join('\n'),
  };
}

export function createCliStreamSanitizer(): CliStreamSanitizer {
  let pending = '';
  let atStreamStart = true;

  return {
    push(chunk: string): SanitizedCliChunk {
      if (!chunk) return emptyChunk();

      const combined = pending + chunk;
      if (
        atStreamStart &&
        combined.length < 4096 &&
        looksLikeLeadingBannerPrefix(combined) &&
        !hasCompleteServiceTuple(combined)
      ) {
        pending = combined;
        return emptyChunk();
      }

      const pendingStart = findPendingServiceTupleStart(combined);
      pending = pendingStart >= 0 ? combined.slice(pendingStart) : '';
      const ready = pendingStart >= 0 ? combined.slice(0, pendingStart) : combined;
      const sanitized = sanitizeCliStreamChunk(ready);
      if (sanitized.outputText.trim()) atStreamStart = false;
      return sanitized;
    },

    flush(): SanitizedCliChunk {
      if (!pending) return emptyChunk();
      const chunk = pending;
      pending = '';
      const sanitized = sanitizeCliStreamChunk(chunk);
      if (sanitized.outputText.trim()) atStreamStart = false;
      return sanitized;
    },
  };
}

export function sanitizeCliFinalText(text: string): string {
  if (!text) return '';
  const sanitized = sanitizeCliStreamChunk(text);
  return cleanAssistantMessageText(sanitized.outputText).trim();
}
