import { Response } from 'express';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { hermesSpawn, stripAnsi } from './cli';
import { findLatestClientSession, isValidSessionId, SESSION_SOURCE } from './sessions';
import { getLatestStateDbAssistantMessage } from './stateDb';
import {
  createCliStreamSanitizer,
  sanitizeCliFinalText,
  sanitizeCliStreamChunk,
} from './streamSanitizer';
import {
  configureSse,
  emitRunCompleted,
  emitRunStarted,
  emitRunStatus,
  startRunStatusHeartbeat,
  stopRunStatusHeartbeat,
  writeSse,
} from './runState';

export interface ChatOptions {
  profile?: string | null;
  /** Hermes session id to resume; pass null/undefined to start a new session. */
  sessionId?: string | null;
  /** Image attachments — passed via repeated `--image` flags. */
  imagePaths?: string[];
  /** Per-conversation settings. Only locally supported CLI flags are emitted. */
  settings?: EffectiveSessionSettings;
  runId?: string;
}

export interface EffectiveSessionSettings {
  thinkingLevel?: string | null;
  reasoningLevel?: string | null;
  verboseLevel?: string | null;
  fastMode?: boolean | null;
  modelOverride?: string | null;
  providerOverride?: string | null;
  skillsOverride?: string | null;
  toolsetsOverride?: string | null;
}

export interface ChatStreamResult {
  /** Hermes session id for this turn (resolved post-stream when starting fresh). */
  sessionId: string | null;
  /** Source-of-truth Hermes message id for the assistant turn, when state.db exposes it. */
  externalId?: string;
  /** Aggregated assistant text the client received (best-effort). */
  text: string;
  /** Raw exit code reported by `hermes chat`. */
  exitCode: number | null;
  error?: string;
}

const SESSION_ID_LINE_RE = /(?:Session(?:\s*ID)?|session_id)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})/i;

export function buildChatArgs(message: string, opts: ChatOptions): string[] {
  const args = ['chat', '-Q', '--source', SESSION_SOURCE, '-q', message];
  if (opts.settings?.modelOverride) args.push('--model', opts.settings.modelOverride);
  if (opts.settings?.providerOverride) args.push('--provider', opts.settings.providerOverride);
  if (opts.settings?.toolsetsOverride) args.push('--toolsets', opts.settings.toolsetsOverride);
  if (opts.settings?.skillsOverride) {
    opts.settings.skillsOverride
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)
      .forEach((skill) => args.push('--skills', skill));
  }
  if (opts.sessionId && isValidSessionId(opts.sessionId)) {
    args.push('--resume', opts.sessionId);
  }
  // Current local Hermes CLI exposes `--verbose` only. Thinking,
  // reasoning, and fast-mode are passed through gateway/dry-run but not
  // translated to unsupported CLI flags.
  if (opts.settings?.verboseLevel && opts.settings.verboseLevel !== 'inherit' && opts.settings.verboseLevel !== 'off') {
    args.push('--verbose');
  }
  (opts.imagePaths ?? []).forEach((img) => {
    args.push('--image', img);
  });
  return args;
}

/**
 * Spawn `hermes chat -Q -q "<msg>"` and stream its stdout to the client as
 * SSE deltas. Resolves with the resolved Hermes session id (if any) and the
 * aggregated assistant text once the child exits.
 *
 * Importantly, this function does **not** end the SSE response — the
 * caller is expected to persist the result (assistant message, session id,
 * …) and only then write `[DONE]` and close. Closing the response here
 * would race the caller's DB write against the client's follow-up
 * `getMessages` refetch, leaving the chat UI temporarily blank.
 *
 * Inspects both stdout and stderr for the session id token because
 * `hermes chat -Q` writes the response to stdout and the trailing
 * `session_id: …` line to stderr.
 */
