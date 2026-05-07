import { describe, expect, it } from 'vitest';
import type { Message } from '../../../entities/message';
import { hasMatchingDurablePendingUser } from './pendingUser';

function message(overrides: Partial<Message>): Message {
  return {
    _id: '1',
    conversationId: '1',
    text: '',
    thinking: null,
    files: [],
    role: 'user',
    kind: 'message',
    sourceSessionId: null,
    toolName: null,
    toolCallId: null,
    toolStatus: null,
    finishReason: null,
    runId: null,
    upstreamRunId: null,
    clientTurnId: null,
    provisional: false,
    metadata: {},
    hidden: false,
    createdAt: '2026-04-30T13:00:37.000Z',
    ...overrides,
  };
}

describe('hasMatchingDurablePendingUser', () => {
  it('hides an optimistic user bubble after the same durable turn arrives', () => {
    expect(
      hasMatchingDurablePendingUser(
        [message({ text: 'Так, о чём мы общались, я уже забыл просто.' })],
        'Так, о чём мы общались, я уже забыл просто.',
        [],
        '2026-04-30T13:00:35.000Z'
      )
    ).toBe(true);
  });

  it('keeps the optimistic bubble when only an old same-text turn exists', () => {
    expect(
      hasMatchingDurablePendingUser(
        [message({ text: 'Так, о чём мы общались, я уже забыл просто.', createdAt: '2026-04-29T15:26:15.000Z' })],
        'Так, о чём мы общались, я уже забыл просто.',
        [],
        '2026-04-30T13:00:35.000Z'
      )
    ).toBe(false);
  });
});
