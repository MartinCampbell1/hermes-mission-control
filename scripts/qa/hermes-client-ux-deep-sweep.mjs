#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { readQaCredentials } from './auth-credentials.mjs';

const appUrl = (process.env.HERMES_CLIENT_URL || 'http://localhost:18888').replace(/\/+$/, '');
const appOrigin = new URL(appUrl);
const apiUrl = (
  process.env.HERMES_CLIENT_API_URL ||
  `${appOrigin.protocol}//${appOrigin.hostname}:18889/api`
).replace(/\/+$/, '');
const { email, password } = readQaCredentials();
const artifactDir = path.resolve('docs/qa/e2e/artifacts');
const routes = (process.env.HERMES_CLIENT_QA_ROUTES || '')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

const defaultRoutes = [
  '/',
  '/users',
  '/plugins',
  '/skills',
  '/cron',
  '/kanban',
  '/agent/1/chat/1',
  '/agent/1/chat/657',
  '/agent/1/settings/usage',
  '/workspace',
  '/settings',
];
const loadingTextRe =
  /Checking authentication|Loading route|Loading workspace|Loading conversation|Проверка входа|Загрузка маршрута|Загрузка Workspace|Загрузка чата/i;
const explicitErrorRe =
  /Could not load|taking too long|Sync failed|Не удалось загрузить|слишком долго|Синхронизация не удалась/i;
const loginPageRe = /^(Login\s+Email|Вход\s+Email)/i;
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
  apiUrl,
  checks: [],
};
let artifactPath = null;

function includesText(text, needle) {
  return text.toLowerCase().includes(needle.toLowerCase());
}

function record(name, ok, details = {}) {
  summary.checks.push({ name, ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

async function writeArtifact() {
  await fs.mkdir(artifactDir, { recursive: true });
  artifactPath =
    artifactPath ||
    path.join(artifactDir, `ux-deep-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ARTIFACT ${artifactPath}`);
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
    return await chromium.launch({
      channel: 'chrome',
      headless: process.env.HERMES_CLIENT_QA_HEADLESS !== '0',
    });
  } catch (err) {
    if (process.env.HERMES_CLIENT_QA_ALLOW_CHROMIUM_FALLBACK === '1') {
      return chromium.launch({ headless: process.env.HERMES_CLIENT_QA_HEADLESS !== '0' });
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
}

async function fetchJson(page, url) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.json();
}

function isBadTextState(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (loadingTextRe.test(trimmed)) return true;
  if (/(^|\n)404(\n|$)/i.test(trimmed)) return true;
  return false;
}

function isProgressbarOnly(text, progressbars) {
  return (
    progressbars > 0 &&
    text.replace(loadingTextRe, '').replace(/\s+/g, '').length < 30
  );
}

function hasVisibleServiceTuple(text) {
  return /\(\s*\d+\s*user\s+messages?\s*,\s*\d+\s*total\s+messages?\s*\)/i.test(text);
}

async function inspectRoute(page, route) {
  const started = Date.now();
  await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
  let settledWithinMs = null;

  while (Date.now() - started <= 10_000) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const progressbars = await page.getByRole('progressbar').count().catch(() => 0);
    const composerCount = await page
      .locator(composerSelector)
      .count()
      .catch(() => 0);
    const isChat = route.includes('/chat/');
    const pathname = new URL(page.url()).pathname;
    const routeMatches = route === '/' || pathname === route;
    const contentReady =
      routeMatches &&
      !isProgressbarOnly(bodyText, progressbars) &&
      (!isChat || composerCount > 0);
    const explicitError =
      !contentReady && explicitErrorRe.test(bodyText);
    const settled =
      explicitError ||
      (!isBadTextState(bodyText) &&
        !isProgressbarOnly(bodyText, progressbars) &&
        (!isChat || composerCount > 0));
    if (settled) {
      settledWithinMs = Date.now() - started;
      break;
    }
    await page.waitForTimeout(150);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const progressbars = await page.getByRole('progressbar').count().catch(() => 0);
  const composerCount = await page
    .locator(composerSelector)
    .count()
    .catch(() => 0);
  const clipped = await findClippedMainText(page);
  const finalPathname = new URL(page.url()).pathname;
  const trimmedText = bodyText.trim();
  const routeMatches = route === '/' || finalPathname === route;
  const isChat = route.includes('/chat/');
  const contentReady =
    routeMatches &&
    !isProgressbarOnly(bodyText, progressbars) &&
    !/(^|\n)404(\n|$)/i.test(trimmedText) &&
    (!isChat || composerCount > 0);
  const explicitError =
    !contentReady && explicitErrorRe.test(bodyText);
  const badTextState = !contentReady && isBadTextState(bodyText);

  return {
    route,
    finalUrl: page.url(),
    routeMatches,
    settledWithinMs,
    progressbars,
    progressbarOnly: isProgressbarOnly(bodyText, progressbars),
    composerCount,
    isLoginPage: finalPathname.includes('/login') || loginPageRe.test(trimmedText),
    explicitError,
    badTextState,
    serviceTupleLeak: hasVisibleServiceTuple(bodyText),
    rawReasoningBoxLeak: /┌─\s*Reasoning/i.test(bodyText),
    timestampOnlyStack: hasTimestampOnlyStack(bodyText),
    clipped,
    textPreview: bodyText.trim().slice(0, 600),
  };
}

function hasTimestampOnlyStack(text) {
  let consecutive = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(line)) {
      consecutive += 1;
      if (consecutive >= 3) return true;
      continue;
    }
    if (line) consecutive = 0;
  }
  return false;
}

async function findClippedMainText(page) {
  return page.evaluate(() => {
    const rows = [];
    for (const el of document.querySelectorAll('p, span, div, pre, code')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 8) continue;
      if (rect.left < 320) continue;
      const style = window.getComputedStyle(el);
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length < 80) continue;
      if (style.overflowX !== 'hidden' && style.textOverflow !== 'ellipsis') continue;
      if (el.scrollWidth <= el.clientWidth + 2) continue;
      if (el.closest('button,[role="button"],nav,aside')) continue;
      rows.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 180),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
      if (rows.length >= 10) break;
    }
    return rows;
  });
}

