import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStateDb } from '../fixtures/stateDbFixture';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-sync-'));
const hermesHome = path.join(rootDir, 'hermes-home');
process.env.HERMES_HOME = hermesHome;
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Agent, Conversation, Message } = require('../../src/entities') as typeof import('../../src/entities');
const sync = require('../../src/services/hermes/sync') as typeof import('../../src/services/hermes/sync');

async function resetClientDb(): Promise<void> {
  await AppDataSource.getRepository(Message).clear();
  await AppDataSource.getRepository(Conversation).clear();
  await AppDataSource.getRepository(Agent).clear();
}

function resetHermesState(): void {
  fs.rmSync(hermesHome, { recursive: true, force: true });
  fs.mkdirSync(hermesHome, { recursive: true });
}

function seedStateDb(): void {
  createStateDb(
    hermesHome,
    [
      {
        id: 'root-1',
        thread_id: 'thread-1',
        session_kind: 'root',
        started_at: 10,
        ended_at: 20,
        message_count: 2,
        title: 'Root title',
      },
      {
        id: 'leaf-1',
        parent_session_id: 'root-1',
        thread_id: 'thread-1',
        session_kind: 'compression',
        started_at: 30,
        ended_at: 40,
        message_count: 2,
        title: 'Leaf 1',
      },
      {
        id: 'leaf-2',
        parent_session_id: 'leaf-1',
        thread_id: 'thread-1',
        session_kind: 'compression',
        started_at: 50,
        ended_at: 60,
        message_count: 2,
        title: 'Leaf 2',
      },
      {
        id: 'thread-2-root',
        thread_id: 'thread-2',
        session_kind: 'root',
        started_at: 70,
        ended_at: 80,
        message_count: 2,
        title: 'Thread 2',
      },
    ],
    [
      { session_id: 'root-1', role: 'user', content: 'root user', timestamp: 11 },
      { session_id: 'root-1', role: 'assistant', content: 'root answer', timestamp: 12 },
      { session_id: 'leaf-1', role: 'user', content: 'first user', timestamp: 31 },
      { session_id: 'leaf-1', role: 'assistant', content: 'first answer', timestamp: 32 },
      { session_id: 'leaf-2', role: 'user', content: 'second user', timestamp: 51 },
      { session_id: 'leaf-2', role: 'assistant', content: 'second answer', timestamp: 52 },
      { session_id: 'thread-2-root', role: 'user', content: 'other user', timestamp: 71 },
      { session_id: 'thread-2-root', role: 'assistant', content: 'other answer', timestamp: 72 },
    ]
  );
}

async function createAgent(): Promise<InstanceType<typeof Agent>> {
  return AppDataSource.getRepository(Agent).save(
    AppDataSource.getRepository(Agent).create({
      name: 'Default',
      hermesProfile: 'default',
      createdBy: 1,
      createdAt: new Date(),
    })
  );
}

function seedClassicJsonSession(): void {
  const sessionsDir = path.join(hermesHome, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, 'session_20260429_010101_abcdef.json');
  fs.writeFileSync(
    sessionFile,
    JSON.stringify({
      title: 'Classic JSON',
      session_start: '2026-04-29T01:01:01.000Z',
      messages: [
        { role: 'user', content: 'json user', timestamp: '2026-04-29T01:01:02.000Z' },
        { role: 'assistant', content: 'json assistant', timestamp: '2026-04-29T01:01:03.000Z' },
      ],
    })
  );
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(sessionFile, old, old);
}

test.before(async () => {
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('discovers and syncs state.db thread identities without splitting compression children', async () => {
  await resetClientDb();
  resetHermesState();
  seedStateDb();
  const agent = await createAgent();

  const result = await sync.discoverProfileSessions(agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const rows = (await convRepo.find({ where: { agentId: agent._id }, order: { _id: 'ASC' } }))
    .sort((a, b) => String(a.threadKey).localeCompare(String(b.threadKey)));

  assert.equal(result.created.length, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.threadKey, row.sessionKey, row.rootSessionKey, row.messageSource]),
    [
      ['thread-1', 'leaf-2', 'thread-1', 'state_db'],
      ['thread-2', 'thread-2-root', 'thread-2', 'state_db'],
    ]
  );

  const threadOne = rows.find((row) => row.threadKey === 'thread-1');
  assert.ok(threadOne);
  const messages = await msgRepo.find({
    where: { conversationId: threadOne._id },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });
  assert.deepEqual(messages.map((message) => message.text), [
    'first user',
    'first answer',
    'second user',
    'second answer',
  ]);
});

test('updates an existing conversation from an old chain sessionKey to the latest live tip', async () => {
  await resetClientDb();
  resetHermesState();
  seedStateDb();
  const agent = await createAgent();
  const convRepo = AppDataSource.getRepository(Conversation);
  const existing = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'leaf-1',
      title: 'Old leaf',
      createdBy: agent.createdBy,
      createdAt: new Date(),
    })
  );

  await sync.discoverProfileSessions(agent);
  const rows = await convRepo.find({ where: { agentId: agent._id }, order: { _id: 'ASC' } });
  const updated = await convRepo.findOneByOrFail({ _id: existing._id });

  assert.equal(rows.length, 2);
  assert.equal(updated._id, existing._id);
  assert.equal(updated.threadKey, 'thread-1');
  assert.equal(updated.rootSessionKey, 'thread-1');
  assert.equal(updated.sessionKey, 'leaf-2');
  assert.equal(updated.messageSource, 'state_db');
});

