import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { createStateDb, createTempHermesHome } from '../fixtures/stateDbFixture';

const hermesHome = createTempHermesHome();
process.env.HERMES_HOME = hermesHome;

const stateDb = require('../../src/services/hermes/stateDb') as typeof import('../../src/services/hermes/stateDb');

test.before(() => {
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
        id: 'hidden-subagent',
        parent_session_id: 'leaf-2',
        thread_id: 'thread-1',
        session_kind: 'subagent',
        is_user_visible: 0,
        started_at: 500,
        ended_at: 600,
        message_count: 2,
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
      {
        id: 'tool-row',
        source: 'tool',
        thread_id: 'thread-tool',
        session_kind: 'root',
        started_at: 90,
        ended_at: 100,
        message_count: 2,
      },
    ],
    [
      { session_id: 'root-1', role: 'user', content: 'root user', timestamp: 11 },
      { session_id: 'root-1', role: 'assistant', content: 'root answer', timestamp: 12 },
      { session_id: 'leaf-1', role: 'user', content: 'first user', timestamp: 31 },
      { session_id: 'leaf-1', role: 'assistant', content: 'first answer', timestamp: 32 },
      { session_id: 'leaf-2', role: 'user', content: 'second user', timestamp: 51 },
      { session_id: 'leaf-2', role: 'assistant', content: 'second answer', timestamp: 52 },
      { session_id: 'hidden-subagent', role: 'user', content: 'hidden user', timestamp: 501 },
      { session_id: 'hidden-subagent', role: 'assistant', content: 'hidden answer', timestamp: 502 },
      { session_id: 'thread-2-root', role: 'user', content: 'other user', timestamp: 71 },
      { session_id: 'thread-2-root', role: 'assistant', content: 'other answer', timestamp: 72 },
      { session_id: 'tool-row', role: 'user', content: 'tool user', timestamp: 91 },
    ]
  );
});

test('listStateDbThreads returns one visible conversation per thread and hides tool/subagent rows', () => {
  const threads = stateDb.listStateDbThreads(null);

  assert.deepEqual(threads.map((thread) => thread.threadKey), ['thread-2', 'thread-1']);
  assert.equal(threads.some((thread) => thread.sessionKey === 'hidden-subagent'), false);
  assert.equal(threads.some((thread) => thread.sessionKey === 'tool-row'), false);
});

test('listStateDbThreads selects the latest visible leaf as sessionKey', () => {
  const threads = stateDb.listStateDbThreads(null);
  const thread = threads.find((item) => item.threadKey === 'thread-1');

  assert.ok(thread);
  assert.equal(thread.sessionKey, 'leaf-2');
  assert.equal(thread.rootSessionKey, 'thread-1');
  assert.equal(thread.preview, 'second user');
  assert.equal(thread.messageSource, 'state_db');
});

test('getStateDbThread aggregates a selected compression chain in message order', () => {
  const detail = stateDb.getStateDbThread(null, 'leaf-1');

  assert.ok(detail);
  assert.equal(detail.sessionKey, 'leaf-2');
  assert.equal(detail.messageCount, 4);
  assert.deepEqual(
    detail.messages.map((message) => [message.sessionId, message.role, message.text]),
    [
      ['leaf-1', 'user', 'first user'],
      ['leaf-1', 'assistant', 'first answer'],
      ['leaf-2', 'user', 'second user'],
      ['leaf-2', 'assistant', 'second answer'],
    ]
  );
});

test('resolveStateDbLiveTip accepts thread keys and session keys', () => {
  assert.equal(stateDb.resolveStateDbLiveTip(null, 'thread-1'), 'leaf-2');
  assert.equal(stateDb.resolveStateDbLiveTip(null, 'leaf-1'), 'leaf-2');
});

test('getLatestStateDbAssistantMessage returns the latest assistant row after a send start', () => {
  const latest = stateDb.getLatestStateDbAssistantMessage(null, 'leaf-2', 49_000);

  assert.ok(latest);
  assert.equal(latest.sessionId, 'leaf-2');
  assert.equal(latest.text, 'second answer');
  assert.equal(latest.externalId, 'leaf-2:6');
});

test('missing state.db returns safe empty values', () => {
  const missingProfile = path.join('profiles', 'missing');

  assert.deepEqual(stateDb.listStateDbThreads(missingProfile), []);
  assert.equal(stateDb.getStateDbThread(missingProfile, 'anything'), null);
  assert.equal(stateDb.resolveStateDbLiveTip(missingProfile, 'anything'), null);
  assert.equal(stateDb.getLatestStateDbAssistantMessage(missingProfile, 'anything'), null);
});
