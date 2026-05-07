import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../../../../app/store/hooks';
import { API_BASE_URL, baseApi } from '../../../../shared/api';
import { useGetMessagesQuery, type Message, type MessageFile } from '../../../../entities/message';
import { initialLiveTimelineState, reduceLiveTimeline } from './liveTimelineReducer';

interface UseSendMessageArgs {
  conversationId: string | undefined;
  refetch: ReturnType<typeof useGetMessagesQuery>['refetch'];
}

export interface SendMessageState {
  isStreaming: boolean;
  streamingText: string;
  streamingThinking: string;
  liveEvents: Message[];
  streamStatus: string;
  streamError: string | null;
  pendingUserText: string;
  pendingFilesPreviews: MessageFile[];
  pendingUserStartedAt: string | null;
  send: (text: string, files: File[]) => Promise<void>;
  abort: () => void;
  clearError: () => void;
}

/**
 * Owns the fetch/stream lifecycle for sending a chat message.
 * Keeps UI-facing state (streaming text, pending previews) local.
 */
export function useSendMessage({
  conversationId,
  refetch,
}: UseSendMessageArgs): SendMessageState {
  const [liveTimeline, setLiveTimeline] = useState(initialLiveTimelineState);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUserText, setPendingUserText] = useState('');
  const [pendingFilesPreviews, setPendingFilesPreviews] = useState<MessageFile[]>([]);
  const [pendingUserStartedAt, setPendingUserStartedAt] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const latestConversationIdRef = useRef(conversationId);
  const inFlightConversationsRef = useRef<Set<string>>(new Set());
  const dispatch = useAppDispatch();

  useEffect(() => {
    latestConversationIdRef.current = conversationId;
    setIsStreaming(false);
    setLiveTimeline(initialLiveTimelineState);
    setStreamError(null);
    setPendingUserText('');
    setPendingUserStartedAt(null);
    setPendingFilesPreviews((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
  }, [conversationId]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearError = useCallback(() => setStreamError(null), []);

  const send = useCallback(
    async (text: string, files: File[]) => {
      const trimmed = text.trim();
      if ((!trimmed && files.length === 0) || !conversationId || isStreaming) return;
      if (inFlightConversationsRef.current.has(conversationId)) return;
      const sendConversationId = conversationId;
      inFlightConversationsRef.current.add(sendConversationId);

      const previews: MessageFile[] = files.map((f) => ({
        filename: f.name,
        originalName: f.name,
        mimetype: f.type,
        size: f.size,
        url: URL.createObjectURL(f),
      }));

      setPendingUserText(trimmed);
      setPendingUserStartedAt(new Date().toISOString());
      setPendingFilesPreviews(previews);
      setLiveTimeline({ ...initialLiveTimelineState, status: 'Sending message...' });
      setStreamError(null);
      setIsStreaming(true);

      const token = localStorage.getItem('token');
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const form = new FormData();
        form.append('conversationId', conversationId);
        if (trimmed) form.append('text', trimmed);
        files.forEach((f) => form.append('files', f));

        const res = await fetch(`${API_BASE_URL}/message/chat`, {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: form,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.error('Chat request failed:', res.status);
          let msg = `Chat request failed (${res.status}).`;
          try {
            const body = await res.json();
            if (body?.error) msg = String(body.error);
            else if (body?.message) msg = String(body.message);
          } catch {
            /* ignore */
          }
          setStreamError(msg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let lineBuf = '';

        const processLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') return;
          try {
            const event = JSON.parse(jsonStr);
            if (latestConversationIdRef.current === sendConversationId) {
              setLiveTimeline((prev) => reduceLiveTimeline(prev, event));
            }
            if (
              event.type === 'response.error' &&
              event.delta &&
              latestConversationIdRef.current === sendConversationId
            ) {
              setStreamError(String(event.delta));
            } else if (event.type === 'session.update') {
              dispatch(baseApi.util.invalidateTags(['Conversation']));
            } else if (event.type === 'message.saved') {
              // Accepted for stream compatibility. The durable message list
              // is still loaded by the refetch after the stream completes.
            } else if (event.type === 'settings.applied') {
              // QA/debug event emitted by dry-run and compatible adapters.
            }
          } catch {
            /* skip */
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            if (lineBuf.trim()) processLine(lineBuf);
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          lineBuf += chunk;
          const parts = lineBuf.split('\n');
          lineBuf = parts.pop()!;
          parts.forEach(processLine);
        }

        if (latestConversationIdRef.current === sendConversationId) {
          await refetch();
          dispatch(baseApi.util.invalidateTags(['Conversation']));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Stream error:', err);
        setStreamError(err instanceof Error ? err.message : 'Network error while streaming.');
      } finally {
        if (latestConversationIdRef.current === conversationId) {
          setIsStreaming(false);
          setLiveTimeline(initialLiveTimelineState);
          setPendingUserText('');
          setPendingUserStartedAt(null);
          setPendingFilesPreviews((prev) => {
            prev.forEach((f) => URL.revokeObjectURL(f.url));
            return [];
          });
        }
        abortRef.current = null;
        inFlightConversationsRef.current.delete(sendConversationId);
      }
    },
    [conversationId, isStreaming, refetch, dispatch]
  );

  return {
    isStreaming,
    streamingText: liveTimeline.assistantText,
    streamingThinking: liveTimeline.thinkingText,
    liveEvents: liveTimeline.events,
    streamStatus: liveTimeline.status,
    streamError,
    pendingUserText,
    pendingFilesPreviews,
    pendingUserStartedAt,
    send,
    abort,
    clearError,
  };
}
