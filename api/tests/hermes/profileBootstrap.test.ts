import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileListForTest } from '../../src/services/hermes/profiles';

test('parses long Hermes profile names when table columns collapse to one space', () => {
  const stdout = `
 Profile          Model                        Gateway      Alias
 ───────────────    ───────────────────────────    ───────────    ────────────
 ◆default         gpt-5.5                      running      —
  continuity-first gpt-5.5                      stopped      continuity-first
  multica-supervisor gpt-5.5                      stopped      multica-supervisor
  multica-worker-hermes gpt-5.5                      stopped      multica-worker-hermes
  ultra-long-autonomy gpt-5.5                      stopped      —
`;

  assert.deepEqual(parseProfileListForTest(stdout).map((p) => p.name), [
    'default',
    'continuity-first',
    'multica-supervisor',
    'multica-worker-hermes',
    'ultra-long-autonomy',
  ]);
});
