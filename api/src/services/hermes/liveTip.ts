import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { profileHome } from './paths';

export interface HermesLiveTipResolution {
  sessionId: string;
  threadKey: string;
  rootSessionKey: string;
  selectedSessionIds: string[];
}

export interface ResolveLiveTipFastOptions {
  profile?: string | null;
  key: string;
  dbPath?: string;
  db?: Database.Database;
  onQuery?: (sql: string) => void;
}

interface SessionRow {
  id: string;
  parent_session_id: string | null;
  thread_key: string;
  session_kind: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number | null;
}

function stateDbPath(profile: string | null | undefined): string {
  return path.join(profileHome(profile), 'state.db');
}

function openReadOnlyStateDb(opts: ResolveLiveTipFastOptions): Database.Database | null {
  if (opts.db) return opts.db;

  const dbPath = opts.dbPath || stateDbPath(opts.profile);
  if (!fs.existsSync(dbPath)) return null;

  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function queryAll<T extends object>(
  db: Database.Database,
  sql: string,
  params: unknown[],
  onQuery?: (sql: string) => void
): T[] {
  onQuery?.(sql);
  return db.prepare(sql).all(...params) as T[];
}

function resolveThreadKey(
  db: Database.Database,
  key: string,
  onQuery?: (sql: string) => void
): string | null {
  const sql = `
    SELECT COALESCE(thread_id, id) AS thread_key
    FROM sessions
    WHERE COALESCE(is_user_visible, 1) = 1
      AND COALESCE(source, '') != 'tool'
      AND (id = ? OR COALESCE(thread_id, id) = ?)
    ORDER BY COALESCE(ended_at, started_at, 0) DESC, COALESCE(started_at, 0) DESC, id DESC
    LIMIT 1
  `;
  onQuery?.(sql);
  const row = db.prepare(sql).get(key, key) as { thread_key?: string } | undefined;
  return row?.thread_key ? String(row.thread_key) : null;
}

function selectLiveLeaf(rows: SessionRow[]): SessionRow | null {
  if (!rows.length) return null;

  const parentIds = new Set(
    rows
      .map((row) => row.parent_session_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const leaves = rows.filter((row) => !parentIds.has(row.id));
  const candidates = leaves.length ? leaves : rows;

  return [...candidates].sort((a, b) => {
    const aTime = Number(a.ended_at || a.started_at || 0);
    const bTime = Number(b.ended_at || b.started_at || 0);
    if (aTime !== bTime) return bTime - aTime;
    const aCount = Number(a.message_count || 0);
    const bCount = Number(b.message_count || 0);
    if (aCount !== bCount) return bCount - aCount;
    return String(b.id).localeCompare(String(a.id));
  })[0] || null;
}

function selectRoot(rows: SessionRow[], threadKey: string): SessionRow | null {
  const explicitRoot = rows.find((row) => row.id === threadKey);
  if (explicitRoot) return explicitRoot;

  return [...rows].sort((a, b) => {
    const aTime = Number(a.started_at || a.ended_at || 0);
    const bTime = Number(b.started_at || b.ended_at || 0);
    if (aTime !== bTime) return aTime - bTime;
    return String(a.id).localeCompare(String(b.id));
  })[0] || null;
}

export function resolveLiveTipFast(
  opts: ResolveLiveTipFastOptions
): HermesLiveTipResolution | null {
  if (!opts.key || /[\\/]/.test(opts.key)) return null;

  const db = openReadOnlyStateDb(opts);
  if (!db) return null;
  const shouldClose = !opts.db;

  try {
    const threadKey = resolveThreadKey(db, opts.key, opts.onQuery);
    if (!threadKey) return null;

    const rows = queryAll<SessionRow>(
      db,
      `
        SELECT
          id,
          parent_session_id,
          COALESCE(thread_id, id) AS thread_key,
          session_kind,
          COALESCE(started_at, 0) AS started_at,
          ended_at,
          COALESCE(message_count, 0) AS message_count
        FROM sessions
        WHERE COALESCE(is_user_visible, 1) = 1
          AND COALESCE(source, '') != 'tool'
          AND COALESCE(thread_id, id) = ?
        ORDER BY COALESCE(started_at, 0) ASC, id ASC
      `,
      [threadKey],
      opts.onQuery
    );
    if (!rows.length) return null;

    const liveLeaf = selectLiveLeaf(rows);
    const root = selectRoot(rows, threadKey);
    if (!liveLeaf || !root) return null;

    return {
      sessionId: String(liveLeaf.id),
      threadKey,
      rootSessionKey: String(root.id),
      selectedSessionIds: rows.map((row) => String(row.id)),
    };
  } catch {
    return null;
  } finally {
    if (shouldClose) db.close();
  }
}
