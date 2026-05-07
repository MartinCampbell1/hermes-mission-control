import { useEffect, useState } from 'react';
import { Alert, Box, Typography, CircularProgress, Button } from '@mui/material';
import { MessageBubble, RunStatusBlock, type Message } from '../../../entities/message';
import AgentActivityBlock from '../../../entities/message/ui/AgentActivityBlock';
import type { ChatState } from '../model/types';
import { hasMatchingDurablePendingUser } from '../model/pendingUser';
import { getDurableRunStatus } from '../model/runState';
import { useI18n } from '../../../shared/i18n';

interface MessageListProps {
  chat: ChatState;
}

function isActivityMessage(message: Message): boolean {
  return message.kind === 'reasoning' || message.kind === 'tool_call' || message.kind === 'tool_result';
}

function renderMessageStream(messages: Message[]) {
  const rendered = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.hidden) continue;

    if (isActivityMessage(message)) {
      const group: Message[] = [];
      let cursor = index;
      while (cursor < messages.length && messages[cursor] && isActivityMessage(messages[cursor])) {
        if (!messages[cursor].hidden) group.push(messages[cursor]);
        cursor += 1;
      }
      index = cursor - 1;
      const thinkingText = group
        .filter((item) => item.kind === 'reasoning')
        .map((item) => item.thinking || item.text)
        .filter(Boolean)
        .join('\n\n');
      const toolMessages = group.filter((item) => item.kind === 'tool_call' || item.kind === 'tool_result');
      rendered.push(
        <AgentActivityBlock
          key={`activity-${group.map((item) => item._id).join('-')}`}
          thinkingText={thinkingText}
          toolMessages={toolMessages}
        />
      );
      continue;
    }

    rendered.push(<MessageBubble key={message._id} message={message} messageId={message._id} />);
  }
  return rendered;
}

export default function MessageList({ chat }: MessageListProps) {
  const { t } = useI18n();
  const {
    messages,
    isLoading,
    isFetching,
    isRefreshing,
    hasMore,
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
    loadMore,
    loadMoreCursor,
    scrollContainerRef,
    messagesEndRef,
    handleScroll,
    clearError,
  } = chat;
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const showPendingUser =
    isStreaming &&
    (pendingUserText || pendingFilesPreviews.length > 0) &&
    !hasMatchingDurablePendingUser(
      messages,
      pendingUserText,
      pendingFilesPreviews,
      pendingUserStartedAt
    );
  const durableStatus = getDurableRunStatus(durableRunState, messages, isStreaming, {
    running: t('chat.durableRunning'),
    error: t('chat.durableError'),
    cancelled: t('chat.durableCancelled'),
    completed: t('chat.durableCompleted'),
  });

  useEffect(() => {
    if (!isLoading || loadMoreCursor) {
      setLoadingTimedOut(false);
      return undefined;
    }
    const id = window.setTimeout(() => setLoadingTimedOut(true), 5000);
    return () => window.clearTimeout(id);
  }, [isLoading, loadMoreCursor]);

  return (
    <div
      className="chat-scroll"
      ref={scrollContainerRef}
      onScroll={handleScroll}
    >
      <div className="chat-inner">
        {streamError && (
          <Box sx={{ position: 'sticky', top: 0, zIndex: 2, mb: 1.5 }}>
            <Alert severity="error" variant="filled" onClose={clearError} sx={{ alignItems: 'flex-start', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {streamError}
            </Alert>
          </Box>
        )}
        {isLoading && !loadMoreCursor ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 1 }}>
            <RunStatusBlock status={loadingTimedOut ? t('chat.conversationStillLoading') : t('chat.loadingConversation')} />
            {loadingTimedOut ? (
              <Button size="small" variant="outlined" onClick={() => window.location.reload()}>{t('common.reload')}</Button>
            ) : (
              <CircularProgress size={20} />
            )}
          </Box>
        ) : messages.length === 0 && !isStreaming && !durableStatus ? (
          <div className="hero">
            <h2>{t('chat.noMessages')}</h2>
          </div>
        ) : (
          <>
            {isRefreshing && messages.length > 0 && !loadMoreCursor && (
              <Typography variant="caption" color="text.secondary">{t('chat.refreshing')}</Typography>
            )}
            {hasMore && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                {isFetching && loadMoreCursor ? (
                  <CircularProgress size={20} />
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }} onClick={loadMore}>
                    {t('chat.loadOlder')}
                  </Typography>
                )}
              </Box>
            )}
            {renderMessageStream(messages)}
            {showPendingUser && <MessageBubble message={{ text: pendingUserText, role: 'user', files: pendingFilesPreviews }} />}
            {isStreaming && streamingThinking && (
              <AgentActivityBlock thinkingText={streamingThinking} isStreaming />
            )}
            {isStreaming && liveEvents.length > 0 && <AgentActivityBlock toolMessages={liveEvents} isStreaming />}
            {isStreaming && streamingText && <MessageBubble message={{ text: streamingText, role: 'assistant' }} isStreaming />}
            {isStreaming && !streamingText && !streamingThinking && liveEvents.length === 0 && <RunStatusBlock status={streamStatus || t('chat.hermesWorking')} />}
            {!isStreaming && durableStatus && <RunStatusBlock status={durableStatus.text} severity={durableStatus.severity} />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
