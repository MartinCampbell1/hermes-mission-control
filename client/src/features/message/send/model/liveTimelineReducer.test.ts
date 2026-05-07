import { describe, expect, it } from 'vitest';
import { initialLiveTimelineState, reduceLiveTimeline } from './liveTimelineReducer';

describe('reduceLiveTimeline', () => {
  it('binds null state to first backend run.started runId', () => {
    const state = reduceLiveTimeline(initialLiveTimelineState, {
      type: 'run.started',
      runId: 'server-run-1',
    });

    expect(state.runId).toBe('server-run-1');
    expect(state.status).toBeTruthy();
  });

  it('updates timeline for events with the bound runId', () => {
    const started = reduceLiveTimeline(initialLiveTimelineState, {
      type: 'run.started',
      runId: 'server-run-1',
    });
    const updated = reduceLiveTimeline(started, {
      type: 'response.output_text.delta',
      runId: 'server-run-1',
      delta: 'hello',
    });

    expect(updated.assistantText).toBe('hello');
  });

  it('ignores events from another runId after binding', () => {
    const started = reduceLiveTimeline(initialLiveTimelineState, {
      type: 'run.started',
      runId: 'server-run-1',
    });
    const updated = reduceLiveTimeline(started, {
      type: 'response.output_text.delta',
      runId: 'server-run-2',
      delta: 'wrong',
    });

    expect(updated.assistantText).toBe('');
  });

  it('terminalizes running tool events on error completion', () => {
    const started = reduceLiveTimeline(initialLiveTimelineState, {
      type: 'run.started',
      runId: 'server-run-1',
    });
    const withTool = reduceLiveTimeline(started, {
      type: 'timeline.event',
      runId: 'server-run-1',
      role: 'tool',
      kind: 'tool_call',
      toolName: 'memory',
      toolCallId: 'call-1',
      toolStatus: 'running',
    });
    const completed = reduceLiveTimeline(withTool, {
      type: 'run.completed',
      runId: 'server-run-1',
      status: 'error',
    });

    expect(
      completed.events.some((event) => event.toolCallId === 'call-1' && event.toolStatus === 'error')
    ).toBe(true);
  });
});
