import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-settings-cap-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Agent, Conversation } = require('../../src/entities') as typeof import('../../src/entities');
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

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

async function seedConversation() {
  await AppDataSource.getRepository(Conversation).clear();
  await AppDataSource.getRepository(Agent).clear();
  const agentRepo = AppDataSource.getRepository(Agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const agent = await agentRepo.save(agentRepo.create({
    name: 'default',
    hermesProfile: 'default',
    createdBy: 1,
    createdAt: new Date(),
  }));
  const conv = await convRepo.save(convRepo.create({
    agentId: agent._id,
    title: 'Capabilities',
    sessionKey: 'cap-session',
    createdBy: 1,
    createdAt: new Date(),
  }));
  return { agent, conv };
}

test('cli capabilities expose real and unsupported settings truthfully', async () => {
  const { agent, conv } = await seedConversation();
  const res = createJsonResponse();

  await agentController.getSessionSettings(
    { params: { id: String(agent._id), conversationId: String(conv._id) } } as never,
    res,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  const payload = res.jsonPayload as {
    capabilities: Record<string, { appliedOn: string[]; reason?: string }>;
  };
  assert.deepEqual(payload.capabilities.modelOverride.appliedOn, ['cli', 'gateway', 'dry_run']);
  assert.deepEqual(payload.capabilities.providerOverride.appliedOn, ['cli', 'gateway', 'dry_run']);
  assert.deepEqual(payload.capabilities.skillsOverride.appliedOn, ['cli', 'gateway', 'dry_run']);
  assert.deepEqual(payload.capabilities.toolsetsOverride.appliedOn, ['cli', 'gateway', 'dry_run']);
  assert.deepEqual(payload.capabilities.verboseLevel.appliedOn, ['cli', 'dry_run']);
  assert.equal(payload.capabilities.thinkingLevel.appliedOn.includes('cli'), false);
  assert.match(payload.capabilities.thinkingLevel.reason || '', /CLI/);
});

test('settings patch rejects unsupported value shape', async () => {
  const { agent, conv } = await seedConversation();
  const res = createJsonResponse();

  await agentController.patchSessionSettings(
    {
      params: { id: String(agent._id), conversationId: String(conv._id) },
      body: { skillsOverride: { bad: true } },
    } as never,
    res,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(JSON.stringify(res.jsonPayload), /skillsOverride/);
});
