import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-settings-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Agent, Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
const agentController = require('../../src/routes/agent/controller') as typeof import('../../src/routes/agent/controller');

interface MockJsonResponse extends Response {
  statusCode: number;
  jsonPayload: unknown;
}

function createJsonResponse(): MockJsonResponse {
  const mock = {
    statusCode: 200,
    jsonPayload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.jsonPayload = payload;
      return this;
    },
  };
  return mock as unknown as MockJsonResponse;
}

async function resetClientDb(): Promise<void> {
  await AppDataSource.getRepository(Message).clear();
  await AppDataSource.getRepository(Conversation).clear();
  await AppDataSource.getRepository(Agent).clear();
}

async function seedConversation(): Promise<{
  agent: InstanceType<typeof Agent>;
  conv: InstanceType<typeof Conversation>;
}> {
  const agentRepo = AppDataSource.getRepository(Agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const agent = await agentRepo.save(
    agentRepo.create({
      name: 'default',
      hermesProfile: 'default',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      title: 'Settings chat',
      sessionKey: 'settings-session',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  return { agent, conv };
}

function assertNoControllerError(err?: unknown): void {
  if (err) throw err;
}

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('patch stores conversation session settings and get returns stored values', async () => {
  await resetClientDb();
  const { agent, conv } = await seedConversation();

  const patchRes = createJsonResponse();
  await agentController.patchSessionSettings(
    {
      params: { id: String(agent._id), conversationId: String(conv._id) },
      body: {
        thinkingLevel: 'xhigh',
        reasoningLevel: 'high',
        verboseLevel: 'minimal',
        fastMode: true,
        modelOverride: 'openai-codex/gpt-5.5',
        providerOverride: 'openai-codex',
        skillsOverride: 'browser,computer',
        toolsetsOverride: 'shell,web',
        ignored: 'nope',
      },
    } as never,
    patchRes,
    assertNoControllerError
  );
  assert.equal(patchRes.statusCode, 200);

  const saved = await AppDataSource.getRepository(Conversation).findOneByOrFail({ _id: conv._id });
  assert.equal(saved.thinkingLevel, 'xhigh');
  assert.equal(saved.reasoningLevel, 'high');
  assert.equal(saved.verboseLevel, 'minimal');
  assert.equal(saved.fastMode, true);
  assert.equal(saved.modelOverride, 'openai-codex/gpt-5.5');
  assert.equal(saved.providerOverride, 'openai-codex');
  assert.equal(saved.skillsOverride, 'browser,computer');
  assert.equal(saved.toolsetsOverride, 'shell,web');

  const getRes = createJsonResponse();
  await agentController.getSessionSettings(
    { params: { id: String(agent._id), conversationId: String(conv._id) } } as never,
    getRes,
    assertNoControllerError
  );

  const payload = getRes.jsonPayload as {
    ok: boolean;
    settings: Record<string, unknown>;
    capabilities: Record<string, { appliedOn: string[]; reason?: string }>;
  };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.settings, {
    title: 'Settings chat',
    sessionId: 'settings-session',
    thinkingLevel: 'xhigh',
    reasoningLevel: 'high',
    verboseLevel: 'minimal',
    fastMode: true,
    modelOverride: 'openai-codex/gpt-5.5',
    providerOverride: 'openai-codex',
    skillsOverride: 'browser,computer',
    toolsetsOverride: 'shell,web',
  });
  assert.deepEqual(payload.capabilities.modelOverride.appliedOn, ['cli', 'gateway', 'dry_run']);
  assert.equal(payload.capabilities.thinkingLevel.appliedOn.includes('cli'), false);
  assert.match(payload.capabilities.thinkingLevel.reason || '', /--thinking/);
});

test('inherit values are stored as null and returned as inherited settings', async () => {
  await resetClientDb();
  const { agent, conv } = await seedConversation();

  const patchRes = createJsonResponse();
  await agentController.patchSessionSettings(
    {
      params: { id: String(agent._id), conversationId: String(conv._id) },
      body: {
        thinkingLevel: 'inherit',
        reasoningLevel: 'inherit',
        verboseLevel: 'inherit',
        fastMode: null,
        modelOverride: 'inherit',
        providerOverride: 'inherit',
        skillsOverride: 'inherit',
        toolsetsOverride: 'inherit',
      },
    } as never,
    patchRes,
    assertNoControllerError
  );
  assert.equal(patchRes.statusCode, 200);

  const saved = await AppDataSource.getRepository(Conversation).findOneByOrFail({ _id: conv._id });
  assert.equal(saved.thinkingLevel, null);
  assert.equal(saved.reasoningLevel, null);
  assert.equal(saved.verboseLevel, null);
  assert.equal(saved.fastMode, null);
  assert.equal(saved.modelOverride, null);
  assert.equal(saved.providerOverride, null);
  assert.equal(saved.skillsOverride, null);
  assert.equal(saved.toolsetsOverride, null);

  const getRes = createJsonResponse();
  await agentController.getSessionSettings(
    { params: { id: String(agent._id), conversationId: String(conv._id) } } as never,
    getRes,
    assertNoControllerError
  );

  const payload = getRes.jsonPayload as {
    ok: boolean;
    settings: Record<string, unknown>;
    capabilities: Record<string, unknown>;
  };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.settings, {
    title: 'Settings chat',
    sessionId: 'settings-session',
    thinkingLevel: 'inherit',
    reasoningLevel: 'inherit',
    verboseLevel: 'inherit',
    fastMode: null,
    modelOverride: null,
    providerOverride: null,
    skillsOverride: null,
    toolsetsOverride: null,
  });
  assert.ok(payload.capabilities);
});