async function inspectSlashMenu(page, route) {
  await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
  const catalog = await fetchJson(page, `${apiUrl}/slash/catalog?limit=200`);
  const firstSkill = catalog.items?.find((item) => item.source === 'skill') ?? null;
  const firstToolset = catalog.items?.find((item) => item.source === 'toolset') ?? null;
  const setSkills = catalog.items?.find((item) => item.name === 'set-skills') ?? null;

  const input = page
    .locator(composerSelector)
    .first();
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForFunction(
    (source) => !(new RegExp(source, 'i')).test(document.body.innerText),
    loadingTextRe.source,
    { timeout: 5_000 }
  );
  const started = Date.now();
  await input.fill('/');
  let openedWithinMs = null;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('/new') && document.body.innerText.includes('/swarm'),
      null,
      { timeout: 500 }
    );
    openedWithinMs = Date.now() - started;
  } catch {
    await page.waitForTimeout(100);
  }
  try {
    await page.waitForFunction(
      ({ skillName, toolsetName }) => {
        const text = document.body.innerText.toLowerCase();
        return (
          (!skillName || text.includes(`/${skillName}`.toLowerCase())) &&
          (!toolsetName || text.includes(`/${toolsetName}`.toLowerCase())) &&
          text.includes('workspace')
        );
      },
      {
        skillName: firstSkill?.name ?? null,
        toolsetName: firstToolset?.name ?? null,
      },
      { timeout: 2_000 }
    );
  } catch {
    /* Keep the final snapshot as failure evidence. */
  }
  const bodyText = await page.locator('body').innerText().catch(() => '');

  await input.fill('/set-skills ');
  await page.waitForTimeout(100);
  const setSkillsText = await page.locator('body').innerText().catch(() => '');

  return {
    openedWithinMs,
    hasNew: bodyText.includes('/new'),
    hasSkills: bodyText.includes('/skills'),
    hasToolsets: bodyText.includes('/toolsets'),
    hasSwarm: bodyText.includes('/swarm'),
    hasSkillRow: !firstSkill || bodyText.includes(`/${firstSkill.name}`),
    hasToolsetRow: !firstToolset || bodyText.includes(`/${firstToolset.name}`),
    hasSourceLabels:
      includesText(bodyText, 'core') &&
      includesText(bodyText, 'workspace') &&
      includesText(bodyText, 'local') &&
      (!firstSkill || includesText(bodyText, 'skill')) &&
      (!firstToolset || includesText(bodyText, 'toolset')),
    setSkillsIsLocalOverride:
      setSkills?.source === 'local' &&
      setSkills?.executeMode === 'set_setting' &&
      setSkills?.settingKey === 'skillsOverride' &&
      setSkillsText.includes('/set-skills'),
    firstSkill: firstSkill?.name ?? null,
    firstToolset: firstToolset?.name ?? null,
  };
}

async function inspectDuplicateSendGuard() {
  const file = path.resolve('client/src/features/message/send/model/useSendMessage.ts');
  const source = await fs.readFile(file, 'utf8');
  return {
    hasSynchronousInFlightRef: /inFlight[A-Za-z0-9_]*Ref/.test(source),
    hasStateOnlyGuard: /isStreaming/.test(source),
  };
}

