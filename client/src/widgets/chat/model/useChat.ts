import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch } from '../../../app/store/hooks';
import {
  messagesApi,
  useGetMessagesQuery,
  usePollMessagesQuery,
  type ConversationRunState,
  type Message,
  type MessagesResponse,
} from '../../../entities/message';
import { useSendMessage } from '../../../features/message/send';
import type { ChatState } from './types';

const POLL_INTERVAL_MS = 5000;

/**
 * Composes message querying, polling, scroll behavior, and send-message state
 * into a single `ChatState` consumed by the chat widget.
 */
export function useChat(conversationId: string | undefined): ChatState {
  const [loadMoreCursor, setLoadMoreCursor] = useState<string | undefined>();
  const [initialLoadTimedOut, setInitialLoadTimedOut] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMore = useRef(false);
  const prevScrollHeight = useRef(0);
  const initialScrollDone = useRef(false);
  const lastConvId = useRef(conversationId);
  const scrollTickRef = useRef(0);
  const lastMergedPollTs = useRef<string | undefined>(undefined);
  const stableMessagesRef = useRef<{ conversationId: string | undefined; messages: Message[] }>({
    conversationId,
    messages: [],
  });

  const dispatch = useAppDispatch();

  const { data, isLoading, isFetching, refetch } = useGetMessagesQuery(
    { conversationId: conversationId!, before: loadMoreCursor, limit: 20 },
    { skip: !conversationId }
  );

  const fetchedMessages = useMemo<Message[]>(() => data?.items ?? [], [data?.items]);
  const canUseStableMessages =
    Boolean(conversationId) &&
    stableMessagesRef.current.conversationId === conversationId &&
    stableMessagesRef.current.messages.length > 0 &&
    fetchedMessages.length === 0 &&
    !loadMoreCursor &&
    (isLoading || isFetching);
  const messages = canUseStableMessages ? stableMessagesRef.current.messages : fetchedMessages;
  const isInitialLoading = isLoading && !canUseStableMessages;
  const effectiveInitialLoading = isInitialLoading && !initialLoadTimedOut;
  const isRefreshing = isFetching && !effectiveInitialLoading;
  const hasMore = (data as MessagesResponse | undefined)?.hasMore ?? false;

  const {
    isStreaming,
    streamingText,
    streamingThinking,
    liveEvents,
    streamStatus,
    streamError,
    pendingUserText,
    pendingFilesPreviews,
    pendingUserStartedAt,
    send,
    clearError,
  } = useSendMessage({
    conversationId,
    refetch,
  });

  // Polling: only fetch messages newer than the latest one we have.
  // Keep this lightweight during streaming; live overlay owns in-flight UI,
  // while polling can still attach durable rows that completed in background.
  const lastMessageTs = messages.length > 0 ? messages[messages.length - 1].createdAt : undefined;

  const { data: pollData } = usePollMessagesQuery(
    { conversationId: conversationId!, after: lastMessageTs },
    {
      skip: !conversationId || isLoading,
      pollingInterval: POLL_INTERVAL_MS,
      refetchOnMountOrArgChange: true,
    }
  );
  const durableRunState: ConversationRunState | null =
    pollData?.runState === undefined
      ? ((data as MessagesResponse | undefined)?.runState ?? null)
      : (pollData.runState ?? null);

  // Merge new polled items into the messages cache + trigger auto-scroll.
  useEffect(() => {
    if (!conversationId || loadMoreCursor || fetchedMessages.length === 0) return;
    stableMessagesRef.current = { conversationId, messages: fetchedMessages };
  }, [conversationId, fetchedMessages, loadMoreCursor]);

  useEffect(() => {
    if (!conversationId || !pollData || pollData.items.length === 0) return;

    // Dedup by newest polled timestamp: avoids re-merging the same data.
    const newestTs = pollData.items[pollData.items.length - 1].createdAt;
    if (lastMergedPollTs.current === newestTs) return;
    lastMergedPollTs.current = newestTs;

    dispatch(
      messagesApi.util.updateQueryData(
        'getMessages',
        { conversationId, before: undefined },
        (draft) => {
          const existing = new Set(draft.items.map((m) => m._id));
          const additions = pollData.items.filter((m) => !existing.has(m._id));
          if (additions.length === 0) return;
          draft.items = [...draft.items, ...additions];
          draft.total = draft.items.length;
        }
      )
    );

    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 200) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  }, [pollData, conversationId, dispatch]);

  useEffect(() => {
    setInitialLoadTimedOut(false);
    if (lastConvId.current !== conversationId) {
      lastConvId.current = conversationId;
      initialScrollDone.current = false;
      lastMergedPollTs.current = undefined;
      if (stableMessagesRef.current.conversationId !== conversationId) {
        stableMessagesRef.current = { conversationId, messages: [] };
      }
    }
    if (isLoadingMore.current) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight - prevScrollHeight.current;
        prevScrollHeight.current = 0;
      }
      isLoadingMore.current = false;
      return;
    }
    if (!initialScrollDone.current && messages.length > 0) {
      initialScrollDone.current = true;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 80);
      return;
    }
    if (pendingUserText || pendingFilesPreviews.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  }, [messages, conversationId, pendingUserText, pendingFilesPreviews]);

  useEffect(() => {
    if (!isInitialLoading || loadMoreCursor) {
      setInitialLoadTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setInitialLoadTimedOut(true), 5000);
    return () => window.clearTimeout(id);
  }, [conversationId, isInitialLoading, loadMoreCursor]);

  useEffect(() => {
    if (!streamingText && !streamingThinking) return;
    const now = Date.now();
    if (now - scrollTickRef.current < 200) return;
    scrollTickRef.current = now;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamingText, streamingThinking]);

  const [prevConvId, setPrevConvId] = useState(conversationId);
  if (prevConvId !== conversationId) {
    setPrevConvId(conversationId);
    clearError();
    if (loadMoreCursor !== undefined) setLoadMoreCursor(undefined);
  }

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingMore.current || isFetching || !hasMore || isStreaming) return;
    if (container.scrollTop < 150 && messages.length > 0) {
      isLoadingMore.current = true;
      prevScrollHeight.current = container.scrollHeight;
      setLoadMoreCursor(messages[0].createdAt);
    }
  }, [isFetching, hasMore, isStreaming, messages]);

  const loadMore = useCallback(() => {
    if (messages.length > 0) {
      isLoadingMore.current = true;
      prevScrollHeight.current = scrollContainerRef.current?.scrollHeight ?? 0;
      setLoadMoreCursor(messages[0].createdAt);
    }
  }, [messages]);

  return {
    messages,
    isLoading: effectiveInitialLoading,
    isFetching,
    isInitialLoading: effectiveInitialLoading,
    initialLoadTimedOut,
    isRefreshing,
    hasMore,
    loadMoreCursor,
    isStreaming,
    streamingText,
    streamingThinking,
    liveEvents,
    streamStatus,
    streamError,
    durableRunState,
    pendingUserText,
    pendingFilesPreviews,
    pendingUserStartedAt,
    send,
    loadMore,
    handleScroll,
    clearError,
    scrollContainerRef,
    messagesEndRef,
  };
}
