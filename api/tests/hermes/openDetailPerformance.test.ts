import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createStateDb, createTempHermesHome, FixtureMessage } from '../fixtures/stateDbFixture';

const hermesHome = createTempHermesHome();
process.env.HERMES_HOME = hermesHome;

const stateDb = require('../../src/services/hermes/stateDb') as typeof import('../../src/services/hermes/stateDb');

test.before(() => {
  const messages: FixtureMessage[] = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1,
    session_id: 'leaf-large',
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index + 1}`,
    timestamp: 1_000 + index,
  }));

  createStateDb(
    hermesHome,
    [
      {
        id: 'root-large',
        thread_id: 'thread-large',
        session_kind: 'root',
        started_at: 900,
        ended_at: 950,
        message_count: 2,
      },
      {
        id: 'leaf-large',
        parent_session_id: 'root-large',
        thread_id: 'thread-large',
        session_kind: 'chat',
        started_at: 1_000,
        ended_at: 1_300,
        message_count: messages.length,
      },
    ],
    messages
  );
});

test('state db detail reader supports cursor pagination without duplicate rows', () => {
  const first = stateDb.getStateDbThreadPage(null, 'thread-large', { limit: 80 });
  assert.ok(first);
  assert.equal(first.messages.length, 80);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = stateDb.getStateDbThreadPage(null, 'thread-large', {
    limit: 80,
    cursor: first.nextCursor,
  });
  assert.ok(second);
  assert.equal(second.messages.length, 80);

  const firstIds = new Set(first.messages.map((message) => message.externalId));
  assert.equal(second.messages.some((message) => firstIds.has(message.externalId)), false);
});

test('large state db conversation first page stays within local fixture budget', () => {
  const started = performance.now();
  const page = stateDb.getStateDbThreadPage(null, 'thread-large', { limit: 80 });
  const elapsed = performance.now() - started;

  assert.ok(page);
  assert.equal(page.messages.length, 80);
  assert.ok(elapsed < 250, `expected first page under 250ms, got ${elapsed.toFixed(1)}ms`);
});
