import { createStateDb } from './stateDbFixture';

export function createTimelineStateDb(profileDir: string): void {
  createStateDb(
    profileDir,
    [
      {
        id: 'timeline-live',
        thread_id: 'timeline-thread',
        session_kind: 'root',
        started_at: 100,
        ended_at: 140,
        message_count: 6,
        title: 'Timeline thread',
      },
    ],
    [
      { id: 10, session_id: 'timeline-live', role: 'user', content: 'Need date', timestamp: 101 },
      {
        id: 11,
        session_id: 'timeline-live',
        role: 'assistant',
        content: '',
        timestamp: 102,
        finish_reason: 'tool_calls',
        reasoning_content: 'I should run date.',
        tool_calls: JSON.stringify([
          {
            id: 'call-date-1',
            type: 'function',
            function: {
              name: 'exec_command',
              arguments: JSON.stringify({ cmd: 'date' }),
            },
          },
        ]),
      },
      {
        id: 12,
        session_id: 'timeline-live',
        role: 'tool',
        content: JSON.stringify({
          output: 'Thu Apr 30 05:00:00 WITA 2026',
          exit_code: 0,
          error: null,
        }),
        timestamp: 103,
        tool_call_id: 'call-date-1',
        tool_name: 'exec_command',
      },
      {
        id: 13,
        session_id: 'timeline-live',
        role: 'assistant',
        content: '',
        timestamp: 104,
        reasoning_content: 'The command succeeded.',
      },
      {
        id: 14,
        session_id: 'timeline-live',
        role: 'assistant',
        content: '',
        timestamp: 105,
      },
      {
        id: 15,
        session_id: 'timeline-live',
        role: 'assistant',
        content: 'The date is Thu Apr 30 05:00:00 WITA 2026.',
        timestamp: 106,
        finish_reason: 'stop',
      },
      {
        id: 16,
        session_id: 'timeline-live',
        role: 'assistant',
        content: '',
        timestamp: 107,
        codex_message_items: JSON.stringify([
          {
            type: 'reasoning',
            encrypted_content: 'opaque-secret-reasoning',
          },
        ]),
      },
      {
        id: 17,
        session_id: 'timeline-live',
        role: 'assistant',
        content: '',
        timestamp: 108,
        codex_message_items: JSON.stringify([
          {
            type: 'reasoning',
            encrypted_content: 'opaque-secret-reasoning',
            summary: [{ type: 'summary_text', text: 'Visible reasoning summary.' }],
          },
        ]),
      },
    ]
  );
}
