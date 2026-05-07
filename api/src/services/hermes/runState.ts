import { Response } from 'express';

export interface RunStreamOptions {
  runId?: string;
  sessionId?: string | null;
}

export function configureSse(res: Response): void {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
  }
}

export function canWriteSse(res: Response): boolean {
  return !res.writableEnded && !res.destroyed;
}

export function writeSse(res: Response, payload: object | string): void {
  if (!canWriteSse(res)) return;
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  try {
    res.write(`data: ${data}\n\n`);
  } catch {
    // Browser navigation can close the SSE socket while the Hermes run keeps
    // completing durably. That should not abort persistence.
  }
}

export function emitRunStarted(res: Response, opts: RunStreamOptions | undefined): void {
  if (!opts?.runId) return;
  writeSse(res, {
    type: 'run.started',
    runId: opts.runId,
    sessionId: opts.sessionId ?? null,
  });
}

export function emitRunStatus(
  res: Response,
  opts: RunStreamOptions | undefined,
  status: string
): void {
  if (!opts?.runId) return;
  writeSse(res, {
    type: 'run.status',
    runId: opts.runId,
    status,
  });
}

export function emitRunCompleted(
  res: Response,
  opts: RunStreamOptions | undefined,
  status: 'completed' | 'error',
  error?: string
): void {
  if (!opts?.runId) return;
  writeSse(res, {
    type: 'run.completed',
    runId: opts.runId,
    status,
    error,
  });
}

export function startRunStatusHeartbeat(
  res: Response,
  opts: RunStreamOptions | undefined,
  status = 'Hermes is thinking...'
): NodeJS.Timeout | null {
  if (!opts?.runId) return null;
  let emitted = false;
  return setInterval(() => {
    if (!canWriteSse(res)) return;
    emitRunStatus(res, opts, emitted ? status : 'Hermes is running...');
    emitted = true;
  }, 1000);
}

export function stopRunStatusHeartbeat(timer: NodeJS.Timeout | null): void {
  if (timer) clearInterval(timer);
}
