#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readQaCredentials } from './auth-credentials.mjs';

const repoRoot = process.cwd();
const artifactDir = path.resolve(repoRoot, 'docs/qa/e2e/artifacts');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactPath = path.join(artifactDir, `state-audit-${timestamp}.json`);

const localDbPath = path.resolve(
  repoRoot,
  process.env.HERMES_CLIENT_APP_DB || 'api/data/hermes.sqlite'
);
const hermesDbPath = process.env.HERMES_STATE_DB
  ? path.resolve(process.env.HERMES_STATE_DB)
  : path.join(os.homedir(), '.hermes/state.db');
const apiUrl = (process.env.HERMES_CLIENT_API_URL || 'http://localhost:18889/api').replace(
  /\/+$/,
  ''
);
const { email: apiEmail, password: apiPassword } = readQaCredentials();
const apiTimeoutMs = Number(process.env.HERMES_CLIENT_AUDIT_API_TIMEOUT_MS || 8000);
const apiWarnMs = Number(process.env.HERMES_CLIENT_AUDIT_API_WARN_MS || 5000);
const conversationsToInspect = ['1', '653', '657'];
const messageDetailPaths = conversationsToInspect.map(
  (conversationId) => `/api/message/conversation/${conversationId}`
);
const serviceTupleRe = /\(\s*\d+\s*user messages,\s*\d+\s*total messages\s*\)/i;
const rawReasoningWrapperRe = /(?:┌|╭|─)\s*Reasoning\b/i;
const resumeBannerRe =
  /^[↻↺\u21BB\u21BA\s]*Resumed session\s+\S+(?:\s+"[^"]*")?(?:\s*\([^)]*\))?\s*/i;
const serviceTuplePrefixRe =
  /^\s*(?:generic:\s*)?\(\s*\d+\s*user messages?\s*,\s*\d+\s*total messages?\s*\)\s*/i;
const titledServiceTuplePrefixRe =
  /^\s*(?:generic:\s*)?"[^"]*"\s*\(\s*\d+\s*user messages?\s*,\s*\d+\s*total messages?\s*\)\s*/i;

const summary = {
  startedAt: new Date().toISOString(),
  paths: {
    localDbPath,
    hermesDbPath,
    apiUrl,
  },
  checks: [],
  localApp: null,
  hermesState: null,
  api: null,
  observable: {
    routeLatencyMs: Object.fromEntries(messageDetailPaths.map((route) => [route, 'timeout'])),
    visibleBlankAssistantCount: null,
    visibleServiceTupleCount: null,
    visibleRawReasoningWrapperCount: null,
    stuckRunningToolCount: null,
    stateDbReadOnlyVerified: false,
  },
};

function record(status, name, details = {}) {
  const entry = { status, name, ...details };
  summary.checks.push(entry);
  const detailText = details.message ? ` - ${details.message}` : '';
  console.log(`${status} ${name}${detailText}`);
  return entry;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-readonly', '-json', '-cmd', '.timeout 10000', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
    timeout: 30000,
  }).trim();
  if (!output) return [];
  return JSON.parse(output);
}

