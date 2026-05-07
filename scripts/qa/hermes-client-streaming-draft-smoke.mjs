#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readQaCredentials } from './auth-credentials.mjs';

const appUrl = (process.env.HERMES_CLIENT_URL || 'http://localhost:18888').replace(/\/+$/, '');
const appOrigin = new URL(appUrl);
const apiUrl = (
  process.env.HERMES_CLIENT_API_URL || `${appOrigin.protocol}//${appOrigin.hostname}:18889/api`
).replace(/\/+$/, '');
const { email, password } = readQaCredentials();
const route = process.env.HERMES_CLIENT_QA_ROUTE || '/agent/1/chat/1';
const artifactDir = path.resolve('docs/qa/e2e/artifacts');
const composerSelector = [
  'textarea[placeholder="Type a message..."]',
  'textarea[placeholder="Напишите сообщение..."]',
  'textarea[placeholder="Draft the next message..."]',
  'textarea[placeholder="Пишите следующий prompt..."]',
  'textarea:not([aria-hidden="true"])',
].join(', ');

const summary = {
  startedAt: new Date().toISOString(),
  appUrl,
  apiUrl,
  route,
  checks: [],
  screenshots: [],
};

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function writeArtifact() {
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(
    artifactDir,
    `streaming-draft-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  summary.finishedAt = new Date().toISOString();
  await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ARTIFACT ${artifactPath}`);
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

async function main() {
  await fs.mkdir(artifactDir, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let intercepted = false;
  let markIntercepted;
  const interceptedPromise = new Promise((resolve) => {
    markIntercepted = resolve;
  });

  try {
    await login(page);
    await page.route('**/api/message/chat', async (routeHandle) => {
      intercepted = true;
      markIntercepted();
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await routeHandle.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: [
          'data: {"type":"run.status","status":"QA intercepted stream"}',
          '',
          'data: {"type":"response.output_text.delta","delta":"QA intercepted reply"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      });
    });

    await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
    const composer = page.locator(composerSelector).last();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.fill('QA streaming draft first prompt');
    await composer.press('Enter');
    await Promise.race([
      interceptedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('message chat request was not intercepted')), 2_000)),
    ]);
    record('message chat request was intercepted', intercepted);
    await page.waitForTimeout(100);

    await composer.fill('QA second prompt draft while stream');
    const draftValue = await composer.inputValue();
    const editableDuringStream = await composer.isEditable();
    const blockedSend = await page
      .locator(
        'button[aria-label="Отправка недоступна во время streaming ответа"], button[aria-label="Send unavailable while response is streaming"]'
      )
      .last()
      .isDisabled();

    record('composer editable while stream is in flight', editableDuringStream && draftValue.includes('QA second prompt'), {
      draftValue,
      editableDuringStream,
    });
    record('send stays blocked during current stream', blockedSend);

    await page.waitForTimeout(2200);
    const retainedDraft = await composer.inputValue();
    const sendEnabledAfterStream = await page
      .locator('button[aria-label="Отправить сообщение"], button[aria-label="Send message"]')
      .last()
      .isEnabled();
    record('draft remains after stream completes', retainedDraft === 'QA second prompt draft while stream', {
      retainedDraft,
    });
    record('send becomes available for retained draft', sendEnabledAfterStream);
    const screenshotPath = path.join(
      artifactDir,
      `streaming-draft-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.screenshots.push(screenshotPath);
  } finally {
    await browser.close();
    await writeArtifact();
  }

  const failed = summary.checks.some((check) => !check.ok);
  if (failed) process.exitCode = 1;
}

await main().catch(async (err) => {
  record('streaming draft smoke failed', false, {
    error: err instanceof Error ? err.message : String(err),
  });
  await writeArtifact();
  process.exitCode = 1;
});
