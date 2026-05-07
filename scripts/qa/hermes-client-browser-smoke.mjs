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
const oldConversationId = process.env.HERMES_CLIENT_QA_CONVERSATION_ID || '1';
const oldSentinel = process.env.HERMES_CLIENT_QA_SENTINEL ?? '';
const qaRoutes = (process.env.HERMES_CLIENT_QA_ROUTES || '')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);
const artifactDir = path.resolve('docs/qa/e2e/artifacts');
const requiredRoutes = [
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
const explicitRouteErrorRe =
  /Could not load|taking too long|Sync failed|Не удалось загрузить|слишком долго|Синхронизация не удалась/i;
const loginPageRe = /^(Login\s+Email|Вход\s+Email)/i;
const authRecoveryRe = /Authentication is taking too long|Проверка входа слишком долго/i;
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

function hasVisibleServiceTuple(text) {
  return /\(\s*\d+\s*user\s+messages?\s*,\s*\d+\s*total\s+messages?\s*\)/i.test(text);
}

function uniqueRoutes(routes) {
  return [...new Set(routes.filter(Boolean))];
}

async function slashCommandRows(page) {
  return page
    .locator('button')
    .evaluateAll((buttons) =>
      buttons
        .map((button) => (button.innerText || '').trim())
        .filter((text) => text.startsWith('/'))
    );
}

function hasSlashCommandRow(rows, name, source) {
  const sourcePattern = new RegExp(`\\b${source}\\b`, 'i');
  return rows.some((row) => row.includes(`/${name}`) && sourcePattern.test(row));
}

async function writeArtifact() {
  artifactPath =
    artifactPath ||
    path.join(
      artifactDir,
      `browser-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
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
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (!/First-run credentials|Данные первого локального входа/i.test(bodyText)) {
    throw new Error('Login page did not show the local credentials hint.');
  }
  await emailInput.fill(email);
  await passwordInput.fill(password);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/auth/login') && response.status() === 200,
    { timeout: 10_000 }
  );
  await page.getByRole('button', { name: /^(login|войти)$/i }).click();
  await loginResponsePromise;
  await page.waitForFunction(() => Boolean(localStorage.getItem('token')), null, { timeout: 5_000 });

  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
  } catch {
    const tokenPresent = await page.evaluate(() => Boolean(localStorage.getItem('token')));
    if (!tokenPresent) {
      throw new Error('Login completed but no auth token was stored.');
    }
  }
}

async function routeSnapshot(page, route) {
  const started = Date.now();
  await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
  let settledWithinMs = null;

  for (;;) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
    const progressbars = await page.getByRole('progressbar').count().catch(() => 0);
    const pathname = new URL(page.url()).pathname;
    const composerVisible =
      (await page
        .locator(composerSelector)
        .count()
        .catch(() => 0)) > 0;
    const isLoginPage = pathname.includes('/login') || loginPageRe.test(bodyText);
    const isAuthRecovery = authRecoveryRe.test(bodyText);
    const visible404 = /(^|\n)404(\n|$)/.test(bodyText);
    const isRootRoute = route === '/';
    const routeMatches = isRootRoute || pathname === route;
    const spinnerOnly =
      progressbars > 0 &&
      bodyText.replace(loadingTextRe, '').replace(/\s+/g, '').length < 30;
    const chatRouteReady =
      route.includes('/chat/') &&
      routeMatches &&
      composerVisible &&
      !visible404;
    const adminRouteReady =
      !route.includes('/chat/') &&
      routeMatches &&
      bodyText.length > 50 &&
      !visible404;
    const contentReady = chatRouteReady || adminRouteReady;
    const hasBlockingLoading =
      !contentReady && loadingTextRe.test(bodyText);
    const hasUsefulContent =
      !isLoginPage &&
      !isAuthRecovery &&
      !spinnerOnly &&
      contentReady;

    if (!spinnerOnly && hasUsefulContent) {
      settledWithinMs = Date.now() - started;
      break;
    }
    if (Date.now() - started > 5_000) break;
    await page.waitForTimeout(150);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const progressbars = await page.getByRole('progressbar').count().catch(() => 0);
  const finalUrl = page.url();
  const finalPathname = new URL(finalUrl).pathname;
  const visible404 = /(^|\n)404(\n|$)/.test(bodyText.trim());
  const spinnerOnlyAfter5s =
    settledWithinMs === null &&
    progressbars > 0 &&
    bodyText.replace(loadingTextRe, '').replace(/\s+/g, '').length < 30;
  const composerVisible =
    (await page
      .locator(composerSelector)
      .count()
      .catch(() => 0)) > 0;
  const routeMatches = route === '/' || finalPathname === route;
  const chatRouteReady =
    route.includes('/chat/') &&
    routeMatches &&
    composerVisible &&
    !visible404;
  const adminRouteReady =
    !route.includes('/chat/') &&
    routeMatches &&
    bodyText.length > 50 &&
    !visible404 &&
    !spinnerOnlyAfter5s;
  const isLoginPage = finalPathname.includes('/login') || loginPageRe.test(bodyText.trim());
  const isAuthRecovery = authRecoveryRe.test(bodyText);
  const contentReady = chatRouteReady || adminRouteReady;
  const explicitRouteError =
    !contentReady && explicitRouteErrorRe.test(bodyText);
  const hasBlockingLoading =
    !contentReady && loadingTextRe.test(bodyText);

  return {
    route,
    finalUrl,
    settledWithinMs,
    spinnerOnlyAfter5s,
    isLoginPage,
    isAuthRecovery,
    explicitRouteError,
    hasBlockingLoading,
    visible404,
    visibleServiceTuple: hasVisibleServiceTuple(bodyText),
    visibleRawReasoningWrapper: /┌─\s*Reasoning/i.test(bodyText),
    visibleBlankTimestampBubble: hasTimestampOnlyStack(bodyText),
    containsSentinel: bodyText.includes(oldSentinel),
    textLength: bodyText.length,
    textPreview: bodyText.trim().slice(0, 500),
  };
}

async function fetchSlashCatalog(page) {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await fetch(`${apiUrl}/slash/catalog?limit=200`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`slash catalog API failed (${response.status})`);
  }
  return response.json();
}

async function slashCommandSnapshot(page, route) {
  await page.goto(`${appUrl}${route}`, { waitUntil: 'domcontentloaded' });
  const input = page
    .locator(composerSelector)
    .first();
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForFunction(
    (source) => !(new RegExp(source, 'i')).test(document.body.innerText),
    loadingTextRe.source,
    { timeout: 5_000 }
  );
  const catalog = await fetchSlashCatalog(page);
  const firstSkill = catalog.items?.find((item) => item.source === 'skill');
  const firstToolset = catalog.items?.find((item) => item.source === 'toolset');
  const setSkills = catalog.items?.find((item) => item.name === 'set-skills');
  const started = Date.now();
  await input.fill('/');
  let openedWithinMs = null;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('/new') && document.body.innerText.includes('/skills'),
      null,
      { timeout: 500 }
    );
    openedWithinMs = Date.now() - started;
  } catch {
    await page.waitForTimeout(250);
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
  const commandRows = await slashCommandRows(page);
  const hasCoreCommands =
    hasSlashCommandRow(commandRows, 'new', 'core') &&
    hasSlashCommandRow(commandRows, 'skills', 'core') &&
    hasSlashCommandRow(commandRows, 'toolsets', 'core') &&
    hasSlashCommandRow(commandRows, 'set-skills', 'local') &&
    hasSlashCommandRow(commandRows, 'swarm', 'workspace');
  const hasDynamicSkill =
    !firstSkill || hasSlashCommandRow(commandRows, firstSkill.name, 'skill');
  const hasDynamicToolset =
    !firstToolset || hasSlashCommandRow(commandRows, firstToolset.name, 'toolset');
  const hasSourceLabels =
    hasSlashCommandRow(commandRows, 'new', 'core') &&
    hasSlashCommandRow(commandRows, 'swarm', 'workspace') &&
    hasDynamicSkill &&
    hasDynamicToolset;
  const setSkillsIsLocalOverride =
    setSkills?.source === 'local' &&
    setSkills?.executeMode === 'set_setting' &&
    setSkills?.settingKey === 'skillsOverride';
  await page.keyboard.press('Escape');
  return {
    route,
    hasCoreCommands,
    hasDynamicSkill,
    hasDynamicToolset,
    hasSourceLabels,
    setSkillsIsLocalOverride,
    openedWithinMs,
    firstSkill: firstSkill?.name ?? null,
    firstToolset: firstToolset?.name ?? null,
    commandRows,
    textPreview: bodyText.trim().slice(0, 500),
  };
}

async function workspaceLaunchSnapshot(page) {
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

  await goalInput.fill('QA browser smoke workspace launch control check');
  await page.waitForTimeout(100);
  const enabledAfterGoal = !(await launchButton.isDisabled());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  await goalInput.fill('');

  return {
    hasMissions: /Missions|Миссии/i.test(bodyText),
    hasLaunchMission: /Launch Mission|Запустить mission/i.test(bodyText),
    hasMissionGoal: /Mission goal|Цель mission/i.test(bodyText),
    hasMaxParallel: bodyText.includes('Max parallel') || bodyText.includes('Parallel workers'),
    hasSupervised: /Supervised/i.test(bodyText),
    mentionsHermesCron: /Hermes cron/i.test(bodyText),
    initiallyDisabled,
    enabledAfterGoal,
    textPreview: bodyText.trim().slice(0, 500),
  };
}

async function main() {
  await fs.mkdir(artifactDir, { recursive: true });
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await login(page);
    record('login succeeds with local credentials or existing session', true, { email });

    const routes = uniqueRoutes([
      ...requiredRoutes,
      `/agent/1/chat/${oldConversationId}`,
      ...(qaRoutes.length ? qaRoutes : ['/agent/1/chat/653']),
    ]);
    for (const route of routes) {
      const snapshot = await routeSnapshot(page, route);
      const ok =
        snapshot.settledWithinMs !== null &&
        !snapshot.isLoginPage &&
        !snapshot.isAuthRecovery &&
        !snapshot.explicitRouteError &&
        !snapshot.hasBlockingLoading &&
        !snapshot.visible404 &&
        !snapshot.spinnerOnlyAfter5s &&
        !snapshot.visibleServiceTuple &&
        !snapshot.visibleRawReasoningWrapper &&
        !snapshot.visibleBlankTimestampBubble;
      record(`DOM route ${route}`, ok, snapshot);
      if (!ok) throw new Error(`Route ${route} failed DOM smoke: ${JSON.stringify(snapshot)}`);
    }

    const oldChat = summary.checks.find((check) => check.route === `/agent/1/chat/${oldConversationId}`);
    if (oldSentinel && oldChat && !oldChat.containsSentinel) {
      throw new Error(`old chat ${oldConversationId} did not show sentinel ${oldSentinel}`);
    }
    if (oldSentinel) {
      record(`old chat ${oldConversationId} sentinel`, true, { sentinel: oldSentinel });
    }

    const slashSnapshot = await slashCommandSnapshot(page, `/agent/1/chat/${oldConversationId}`);
    const slashOk =
      slashSnapshot.openedWithinMs !== null &&
      slashSnapshot.openedWithinMs <= 500 &&
      slashSnapshot.hasCoreCommands &&
      slashSnapshot.hasDynamicSkill &&
      slashSnapshot.hasDynamicToolset &&
      slashSnapshot.hasSourceLabels &&
      slashSnapshot.setSkillsIsLocalOverride;
    record('slash command menu opens in composer', slashOk, slashSnapshot);
    if (!slashOk) {
      throw new Error(`Slash command menu did not expose core commands: ${JSON.stringify(slashSnapshot)}`);
    }

    const workspaceSnapshot = await workspaceLaunchSnapshot(page);
    const workspaceLaunchUiOk =
      workspaceSnapshot.hasMissions &&
      workspaceSnapshot.hasLaunchMission &&
      workspaceSnapshot.hasMissionGoal &&
      workspaceSnapshot.hasMaxParallel &&
      workspaceSnapshot.hasSupervised &&
      workspaceSnapshot.mentionsHermesCron &&
      workspaceSnapshot.initiallyDisabled &&
      workspaceSnapshot.enabledAfterGoal;
    record('workspace swarm launch controls', workspaceLaunchUiOk, workspaceSnapshot);
    if (!workspaceLaunchUiOk) {
      throw new Error(`Workspace launch controls are incomplete: ${JSON.stringify(workspaceSnapshot)}`);
    }
  } finally {
    await browser.close();
    await writeArtifact();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  record('browser smoke failed', false, { error: message });
  writeArtifact().catch(() => {});
  process.exitCode = 1;
});
