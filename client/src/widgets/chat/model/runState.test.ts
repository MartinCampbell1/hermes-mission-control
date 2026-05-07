import { describe, expect, it } from 'vitest';
import type { ConversationRunState, Message } from '../../../entities/message';
import { getDurableRunStatus } from './runState';

function runState(overrides: Partial<ConversationRunState>): ConversationRunState {
  return {
    runId: 'run-1',
    sessionId: null,
    upstreamRunId: null,
    status: 'running',
    startedAt: '2026-05-03T00:00:00.000Z',
    completedAt: null,
    lastEventAt: '2026-05-03T00:00:01.000Z',
    error: null,
    ...overrides,
  };
}

function message(overrides: Partial<Message>): Message {
  return {
    _id: '1',
    conversationId: '1',
    text: '',
    thinking: null,
    files: [],
    role: 'assistant',
    kind: 'message',
    sourceSessionId: null,
    toolName: null,
    toolCallId: null,
    toolStatus: null,
    finishReason: null,
    runId: 'run-1',
    upstreamRunId: null,
    clientTurnId: null,
    provisional: false,
    metadata: {},
    hidden: false,
    createdAt: '2026-05-03T00:00:02.000Z',
    ...overrides,
  };
}

describe('getDurableRunStatus', () => {
  it('shows running state when local streaming overlay is gone', () => {
    expect(getDurableRunStatus(runState({ status: 'running' }), [], false)?.text).toContain(
      'still working'
    );
  });

  it('suppresses durable state while local streaming overlay is active', () => {
    expect(getDurableRunStatus(runState({ status: 'running' }), [], true)).toBeNull();
  });

  it('suppresses completed state once a visible assistant row exists', () => {
    expect(
      getDurableRunStatus(
        runState({ status: 'completed', completedAt: '2026-05-03T00:00:03.000Z' }),
        [message({ text: 'done' })],
        false
      )
    ).toBeNull();
  });

  it('keeps terminal errors visible when no reply was saved', () => {
    expect(
      getDurableRunStatus(runState({ status: 'error', error: 'auth failed' }), [], false)
    ).toMatchObject({ severity: 'error', text: 'auth failed' });
  });
});
