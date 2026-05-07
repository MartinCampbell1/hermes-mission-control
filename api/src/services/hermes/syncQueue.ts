import { Agent } from '../../entities';
import { discoverProfileSessions } from './sync';

export interface QueuedSyncStatus {
  profile: string;
  running: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

const inFlight = new Map<string, Promise<void>>();
const statuses = new Map<string, QueuedSyncStatus>();
const DEFAULT_SYNC_COOLDOWN_MS = 60_000;
const DEFAULT_SYNC_START_DELAY_MS = Number(process.env.HERMES_CLIENT_BACKGROUND_SYNC_DELAY_MS || 60000);

function keyFor(agent: Agent): string {
  return agent.hermesProfile || 'default';
}

function statusFor(profile: string): QueuedSyncStatus {
  const existing = statuses.get(profile);
  if (existing) return existing;
  const fresh: QueuedSyncStatus = {
    profile,
    running: false,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
  statuses.set(profile, fresh);
  return fresh;
}

export function enqueueProfileSync(agent: Agent): Promise<void> {
  return enqueueProfileSyncForTest(keyFor(agent), async () => {
    await discoverProfileSessions(agent, { syncMessages: false });
  }, DEFAULT_SYNC_COOLDOWN_MS, DEFAULT_SYNC_START_DELAY_MS);
}

export function enqueueProfileSyncForTest(
  profile: string,
  run: () => Promise<unknown>,
  cooldownMs = DEFAULT_SYNC_COOLDOWN_MS,
  startDelayMs = 0
): Promise<void> {
  const existing = inFlight.get(profile);
  if (existing) return existing;

  const status = statusFor(profile);
  if (
    cooldownMs > 0 &&
    status.finishedAt &&
    Date.now() - status.finishedAt.getTime() < cooldownMs
  ) {
    return Promise.resolve();
  }

  status.running = true;
  status.startedAt = new Date();
  status.finishedAt = null;
  status.error = null;

  const promise = new Promise<void>((resolve) => {
    const start = () => {
      Promise.resolve()
        .then(run)
        .catch((err) => {
          status.error = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          status.running = false;
          status.finishedAt = new Date();
          inFlight.delete(profile);
          resolve();
        });
    };

    if (startDelayMs > 0) {
      setTimeout(start, startDelayMs);
    } else {
      setImmediate(start);
    }
  });

  inFlight.set(profile, promise);
  return promise;
}

export function getSyncQueueStatus(profile: string): QueuedSyncStatus | null {
  return statuses.get(profile) ?? null;
}

export function getSyncQueueStatusForTest(profile: string): QueuedSyncStatus | null {
  return getSyncQueueStatus(profile);
}
