import type { RefObject } from 'react';
import type { ConversationRunState, Message, MessageFile } from '../../../entities/message';

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  isFetching: boolean;
  isInitialLoading: boolean;
  initialLoadTimedOut: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  loadMoreCursor: string | undefined;

  isStreaming: boolean;
  streamingText: string;
  streamingThinking: string;
  liveEvents: Message[];
  streamStatus: string;
  streamError: string | null;
  durableRunState: ConversationRunState | null;
  pendingUserText: string;
  pendingFilesPreviews: MessageFile[];
  pendingUserStartedAt: string | null;

  send: (text: string, files: File[]) => Promise<void>;
  loadMore: () => void;
  handleScroll: () => void;
  clearError: () => void;

  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
}
