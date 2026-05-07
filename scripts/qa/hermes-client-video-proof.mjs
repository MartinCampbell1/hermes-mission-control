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
const headless = process.env.HERMES_CLIENT_QA_HEADLESS !== '0';
const artifactRoot = path.resolve('docs/qa/e2e/artifacts');
const runId = `video-proof-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = path.join(artifactRoot, runId);
const videoDir = path.join(artifactDir, 'videos');
const screenshotDir = path.join(artifactDir, 'screenshots');
const routes = (process.env.HERMES_CLIENT_QA_ROUTES || '/,/kanban,/workspace,/settings,/agent/1/chat/1,/plugins,/skills,/cron')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);
const loadingTextRe =
  /Checking authentication|Loading route|Loading workspace|Loading conversation|Проверка входа|Загрузка маршрута|Загрузка Workspace|Загрузка чата/i;
const explicitErrorRe =
  /Could not load|taking too long|Sync failed|Не удалось загрузить|слишком долго|Синхронизация не удалась|(^|\n)404(\n|$)/i;

const summary = {
  startedAt: new Date().toISOString(),
  appUrl,
  apiUrl,
  headless,
  routes,
  checks: [],
  console: [],
  pageErrors: [],
  requestFailures: [],
  screenshots: [],
  video: null,
};

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function writeSummary() {
  await fs.mkdir(artifactDir, { recursive: true });
  const summaryPath = path.join(artifactDir, 'summary.json');
  summary.finishedAt = new Date().toISOString();
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ARTIFACT ${summaryPath}`);
  if (summary.video) console.log(`VIDEO ${summary.video}`);
}

async function withTimeout(promise, ms, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless });
  } catch (err) {
    if (process.env.HERMES_CLIENT_QA_ALLOW_CHROMIUM_FALLBACK === '1') {
      return chromium.launch({ headless });
    }
    throw new Error(
      `Chrome channel is unavailable. Install Chrome or set HERMES_CLIENT_QA_ALLOW_CHROMIUM_FALLBACK=1. ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function login(page) {
  await page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[name="email"]').first();
  const passwordInput = page.locator('input[name="password"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 5_000 });
  await passwordInput.waitFor({ state: 'visible', timeout: 5_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/auth/login') && response.status() === 200,
    { timeout: 10_000 }
  );
  await page.getByRole('button', { name: /^(login|войти)$/i }).click();
  await loginResponsePromise;
  await page.waitForFunction(() => Boolean(localStorage.getItem('token')), null, { timeout: 5_000 });
  record('login', true);
}

async function waitForRouteSettled(page, route) {
  const started = Date.now();
  let lastText = '';
  while (Date.now() - started < 7_500) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    lastText = bodyText;
    const progressbars = await page.getByRole('progressbar').count().catch(() => 0);
    const blockingLoading = loadingTextRe.test(bodyText);
    const loadingOnly =
      progressbars > 0 &&
      bodyText.replace(loadingTextRe, '').replace(/\s+/g, '').length < 30;
    const explicitError = explicitErrorRe.test(bodyText);
    const usefulContent = bodyText.trim().length > 50 && !loadingOnly && !blockingLoading;
    if (explicitError || usefulContent) {
      return {
        settledWithinMs: Date.now() - started,
        explicitError,
        blockingLoading,
        textPreview: bodyText.trim().slice(0, 700),
      };
    }
    await page.waitForTimeout(150);
  }
  const blockingLoading = loadingTextRe.test(lastText);
  return { settledWithinMs: null, explicitError: false, blockingLoading, textPreview: lastText.trim().slice(0, 700) };
}

async function runRoute(page, route) {
  const url = `${appUrl}${route}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const state = await waitForRouteSettled(page, route);
  const safeName = route === '/' ? 'root' : route.replace(/^\//, '').replace(/[^a-z0-9_-]+/gi, '-');
  const screenshotPath = path.join(screenshotDir, `${safeName || 'route'}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  summary.screenshots.push(screenshotPath);
  record(`route ${route}`, !state.explicitError && state.settledWithinMs !== null, {
    finalUrl: page.url(),
    screenshot: screenshotPath,
    ...state,
  });
}

let browser;
let context;
let page;
try {
  await fs.mkdir(videoDir, { recursive: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  browser = await launchBrowser();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 1200 } },
  });
  page = await context.newPage();
  page.on('console', (message) => {
    const type = message.type();
    if (['error', 'warning'].includes(type)) {
      summary.console.push({ type, text: message.text().slice(0, 1000) });
    }
  });
  page.on('pageerror', (error) => {
    summary.pageErrors.push({ message: error.message, stack: error.stack?.slice(0, 1500) });
  });
  page.on('requestfailed', (request) => {
    summary.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? null });
  });

  await login(page);
  for (const route of routes) {
    await runRoute(page, route);
  }
} catch (err) {
  record('video proof run', false, { error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  if (page) {
    try {
      const video = page.video();
      await withTimeout(page.close(), 10_000, 'page.close');
      if (video) summary.video = await withTimeout(video.path(), 10_000, 'video.path');
    } catch (err) {
      summary.videoError = err instanceof Error ? err.message : String(err);
    }
  }
  if (context) await withTimeout(context.close(), 5_000, 'context.close').catch(() => {});
  if (browser) await withTimeout(browser.close(), 5_000, 'browser.close').catch(() => {});
  await writeSummary();
}
process.exit(process.exitCode ?? 0);
