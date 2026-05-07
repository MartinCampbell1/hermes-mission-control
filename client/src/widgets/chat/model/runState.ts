import type { ConversationRunState, Message } from '../../../entities/message';

export interface DurableRunStatus {
  runId: string;
  status: ConversationRunState['status'];
  text: string;
  severity: 'info' | 'error';
}

export interface DurableRunStatusCopy {
  running: string;
  error: string;
  cancelled: string;
  completed: string;
}

const defaultCopy: DurableRunStatusCopy = {
  running: 'Hermes is still working. This run will continue even if you switch tabs.',
  error: 'Hermes stopped with an error before a visible reply was saved.',
  cancelled: 'Hermes run was cancelled before a visible reply was saved.',
  completed: 'Hermes finished the run and is reconciling the saved reply.',
};

function hasVisibleAssistantForRun(messages: Message[], runId: string): boolean {
  return messages.some((message) => (
    !message.hidden &&
    message.role === 'assistant' &&
    message.runId === runId &&
    Boolean(message.text?.trim() || message.thinking?.trim())
  ));
}

function hasVisibleAssistantAfterRunStart(messages: Message[], startedAt: string): boolean {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return messages.some((message) => {
    if (message.hidden || message.role !== 'assistant') return false;
    if (!message.text?.trim() && !message.thinking?.trim()) return false;
    const created = new Date(message.createdAt).getTime();
    return Number.isFinite(created) && created >= started;
  });
}

export function getDurableRunStatus(
  runState: ConversationRunState | null | undefined,
  messages: Message[],
  isStreaming: boolean,
  copy?: Partial<DurableRunStatusCopy>
): DurableRunStatus | null {
  if (!runState || isStreaming) return null;
  if (runState.status === 'completed' && hasVisibleAssistantForRun(messages, runState.runId)) {
    return null;
  }
  const messagesCopy = { ...defaultCopy, ...copy };

  if (runState.status === 'running') {
    if (hasVisibleAssistantAfterRunStart(messages, runState.startedAt)) return null;
    return {
      runId: runState.runId,
      status: runState.status,
      severity: 'info',
      text: messagesCopy.running,
    };
  }

  if (runState.status === 'error') {
    return {
      runId: runState.runId,
      status: runState.status,
      severity: 'error',
      text: runState.error || messagesCopy.error,
    };
  }

  if (runState.status === 'cancelled') {
    return {
      runId: runState.runId,
      status: runState.status,
      severity: 'error',
      text: messagesCopy.cancelled,
    };
  }

  return {
    runId: runState.runId,
    status: runState.status,
    severity: 'info',
    text: messagesCopy.completed,
  };
}
