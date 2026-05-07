import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStateDb, FixtureMessage, FixtureSession } from '../fixtures/stateDbFixture';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-regression-'));
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

function seedState(sessions: FixtureSession[], messages: FixtureMessage[]): void {
  resetHermesState();
  createStateDb(hermesHome, sessions, messages);
}

test.before(async () => {
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('cross-session sync keeps tokens and busy state isolated by conversation id', async () => {
  await resetClientDb();
  const agent = await createAgent();
  seedState(
    [
      {
        id: 'alpha-live',
        thread_id: 'alpha-thread',
        session_kind: 'root',
        started_at: 10,
        ended_at: 12,
        message_count: 2,
        title: 'Alpha',
      },
      {
        id: 'beta-live',
        thread_id: 'beta-thread',
        session_kind: 'root',
        started_at: 20,
        ended_at: 22,
        message_count: 2,
        title: 'Beta',
      },
    ],
    [
      { session_id: 'alpha-live', role: 'user', content: 'alpha user', timestamp: 11 },
      { session_id: 'alpha-live', role: 'assistant', content: 'alpha assistant', timestamp: 12 },
      { session_id: 'beta-live', role: 'user', content: 'beta user', timestamp: 21 },
      { session_id: 'beta-live', role: 'assistant', content: 'beta assistant', timestamp: 22 },
    ]
  );

  await sync.discoverProfileSessions(agent);
  const convs = await AppDataSource.getRepository(Conversation).find({ where: { agentId: agent._id } });
  const alpha = convs.find((conv) => conv.threadKey === 'alpha-thread');
  const beta = convs.find((conv) => conv.threadKey === 'beta-thread');
  assert.ok(alpha);
  assert.ok(beta);

  const messages = await AppDataSource.getRepository(Message).find({
    order: { conversationId: 'ASC', _id: 'ASC' },
  });
  const byConversation = new Map<number, string[]>();
  messages.forEach((message) => {
    byConversation.set(message.conversationId, [
      ...(byConversation.get(message.conversationId) || []),
      message.text,
    ]);
  });

  assert.deepEqual(byConversation.get(alpha._id), ['alpha user', 'alpha assistant']);
  assert.deepEqual(byConversation.get(beta._id), ['beta user', 'beta assistant']);
});

test('reload-style sync reattaches durable state to the live conversation tip', async () => {
  await resetClientDb();
  const agent = await createAgent();
  seedState(
    [
      {
        id: 'reload-root',
        thread_id: 'reload-thread',
        session_kind: 'root',
        started_at: 30,
        ended_at: 31,
        message_count: 2,
      },
      {
        id: 'reload-live',
        parent_session_id: 'reload-root',
        thread_id: 'reload-thread',
        session_kind: 'compression',
        started_at: 40,
        ended_at: 42,
        message_count: 2,
      },
    ],
    [
      { session_id: 'reload-root', role: 'user', content: 'old root user', timestamp: 31 },
      { session_id: 'reload-root', role: 'assistant', content: 'old root assistant', timestamp: 32 },
      { session_id: 'reload-live', role: 'user', content: 'live user', timestamp: 41 },
      { session_id: 'reload-live', role: 'assistant', content: 'live assistant', timestamp: 42 },
    ]
  );

  const convRepo = AppDataSource.getRepository(Conversation);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'reload-root',
      threadKey: 'reload-thread',
      rootSessionKey: 'reload-thread',
      messageSource: 'state_db',
      createdBy: agent.createdBy,
      createdAt: new Date(),
    })
  );

  await sync.syncConversationFromHermes(conv, agent);
  const reloaded = await convRepo.findOneByOrFail({ _id: conv._id });
  const messages = await AppDataSource.getRepository(Message).find({
    where: { conversationId: conv._id },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });

  assert.equal(reloaded.sessionKey, 'reload-live');
  assert.deepEqual(messages.map((message) => message.text), ['live user', 'live assistant']);
});

test('deleted conversations do not resurrect from discovery while soft-deleted locally', async () => {
  await resetClientDb();
  const agent = await createAgent();
  seedState(
    [
      {
        id: 'deleted-live',
        thread_id: 'deleted-thread',
        session_kind: 'root',
        started_at: 50,
        ended_at: 52,
        message_count: 2,
      },
    ],
    [
      { session_id: 'deleted-live', role: 'user', content: 'deleted user', timestamp: 51 },
      { session_id: 'deleted-live', role: 'assistant', content: 'deleted assistant', timestamp: 52 },
    ]
  );

  const convRepo = AppDataSource.getRepository(Conversation);
  const conv = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'deleted-live',
      threadKey: 'deleted-thread',
      rootSessionKey: 'deleted-thread',
      messageSource: 'state_db',
      createdBy: agent.createdBy,
      createdAt: new Date(),
    })
  );
  await convRepo.softDelete(conv._id);

  await sync.discoverProfileSessions(agent);
  const active = await convRepo.find({ where: { agentId: agent._id } });
  const all = await convRepo.find({ where: { agentId: agent._id }, withDeleted: true });

  assert.equal(active.length, 0);
  assert.equal(all.length, 1);
  assert.equal(all[0].deletedAt instanceof Date, true);
});

test('api gateway lineage keeps one conversation row and updates to latest live tip', async () => {
  await resetClientDb();
  const agent = await createAgent();
  seedState(
    [
      {
        id: 'api-root',
        source: 'api',
        thread_id: 'api-thread',
        session_kind: 'root',
        started_at: 60,
        ended_at: 61,
        message_count: 2,
      },
      {
        id: 'api-live',
        source: 'api',
        parent_session_id: 'api-root',
        thread_id: 'api-thread',
        session_kind: 'compression',
        started_at: 70,
        ended_at: 72,
        message_count: 2,
      },
    ],
    [
      { session_id: 'api-root', role: 'user', content: 'api root user', timestamp: 61 },
      { session_id: 'api-root', role: 'assistant', content: 'api root assistant', timestamp: 62 },
      { session_id: 'api-live', role: 'user', content: 'api live user', timestamp: 71 },
      { session_id: 'api-live', role: 'assistant', content: 'api live assistant', timestamp: 72 },
    ]
  );

  const convRepo = AppDataSource.getRepository(Conversation);
  const existing = await convRepo.save(
    convRepo.create({
      agentId: agent._id,
      sessionKey: 'api-root',
      createdBy: agent.createdBy,
      createdAt: new Date(),
    })
  );

  await sync.discoverProfileSessions(agent);
  const rows = await convRepo.find({ where: { agentId: agent._id } });
  const updated = await convRepo.findOneByOrFail({ _id: existing._id });

  assert.equal(rows.length, 1);
  assert.equal(updated.sessionKey, 'api-live');
  assert.equal(updated.threadKey, 'api-thread');
  assert.equal(updated.rootSessionKey, 'api-thread');
  assert.equal(updated.messageSource, 'state_db');
});
