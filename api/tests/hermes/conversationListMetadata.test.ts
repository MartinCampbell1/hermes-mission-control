import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-conversation-list-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
const conversationController =
  require('../../src/routes/conversation/controller') as typeof import('../../src/routes/conversation/controller');

interface MockJsonResponse extends Response {
  statusCode: number;
  jsonPayload: any;
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

test('conversation list includes visible message count and last active timestamp', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);

  const emptyLatest = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Empty latest shell',
      createdBy: 1,
      createdAt: new Date('2026-05-01T11:00:00.000Z'),
    })
  );
  const populatedOlder = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Message bearing chat',
      createdBy: 1,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: populatedOlder._id,
      text: 'visible user',
      role: 'user' as const,
      createdBy: 1,
      createdAt: new Date('2026-05-01T10:05:00.000Z'),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: populatedOlder._id,
      text: 'hidden status',
      role: 'assistant' as const,
      kind: 'status' as const,
      hidden: true,
      createdBy: 1,
      createdAt: new Date('2026-05-01T10:10:00.000Z'),
    })
  );

  const res = createJsonResponse();
  await conversationController.listAll({} as never, res, assertNoControllerError);

  assert.equal(res.statusCode, 200);
  const items = res.jsonPayload.items as Array<{
    _id: number;
    messageCount: number;
    lastActive: string | null;
  }>;
  const empty = items.find((item) => item._id === emptyLatest._id);
  const populated = items.find((item) => item._id === populatedOlder._id);

  assert.equal(empty?.messageCount, 0);
  assert.equal(empty?.lastActive, null);
  assert.equal(populated?.messageCount, 1);
  assert.ok(populated?.lastActive, 'populated conversations should expose a lastActive value');
});
