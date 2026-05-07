import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-dry-run-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');
process.env.HERMES_CLIENT_UPLOADS_DIR = path.join(rootDir, 'uploads');
process.env.HERMES_CLIENT_DRY_RUN = '1';

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { User, Agent, Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
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

test('message chat dry-run emits stream events and persists assistant before done', async () => {
  const userRepo = AppDataSource.getRepository(User);
  const agentRepo = AppDataSource.getRepository(Agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);

  const user = await userRepo.save(
    userRepo.create({
      email: 'dry-run@example.com',
      password: '123456',
      name: 'Dry',
      lastName: 'Run',
      active: true,
      createdAt: new Date(),
    })
  );
  const agent = await agentRepo.save(
    agentRepo.create({
      name: 'default',
      hermesProfile: 'default',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      title: 'Dry run chat',
      thinkingLevel: 'xhigh',
      verboseLevel: 'minimal',
      fastMode: true,
      createdBy: user._id,
      createdAt: new Date(),
    })
  );

  const req = {
    body: { conversationId: String(conv._id), text: 'local browser acceptance' },
    files: [],
    headers: { host: 'localhost:18889' },
    protocol: 'http',
    user,
  };
  const res = createMockResponse();

  await messageController.chat(req as never, res, (err?: unknown) => {
    if (err) throw err;
  });

  const sse = res.chunks.join('');
  assert.match(sse, /settings\.applied/);
  assert.match(sse, /"thinkingLevel":"xhigh"/);
  assert.match(sse, /response\.output_text\.delta/);
  assert.match(sse, /session\.update/);
  assert.match(sse, /message\.saved/);
  assert.match(sse, /\[DONE\]/);

  const saved = await msgRepo.find({
    where: { conversationId: conv._id },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].role, 'user');
  assert.equal(saved[1].role, 'assistant');
  assert.equal(saved[1].text, '[dry-run] local browser acceptance');
});

test('message chat dry-run persists uploaded files and emits durable save events', async () => {
  const userRepo = AppDataSource.getRepository(User);
  const agentRepo = AppDataSource.getRepository(Agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);

  const user = await userRepo.save(
    userRepo.create({
      email: 'dry-run-upload@example.com',
      password: '123456',
      name: 'Upload',
      lastName: 'Smoke',
      active: true,
      createdAt: new Date(),
    })
  );
  const agent = await agentRepo.save(
    agentRepo.create({
      name: 'default',
      hermesProfile: 'default',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      title: 'Upload dry run chat',
      createdBy: user._id,
      createdAt: new Date(),
    })
  );
  const uploadPath = path.join(rootDir, 'upload-smoke.txt');
  fs.writeFileSync(uploadPath, 'upload smoke body');

  const req = {
    body: { conversationId: String(conv._id), text: 'dry-run upload smoke' },
    files: [
      {
        path: uploadPath,
        originalname: 'hermes-client-upload-smoke.txt',
        mimetype: 'text/plain',
        size: fs.statSync(uploadPath).size,
      },
    ],
    headers: { host: 'localhost:18889' },
    protocol: 'http',
    user,
  };
  const res = createMockResponse();

  await messageController.chat(req as never, res, (err?: unknown) => {
    if (err) throw err;
  });

  const sse = res.chunks.join('');
  assert.match(sse, /message\.saved/);
  assert.match(sse, /\[DONE\]/);

  const saved = await msgRepo.find({
    where: { conversationId: conv._id },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].role, 'user');
  assert.equal(saved[0].files?.length, 1);
  assert.equal(saved[0].files?.[0].originalName, 'hermes-client-upload-smoke.txt');
  assert.equal(saved[1].role, 'assistant');
  assert.match(saved[1].text, /^\[dry-run\] dry-run upload smoke/);
  assert.match(saved[1].text, /Attached file\(s\):/);
});

test('selectReusableAssistantMessageForTest matches a concurrent imported assistant by normalized text', () => {
  const repo = AppDataSource.getRepository(Message);
  const reusable = repo.create({
    conversationId: 1,
    text: 'LIVE_CONTINUITY_OK_20260429',
    role: 'assistant' as const,
    createdBy: 1,
    createdAt: new Date(),
  });
  const unrelated = repo.create({
    conversationId: 1,
    text: 'different assistant',
    role: 'assistant' as const,
    createdBy: 1,
    createdAt: new Date(),
  });

  const selected = messageController.selectReusableAssistantMessageForTest(
    [unrelated, reusable],
    ' LIVE_CONTINUITY_OK_20260429\n'
  );

  assert.equal(selected, reusable);
});

test('claimConversationSessionForTest merges background-discovered duplicate session shells', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);

  const active = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Active browser chat',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const duplicate = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Background sync shell',
      sessionKey: 'duplicate-session',
      threadKey: 'duplicate-session',
      rootSessionKey: 'duplicate-session',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const duplicateMessage = await msgRepo.save(
    msgRepo.create({
      conversationId: duplicate._id,
      text: 'imported assistant',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  await messageController.claimConversationSessionForTest(
    convRepo,
    msgRepo,
    active,
    'duplicate-session'
  );

  const savedActive = await convRepo.findOneByOrFail({ _id: active._id });
  const savedDuplicate = await convRepo.findOne({
    where: { _id: duplicate._id },
    withDeleted: true,
  });
  const movedMessage = await msgRepo.findOneByOrFail({ _id: duplicateMessage._id });

  assert.equal(savedActive.sessionKey, 'duplicate-session');
  assert.equal(savedDuplicate?.sessionKey, null);
  assert.ok(savedDuplicate?.deletedAt);
  assert.equal(movedMessage.conversationId, active._id);
});
