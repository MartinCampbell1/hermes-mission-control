import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGatewayEvent } from '../../src/services/hermes/eventNormalizer';

test('normalizes reasoning delta to response.thinking.delta', () => {
  const event = normalizeGatewayEvent(
    { event: 'reasoning.delta', delta: 'thinking' },
    { runId: 'local-1', upstreamRunId: 'up-1' }
  );
  assert.deepEqual(event, {
    type: 'response.thinking.delta',
    delta: 'thinking',
    runId: 'local-1',
    upstreamRunId: 'up-1',
  });
});

test('normalizes tool call start to durable timeline event', () => {
  const event = normalizeGatewayEvent(
    { event: 'tool_call.started', name: 'memory', call_id: 'call-1', input: { a: 1 } },
    { runId: 'local-1' }
  );
  assert.equal(event?.type, 'timeline.event');
  assert.equal(event && 'kind' in event ? event.kind : null, 'tool_call');
  assert.equal(event && 'toolName' in event ? event.toolName : null, 'memory');
  assert.equal(event && 'toolStatus' in event ? event.toolStatus : null, 'running');
});

test('unknown gateway event never becomes assistant output text', () => {
  const event = normalizeGatewayEvent(
    { event: 'unknown.debug', delta: 'debug text' },
    { runId: 'local-1' }
  );
  assert.equal(event?.type === 'response.output_text.delta', false);
});
