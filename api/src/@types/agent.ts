import { RequestHandler } from 'express';
import { QueryFilters, RequestParams, APIResponse } from './shared';

export type AgentResponse = {
  _id: number;
  name: string;
  hermesProfile: string;
  createdBy: number;
  createdAt: Date | string;
  updatedAt: Date | string | null;
  /** Active model for the bound profile (resolved at request time, not stored). */
  model?: string | null;
  /** Whether the profile directory still exists in `~/.hermes`. */
  exists?: boolean;
  /** Advisory spend caps in USD; `null` means no cap. */
  dailyCapUsd: number | null;
  monthlyCapUsd: number | null;
  allTimeCapUsd: number | null;
} | null;

export type AgentJson = NonNullable<AgentResponse>;

export type AgentFilters = QueryFilters<'name' | 'createdAt' | 'updatedAt'>;

export type AgentRequestBody = {
  name?: string;
  hermesProfile?: string;
  /** Pass an explicit `null` to clear a cap, or omit to leave it unchanged. */
  dailyCapUsd?: number | null;
  monthlyCapUsd?: number | null;
  allTimeCapUsd?: number | null;
};

export type ConversationSessionSettings = {
  title?: string | null;
  sessionId?: string | null;
  thinkingLevel?: string | null;
  reasoningLevel?: string | null;
  verboseLevel?: string | null;
  fastMode?: boolean | null;
  modelOverride?: string | null;
  providerOverride?: string | null;
  skillsOverride?: string | null;
  toolsetsOverride?: string | null;
};

export type SettingCapability = {
  supported: boolean;
  appliedOn: Array<'cli' | 'gateway' | 'dry_run'>;
  reason?: string;
};

export type ConversationSessionSettingsResponse = {
  settings: ConversationSessionSettings;
  capabilities: Record<
    | 'modelOverride'
    | 'providerOverride'
    | 'skillsOverride'
    | 'toolsetsOverride'
    | 'verboseLevel'
    | 'thinkingLevel'
    | 'reasoningLevel'
    | 'fastMode',
    SettingCapability
  >;
};

export type List = RequestHandler<never, APIResponse<AgentResponse>, never, AgentFilters>;
export type Get = RequestHandler<RequestParams, AgentResponse, never, never>;
export type Create = RequestHandler<never, AgentResponse, AgentRequestBody, never>;
export type Update = RequestHandler<RequestParams, AgentResponse, AgentRequestBody, never>;
export type Destroy = RequestHandler<RequestParams, null, never, never>;
