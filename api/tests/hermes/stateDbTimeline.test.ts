import test from 'node:test';
import assert from 'node:assert/strict';
import { createTempHermesHome } from '../fixtures/stateDbFixture';
import { createTimelineStateDb } from '../fixtures/stateDbTimelineFixture';

const hermesHome = createTempHermesHome();
process.env.HERMES_HOME = hermesHome;

const stateDb = require('../../src/services/hermes/stateDb') as typeof import('../../src/services/hermes/stateDb');

test.before(() => {
  createTimelineStateDb(hermesHome);
});

test('getStateDbThread returns tool calls, tool results, reasoning, and hides true blanks', () => {
  const detail = stateDb.getStateDbThread(null, 'timeline-live');

  assert.ok(detail);
  assert.deepEqual(
    detail.messages.map((message) => [
      message.externalId,
      message.role,
      message.kind,
      message.toolName,
      message.toolStatus,
      message.hidden,
    ]),
    [
      ['timeline-live:10', 'user', 'message', null, null, false],
      ['timeline-live:11', 'tool', 'tool_call', 'exec_command', 'running', false],
      ['timeline-live:12', 'tool', 'tool_result', 'exec_command', 'done', false],
      ['timeline-live:13', 'assistant', 'reasoning', null, null, false],
      ['timeline-live:14', 'assistant', 'status', null, null, true],
      ['timeline-live:15', 'assistant', 'message', null, null, false],
      ['timeline-live:16', 'assistant', 'status', null, null, true],
      ['timeline-live:17', 'assistant', 'reasoning', null, null, false],
    ]
  );

  const toolCall = detail.messages.find((message) => message.kind === 'tool_call');
  assert.ok(toolCall);
  assert.equal(toolCall.toolCallId, 'call-date-1');
  assert.deepEqual(toolCall.metadata.arguments, { cmd: 'date' });

  const toolResult = detail.messages.find((message) => message.kind === 'tool_result');
  assert.ok(toolResult);
  assert.equal(toolResult.text, 'Thu Apr 30 05:00:00 WITA 2026');

  const encryptedOnly = detail.messages.find((message) => message.externalId === 'timeline-live:16');
  assert.ok(encryptedOnly);
  assert.equal(encryptedOnly.hidden, true);
  assert.equal(encryptedOnly.thinking, null);

  const summarizedReasoning = detail.messages.find((message) => message.externalId === 'timeline-live:17');
  assert.ok(summarizedReasoning);
  assert.equal(summarizedReasoning.thinking, 'Visible reasoning summary.');
  assert.doesNotMatch(summarizedReasoning.thinking || '', /encrypted_content|opaque-secret-reasoning/);
});

test('getLatestStateDbAssistantMessage ignores tool-call and blank assistant rows', () => {
  const latest = stateDb.getLatestStateDbAssistantMessage(null, 'timeline-live', 101_000);

  assert.ok(latest);
  assert.equal(latest.externalId, 'timeline-live:15');
  assert.equal(latest.text, 'The date is Thu Apr 30 05:00:00 WITA 2026.');
});
