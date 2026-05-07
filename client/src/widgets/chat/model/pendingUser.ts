import type { Message, MessageFile } from '../../../entities/message';

const RECENT_DURABLE_MATCH_WINDOW_MS = 2 * 60 * 1000;

function normalizedText(text: string | null | undefined): string {
  return String(text || '').trim();
}

function normalizedFileSignature(file: Pick<MessageFile, 'originalName' | 'filename' | 'size'>): string {
  return `${file.originalName || file.filename}:${file.size}`;
}

function filesMatch(durableFiles: MessageFile[] = [], pendingFiles: MessageFile[] = []): boolean {
  if (durableFiles.length !== pendingFiles.length) return false;
  const durable = durableFiles.map(normalizedFileSignature).sort();
  const pending = pendingFiles.map(normalizedFileSignature).sort();
  return durable.every((value, index) => value === pending[index]);
}

function isRecentEnough(createdAt: string, pendingStartedAt: string | null): boolean {
  if (!pendingStartedAt) return false;
  const durableTime = new Date(createdAt).getTime();
  const pendingTime = new Date(pendingStartedAt).getTime();
  if (!Number.isFinite(durableTime) || !Number.isFinite(pendingTime)) return false;
  return durableTime >= pendingTime - RECENT_DURABLE_MATCH_WINDOW_MS;
}

export function hasMatchingDurablePendingUser(
  messages: Message[],
  pendingUserText: string,
  pendingFiles: MessageFile[],
  pendingStartedAt: string | null
): boolean {
  const text = normalizedText(pendingUserText);
  if (!text && pendingFiles.length === 0) return false;

  return messages
    .slice(-20)
    .some((message) => (
      message.role === 'user' &&
      !message.hidden &&
      isRecentEnough(message.createdAt, pendingStartedAt) &&
      normalizedText(message.text) === text &&
      filesMatch(message.files, pendingFiles)
    ));
}
