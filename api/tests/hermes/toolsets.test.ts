import test from 'node:test';
import assert from 'node:assert/strict';
import { listToolsets, parseToolsetsJson } from '../../src/services/hermes/toolsets';

test('toolset JSON parser accepts valid arrays', () => {
  assert.deepEqual(
    parseToolsetsJson(
      JSON.stringify([
        { name: 'web', description: 'Web research' },
        { name: 'image_gen', description: 'Image generation' },
      ])
    ),
    [
      { name: 'web', description: 'Web research' },
      { name: 'image_gen', description: 'Image generation' },
    ]
  );
});

test('toolset JSON parser rejects non-arrays', () => {
  assert.deepEqual(parseToolsetsJson(JSON.stringify({ web: { description: 'nope' } })), []);
  assert.deepEqual(parseToolsetsJson('not json'), []);
});

test('toolset JSON parser drops unsafe names', () => {
  assert.deepEqual(
    parseToolsetsJson(
      JSON.stringify([
        { name: 'web', description: 'ok' },
        { name: 'bad/name', description: 'slash' },
        { name: 'bad name', description: 'space' },
        { name: 'bad;name', description: 'shell' },
      ])
    ),
    [{ name: 'web', description: 'ok' }]
  );
});

test('toolset discovery returns empty array when CLI and Python fallback fail', () => {
  const toolsets = listToolsets({
    hermesRunner: () => ({
      ok: false,
      stdout: '',
      stderr: 'unsupported',
      error: 'unsupported',
    }),
    pythonRunner: () => {
      throw new Error('python failed');
    },
  });

  assert.deepEqual(toolsets, []);
});
