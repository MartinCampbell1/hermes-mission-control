import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanAssistantMessageText,
  cleanReasoningWrapperText,
  hasRawReasoningWrapper,
} from '../../src/services/hermes/textCleanup';

test('cleanAssistantMessageText strips Hermes titled service tuple prefixes', () => {
  assert.equal(
    cleanAssistantMessageText(
      '"QA_NEW_CHAT_SIMPLE_20260430: Ответь ровно QA_NEW_CHAT_SIMPLE_OK_20260430 и ничего больше." (2 user messages, 6 total messages) date: Thu Apr 30 05:50:13 WITA 2026'
    ),
    'date: Thu Apr 30 05:50:13 WITA 2026'
  );
});

test('cleanAssistantMessageText strips generic service tuple prefixes', () => {
  assert.equal(
    cleanAssistantMessageText('generic: (6 user messages, 163 total messages) QDRANT_OK'),
    'QDRANT_OK'
  );
});

test('cleanReasoningWrapperText extracts reasoning body without box chrome', () => {
  const raw =
    '┌─ Reasoning ──────────────────────────────────────────────────────────────────┐\n│ considering tool output\n└──────────────────────────────────────────────────────────────────────────────┘';

  assert.equal(hasRawReasoningWrapper(raw), true);
  assert.equal(cleanReasoningWrapperText(raw), 'considering tool output');
});
