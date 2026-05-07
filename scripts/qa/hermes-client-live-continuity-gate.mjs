#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readQaCredentials } from './auth-credentials.mjs';

const appUrl = (process.env.HERMES_CLIENT_URL || 'http://localhost:18888').replace(/\/+$/, '');
const apiUrl = (process.env.HERMES_CLIENT_API_URL || 'http://localhost:18889/api').replace(/\/+$/, '');
const { email, password } = readQaCredentials();
const conversationId = process.env.HERMES_CLIENT_QA_CONVERSATION_ID || '655';
const baselineSentinel = process.env.HERMES_CLIENT_QA_SENTINEL || 'QA_CONTINUITY_CURRENT_20260429';
const expected = process.env.HERMES_CLIENT_LIVE_EXPECTED || 'LIVE_CONTINUITY_OK_20260429';
const prompt =
  process.env.HERMES_CLIENT_LIVE_PROMPT ||
  `Reply exactly ${expected} and nothing else.`;
const artifactDir = path.resolve('docs/qa/e2e/artifacts');

if (process.env.HERMES_CLIENT_CONFIRM_LIVE !== '1') {
  console.error(
    'Refusing to run live continuity gate without HERMES_CLIENT_CONFIRM_LIVE=1. ' +
      'This sends a prompt through the live Hermes backend.'
  );
  process.exit(64);
}

const summary = {
  startedAt: new Date().toISOString(),
  appUrl,
  apiUrl,
  conversationId,
  baselineSentinel,
  expected,
  prompt,
  checks: [],
};

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function check(name, fn) {
  try {
    const details = await fn();
    const safeDetails =
      details && typeof details === 'object' && !Array.isArray(details) ? details : {};
    record(name, true, safeDetails);
    return details;
  } catch (err) {
    record(name, false, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON (${res.status}): ${text.slice(0, 240)}`);
  }
  if (!res.ok) throw new Error(`${url} returned ${res.status}: ${text.slice(0, 240)}`);
  return { res, json };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login() {
  const { res, json } = await fetchJson(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = String(json?.accessToken || res.headers.get('access-token') || '').replace(
    /^Bearer\s+/i,
    ''
  );
  if (!token) throw new Error('login did not return token');
  return token;
}

async function readConversation(token, limit = 80) {
  const { json } = await fetchJson(`${apiUrl}/message/conversation/${conversationId}?limit=${limit}`, {
    headers: authHeaders(token),
  });
  return json?.items ?? [];
}

async function sendLivePrompt(token) {
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('text', prompt);

  const res = await fetch(`${apiUrl}/message/chat`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`live send failed ${res.status}: ${body.slice(0, 800)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';
  let sessionId = null;
  let messageId = null;
  const events = [];

  const consume = (line) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      events.push('[DONE]');
      return;
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      events.push('raw');
      return;
    }
    events.push(event.type || 'unknown');
    if (event.type === 'response.output_text.delta' && event.delta) assistantText += event.delta;
    if (event.type === 'response.error') {
      throw new Error(String(event.delta || event.error || event.message || 'live stream error'));
    }
    if (event.type === 'session.update') sessionId = event.sessionId || null;
    if (event.type === 'message.saved') messageId = event.messageId || null;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    parts.forEach(consume);
  }
  if (buffer.trim()) consume(buffer.trim());

  return {
    assistantText: assistantText.trim(),
    sessionId,
    messageId,
    events,
  };
}

await fs.mkdir(artifactDir, { recursive: true });
let token = '';
await check('login for live gate', async () => {
  token = await login();
  return { email };
});

await check('old conversation contains baseline continuity sentinel', async () => {
  const messages = await readConversation(token, 120);
  const allText = messages.map((m) => m.text || '').join('\n');
  if (!allText.includes(baselineSentinel)) {
    throw new Error(`baseline sentinel missing: ${baselineSentinel}`);
  }
  return { messageCount: messages.length };
});

const sendResult = await check('live send returns expected assistant text', async () => {
  const result = await sendLivePrompt(token);
  if (result.assistantText.trim() !== expected) {
    throw new Error(`expected exactly ${expected}, got ${JSON.stringify(result.assistantText)}`);
  }
  if (!result.sessionId) throw new Error('stream did not emit session.update');
  if (!result.messageId) throw new Error('stream did not emit message.saved');
  return result;
});

await check('live response persists after refetch-equivalent reload', async () => {
  const messages = await readConversation(token, 120);
  const latestPromptIndex = messages.map((m) => m.text).lastIndexOf(prompt);
  if (latestPromptIndex === -1) throw new Error('latest live prompt was not persisted');
  const turnMessages = messages.slice(latestPromptIndex + 1);
  const assistantsAfterPrompt = turnMessages.filter((m) => m.role === 'assistant');
  if (assistantsAfterPrompt.length !== 1) {
    throw new Error(`expected exactly one assistant after latest prompt, got ${assistantsAfterPrompt.length}`);
  }
  const assistant = assistantsAfterPrompt[0];
  if (String(assistant.text || '').trim() !== expected) {
    throw new Error(
      `persisted assistant text mismatch: ${JSON.stringify(assistant.text)}`
    );
  }
  if (assistant._id !== sendResult.messageId) {
    throw new Error(`persisted assistant id mismatch: ${assistant._id} != ${sendResult.messageId}`);
  }
  if (!assistant.externalId) {
    throw new Error('persisted assistant is missing Hermes externalId');
  }
  if (sendResult.sessionId && !String(assistant.externalId).startsWith(`${sendResult.sessionId}:`)) {
    throw new Error(
      `persisted assistant externalId ${assistant.externalId} does not belong to ${sendResult.sessionId}`
    );
  }
  return {
    messageCount: messages.length,
    turnMessages: turnMessages.map((m) => ({
      id: m._id,
      role: m.role,
      text: m.text,
      externalId: m.externalId || null,
    })),
  };
});

summary.result = sendResult;
const artifactPath = path.join(
  artifactDir,
  `live-continuity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`ARTIFACT ${artifactPath}`);