export function streamChat(
  res: Response,
  message: string,
  opts: ChatOptions
): Promise<ChatStreamResult> {
  configureSse(res);
  emitRunStarted(res, { runId: opts.runId, sessionId: opts.sessionId });
  emitRunStatus(res, { runId: opts.runId, sessionId: opts.sessionId }, 'Hermes is starting...');
  const heartbeat = startRunStatusHeartbeat(res, { runId: opts.runId, sessionId: opts.sessionId });

  const startedAtMs = Date.now();
  const args = buildChatArgs(message, opts);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = hermesSpawn(args, { profile: opts.profile ?? null });
  } catch (err) {
    stopRunStatusHeartbeat(heartbeat);
    writeSse(res, { type: 'response.error', delta: (err as Error).message });
    emitRunCompleted(res, { runId: opts.runId }, 'error', (err as Error).message);
    return Promise.resolve({
      sessionId: null,
      text: '',
      exitCode: null,
      error: (err as Error).message,
    });
  }

  let aggregated = '';
  let resolvedSessionId: string | null = opts.sessionId ?? null;
  let stderrBuf = '';
  let clientClosed = false;
  let emittedText = '';
  const cliStreamSanitizer = createCliStreamSanitizer();

  res.once('close', () => {
    clientClosed = true;
  });

  const tryCaptureSessionId = (chunk: string): void => {
    if (resolvedSessionId) return;
    const match = chunk.match(SESSION_ID_LINE_RE);
    if (match) [, resolvedSessionId] = match;
  };

  const handleSanitizedOutput = (sanitized: ReturnType<typeof sanitizeCliStreamChunk>): void => {
    if (sanitized.outputText) aggregated += sanitized.outputText;
    if (clientClosed) return;
    if (sanitized.reasoningText) {
      writeSse(res, { type: 'response.thinking.delta', delta: sanitized.reasoningText });
    }
    if (sanitized.outputText) {
      emittedText += sanitized.outputText;
      writeSse(res, { type: 'response.output_text.delta', delta: sanitized.outputText });
    }
  };

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    const cleaned = stripAnsi(chunk);
    tryCaptureSessionId(cleaned);
    handleSanitizedOutput(cliStreamSanitizer.push(cleaned));
  });

  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    const cleaned = stripAnsi(chunk);
    stderrBuf += cleaned;
    tryCaptureSessionId(cleaned);
  });

  return new Promise<ChatStreamResult>((resolve) => {
    child.on('error', (err) => {
      stopRunStatusHeartbeat(heartbeat);
      const message2 = err.message || 'hermes failed to start';
      if (!clientClosed) writeSse(res, { type: 'response.error', delta: message2 });
      if (!clientClosed) emitRunCompleted(res, { runId: opts.runId }, 'error', message2);
      resolve({ sessionId: resolvedSessionId, text: aggregated, exitCode: null, error: message2 });
    });
    child.on('close', async (code) => {
      handleSanitizedOutput(cliStreamSanitizer.flush());
      if (!resolvedSessionId) {
        resolvedSessionId = findLatestClientSession(opts.profile ?? null, startedAtMs);
      }
      let stateDbAssistant = resolvedSessionId
        ? getLatestStateDbAssistantMessage(opts.profile ?? null, resolvedSessionId, startedAtMs)
        : null;
      const error =
        code && code !== 0 ? stderrBuf.trim() || `hermes exited with code ${code}` : undefined;

      const finalText = sanitizeCliFinalText(stateDbAssistant?.text || aggregated);
      stopRunStatusHeartbeat(heartbeat);

      if (!clientClosed) {
        if (error) writeSse(res, { type: 'response.error', delta: error });
        if (!error && finalText && !emittedText.trim()) {
          writeSse(res, { type: 'response.output_text.delta', delta: finalText });
        }
        emitRunCompleted(
          res,
          { runId: opts.runId, sessionId: resolvedSessionId },
          error ? 'error' : 'completed',
          error
        );
      }
      resolve({
        sessionId: resolvedSessionId,
        externalId: stateDbAssistant?.externalId,
        text: finalText,
        exitCode: code,
        error,
      });
    });
  });
}
