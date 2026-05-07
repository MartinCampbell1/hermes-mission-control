import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

export interface FixtureSession {
  id: string;
  source?: string;
  model?: string | null;
  title?: string | null;
  parent_session_id?: string | null;
  thread_id?: string | null;
  session_kind?: string | null;
  is_user_visible?: number | null;
  started_at: number;
  ended_at?: number | null;
  message_count?: number;
}

export interface FixtureMessage {
  id?: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
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

export function createTempHermesHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-state-'));
}

export function seedStateDbSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      model TEXT,
      title TEXT,
      parent_session_id TEXT,
      thread_id TEXT,
      session_kind TEXT,
      is_user_visible INTEGER DEFAULT 1,
      started_at REAL NOT NULL,
      ended_at REAL,
      message_count INTEGER DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      timestamp REAL NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      finish_reason TEXT,
      reasoning TEXT,
      reasoning_content TEXT,
      reasoning_details TEXT,
      codex_reasoning_items TEXT,
      codex_message_items TEXT
    );
  `);
}

export function seedCompressionLineage(db: Database.Database): {
  root: string;
  compression: string;
  visibleLeaf: string;
  sibling: string;
  threadKey: string;
} {
  const threadKey = 'thread-root-1';
  const root = 'session_root';
  const compression = 'session_compress_1';
  const visibleLeaf = 'session_leaf_visible';
  const sibling = 'session_leaf_sibling';

  const insert = db.prepare(`
    INSERT INTO sessions (
      id, source, model, title, parent_session_id, thread_id, session_kind,
      is_user_visible, started_at, ended_at, message_count
    ) VALUES (?, 'cli', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(root, 'Root', null, threadKey, 'chat', 1, 1_000, 2_000, 2);
  insert.run(compression, 'Compression', root, threadKey, 'compression', 1, 3_000, 4_000, 2);
  insert.run(visibleLeaf, 'Visible leaf', compression, threadKey, 'chat', 1, 5_000, 6_000, 2);
  insert.run(sibling, 'Hidden sibling', compression, threadKey, 'chat', 0, 7_000, 8_000, 2);

  return { root, compression, visibleLeaf, sibling, threadKey };
}

export function createStateDb(
  profileDir: string,
  sessions: FixtureSession[],
  messages: FixtureMessage[]
): void {
  fs.mkdirSync(profileDir, { recursive: true });
  const db = new Database(path.join(profileDir, 'state.db'));
  seedStateDbSchema(db);

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, source, model, title, parent_session_id, thread_id, session_kind,
      is_user_visible, started_at, ended_at, message_count
    ) VALUES (
      @id, @source, @model, @title, @parent_session_id, @thread_id, @session_kind,
      @is_user_visible, @started_at, @ended_at, @message_count
    )
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, timestamp, tool_calls, tool_call_id, tool_name,
      finish_reason, reasoning, reasoning_content, reasoning_details, codex_reasoning_items,
      codex_message_items
    )
    VALUES (
      @id, @session_id, @role, @content, @timestamp, @tool_calls, @tool_call_id, @tool_name,
      @finish_reason, @reasoning, @reasoning_content, @reasoning_details, @codex_reasoning_items,
      @codex_message_items
    )
  `);

  const tx = db.transaction(() => {
    sessions.forEach((session) => {
      insertSession.run({
        source: 'cli',
        model: null,
        title: null,
        parent_session_id: null,
        thread_id: null,
        session_kind: null,
        is_user_visible: 1,
        ended_at: null,
        message_count: 0,
        ...session,
      });
    });
    messages.forEach((message) => insertMessage.run({
      id: null,
      tool_calls: null,
      tool_call_id: null,
      tool_name: null,
      finish_reason: null,
      reasoning: null,
      reasoning_content: null,
      reasoning_details: null,
      codex_reasoning_items: null,
      codex_message_items: null,
      ...message,
    }));
  });
  tx();
  db.close();
}
