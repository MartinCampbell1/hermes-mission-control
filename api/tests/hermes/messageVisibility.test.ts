import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTimelineStateDb } from '../fixtures/stateDbTimelineFixture';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-message-visibility-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');
process.env.HERMES_HOME = path.join(rootDir, 'hermes-home');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
const controller = require('../../src/routes/message/controller') as typeof import('../../src/routes/message/controller');

function mockJsonResponse() {
  return {
    statusCode: 200,
    payload: undefined as any,
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
}

test.before(async () => {
  fs.mkdirSync(process.env.HERMES_HOME!, { recursive: true });
  createTimelineStateDb(process.env.HERMES_HOME!);
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('list and poll endpoints hide hidden timeline rows', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Visibility',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const visible = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'visible assistant',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(10_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: '',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(15_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: '┌─ Reasoning ──────────────────────────────────────────────────────────────────┐\ninternal reasoning box',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(17_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: '(5user messages, 151 total messages) final answer',
      role: 'assistant' as const,
      kind: 'message' as const,
      hidden: false,
      createdBy: 1,
      createdAt: new Date(18_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'Running exec_command',
      role: 'tool' as const,
      kind: 'tool_call' as const,
      toolName: 'exec_command',
      toolCallId: 'call-1',
      toolStatus: 'running',
      hidden: false,
      createdBy: 1,
      createdAt: new Date(18_500),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'ok',
      role: 'tool' as const,
      kind: 'tool_result' as const,
      toolName: 'exec_command',
      toolCallId: 'call-1',
      toolStatus: 'done',
      hidden: false,
      createdBy: 1,
      createdAt: new Date(19_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: '',
      role: 'assistant' as const,
      kind: 'status' as const,
      hidden: true,
      createdBy: 1,
      createdAt: new Date(20_000),
    })
  );

  const listRes = mockJsonResponse();
  await controller.listByConversation(
    { params: { conversationId: String(conv._id) }, query: {} } as never,
    listRes as never,
    (err?: unknown) => {
      if (err) throw err;
    }
  );
  assert.deepEqual(
    listRes.payload.items.map((message: { text: string }) => message.text),
    ['visible assistant', 'final answer', 'Running exec_command', 'ok']
  );
  const terminalizedCall = listRes.payload.items.find(
    (message: { kind: string; toolCallId?: string }) =>
      message.kind === 'tool_call' && message.toolCallId === 'call-1'
  );
  assert.equal(terminalizedCall.toolStatus, 'done');

  assert.equal(
    listRes.payload.items.some((message: { text: string }) =>
      /\(\s*\d+\s*user messages,\s*\d+\s*total messages\s*\)/i.test(message.text)
    ),
    false
  );

  const pollRes = mockJsonResponse();
  await controller.poll(
    { params: { conversationId: String(conv._id) }, query: { after: '1970-01-01T00:00:00.000Z' } } as never,
    pollRes as never,
    (err?: unknown) => {
      if (err) throw err;
    }
  );
  assert.deepEqual(
    pollRes.payload.items.map((message: { text: string }) => message.text),
    ['visible assistant', 'final answer', 'Running exec_command', 'ok']
  );
});

test('list endpoint keeps deterministic chronological order when timestamps tie', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: 1,
      title: 'Ordering',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  const sameTimestamp = new Date('2026-04-30T13:00:37.000Z');

  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'first same-second message',
      role: 'user' as const,
      createdBy: 1,
      createdAt: sameTimestamp,
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'second same-second message',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: sameTimestamp,
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'third same-second message',
      role: 'user' as const,
      createdBy: 1,
      createdAt: sameTimestamp,
    })
  );

  const listRes = mockJsonResponse();
  await controller.listByConversation(
    { params: { conversationId: String(conv._id) }, query: {} } as never,
    listRes as never,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  assert.deepEqual(
    listRes.payload.items.map((message: { text: string }) => message.text),
    ['first same-second message', 'second same-second message', 'third same-second message']
  );
});

test('list endpoint imports state.db messages for cached conversation shells', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: 100,
      sessionKey: 'timeline-live',
      threadKey: 'timeline-thread',
      rootSessionKey: 'timeline-thread',
      messageSource: 'state_db',
      title: 'Cached shell',
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  assert.equal(await msgRepo.countBy({ conversationId: conv._id }), 0);

  const listRes = mockJsonResponse();
  await controller.listByConversation(
    { params: { conversationId: String(conv._id) }, query: {} } as never,
    listRes as never,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  const texts = listRes.payload.items.map((message: { text: string }) => message.text);
  assert.ok(texts.includes('Need date'));
  assert.ok(texts.includes('The date is Thu Apr 30 05:00:00 WITA 2026.'));
  assert.ok(await msgRepo.countBy({ conversationId: conv._id }) > 0);
});

test('list endpoint does not block populated conversations on state.db sync', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: 99,
      sessionKey: 'timeline-live',
      threadKey: 'timeline-thread',
      rootSessionKey: 'timeline-thread',
      messageSource: 'state_db',
      title: 'Populated conversation',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'durable local row',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(30_000),
    })
  );

  const listRes = mockJsonResponse();
  await controller.listByConversation(
    { params: { conversationId: String(conv._id) }, query: {} } as never,
    listRes as never,
    (err?: unknown) => {
      if (err) throw err;
    }
  );

  assert.deepEqual(
    listRes.payload.items.map((message: { text: string }) => message.text),
    ['durable local row']
  );
  assert.equal(await msgRepo.countBy({ conversationId: conv._id }), 1);
});

test('poll endpoint stays local-only by default to avoid route blocking syncs', async () => {
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: 1,
      sessionKey: 'timeline-live',
      title: 'Poll local only',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      externalId: 'local-only-row',
      text: 'durable local row',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(30_000),
    })
  );

  const previousPollSync = process.env.HERMES_CLIENT_POLL_SYNC;
  delete process.env.HERMES_CLIENT_POLL_SYNC;

  try {
    const pollRes = mockJsonResponse();
    await controller.poll(
      { params: { conversationId: String(conv._id) }, query: { after: '1970-01-01T00:00:00.000Z' } } as never,
      pollRes as never,
      (err?: unknown) => {
        if (err) throw err;
      }
    );

    assert.equal(pollRes.payload.synced, 0);
    assert.deepEqual(
      pollRes.payload.items.map((message: { text: string }) => message.text),
      ['durable local row']
    );
    assert.equal(await msgRepo.countBy({ conversationId: conv._id }), 1);
  } finally {
    if (previousPollSync === undefined) delete process.env.HERMES_CLIENT_POLL_SYNC;
    else process.env.HERMES_CLIENT_POLL_SYNC = previousPollSync;
  }
});
