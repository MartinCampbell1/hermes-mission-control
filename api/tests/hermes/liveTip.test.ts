import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { seedCompressionLineage, seedStateDbSchema } from '../fixtures/stateDbFixture';
import { resolveLiveTipFast } from '../../src/services/hermes/liveTip';

test('resolveLiveTipFast selects visible leaf without reading messages', () => {
  const db = new Database(':memory:');
  seedStateDbSchema(db);
  const ids = seedCompressionLineage(db);
  const queries: string[] = [];

  const result = resolveLiveTipFast({
    db,
    key: ids.threadKey,
    onQuery: (sql) => queries.push(sql),
  });

  assert.equal(result?.sessionId, ids.visibleLeaf);
  assert.equal(result?.threadKey, ids.threadKey);
  assert.equal(result?.rootSessionKey, ids.root);
  assert.equal(
    queries.some((sql) => /\bfrom\s+messages\b/i.test(sql)),
    false,
    'fast live tip resolution must not read transcript rows'
  );

  db.close();
});

test('resolveLiveTipFast returns null when state db is missing', () => {
  const result = resolveLiveTipFast({
    dbPath: '/tmp/hermes-client-missing-state.db',
    key: 'missing',
  });
  assert.equal(result, null);
});