async function inspectWorkspaceLaunchControls(page) {
  await page.goto(`${appUrl}/workspace`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (source) => !(new RegExp(source, 'i')).test(document.body.innerText),
    loadingTextRe.source,
    { timeout: 5_000 }
  );

  const goalInput = page.getByLabel(/Mission goal|Цель mission/i).first();
  await goalInput.waitFor({ state: 'visible', timeout: 5_000 });
  const launchButton = page.getByRole('button', { name: /^(launch|запустить)$/i }).first();
  const initiallyDisabled = await launchButton.isDisabled();

  await goalInput.fill('QA UX launch button enablement check');
  await page.waitForTimeout(100);
  const enabledAfterGoal = !(await launchButton.isDisabled());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  await goalInput.fill('');

  return {
    hasMissions: includesText(bodyText, 'Missions') || includesText(bodyText, 'Миссии'),
    hasLaunchMission: /Launch Mission|Запустить mission/i.test(bodyText),
    hasMissionGoal: /Mission goal|Цель mission/i.test(bodyText),
    hasMaxParallel: includesText(bodyText, 'Max parallel') || includesText(bodyText, 'Parallel workers'),
    hasSupervised: includesText(bodyText, 'Supervised'),
    hasCronExplanation: includesText(bodyText, 'Hermes cron'),
    initiallyDisabled,
    enabledAfterGoal,
    textPreview: bodyText.trim().slice(0, 600),
  };
}

async function main() {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await login(page);
    record('login', true, { email });

    for (const route of (routes.length ? routes : defaultRoutes)) {
      const snapshot = await inspectRoute(page, route);
      const ok =
        snapshot.settledWithinMs !== null &&
        snapshot.settledWithinMs <= 10_000 &&
        snapshot.routeMatches &&
        !snapshot.isLoginPage &&
        !snapshot.explicitError &&
        !snapshot.badTextState &&
        !snapshot.progressbarOnly &&
        !snapshot.serviceTupleLeak &&
        !snapshot.rawReasoningBoxLeak &&
        !snapshot.timestampOnlyStack &&
        snapshot.clipped.length === 0 &&
        (!route.includes('/chat/') || snapshot.composerCount > 0);
      record(`route ${route}`, ok, snapshot);
      if (!ok) throw new Error(`Route ${route} failed UX deep sweep.`);
    }

    const slash = await inspectSlashMenu(page, '/agent/1/chat/1');
    const slashOk =
      slash.openedWithinMs !== null &&
      slash.openedWithinMs <= 500 &&
      slash.hasNew &&
      slash.hasSkills &&
      slash.hasToolsets &&
      slash.hasSwarm &&
      slash.hasSkillRow &&
      slash.hasToolsetRow &&
      slash.hasSourceLabels &&
      slash.setSkillsIsLocalOverride;
    record('slash menu dynamic catalog', slashOk, slash);
    if (!slashOk) throw new Error('Slash menu dynamic catalog failed UX deep sweep.');

    const duplicateGuard = await inspectDuplicateSendGuard();
    const duplicateOk = duplicateGuard.hasSynchronousInFlightRef;
    record('duplicate send synchronous guard', duplicateOk, duplicateGuard);
    if (!duplicateOk) throw new Error('Duplicate send guard is still state-only.');

    const workspaceLaunch = await inspectWorkspaceLaunchControls(page);
    const workspaceLaunchOk =
      workspaceLaunch.hasMissions &&
      workspaceLaunch.hasLaunchMission &&
      workspaceLaunch.hasMissionGoal &&
      workspaceLaunch.hasMaxParallel &&
      workspaceLaunch.hasSupervised &&
      workspaceLaunch.hasCronExplanation &&
      workspaceLaunch.initiallyDisabled &&
      workspaceLaunch.enabledAfterGoal;
    record('workspace launch control UX', workspaceLaunchOk, workspaceLaunch);
    if (!workspaceLaunchOk) throw new Error('Workspace launch controls failed UX deep sweep.');
  } finally {
    await withTimeout(browser.close(), 5_000, 'browser.close').catch((err) => {
      summary.browserCloseWarning = err instanceof Error ? err.message : String(err);
      console.warn(summary.browserCloseWarning);
    });
    await writeArtifact();
  }
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  record('ux deep sweep failed', false, { error: message });
  process.exitCode = 1;
  await writeArtifact().catch(() => {});
}).finally(() => {
  process.exit(process.exitCode ?? 0);
});
