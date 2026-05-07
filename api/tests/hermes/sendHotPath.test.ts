import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const controllerPath = path.resolve(__dirname, '../../src/routes/message/controller.ts');

function readController(): string {
  return fs.readFileSync(controllerPath, 'utf8');
}

test('send path resolves the visible Hermes live tip before adapter selection', () => {
  const source = readController();

  assert.match(
    source,
    /resolveLiveTipFast/,
    'message controller must use sessions-only live-tip resolution before send'
  );
  assert.doesNotMatch(
    source,
    /const\s+resumeTarget\s*=\s*conv\.sessionKey\s*\?\?\s*null/,
    'resume target must not be the stale conversation sessionKey without fast live-tip resolution'
  );
});

test('resumed send does not eagerly load full local conversation history', () => {
  const source = readController();

  assert.doesNotMatch(
    source,
    /const\s+conversationHistory\s*=\s*\(await\s+msgRepo\.find\(/,
    'conversation history must not be loaded eagerly before adapter selection'
  );
  assert.match(
    source,
    /loadConversationHistoryForGateway/,
    'history loading should be isolated in a helper used only when needed'
  );
});

test('resumed gateway sends an empty history instead of duplicating local transcript context', () => {
  const source = readController();

  assert.match(
    source,
    /resumeTarget[^?]*\?[^:]*\[\]/s,
    'resumed gateway runs must pass an empty history or omit history when session_id is present'
  );
});
