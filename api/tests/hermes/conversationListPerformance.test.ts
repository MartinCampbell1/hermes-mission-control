import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueProfileSyncForTest,
  getSyncQueueStatusForTest,
} from '../../src/services/hermes/syncQueue';

test('profile sync queue coalesces duplicate sync requests', async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve({ created: [], synced: [] });
  };

  const first = enqueueProfileSyncForTest('default', run);
  const second = enqueueProfileSyncForTest('default', run);
  assert.equal(first, second);
  await first;

  const status = getSyncQueueStatusForTest('default');
  assert.equal(calls, 1);
  assert.equal(status?.running, false);
});

test('profile sync queue skips duplicate syncs inside cooldown window', async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve({ created: [], synced: [] });
  };

  await enqueueProfileSyncForTest('cooldown-profile', run);
  await enqueueProfileSyncForTest('cooldown-profile', run);

  assert.equal(calls, 1);
});