test('claims repeated assistant text against the nearest local row instead of an older duplicate', async () => {
  await resetClientDb();
  resetHermesState();
  createStateDb(
    hermesHome,
    [
      {
        id: 'repeat-live',
        thread_id: 'repeat-thread',
        session_kind: 'root',
        started_at: 190,
        ended_at: 220,
        message_count: 2,
      },
    ],
    [
      { session_id: 'repeat-live', role: 'user', content: 'repeat prompt', timestamp: 200 },
      { session_id: 'repeat-live', role: 'assistant', content: 'repeat answer', timestamp: 210 },
    ]
  );
  const agent = await createAgent();
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'repeat-live',
      threadKey: 'repeat-thread',
      rootSessionKey: 'repeat-thread',
      messageSource: 'state_db',
      createdBy: agent.createdBy,
      createdAt: new Date(100_000),
    })
  );
  const oldDuplicate = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'repeat answer',
      role: 'assistant' as const,
      createdBy: agent.createdBy,
      createdAt: new Date(120_000),
    })
  );
  await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'repeat prompt',
      role: 'user' as const,
      createdBy: agent.createdBy,
      createdAt: new Date(200_000),
    })
  );
  const freshDuplicate = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'repeat answer',
      role: 'assistant' as const,
      createdBy: agent.createdBy,
      createdAt: new Date(210_000),
    })
  );

  await sync.syncConversationFromHermes(conv, agent);
  const oldReloaded = await msgRepo.findOneByOrFail({ _id: oldDuplicate._id });
  const freshReloaded = await msgRepo.findOneByOrFail({ _id: freshDuplicate._id });

  assert.equal(oldReloaded.externalId, null);
  assert.equal(freshReloaded.externalId, 'repeat-live:2');
});

test('does not claim a new turn assistant to a stale duplicate before its user row', async () => {
  await resetClientDb();
  resetHermesState();
  createStateDb(
    hermesHome,
    [
      {
        id: 'stream-live',
        thread_id: 'stream-thread',
        session_kind: 'root',
        started_at: 300,
        ended_at: 330,
        message_count: 2,
      },
    ],
    [
      { session_id: 'stream-live', role: 'user', content: 'repeat prompt', timestamp: 310 },
      { session_id: 'stream-live', role: 'assistant', content: 'repeat answer', timestamp: 320 },
    ]
  );
  const agent = await createAgent();
  const convRepo = AppDataSource.getRepository(Conversation);
  const msgRepo = AppDataSource.getRepository(Message);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'stream-live',
      threadKey: 'stream-thread',
      rootSessionKey: 'stream-thread',
      messageSource: 'state_db',
      createdBy: agent.createdBy,
      createdAt: new Date(290_000),
    })
  );
  const staleAssistant = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'repeat answer',
      role: 'assistant' as const,
      createdBy: agent.createdBy,
      createdAt: new Date(319_000),
    })
  );
  const currentUser = await msgRepo.save(
    msgRepo.create({
      conversationId: conv._id,
      text: 'repeat prompt',
      role: 'user' as const,
      createdBy: agent.createdBy,
      createdAt: new Date(310_000),
    })
  );

  const result = await sync.syncConversationFromHermes(conv, agent);
  const staleReloaded = await msgRepo.findOneByOrFail({ _id: staleAssistant._id });
  const userReloaded = await msgRepo.findOneByOrFail({ _id: currentUser._id });
  const rows = await msgRepo.find({
    where: { conversationId: conv._id },
    order: { _id: 'ASC' },
  });
  const createdAssistant = rows.find(
    (message) => message.role === 'assistant' && message._id > currentUser._id
  );

  assert.equal(result.claimed, 1);
  assert.equal(result.added.length, 1);
  assert.equal(staleReloaded.externalId, null);
  assert.equal(userReloaded.externalId, 'stream-live:1');
  assert.ok(createdAssistant);
  assert.equal(createdAssistant.externalId, 'stream-live:2');
});

test('falls back to classic JSON sessions when state.db is unavailable', async () => {
  await resetClientDb();
  resetHermesState();
  seedClassicJsonSession();
  const agent = await createAgent();

  const result = await sync.discoverProfileSessions(agent);
  const rows = await AppDataSource.getRepository(Conversation).find({
    where: { agentId: agent._id },
  });

  assert.equal(result.created.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionKey, '20260429_010101_abcdef');
  assert.equal(rows[0].threadKey, null);
  assert.equal(rows[0].rootSessionKey, null);
  assert.equal(rows[0].messageSource, 'json_fallback');
});
