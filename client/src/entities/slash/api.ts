import { baseApi } from '../../shared/api/baseApi';

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

export interface SlashCatalogQuery {
  profile?: string | null;
  q?: string;
  query?: string;
  limit?: number;
}

function buildCatalogParams(args?: SlashCatalogQuery) {
  const params: Record<string, string> = {};
  if (args?.profile) params.profile = args.profile;
  if (args?.q) params.q = args.q;
  if (args?.query) params.query = args.query;
  if (args?.limit) params.limit = String(args.limit);
  return params;
}

export const slashApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getSlashCatalog: build.query<SlashCatalogResponse, SlashCatalogQuery | void>({
      query: (args) => ({
        url: '/slash/catalog',
        params: buildCatalogParams(args || undefined),
      }),
    }),
    getSlashCompletions: build.query<SlashCatalogResponse, SlashCatalogQuery | void>({
      query: (args) => ({
        url: '/slash/complete',
        params: buildCatalogParams(args || undefined),
      }),
    }),
    resolveSlashCommand: build.mutation<SlashResolveResult, SlashResolveRequest>({
      query: (body) => ({
        url: '/slash/resolve',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const {
  useGetSlashCatalogQuery,
  useGetSlashCompletionsQuery,
  useResolveSlashCommandMutation,
} = slashApi;
