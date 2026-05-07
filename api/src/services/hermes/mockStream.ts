import { Response } from 'express';
import { EffectiveSessionSettings } from './chat';
import { configureSse, emitRunCompleted, emitRunStarted, emitRunStatus, writeSse } from './runState';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function streamDryRun(
  res: Response,
  input: string,
  sessionId: string | null,
  settings?: EffectiveSessionSettings,
  runId?: string
): Promise<{ sessionId: string; externalId?: string; text: string; error?: string }> {
  const resolved = sessionId || `dry-run-${Date.now()}`;
  const text = `[dry-run] ${input}`;
  const chunkDelayMs = Number(process.env.HERMES_CLIENT_DRY_RUN_CHUNK_DELAY_MS || 0);

  configureSse(res);
  emitRunStarted(res, { runId, sessionId: resolved });
  emitRunStatus(res, { runId, sessionId: resolved }, 'Hermes dry-run is responding...');
  writeSse(res, { type: 'settings.applied', settings: settings ?? {} });
  writeSse(res, { type: 'response.output_text.delta', delta: '[dry-run] ' });
  if (chunkDelayMs > 0) await sleep(chunkDelayMs);
  writeSse(res, { type: 'response.output_text.delta', delta: input });
  emitRunCompleted(res, { runId, sessionId: resolved }, 'completed');

  return { sessionId: resolved, text };
}
