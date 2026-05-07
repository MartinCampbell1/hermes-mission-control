import { baseApi } from '../../shared/api/baseApi';

export interface MessageFile {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type MessageKind = 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'status';
export type ToolStatus = 'running' | 'done' | 'error' | null;

export interface Message {
  _id: string;
  conversationId: string;
  text: string;
  thinking: string | null;
  files: MessageFile[];
  role: MessageRole;
  kind: MessageKind;
  sourceSessionId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  toolStatus: ToolStatus;
  finishReason: string | null;
  runId: string | null;
  upstreamRunId: string | null;
  clientTurnId: string | null;
  provisional: boolean;
  metadata: Record<string, unknown>;
  hidden: boolean;
  createdAt: string;
}

export interface ConversationRunState {
  runId: string;
  sessionId: string | null;
  upstreamRunId: string | null;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  lastEventAt: string;
  error: string | null;
}

export interface MessagesResponse {
  total: number;
  items: Message[];
  hasMore: boolean;
  runState?: ConversationRunState | null;
}

export interface MessagesQueryArg {
  conversationId: string;
  before?: string;
  limit?: number;
}

export interface PollResponse {
  items: Message[];
  synced: number;
  runState?: ConversationRunState | null;
}

export interface PollQueryArg {
  conversationId: string;
  after?: string;
}

export const messagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMessages: build.query<MessagesResponse, MessagesQueryArg>({
      query: ({ conversationId, before, limit }) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        return `/message/conversation/${conversationId}${qs ? `?${qs}` : ''}`;
      },
      serializeQueryArgs: ({ queryArgs }) => queryArgs.conversationId,
      merge: (currentCache, newResponse, { arg }) => {
        if (arg.before) {
          const existingIds = new Set(currentCache.items.map((m) => m._id));
          const unique = newResponse.items.filter((m) => !existingIds.has(m._id));
          currentCache.items = [...unique, ...currentCache.items];
          currentCache.hasMore = newResponse.hasMore;
        } else {
          currentCache.items = newResponse.items;
          currentCache.total = newResponse.total;
          currentCache.hasMore = newResponse.hasMore;
        }
      },
      forceRefetch: ({ currentArg, previousArg }) =>
        currentArg?.before !== previousArg?.before ||
        currentArg?.conversationId !== previousArg?.conversationId,
      providesTags: (_result, _error, { conversationId }) => [
        { type: 'Message', id: conversationId },
      ],
    }),
    pollMessages: build.query<PollResponse, PollQueryArg>({
      query: ({ conversationId, after }) => {
        const params = new URLSearchParams();
        if (after) params.set('after', after);
        const qs = params.toString();
        return `/message/conversation/${conversationId}/poll${qs ? `?${qs}` : ''}`;
      },
    }),
    createMessage: build.mutation<Message, { conversationId: string; text: string }>({
      query: (body) => ({
        url: '/message',
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, { conversationId }) => [
        { type: 'Message', id: conversationId },
      ],
    }),
    deleteMessage: build.mutation<void, { id: string; conversationId: string }>({
      query: ({ id }) => ({
        url: `/message/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { conversationId }) => [
        { type: 'Message', id: conversationId },
      ],
    }),
  }),
});

export const {
  useGetMessagesQuery,
  usePollMessagesQuery,
  useCreateMessageMutation,
  useDeleteMessageMutation,
} = messagesApi;
