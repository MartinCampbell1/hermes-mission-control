import { describe, expect, it } from 'vitest';
import { formatMessageTimestamp } from './formatMessageTimestamp';

describe('formatMessageTimestamp', () => {
  it('uses time only for messages from the current day', () => {
    expect(
      formatMessageTimestamp(
        '2026-04-30T13:00:37.000Z',
        new Date('2026-04-30T15:00:00.000Z'),
        'en-US'
      )
    ).toMatch(/09:00:37|21:00:37/);
  });

  it('includes date for older messages so cross-day turns do not look misordered', () => {
    const formatted = formatMessageTimestamp(
      '2026-04-29T15:26:15.000Z',
      new Date('2026-04-30T15:00:00.000Z'),
      'en-US'
    );

    expect(formatted).toMatch(/Apr 29/);
  });
});
