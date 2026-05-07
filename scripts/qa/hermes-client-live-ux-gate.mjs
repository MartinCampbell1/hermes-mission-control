#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readQaCredentials } from './auth-credentials.mjs';

const appUrl = (process.env.HERMES_CLIENT_URL || 'http://localhost:18888').replace(/\/+$/, '');
const apiUrl = (process.env.HERMES_CLIENT_API_URL || 'http://localhost:18889/api').replace(/\/+$/, '');
const { email, password } = readQaCredentials();
const artifactDir = path.resolve('docs/qa/e2e/artifacts');
const liveSend = process.env.HERMES_CLIENT_LIVE_SEND === '1';
const routes = ['/agent/1/chat/1', '/agent/1/chat/653', '/agent/1/chat/657'];
const loadingTextRe =
  /Checking authentication|Loading workspace|Loading conversation|Проверка входа|Загрузка Workspace|Загрузка чата/i;
const composerSelector = [
  'textarea[placeholder="Type a message..."]',
  'input[placeholder="Type a message..."]',
  'textarea[placeholder="Напишите сообщение..."]',
  'input[placeholder="Напишите сообщение..."]',
  'textarea[placeholder="Draft the next message..."]',
  'textarea[placeholder="Пишите следующий prompt..."]',
  'textarea:not([aria-hidden="true"])',
].join(', ');

const summary = {
  startedAt: new Date().toISOString(),
  appUrl,
  liveSend,
  checks: [],
};

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

function hasTimestampOnlyStack(text) {
  let consecutive = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(line)) {
      consecutive += 1;
      if (consecutive >= 3) return true;
      continue;
    }
    if (line) consecutive = 0;
  }
  return false;
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: 'chrome',
      headless: process.env.HERMES_CLIENT_QA_HEADLESS !== '0',
    });
  } catch (err) {
    if (process.env.HERMES_CLIENT_QA_ALLOW_CHROMIUM_FALLBACK === '1') {
      return chromium.launch({ headless: process.env.HERMES_CLIENT_QA_HEADLESS !== '0' });
    }
    throw err;
  }
}

async function login(page) {
  const response = await page.request.post(`${apiUrl}/auth/login`, {
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(`API login failed: ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.accessToken) throw new Error('API login did not return accessToken.');
  await page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((token) => localStorage.setItem('token', token), body.accessToken);
}

async function inspectRoute(page, route) {
  const started = Date.now();
  await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  let settled = false;
  while (Date.now() - started < 5_000) {
    const text = await page.locator('body').innerText().catch(() => '');
    const composerVisible =
      (await page
        .locator(composerSelector)
        .count()
        .catch(() => 0)) > 0;
    if (composerVisible && !loadingTextRe.test(text)) {
      settled = true;
      break;
    }
    await page.waitForTimeout(150);
  }

  const text = await page.locator('body').innerText().catch(() => '');
  const result = {
    route,
    finalUrl: page.url(),
    settledWithinMs: settled ? Date.now() - started : null,
    spinnerOnlyAfter5s: !settled && (await page.getByRole('progressbar').count().catch(() => 0)) > 0,
    visibleServiceTuple: /\(\s*\d+\s*user messages,\s*\d+\s*total messages\s*\)/i.test(text),
    visibleRawReasoningWrapper: /┌─\s*Reasoning/i.test(text),
    visibleBlankTimestampBubble: hasTimestampOnlyStack(text),
    textLength: text.length,
    textPreview: text.trim().slice(0, 500),
  };
  const ok =
    settled &&
    !result.spinnerOnlyAfter5s &&
    !result.visibleServiceTuple &&
    !result.visibleRawReasoningWrapper &&
    !result.visibleBlankTimestampBubble;
  record(`read-only UX ${route}`, ok, result);
  if (!ok) throw new Error(`read-only UX gate failed for ${route}`);
}

async function liveSendProbe(page) {
  if (!liveSend) {
    record('live send skipped', true, { reason: 'set HERMES_CLIENT_LIVE_SEND=1 to run live sends' });
    return;
  }

  const prompt = process.env.HERMES_CLIENT_LIVE_PROMPT ||
    'QA_FINAL_NEW_TOOL_TRACE_20260430: используй безопасный read-only tool pwd, покажи результат и закончи строкой QA_FINAL_NEW_TOOL_TRACE_DONE_20260430.';
  await page.goto(`${appUrl}/agent/1/chat/657`, { waitUntil: 'domcontentloaded' });
  const input = page.locator(composerSelector).first();
  await input.fill(prompt);
  const beforeSend = Date.now();
  await page.getByRole('button').last().click();

  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return /Hermes is|Running tool|Reasoning|tool result|QA_FINAL_NEW_TOOL_TRACE/i.test(text);
  }, { timeout: 1_500 });
  record('live send visible status under 1.5s', true, { elapsedMs: Date.now() - beforeSend });

  await page.waitForFunction(() => document.body.innerText.includes('QA_FINAL_NEW_TOOL_TRACE_DONE_20260430'), {
    timeout: 180_000,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('QA_FINAL_NEW_TOOL_TRACE_DONE_20260430'), {
    timeout: 20_000,
  });
  record('live send final answer persisted after refresh', true);
}

async function main() {
  await fs.mkdir(artifactDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
    await login(page);
    for (const route of routes) await inspectRoute(page, route);
    await liveSendProbe(page);
  } finally {
    await browser.close();
    const artifactPath = path.join(
      artifactDir,
      `live-ux-gate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`ARTIFACT ${artifactPath}`);
  }
}

main().catch((err) => {
  record('live ux gate failed', false, { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
