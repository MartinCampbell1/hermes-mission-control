import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCliStreamSanitizer,
  sanitizeCliFinalText,
  sanitizeCliStreamChunk,
} from '../../src/services/hermes/streamSanitizer';

test('sanitizeCliStreamChunk strips service tuple preamble', () => {
  const out = sanitizeCliStreamChunk('(5user messages, 151 total messages)\nFinal answer');
  assert.equal(out.outputText, 'Final answer');
  assert.match(out.droppedText, /5user messages/);
});

test('sanitizeCliStreamChunk strips CRLF-wrapped service tuple preamble', () => {
  const out = sanitizeCliStreamChunk(
    'generic: "title"\r\n(6 \r\nuser\r\nmessages, 161 total\r\nmessages)\r\nFinal answer'
  );
  assert.equal(out.outputText, 'Final answer');
  assert.match(out.droppedText, /6 user messages, 161 total messages/);
});

test('createCliStreamSanitizer buffers split service tuple chunks', () => {
  const sanitizer = createCliStreamSanitizer();

  const first = sanitizer.push('generic: (6 \r\nuser');
  assert.equal(first.outputText, '');
  assert.equal(first.reasoningText, '');

  const second = sanitizer.push('\r\nmessages, 161 total\r\nmessages)\r\nFinal answer');
  assert.equal(second.outputText, 'Final answer');
  assert.match(second.droppedText, /6 user messages, 161 total messages/);

  const flushed = sanitizer.flush();
  assert.equal(flushed.outputText, '');
  assert.equal(flushed.reasoningText, '');
});

test('createCliStreamSanitizer buffers split quoted title banners before tuple appears', () => {
  const sanitizer = createCliStreamSanitizer();

  assert.equal(
    sanitizer.push('"QA_NEW_CHAT_SIMPLE_20260430: Ответь \r\n').outputText,
    ''
  );
  assert.equal(
    sanitizer.push('ровно OK и ничего больше." (7 user messages, 24 \r\n').outputText,
    ''
  );
  const final = sanitizer.push('total messages)\r\nFinal answer');

  assert.equal(final.outputText, 'Final answer');
  assert.match(final.droppedText, /QA_NEW_CHAT_SIMPLE_20260430/);
  assert.match(final.droppedText, /7 user messages, 24 total messages/);
  assert.equal(sanitizer.flush().outputText, '');
});

test('sanitizeCliStreamChunk does not emit reasoning box wrapper as assistant text', () => {
  const out = sanitizeCliStreamChunk('┌─ Reasoning\nthinking\n└─\nAnswer');
  assert.equal(out.outputText.includes('┌─ Reasoning'), false);
  assert.equal(out.outputText, 'Answer');
  assert.equal(out.reasoningText, 'thinking');
});

test('sanitizeCliFinalText strips resume and session banners from final text', () => {
  const text = sanitizeCliFinalText('↻ Resumed session abc "title" (1 user message, 2 total messages)\nhello\nsession_id: abc');
  assert.equal(text, 'hello');
});

test('sanitizeCliFinalText strips CRLF-wrapped service tuple from final text', () => {
  const text = sanitizeCliFinalText('(6 \r\nuser\r\nmessages, 161 total\r\nmessages)\r\nhello');
  assert.equal(text, 'hello');
});
