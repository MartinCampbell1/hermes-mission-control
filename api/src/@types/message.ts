import { RequestHandler } from 'express';
import { RequestParams, APIResponse } from './shared';

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type MessageKind = 'message' | 'reasoning' | 'tool_call' | 'tool_result' | 'status';
export type ToolStatus = 'running' | 'done' | 'error' | null;

export type MessageFile = {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
};

export type MessageResponse = {
  _id: number;
  conversationId: number;
  externalId: string | null;
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
  createdBy: number;
  createdAt: Date | string;
} | null;

export type ConversationRunResponse = {
  runId: string;
  sessionId: string | null;
  upstreamRunId: string | null;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: Date | string;
  completedAt: Date | string | null;
  lastEventAt: Date | string;
  error: string | null;
} | null;

export type MessageRequestBody = {
  conversationId?: string;
  text?: string;
};

export type ChatRequestBody = {
  conversationId?: string;
  text?: string;
};

export type ListByConversation = RequestHandler<
  { conversationId: string },
  APIResponse<MessageResponse> & { hasMore: boolean; runState?: ConversationRunResponse },
  never,
  { before?: string; limit?: string }
>;
export type Create = RequestHandler<never, MessageResponse, MessageRequestBody, never>;
export type Chat = RequestHandler<never, unknown, ChatRequestBody, never>;
export type Destroy = RequestHandler<RequestParams, null, never, never>;
