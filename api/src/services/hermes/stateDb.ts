import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { profileHome } from './paths';
import { selectThreadRowsForDetail, HermesThreadRowLike } from './threadSelection';
import { HermesTimelineMessage, HermesRawTimelineRow, mapStateDbMessageRow } from './timeline';

export type HermesMessageSource = 'state_db' | 'json_fallback';

export interface HermesThreadSummary {
  id: string;
  sessionKey: string;
  threadKey: string;
  rootSessionKey: string;
  title: string | null;
  preview: string;
  source: string;
  model: string | null;
  messageCount: number;
  lastActive: Date;
  messageSource: HermesMessageSource;
}

export interface HermesThreadDetail extends HermesThreadSummary {
  messages: HermesTimelineMessage[];
}

export interface StateDbTimelinePage {
  messages: HermesTimelineMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface HermesStateDbAssistantMessage {
  externalId: string;
  sessionId: string;
  text: string;
  timestamp: Date;
}

interface ThreadSummaryRow extends HermesThreadRowLike {
  id: string;
  source?: string | null;
  model?: string | null;
  title?: string | null;
  thread_key?: string | null;
  root_session_key?: string | null;
  preview?: string | null;
  last_active?: number | null;
}

type MessageRow = HermesRawTimelineRow;

function stateDbPath(profile: string | null | undefined): string {
  return path.join(profileHome(profile), 'state.db');
}

function openStateDb(profile: string | null | undefined): Database.Database | null {
  const dbPath = stateDbPath(profile);
  if (!fs.existsSync(dbPath)) return null;
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function tableColumns(db: Database.Database, tableName: string): Set<string> {
  try {
    return new Set(
      (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name?: string }[])
        .map((row) => String(row.name || ''))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function selectOptionalColumn(columns: Set<string>, name: string): string {
  return columns.has(name) ? name : `NULL AS ${name}`;
}

function messageSelectColumns(db: Database.Database): string {
  const columns = tableColumns(db, 'messages');
  return [
    'id',
    'session_id',
    'role',
    columns.has('content') ? 'content' : "'' AS content",
    columns.has('timestamp') ? 'timestamp' : '0 AS timestamp',
    selectOptionalColumn(columns, 'tool_calls'),
    selectOptionalColumn(columns, 'tool_call_id'),
    selectOptionalColumn(columns, 'tool_name'),
    selectOptionalColumn(columns, 'finish_reason'),
    selectOptionalColumn(columns, 'reasoning'),
    selectOptionalColumn(columns, 'reasoning_content'),
    selectOptionalColumn(columns, 'reasoning_details'),
    selectOptionalColumn(columns, 'codex_reasoning_items'),
    selectOptionalColumn(columns, 'codex_message_items'),
  ].join(', ');
}

function secondsToDate(value: unknown): Date {
  const seconds = Number(value || 0);
  return new Date(seconds * 1000);
}

function encodeCursor(row: MessageRow): string {
  return `${Number(row.timestamp || 0)}|${Number(row.id || 0)}`;
}

function decodeCursor(cursor: string | null | undefined): { timestamp: number; id: number } | null {
  if (!cursor) return null;
  const [timestamp, id] = cursor.split('|').map(Number);
  if (!Number.isFinite(timestamp) || !Number.isFinite(id)) return null;
  return { timestamp, id };
}

function mapSummary(row: ThreadSummaryRow): HermesThreadSummary {
  const sessionKey = String(row.id || '');
  const threadKey = String(row.thread_key || sessionKey);
  return {
    id: sessionKey,
    sessionKey,
    threadKey,
    rootSessionKey: String(row.root_session_key || threadKey),
    title: row.title ? String(row.title) : null,
    preview: String(row.preview || ''),
    source: String(row.source || ''),
    model: row.model ? String(row.model) : null,
    messageCount: Number(row.message_count || 0),
    lastActive: secondsToDate(row.last_active || row.started_at),
    messageSource: 'state_db',
  };
}

const BASE_VISIBLE_THREADS_SQL = `
  WITH base_threads AS (
    SELECT
      s.id,
      s.source,
      s.model,
      s.title,
      s.parent_session_id,
      COALESCE(s.thread_id, s.id) AS thread_key,
      COALESCE(s.thread_id, s.id) AS root_session_key,
      s.session_kind,
      COALESCE(s.is_user_visible, 1) AS is_user_visible,
      COALESCE(s.message_count, 0) AS message_count,
      COALESCE(s.started_at, 0) AS started_at,
      s.ended_at,
      COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_active,
      COALESCE(
        (
          SELECT SUBSTR(REPLACE(REPLACE(m2.content, CHAR(10), ' '), CHAR(13), ' '), 1, 63)
          FROM messages m2
          WHERE m2.session_id = s.id AND m2.role = 'user' AND m2.content IS NOT NULL
          ORDER BY m2.timestamp, m2.id
          LIMIT 1
        ),
        ''
      ) AS preview
    FROM sessions s
    WHERE COALESCE(s.is_user_visible, 1) = 1
      AND COALESCE(s.source, '') != 'tool'
  ),
  ranked_threads AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY thread_key
        ORDER BY last_active DESC, started_at DESC, id DESC
      ) AS thread_rank
    FROM base_threads
  )
`;

function getThreadRows(db: Database.Database, threadKey: string): ThreadSummaryRow[] {
  return db.prepare(`
    SELECT
      s.id,
      s.source,
      s.model,
      s.title,
      s.parent_session_id,
      COALESCE(s.thread_id, s.id) AS thread_key,
      COALESCE(s.thread_id, s.id) AS root_session_key,
      s.session_kind,
      COALESCE(s.is_user_visible, 1) AS is_user_visible,
      COALESCE(s.message_count, 0) AS message_count,
      COALESCE(s.started_at, 0) AS started_at,
      s.ended_at,
      COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_active,
      COALESCE(
        (
          SELECT SUBSTR(REPLACE(REPLACE(m2.content, CHAR(10), ' '), CHAR(13), ' '), 1, 63)
          FROM messages m2
          WHERE m2.session_id = s.id AND m2.role = 'user' AND m2.content IS NOT NULL
          ORDER BY m2.timestamp, m2.id
          LIMIT 1
        ),
        ''
      ) AS preview
    FROM sessions s
    WHERE COALESCE(s.thread_id, s.id) = ?
      AND COALESCE(s.is_user_visible, 1) = 1
      AND COALESCE(s.source, '') != 'tool'
    ORDER BY started_at ASC, id ASC
  `).all(threadKey) as ThreadSummaryRow[];
}

function getAnchorRow(db: Database.Database, key: string): ThreadSummaryRow | null {
  const row = db.prepare(`
    ${BASE_VISIBLE_THREADS_SQL}
    SELECT *
    FROM ranked_threads
    WHERE thread_rank = 1
      AND (id = ? OR thread_key = ? OR root_session_key = ?)
    ORDER BY last_active DESC, started_at DESC, id DESC
    LIMIT 1
  `).get(key, key, key) as ThreadSummaryRow | undefined;
  if (row) return row;

  const exact = db.prepare(`
    SELECT
      s.id,
      s.source,
      s.model,
      s.title,
      s.parent_session_id,
      COALESCE(s.thread_id, s.id) AS thread_key,
      COALESCE(s.thread_id, s.id) AS root_session_key,
      s.session_kind,
      COALESCE(s.is_user_visible, 1) AS is_user_visible,
      COALESCE(s.message_count, 0) AS message_count,
      COALESCE(s.started_at, 0) AS started_at,
      s.ended_at,
      COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id), s.started_at) AS last_active,
      '' AS preview
    FROM sessions s
    WHERE s.id = ?
      AND COALESCE(s.is_user_visible, 1) = 1
      AND COALESCE(s.source, '') != 'tool'
    LIMIT 1
  `).get(key) as ThreadSummaryRow | undefined;
  return exact || null;
}

export function listStateDbThreads(profile: string | null | undefined): HermesThreadSummary[] {
  const db = openStateDb(profile);
  if (!db) return [];
  try {
    const rows = db.prepare(`
      ${BASE_VISIBLE_THREADS_SQL}
      SELECT *
      FROM ranked_threads
      WHERE thread_rank = 1
      ORDER BY last_active DESC, started_at DESC, id DESC
      LIMIT 2000
    `).all() as ThreadSummaryRow[];
    return rows.map(mapSummary);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function getStateDbThread(
  profile: string | null | undefined,
  key: string
): HermesThreadDetail | null {
  const db = openStateDb(profile);
  if (!db) return null;
  try {
    const anchor = getAnchorRow(db, key);
    if (!anchor) return null;

    const threadKey = String(anchor.thread_key || anchor.id || '');
    const requestedId = String(anchor.id || key);
    const threadRows = getThreadRows(db, threadKey);
    const selectedRows = selectThreadRowsForDetail(threadRows, requestedId);
    const selectedIds = selectedRows.map((row) => String(row.id || '')).filter(Boolean);
    const detailId = selectedIds[selectedIds.length - 1] || requestedId;
    const detailRow = threadRows.find((row) => row.id === detailId) || anchor;
    const summary = mapSummary(detailRow);

    if (!selectedIds.length) return { ...summary, messages: [] };

    const placeholders = selectedIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT ${messageSelectColumns(db)}
      FROM messages
      WHERE session_id IN (${placeholders})
        AND role IN ('user', 'assistant', 'tool', 'system')
      ORDER BY timestamp, id
    `).all(...selectedIds) as MessageRow[];

    const messages = rows.map(mapStateDbMessageRow);

    return {
      ...summary,
      messageCount: messages.length,
      messages,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getStateDbThreadPage(
  profile: string | null | undefined,
  key: string,
  opts: { cursor?: string | null; limit?: number }
): StateDbTimelinePage | null {
  const db = openStateDb(profile);
  if (!db) return null;
  try {
    const anchor = getAnchorRow(db, key);
    if (!anchor) return null;

    const threadKey = String(anchor.thread_key || anchor.id || '');
    const requestedId = String(anchor.id || key);
    const selectedRows = selectThreadRowsForDetail(getThreadRows(db, threadKey), requestedId);
    const selectedIds = selectedRows.map((row) => String(row.id || '')).filter(Boolean);
    if (!selectedIds.length) return { messages: [], nextCursor: null, hasMore: false };

    const limit = Math.min(Math.max(opts.limit || 80, 1), 200);
    const placeholders = selectedIds.map(() => '?').join(', ');
    const cursor = decodeCursor(opts.cursor);
    const cursorPredicate = cursor
      ? 'AND (timestamp > ? OR (timestamp = ? AND id > ?))'
      : '';
    const params: unknown[] = [...selectedIds];
    if (cursor) params.push(cursor.timestamp, cursor.timestamp, cursor.id);

    const rows = db.prepare(`
      SELECT ${messageSelectColumns(db)}
      FROM messages
      WHERE session_id IN (${placeholders})
        AND role IN ('user', 'assistant', 'tool', 'system')
        ${cursorPredicate}
      ORDER BY timestamp, id
      LIMIT ?
    `).all(...params, limit + 1) as MessageRow[];

    const pageRows = rows.slice(0, limit);
    return {
      messages: pageRows.map(mapStateDbMessageRow),
      nextCursor: rows.length > limit && pageRows.length ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      hasMore: rows.length > limit,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function resolveStateDbLiveTip(profile: string | null | undefined, key: string): string | null {
  const detail = getStateDbThread(profile, key);
  return detail?.sessionKey || null;
}

export function getLatestStateDbAssistantMessage(
  profile: string | null | undefined,
  sessionId: string,
  afterMs?: number
): HermesStateDbAssistantMessage | null {
  const db = openStateDb(profile);
  if (!db) return null;
  try {
    const afterSeconds = afterMs ? Math.max(0, Math.floor(afterMs / 1000) - 5) : 0;
    const row = db.prepare(`
      SELECT ${messageSelectColumns(db)}
      FROM messages
      WHERE session_id = ?
        AND role = 'assistant'
        AND length(trim(COALESCE(content, ''))) > 0
        AND timestamp >= ?
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    `).get(sessionId, afterSeconds) as MessageRow | undefined;
    if (!row) return null;
    return {
      externalId: `${row.session_id}:${row.id}`,
      sessionId: String(row.session_id),
      text: String(row.content || ''),
      timestamp: secondsToDate(row.timestamp),
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getStateDbThreadSessionKeys(
  profile: string | null | undefined,
  key: string
): string[] {
  const db = openStateDb(profile);
  if (!db) return [];
  try {
    const anchor = getAnchorRow(db, key);
    if (!anchor) return [];
    const threadKey = String(anchor.thread_key || anchor.id || '');
    return getThreadRows(db, threadKey).map((row) => String(row.id || '')).filter(Boolean);
  } catch {
    return [];
  } finally {
    db.close();
  }
}
