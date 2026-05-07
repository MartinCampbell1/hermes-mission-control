import { describe, expect, it } from 'vitest';
import { getChatInputControls } from './chatInputControls';

describe('getChatInputControls', () => {
  it('allows an editable draft state while send is blocked by streaming', () => {
    const controls = getChatInputControls({
      text: 'next turn',
      pendingFilesCount: 0,
      isStreaming: true,
    });

    expect(controls.hasDraft).toBe(true);
    expect(controls.sendDisabled).toBe(true);
    expect(controls.sendBlockedByStreaming).toBe(true);
    expect(controls.attachmentsDisabled).toBe(true);
    expect(controls.placeholder).toBe('Draft the next message...');
    expect(controls.statusText).toContain('Draft saved');
  });

  it('enables sending after streaming finishes when a draft exists', () => {
    const controls = getChatInputControls({
      text: 'next turn',
      pendingFilesCount: 0,
      isStreaming: false,
    });

    expect(controls.hasDraft).toBe(true);
    expect(controls.sendDisabled).toBe(false);
    expect(controls.sendBlockedByStreaming).toBe(false);
    expect(controls.attachmentsDisabled).toBe(false);
    expect(controls.statusText).toBeNull();
  });

  it('keeps empty sends disabled outside streaming', () => {
    const controls = getChatInputControls({
      text: '   ',
      pendingFilesCount: 0,
      isStreaming: false,
    });

    expect(controls.hasDraft).toBe(false);
    expect(controls.sendDisabled).toBe(true);
    expect(controls.sendTooltip).toBe('Type a message or attach a file');
  });

  it('treats pending attachments as a draft but blocks attachment changes during streaming', () => {
    const controls = getChatInputControls({
      text: '',
      pendingFilesCount: 1,
      isStreaming: true,
    });

    expect(controls.hasDraft).toBe(true);
    expect(controls.sendDisabled).toBe(true);
    expect(controls.attachmentsDisabled).toBe(true);
    expect(controls.attachmentTooltip).toBe('Add attachments after the current response finishes');
  });
});
