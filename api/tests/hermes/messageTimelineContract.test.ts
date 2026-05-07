import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-client-message-contract-'));
process.env.DB_PATH = path.join(rootDir, 'client.sqlite');

const AppDataSource = require('../../src/data-source').default as typeof import('../../src/data-source').default;
const { Message } = require('../../src/entities') as typeof import('../../src/entities');

test.before(async () => {
  await AppDataSource.initialize();
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('old-style user and assistant messages get timeline-safe defaults', async () => {
  const repo = AppDataSource.getRepository(Message);
  const saved = await repo.save(
    repo.create({
      conversationId: 1,
      text: 'hello',
      role: 'assistant' as const,
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  const reloaded = await repo.findOneByOrFail({ _id: saved._id });
  assert.equal(reloaded.kind, 'message');
  assert.equal(reloaded.hidden, false);
  assert.equal(reloaded.toolName, null);
  assert.deepEqual(reloaded.metadata, {});
});

test('tool and reasoning timeline fields persist and reload', async () => {
  const repo = AppDataSource.getRepository(Message);
  const saved = await repo.save(
    repo.create({
      conversationId: 1,
      externalId: 'session-1:42',
      text: 'Thu Apr 30 05:00:00 WITA 2026',
      thinking: 'Need the current date.',
      role: 'tool' as const,
      kind: 'tool_result' as const,
      sourceSessionId: 'session-1',
      toolName: 'exec_command',
      toolCallId: 'call-1',
      toolStatus: 'done' as const,
      finishReason: 'tool_calls',
      metadata: { exit_code: 0 },
      hidden: false,
      createdBy: 1,
      createdAt: new Date(),
    })
  );

  const reloaded = await repo.findOneByOrFail({ _id: saved._id });
  assert.equal(reloaded.role, 'tool');
  assert.equal(reloaded.kind, 'tool_result');
  assert.equal(reloaded.sourceSessionId, 'session-1');
  assert.equal(reloaded.toolName, 'exec_command');
  assert.equal(reloaded.toolCallId, 'call-1');
  assert.equal(reloaded.toolStatus, 'done');
  assert.equal(reloaded.finishReason, 'tool_calls');
  assert.deepEqual(reloaded.metadata, { exit_code: 0 });
});
