import { RequestHandler } from 'express';

export type SlashItemSource = 'core' | 'skill' | 'toolset' | 'workspace' | 'local';

export interface SlashCatalogItem {
  name: string;
  usage: string;
  description: string;
  category: string;
  source: SlashItemSource;
  aliases?: string[];
  argsHint?: string | null;
  subcommands?: string[];
  insertText: string;
  executeMode: 'local' | 'send_message' | 'set_setting' | 'open_route';
  route?: string | null;
  settingKey?: string | null;
  skillName?: string | null;
  toolsetName?: string | null;
}

export interface SlashCatalogQuery {
  q?: string;
  query?: string;
  profile?: string;
  limit?: string;
}

export interface SlashCatalogResponse {
  items: SlashCatalogItem[];
  total: number;
  query?: string;
}

export interface SlashResolveRequest {
  text: string;
  profile?: string | null;
}

export type SlashResolveResult =
  | { kind: 'not_slash' }
  | { kind: 'unknown'; commandName: string }
  | { kind: 'local'; item: SlashCatalogItem }
  | { kind: 'setting'; item: SlashCatalogItem; value: string }
  | { kind: 'route'; item: SlashCatalogItem; route: string }
  | {
      kind: 'web_v1_skill_invocation';
      item: SlashCatalogItem;
      skillName: string;
      instruction: string;
      messageText: string;
    }
  | { kind: 'send_message'; item: SlashCatalogItem; messageText: string };

export type Catalog = RequestHandler<never, SlashCatalogResponse, never, SlashCatalogQuery>;
export type Complete = RequestHandler<never, SlashCatalogResponse, never, SlashCatalogQuery>;
export type Resolve = RequestHandler<never, SlashResolveResult, SlashResolveRequest>;
