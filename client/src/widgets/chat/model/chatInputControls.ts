interface ChatInputControlsArgs {
  text: string;
  pendingFilesCount: number;
  isStreaming: boolean;
  copy?: Partial<ChatInputControlsCopy>;
}

export interface ChatInputControls {
  hasDraft: boolean;
  sendDisabled: boolean;
  sendBlockedByStreaming: boolean;
  attachmentsDisabled: boolean;
  placeholder: string;
  statusText: string | null;
  sendTooltip: string;
  sendAriaLabel: string;
  attachmentTooltip: string;
}

export interface ChatInputControlsCopy {
  placeholder: string;
  draftPlaceholder: string;
  draftSaved: string;
  draftAllowed: string;
  sendWhenDone: string;
  send: string;
  sendBlocked: string;
  typeOrAttach: string;
  attach: string;
  attachAfterStream: string;
  attachmentLimit: string;
}

const defaultCopy: ChatInputControlsCopy = {
  placeholder: 'Type a message...',
  draftPlaceholder: 'Draft the next message...',
  draftSaved: 'Draft saved. Send when the response finishes.',
  draftAllowed: 'Assistant is responding. You can draft the next message.',
  sendWhenDone: 'Send is available when the current response finishes',
  send: 'Send message',
  sendBlocked: 'Send unavailable while response is streaming',
  typeOrAttach: 'Type a message or attach a file',
  attach: 'Attach files',
  attachAfterStream: 'Add attachments after the current response finishes',
  attachmentLimit: 'Attachment limit reached',
};

export function getChatInputControls({
  text,
  pendingFilesCount,
  isStreaming,
  copy,
}: ChatInputControlsArgs): ChatInputControls {
  const messages = { ...defaultCopy, ...copy };
  const hasDraft = text.trim().length > 0 || pendingFilesCount > 0;
  const sendBlockedByStreaming = isStreaming;
  const attachmentsDisabled = isStreaming || pendingFilesCount >= 5;
  const sendDisabled = !hasDraft || sendBlockedByStreaming;

  return {
    hasDraft,
    sendDisabled,
    sendBlockedByStreaming,
    attachmentsDisabled,
    placeholder: isStreaming ? messages.draftPlaceholder : messages.placeholder,
    statusText: isStreaming
      ? hasDraft
        ? messages.draftSaved
        : messages.draftAllowed
      : null,
    sendTooltip: sendBlockedByStreaming
      ? messages.sendWhenDone
      : hasDraft
        ? messages.send
        : messages.typeOrAttach,
    sendAriaLabel: sendBlockedByStreaming
      ? messages.sendBlocked
      : messages.send,
    attachmentTooltip: isStreaming
      ? messages.attachAfterStream
      : pendingFilesCount >= 5
        ? messages.attachmentLimit
        : messages.attach,
  };
}