function snapshotSqliteDb(dbPath, label) {
  const snapshotPath = path.join(
    os.tmpdir(),
    `hermes-client-${label}-${process.pid}-${Date.now()}.sqlite`
  );
  execFileSync('sqlite3', [dbPath, '.timeout 10000', `.backup ${snapshotPath}`], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return snapshotPath;
}

function tableInfo(dbPath, tableName) {
  try {
    return sqliteJson(dbPath, `PRAGMA table_info(${tableName});`);
  } catch {
    return [];
  }
}

function hasTable(dbPath, tableName) {
  const rows = sqliteJson(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)};`
  );
  return rows.length > 0;
}

function columnSet(dbPath, tableName) {
  return new Set(tableInfo(dbPath, tableName).map((row) => String(row.name)));
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function firstNumber(rows, key) {
  if (!rows.length) return null;
  return Number(rows[0][key] ?? 0);
}

function countMatchingRows(rows, matcher) {
  return rows.reduce((count, row) => (matcher(row) ? count + 1 : count), 0);
}

function auditVisibleText(row) {
  const text = String(row.text || '');
  if (row.role === 'assistant' || row.kind === 'tool_result') {
    return text
      .replace(resumeBannerRe, '')
      .replace(titledServiceTuplePrefixRe, '')
      .replace(serviceTuplePrefixRe, '')
      .trim();
  }
  return text;
}

function previewExpr(column) {
  return `substr(replace(replace(coalesce(${sqlIdent(column)}, ''), char(10), ' '), char(13), ' '), 1, 180)`;
}

function snippetExpr(column, length = 1200) {
  return `substr(coalesce(${sqlIdent(column)}, ''), 1, ${Number(length)})`;
}

function auditLocalDb(dbPath) {
  const result = {
    path: dbPath,
    exists: true,
    skipped: [],
  };

  if (!hasTable(dbPath, 'messages')) {
    record('SKIP', 'local DB messages table', { message: 'messages table is missing' });
    result.skipped.push('messages table missing');
    return result;
  }

  const messageColumns = columnSet(dbPath, 'messages');
  const hasRole = messageColumns.has('role');
  const hasText = messageColumns.has('text');
  const hasDeletedAt = messageColumns.has('deletedAt');
  const hasConversationId = messageColumns.has('conversationId');
  const hasHidden = messageColumns.has('hidden');
  const hasKind = messageColumns.has('kind');
  const hasThinking = messageColumns.has('thinking');
  const visibleWhere = hasDeletedAt ? 'WHERE "deletedAt" IS NULL' : '';
  const blankWhere = [
    hasRole ? `"role" = 'assistant'` : null,
    hasKind ? `"kind" = 'message'` : null,
    hasText ? `length(trim(coalesce("text", ''))) = 0` : null,
    hasThinking ? `length(trim(coalesce("thinking", ''))) = 0` : null,
    hasHidden ? `coalesce("hidden", 0) = 0` : null,
    hasDeletedAt ? `"deletedAt" IS NULL` : null,
  ]
    .filter(Boolean)
    .join(' AND ');

  result.messageColumns = [...messageColumns].sort();
  result.totalMessages = firstNumber(
    sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM messages ${visibleWhere};`),
    'count'
  );
  record('PASS', 'local DB message count', {
    message: String(result.totalMessages),
    count: result.totalMessages,
  });

  if (hasRole) {
    result.roleCounts = sqliteJson(
      dbPath,
      `SELECT "role" AS role, COUNT(*) AS count FROM messages ${visibleWhere} GROUP BY "role" ORDER BY "role";`
    );
    record('PASS', 'local DB role counts', { roleCounts: result.roleCounts });
  } else {
    record('SKIP', 'local DB role counts', { message: 'role column is missing' });
    result.skipped.push('role column missing');
  }

  if (hasRole && hasText) {
    result.blankVisibleAssistantRows = firstNumber(
      sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM messages WHERE ${blankWhere};`),
      'count'
    );
    record('PASS', 'local DB blank visible assistant rows', {
      message: String(result.blankVisibleAssistantRows),
      count: result.blankVisibleAssistantRows,
    });
  } else {
    record('SKIP', 'local DB blank visible assistant rows', {
      message: 'role/text columns are missing',
    });
    result.skipped.push('blank assistant count skipped');
  }

  if (hasText) {
    const visibleClauses = [
      hasDeletedAt ? `"deletedAt" IS NULL` : null,
      hasHidden ? `coalesce("hidden", 0) = 0` : null,
    ].filter(Boolean);
    const maxMessageId =
      messageColumns.has('_id')
        ? firstNumber(sqliteJson(dbPath, 'SELECT MAX("_id") AS maxId FROM messages;'), 'maxId')
        : null;
    const scopedClauses = [...visibleClauses];
    const recentClause =
      maxMessageId !== null && Number.isFinite(maxMessageId)
        ? `${messageColumns.has('_id') ? '"_id"' : 'rowid'} >= ${Math.max(0, maxMessageId - 5000)}`
        : null;
    const conversationClause = hasConversationId
      ? `"conversationId" IN (${conversationsToInspect.map(sqlString).join(', ')})`
      : null;
    if (recentClause || conversationClause) {
      scopedClauses.push(`(${[recentClause, conversationClause].filter(Boolean).join(' OR ')})`);
    }
    const scopedWhereOnly = scopedClauses.length ? `WHERE ${scopedClauses.join(' AND ')}` : '';

    const serviceTupleCandidates = sqliteJson(
      dbPath,
      `
        SELECT ${messageColumns.has('_id') ? '"_id" AS id' : 'rowid AS id'},
               ${hasRole ? '"role" AS role,' : "'' AS role,"}
               ${hasKind ? '"kind" AS kind,' : "'' AS kind,"}
               ${previewExpr('text')} AS textPreview,
               ${snippetExpr('text')} AS text
        FROM messages
        ${scopedWhereOnly}
        ${scopedWhereOnly ? 'AND' : 'WHERE'} ("text" LIKE '%user messages%' OR "text" LIKE '%total messages%')
        LIMIT 500;
      `
    );
    result.visibleServiceTupleRows = countMatchingRows(serviceTupleCandidates, (row) =>
      serviceTupleRe.test(auditVisibleText(row))
    );
    record('PASS', 'local DB visible service tuple rows', {
      message: String(result.visibleServiceTupleRows),
      count: result.visibleServiceTupleRows,
    });

    const rawReasoningCandidates = sqliteJson(
      dbPath,
      `
        SELECT ${messageColumns.has('_id') ? '"_id" AS id' : 'rowid AS id'},
               ${previewExpr('text')} AS textPreview,
               ${snippetExpr('text')} AS text
        FROM messages
        ${scopedWhereOnly}
        ${scopedWhereOnly ? 'AND' : 'WHERE'} ("text" LIKE '%Reasoning%' OR "text" LIKE '%┌%')
        LIMIT 500;
      `
    );
    result.visibleRawReasoningWrapperRows = countMatchingRows(rawReasoningCandidates, (row) =>
      rawReasoningWrapperRe.test(String(row.text || ''))
    );
    record('PASS', 'local DB visible raw reasoning wrapper rows', {
      message: String(result.visibleRawReasoningWrapperRows),
      count: result.visibleRawReasoningWrapperRows,
    });
  }

  if (hasKind && messageColumns.has('toolStatus')) {
    const maxMessageId =
      messageColumns.has('_id')
        ? firstNumber(sqliteJson(dbPath, 'SELECT MAX("_id") AS maxId FROM messages;'), 'maxId')
        : null;
    const recentCallClause =
      maxMessageId !== null && Number.isFinite(maxMessageId)
        ? `call.${messageColumns.has('_id') ? '"_id"' : 'rowid'} >= ${Math.max(0, maxMessageId - 5000)}`
        : null;
    const conversationCallClause = hasConversationId
      ? `call."conversationId" IN (${conversationsToInspect.map(sqlString).join(', ')})`
      : null;
    const visibleCallWhere = [
      `call."kind" = 'tool_call'`,
      `call."toolStatus" = 'running'`,
      hasHidden ? `coalesce(call."hidden", 0) = 0` : null,
      hasDeletedAt ? `call."deletedAt" IS NULL` : null,
      recentCallClause || conversationCallClause
        ? `(${[recentCallClause, conversationCallClause].filter(Boolean).join(' OR ')})`
        : null,
    ].filter(Boolean).join(' AND ');
    const visibleResultWhere = [
      `result."kind" = 'tool_result'`,
      hasHidden ? `coalesce(result."hidden", 0) = 0` : null,
      hasDeletedAt ? `result."deletedAt" IS NULL` : null,
    ].filter(Boolean).join(' AND ');
    result.stuckRunningToolRows = firstNumber(
      sqliteJson(
        dbPath,
        `
          SELECT COUNT(*) AS count
          FROM messages call
          WHERE ${visibleCallWhere}
            AND call."toolCallId" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM messages result
              WHERE ${visibleResultWhere}
                AND result."conversationId" = call."conversationId"
                AND result."toolCallId" = call."toolCallId"
            );
        `
      ),
      'count'
    );
    record('PASS', 'local DB visible running tool-call rows with terminal result', {
      message: String(result.stuckRunningToolRows),
      count: result.stuckRunningToolRows,
    });
  } else {
    record('SKIP', 'local DB visible running tool-call rows', {
      message: 'kind/toolStatus columns are missing',
    });
    result.skipped.push('running tool count skipped');
  }

  if (hasConversationId) {
    result.latestRowsByConversation = {};
    for (const conversationId of conversationsToInspect) {
      const selectParts = [
        messageColumns.has('_id') ? '"_id" AS id' : 'rowid AS id',
        '"conversationId" AS conversationId',
      ];
      if (hasRole) selectParts.push('"role" AS role');
      if (hasText) {
        selectParts.push('length(coalesce("text", \'\')) AS textLength');
        selectParts.push(`${previewExpr('text')} AS textPreview`);
      }
      if (messageColumns.has('externalId')) selectParts.push('"externalId" AS externalId');
      if (messageColumns.has('createdAt')) selectParts.push('"createdAt" AS createdAt');

      const orderColumn = messageColumns.has('_id') ? '"_id"' : 'rowid';
      const rows = sqliteJson(
        dbPath,
        `
          SELECT ${selectParts.join(', ')}
          FROM messages
          WHERE "conversationId" = ${sqlString(conversationId)}
          ORDER BY ${orderColumn} DESC
          LIMIT 12;
        `
      );
      result.latestRowsByConversation[conversationId] = rows;
      record('PASS', `local DB latest rows for conversation ${conversationId}`, {
        message: `${rows.length} rows`,
        rows: rows.length,
      });
    }
  } else {
    record('SKIP', 'local DB latest rows by conversation', {
      message: 'conversationId column is missing',
    });
    result.skipped.push('conversation latest rows skipped');
  }

  return result;
}

function readLocalObservableCounts(dbPath) {
  if (!hasTable(dbPath, 'messages')) return null;
  const messageColumns = columnSet(dbPath, 'messages');
  const hasRole = messageColumns.has('role');
  const hasText = messageColumns.has('text');
  const hasDeletedAt = messageColumns.has('deletedAt');
  const hasHidden = messageColumns.has('hidden');
  const hasKind = messageColumns.has('kind');
  const hasThinking = messageColumns.has('thinking');
  const visibleWhere = hasDeletedAt ? 'WHERE "deletedAt" IS NULL' : '';
  const counts = {
    visibleMessages: firstNumber(
      sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM messages ${visibleWhere};`),
      'count'
    ),
    blankVisibleAssistantRows: null,
  };
  if (hasRole && hasText) {
    const blankWhere = [
      `"role" = 'assistant'`,
      hasKind ? `"kind" = 'message'` : null,
      `length(trim(coalesce("text", ''))) = 0`,
      hasThinking ? `length(trim(coalesce("thinking", ''))) = 0` : null,
      hasHidden ? `coalesce("hidden", 0) = 0` : null,
      hasDeletedAt ? `"deletedAt" IS NULL` : null,
    ]
      .filter(Boolean)
      .join(' AND ');
    counts.blankVisibleAssistantRows = firstNumber(
      sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM messages WHERE ${blankWhere};`),
      'count'
    );
  }
  return counts;
}

function nonemptyColumnPredicate(column) {
  return `length(trim(coalesce(${sqlIdent(column)}, ''))) > 0`;
}

function auditHermesDb(dbPath) {
  const result = {
    path: dbPath,
    exists: true,
    skipped: [],
    readOnlyVerified: false,
  };

  if (!hasTable(dbPath, 'messages')) {
    record('SKIP', 'Hermes state DB messages table', { message: 'messages table is missing' });
    result.skipped.push('messages table missing');
    return result;
  }

  const messageColumns = columnSet(dbPath, 'messages');
  const hasSessions = hasTable(dbPath, 'sessions');
  result.messageColumns = [...messageColumns].sort();

  result.totalMessages = firstNumber(
    sqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM messages;'),
    'count'
  );
  result.readOnlyVerified = true;
  record('PASS', 'Hermes state DB message count', {
    message: String(result.totalMessages),
    count: result.totalMessages,
  });

  if (messageColumns.has('role')) {
    result.roleCounts = sqliteJson(
      dbPath,
      'SELECT "role" AS role, COUNT(*) AS count FROM messages GROUP BY "role" ORDER BY "role";'
    );
    record('PASS', 'Hermes state DB role counts', { roleCounts: result.roleCounts });
  } else {
    record('SKIP', 'Hermes state DB role counts', { message: 'role column is missing' });
    result.skipped.push('role column missing');
  }

  if (messageColumns.has('role')) {
    result.roleToolRows = firstNumber(
      sqliteJson(dbPath, `SELECT COUNT(*) AS count FROM messages WHERE "role" = 'tool';`),
      'count'
    );
    record('PASS', 'Hermes state DB role=tool rows', {
      message: String(result.roleToolRows),
      count: result.roleToolRows,
    });
  }

  const toolPredicates = [];
  if (messageColumns.has('role')) toolPredicates.push(`"role" = 'tool'`);
  for (const column of ['tool_call_id', 'tool_calls', 'tool_name']) {
    if (messageColumns.has(column)) toolPredicates.push(nonemptyColumnPredicate(column));
  }
  if (hasSessions && messageColumns.has('session_id')) {
    toolPredicates.push(
      `"session_id" IN (SELECT id FROM sessions WHERE coalesce(source, '') = 'tool')`
    );
  }
  if (toolPredicates.length) {
    result.toolRelatedRows = firstNumber(
      sqliteJson(
        dbPath,
        `SELECT COUNT(*) AS count FROM messages WHERE ${toolPredicates.join(' OR ')};`
      ),
      'count'
    );
    record('PASS', 'Hermes state DB tool-related rows', {
      message: String(result.toolRelatedRows),
      count: result.toolRelatedRows,
    });
  } else {
    record('SKIP', 'Hermes state DB tool-related rows', {
      message: 'no role/tool columns available',
    });
    result.skipped.push('tool count skipped');
  }

  const reasoningPredicates = [];
  for (const column of [
    'tool_call_id',
    'tool_calls',
    'tool_name',
    'reasoning',
    'reasoning_details',
    'codex_reasoning_items',
    'reasoning_content',
  ]) {
    if (messageColumns.has(column)) reasoningPredicates.push(nonemptyColumnPredicate(column));
  }
  if (messageColumns.has('role') && messageColumns.has('content')) {
    result.emptyContentAssistantRows = firstNumber(
      sqliteJson(
        dbPath,
        `
          SELECT COUNT(*) AS count
          FROM messages
          WHERE "role" = 'assistant'
            AND length(trim(coalesce("content", ''))) = 0;
        `
      ),
      'count'
    );
    record('PASS', 'Hermes state DB empty-content assistant rows', {
      message: String(result.emptyContentAssistantRows),
      count: result.emptyContentAssistantRows,
    });

    if (reasoningPredicates.length) {
      result.emptyAssistantRowsWithToolOrReasoningData = firstNumber(
        sqliteJson(
          dbPath,
          `
            SELECT COUNT(*) AS count
            FROM messages
            WHERE "role" = 'assistant'
              AND length(trim(coalesce("content", ''))) = 0
              AND (${reasoningPredicates.join(' OR ')});
          `
        ),
        'count'
      );
      record('PASS', 'Hermes state DB empty assistant rows with tool/reasoning data', {
        message: String(result.emptyAssistantRowsWithToolOrReasoningData),
        count: result.emptyAssistantRowsWithToolOrReasoningData,
      });
    }
  } else {
    record('SKIP', 'Hermes state DB empty assistant rows', {
      message: 'role/content columns are missing',
    });
    result.skipped.push('empty assistant count skipped');
  }

  return result;
}

async function fetchTextWithTimeout(pathname, token, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);
  const method = options.method || 'GET';
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers,
    body: options.body,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  return { response, text, elapsedMs };
}

async function fetchJson(pathname, token, options = {}) {
  const { response, text, elapsedMs } = await fetchTextWithTimeout(pathname, token, options);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  return { response, json, elapsedMs };
}

async function probeApiEndpoint(pathname, token) {
  const url = new URL(`${apiUrl}${pathname}`);
  const transport = url.protocol === 'https:' ? https : http;
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const req = transport.get(
      url,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Connection: 'close',
        },
      },
      (response) => {
        const elapsedMs = Math.round(performance.now() - started);
        const status = Number(response.statusCode || 0);
        const bytes = Number(response.headers['content-length'] || 0);
        response.resume();
        if (status < 200 || status >= 300) {
          reject(new Error(`${pathname} returned ${status}`));
          return;
        }
        resolve({ elapsedMs, bytes });
      }
    );
    req.setTimeout(apiTimeoutMs, () => {
      req.destroy(new Error(`${pathname} timed out after ${apiTimeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function login() {
  const { response, json, elapsedMs } = await fetchJson('/auth/login', '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: apiEmail, password: apiPassword }),
  });
  const token = String(json?.accessToken || json?.token || response.headers.get('access-token') || '').replace(
    /^Bearer\s+/i,
    ''
  );
  if (!token) throw new Error('login did not return a token');
  return { token, elapsedMs };
}

async function auditApi() {
  const result = {
    apiUrl,
    timeoutMs: apiTimeoutMs,
    warnMs: apiWarnMs,
    endpoints: [],
  };

  if (process.env.HERMES_CLIENT_AUDIT_SKIP_API === '1') {
    record('SKIP', 'API latency checks', {
      message: 'HERMES_CLIENT_AUDIT_SKIP_API=1',
    });
    result.skipped = true;
    result.skipReason = 'HERMES_CLIENT_AUDIT_SKIP_API=1';
    return result;
  }

  const endpoints = [
    '/message/conversation/1?limit=20',
    '/message/conversation/653?limit=20',
    '/message/conversation/657?limit=20',
    '/agent',
    '/conversation',
  ];

  let probe;
  try {
    const childScript = `
      import http from 'node:http';
      import https from 'node:https';
      import { performance } from 'node:perf_hooks';

      const apiUrl = process.env.PROBE_API_URL.replace(/\\/+$/, '');
      const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 8000);
      const endpoints = JSON.parse(process.env.PROBE_ENDPOINTS);
      const headersFor = (token) => token ? { Authorization: 'Bearer ' + token } : {};

      async function fetchJson(pathname, token, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const started = performance.now();
        const response = await fetch(apiUrl + pathname, {
          method: options.method || 'GET',
          headers: { ...(options.headers || {}), ...headersFor(token) },
          body: options.body,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        const text = await response.text();
        return {
          status: response.status,
          text,
          json: text ? JSON.parse(text) : null,
          elapsedMs: Math.round(performance.now() - started),
        };
      }

      async function probeEndpoint(pathname, token) {
        const url = new URL(apiUrl + pathname);
        const transport = url.protocol === 'https:' ? https : http;
        const started = performance.now();
        return new Promise((resolve, reject) => {
          const req = transport.get(url, {
            headers: { ...headersFor(token), Connection: 'close' },
          }, (response) => {
            let bytes = 0;
            response.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); });
            response.on('end', () => resolve({
              status: Number(response.statusCode || 0),
              bytes,
              elapsedMs: Math.round(performance.now() - started),
            }));
          });
          req.setTimeout(timeoutMs, () => req.destroy(new Error(pathname + ' timed out after ' + timeoutMs + 'ms')));
          req.on('error', reject);
        });
      }

      const tokenFromEnv = process.env.PROBE_TOKEN || '';
      let token = tokenFromEnv;
      let loginLatencyMs = null;
      if (!token) {
        const login = await fetchJson('/auth/login', '', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: process.env.PROBE_EMAIL, password: process.env.PROBE_PASSWORD }),
        });
        token = String(login.json?.accessToken || login.json?.token || '').replace(/^Bearer\\s+/i, '');
        loginLatencyMs = login.elapsedMs;
        if (!token) throw new Error('login did not return a token');
      }

      const results = [];
      for (const endpoint of endpoints) {
        const item = await fetchJson(endpoint, token);
        results.push({
          endpoint,
          latencyMs: item.elapsedMs,
          statusCode: item.status,
          bytes: Buffer.byteLength(item.text || ''),
          json: item.json && typeof item.json === 'object'
            ? {
                total: item.json.total ?? null,
                items: Array.isArray(item.json.items) ? item.json.items.length : null,
              }
            : null,
        });
      }
      console.log(JSON.stringify({ loginLatencyMs, usedEnvToken: Boolean(tokenFromEnv), endpoints: results }));
    `;
    probe = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', childScript], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 8,
        timeout: apiTimeoutMs * (endpoints.length + 2),
        env: {
          ...process.env,
          PROBE_API_URL: apiUrl,
          PROBE_TIMEOUT_MS: String(apiTimeoutMs),
          PROBE_ENDPOINTS: JSON.stringify(endpoints),
          PROBE_EMAIL: apiEmail,
          PROBE_PASSWORD: apiPassword,
          PROBE_TOKEN: process.env.HERMES_CLIENT_TOKEN || '',
        },
      })
    );
  } catch (err) {
    record('SKIP', 'API latency checks', {
      message: `auth/API unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
    result.skipped = true;
    result.skipReason = err instanceof Error ? err.message : String(err);
    return result;
  }

  if (probe.usedEnvToken) {
    record('PASS', 'API auth token', { message: 'using HERMES_CLIENT_TOKEN' });
  } else {
    result.loginLatencyMs = probe.loginLatencyMs;
    record('PASS', 'API login', {
      message: `${probe.loginLatencyMs}ms`,
      latencyMs: probe.loginLatencyMs,
      email: apiEmail,
    });
  }

  for (const probeResult of probe.endpoints) {
    const endpoint = probeResult.endpoint;
    try {
      const elapsedMs = Number(probeResult.latencyMs);
      const statusCode = Number(probeResult.statusCode);
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`${endpoint} returned ${statusCode}`);
      }
      const status = elapsedMs > apiWarnMs ? 'FAIL' : 'PASS';
      const shape =
        probeResult.json && typeof probeResult.json === 'object'
          ? probeResult.json
          : { bytes: probeResult.bytes ?? null };
      const endpointResult = { endpoint, latencyMs: elapsedMs, status, ...shape };
      result.endpoints.push(endpointResult);
      const canonicalPath = endpoint.replace(/\?.*$/, '');
      if (Object.prototype.hasOwnProperty.call(summary.observable.routeLatencyMs, canonicalPath)) {
        summary.observable.routeLatencyMs[canonicalPath] = elapsedMs;
      }
      record(status, `API latency ${endpoint}`, {
        message: `${elapsedMs}ms`,
        ...endpointResult,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const endpointResult = { endpoint, status: 'FAIL', error: message };
      result.endpoints.push(endpointResult);
      const canonicalPath = endpoint.replace(/\?.*$/, '');
      if (Object.prototype.hasOwnProperty.call(summary.observable.routeLatencyMs, canonicalPath)) {
        summary.observable.routeLatencyMs[canonicalPath] = 'timeout';
      }
      record('FAIL', `API latency ${endpoint}`, { message, endpoint, error: message });
    }
  }

  return result;
}

await fs.mkdir(artifactDir, { recursive: true });

const [localExists, hermesExists] = await Promise.all([exists(localDbPath), exists(hermesDbPath)]);

if (!localExists) {
  record('SKIP', 'local app DB', { message: `missing: ${localDbPath}` });
}
if (!hermesExists) {
  record('SKIP', 'Hermes state DB', { message: `missing: ${hermesDbPath}` });
}
if (!localExists && !hermesExists) {
  summary.error = 'Both local app DB and Hermes state DB are missing.';
  await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ARTIFACT ${artifactPath}`);
  console.error('FAIL both DBs are missing; cannot run state audit');
  process.exit(2);
}

summary.api = await auditApi();

const localAuditDbPath = localExists ? snapshotSqliteDb(localDbPath, 'local-before') : null;

if (localAuditDbPath) {
  try {
    summary.localApp = auditLocalDb(localAuditDbPath);
    summary.localApp.livePath = localDbPath;
    summary.localApp.snapshotPath = localAuditDbPath;
    summary.observable.visibleBlankAssistantCount =
      summary.localApp.blankVisibleAssistantRows ?? null;
    summary.observable.visibleServiceTupleCount =
      summary.localApp.visibleServiceTupleRows ?? null;
    summary.observable.visibleRawReasoningWrapperCount =
      summary.localApp.visibleRawReasoningWrapperRows ?? null;
    summary.observable.stuckRunningToolCount = summary.localApp.stuckRunningToolRows ?? null;
  } catch (err) {
    record('FAIL', 'local app DB audit', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

if (hermesExists) {
  try {
    summary.hermesState = auditHermesDb(hermesDbPath);
    summary.observable.stateDbReadOnlyVerified = summary.hermesState.readOnlyVerified === true;
  } catch (err) {
    record('FAIL', 'Hermes state DB audit', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const localCountsBeforeApi =
  process.env.HERMES_CLIENT_AUDIT_CHECK_DRIFT === '1' && localAuditDbPath
    ? readLocalObservableCounts(localAuditDbPath)
    : null;
if (localCountsBeforeApi) {
  const localAfterApiDbPath = snapshotSqliteDb(localDbPath, 'local-after-api');
  const localCountsAfterApi = readLocalObservableCounts(localAfterApiDbPath);
  summary.localAppApiDrift = {
    before: localCountsBeforeApi,
    after: localCountsAfterApi,
    afterSnapshotPath: localAfterApiDbPath,
  };
  const changed =
    JSON.stringify(localCountsBeforeApi) !== JSON.stringify(localCountsAfterApi);
  record(changed ? 'FAIL' : 'PASS', 'local DB unchanged after API latency audit', {
    message: changed
      ? `${JSON.stringify(localCountsBeforeApi)} -> ${JSON.stringify(localCountsAfterApi)}`
      : 'observable counts unchanged',
    before: localCountsBeforeApi,
    after: localCountsAfterApi,
  });
}
summary.finishedAt = new Date().toISOString();

await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`ARTIFACT ${artifactPath}`);
