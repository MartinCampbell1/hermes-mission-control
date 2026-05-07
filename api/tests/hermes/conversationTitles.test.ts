import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTitleFromThreadForTest } from '../../src/services/hermes/sync';

test('conversation title falls back to first useful user message, not New chat', () => {
  const title = conversationTitleFromThreadForTest({
    title: null,
    preview: 'Нужно проверить continuity старых диалогов',
  });

  assert.equal(title, 'Нужно проверить continuity старых диалогов');
});

test('conversation title replaces generic New chat with useful preview', () => {
  const title = conversationTitleFromThreadForTest({
    title: 'New chat',
    preview: 'Рефакторинг Hermes Web UI',
  });

  assert.equal(title, 'Рефакторинг Hermes Web UI');
});
