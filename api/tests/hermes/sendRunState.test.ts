import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-run-state-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');
process.env.HERMES_CLIENT_DRY_RUN = '1';

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { User, Agent, Conversation, ConversationRun } = require('../../src/entities') as typeof import('../../src/entities');
const messageController = require('../../src/routes/message/controller') as typeof import('../../src/routes/message/controller');

interface MockSseResponse extends Response {
  chunks: string[];
  headers: Record<string, string>;
}

function createMockResponse(): MockSseResponse {
  const mock = {
    chunks: [] as string[],
    headers: {} as Record<string, string>,
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    jsonPayload: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      this.headersSent = true;
      return this;
    },
    write(chunk: string) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      this.writableEnded = true;
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
      return undefined;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.jsonPayload = payload;
      return this;
    },
  };
  return mock as unknown as MockSseResponse;
}

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  await AppDataSource.initialize();
});

test.after(async () => {
  delete process.env.HERMES_CLIENT_DRY_RUN;
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('dry-run chat creates durable run state and emits run lifecycle SSE', async () => {
  const user = await AppDataSource.getRepository(User).save(
    AppDataSource.getRepository(User).create({
      email: 'run-state@example.com',
      password: '123456',
      name: 'Run',
      lastName: 'State',
      active: true,
      createdAt: new Date(),
    })
  );
  const agent = await AppDataSource.getRepository(Agent).save(
    AppDataSource.getRepository(Agent).create({
      name: 'default',
      hermesProfile: 'default',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );
  const conv = await AppDataSource.getRepository(Conversation).save(
    AppDataSource.getRepository(Conversation).create({
      agentId: agent._id,
      title: 'Run state',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );

  const res = createMockResponse();
  await messageController.chat(
    {
      body: { conversationId: String(conv._id), text: 'run state smoke' },
      files: [],
      headers: { host: 'localhost:18889' },
      protocol: 'http',
      user,
    } as never,
    res,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  const sse = res.chunks.join('');
  assert.match(sse, /run\.started/);
  assert.match(sse, /run\.status/);
  assert.match(sse, /run\.completed/);
  assert.ok(sse.indexOf('run.started') < sse.indexOf('response.output_text.delta'));
  assert.ok(sse.indexOf('run.completed') < sse.indexOf('[DONE]'));

  const runs = await AppDataSource.getRepository(ConversationRun).find({
    where: { conversationId: conv._id },
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'completed');
  assert.ok(runs[0].completedAt);
  assert.equal(runs[0].error, null);
});
