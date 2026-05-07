import { IsNull, In, QueryFailedError } from 'typeorm';
import AppDataSource from '../../data-source';
import { Agent, Conversation, Message } from '../../entities';
import { getSessionMessages, listProfileSessionFiles, readSessionMeta } from './sessions';
import type { SessionMessage } from './sessions';
import {
  getStateDbThread,
  getStateDbThreadSessionKeys,
  listStateDbThreads,
} from './stateDb';
import type { HermesThreadDetail, HermesThreadSummary } from './stateDb';
import type { HermesTimelineMessage } from './timeline';
import {
  cleanAssistantMessageText,
  cleanReasoningWrapperText,
  hasRawReasoningWrapper,
  normalizeForMatch,
} from './textCleanup';

function isSqliteUniqueConstraint(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const driver = e.driverError as Record<string, unknown> | undefined;
  if (driver?.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return msg.includes('UNIQUE constraint failed');
}

/**
 * Skip importing session files that were modified more recently than
 * this. Hermes writes its session JSON in-place, so a very fresh mtime
 * usually means the chat handler in this same process is mid-stream
 * and is about to bind the file's session id to its own conversation.
 */
const RECENT_FILE_GRACE_MS = 5_000;

type SyncableMessage = SessionMessage | HermesTimelineMessage;

const profileFor = (agent: Agent | null | undefined): string =>
  agent?.hermesProfile || 'default';

/**
 * Reconcile DB messages for a single conversation against the Hermes
 * source of truth (`state.db` timeline first, JSON fallback second).
 *
 * It captures every turn for the linked lineage, regardless of whether
 * it originated from this UI or a standalone `hermes` REPL. We:
 *
 *   1. Read every message in the file (with stable per-position ids).
 *   2. Skip rows already imported (matched by externalId). If the user
 *      soft-deleted a message in the app, we keep skipping that
 *      Hermes turn — we do not re-insert or undelete it.
 *   3. Reuse local rows that we created during the live request before
 *      Hermes had assigned them a session-relative id (matched by
 *      role + text), stamping them with the externalId so we don't
 *      duplicate them on the next pass.
 *   4. Insert anything genuinely new — these are the turns that came
 *      from outside this UI (and never soft-deleted in our DB).
 */
export interface SyncResult {
  added: Message[];
  claimed: number;
}

async function syncMessagesIntoConversation(
  conv: Conversation,
  agent: Agent | null | undefined,
  sessionMessages: SyncableMessage[]
): Promise<SyncResult> {
  if (!sessionMessages.length) return { added: [], claimed: 0 };

  const msgRepo = AppDataSource.getRepository(Message);
  // `withDeleted: true` — soft-deleted rows still occupy the SQLite
  // UNIQUE(conversationId, externalId) index. If we filtered them out,
  // we'd keep trying to INSERT the same Hermes turn on every poll and
  // spam SQLITE_CONSTRAINT_UNIQUE until the DB wedged the request.
  const existing = await msgRepo.find({
    where: { conversationId: conv._id },
    withDeleted: true,
    order: { createdAt: 'ASC', _id: 'ASC' },
  });
  const knownExternalIds = new Set(
    existing.map((m) => m.externalId).filter((x): x is string => !!x)
  );
  const existingByExternalId = new Map(
    existing
      .filter((m) => !!m.externalId)
      .map((m) => [m.externalId as string, m])
  );

  const claimablePool = existing
    .filter((m) => !m.externalId && !m.deletedAt)
    .map((m) => ({
      msg: m,
      key: m.role === 'user' || m.role === 'assistant' ? normalizeForMatch(m.role, m.text) : '',
      claimed: false,
    }));

  const added: Message[] = [];
  let claimed = 0;
  let lastUserLocalId: number | null = null;

  const isTimeline = (sm: SyncableMessage): sm is HermesTimelineMessage => 'kind' in sm;
  const canClaimByText = (sm: SyncableMessage): sm is SyncableMessage & { role: 'user' | 'assistant' } =>
    (sm.role === 'user' || sm.role === 'assistant') && (!isTimeline(sm) || sm.kind === 'message');
  const updateFromSync = (sm: SyncableMessage): Partial<Message> => ({
    externalId: sm.externalId,
    text: sm.text,
    thinking: sm.thinking,
    role: sm.role,
    kind: isTimeline(sm) ? sm.kind : 'message',
    sourceSessionId: isTimeline(sm) ? sm.sourceSessionId : null,
    toolName: isTimeline(sm) ? sm.toolName : null,
    toolCallId: isTimeline(sm) ? sm.toolCallId : null,
    toolStatus: isTimeline(sm) ? sm.toolStatus : null,
    finishReason: isTimeline(sm) ? sm.finishReason : null,
    provisional: false,
    metadata: isTimeline(sm) ? sm.metadata : {},
    hidden: isTimeline(sm) ? sm.hidden : false,
  });

  for (const sm of sessionMessages) {
    if (knownExternalIds.has(sm.externalId)) {
      const known = existingByExternalId.get(sm.externalId);
      if (known) {
        await msgRepo.update(known._id, updateFromSync(sm) as never);
        Object.assign(known, updateFromSync(sm));
        if (sm.role === 'user') lastUserLocalId = known._id;
      }
      continue;
    }

    const smKey = canClaimByText(sm) ? normalizeForMatch(sm.role, sm.text) : '';
    const candidates = canClaimByText(sm)
      ? claimablePool
        .filter((c) => {
          if (c.claimed || c.msg.role !== sm.role || c.key !== smKey) return false;
          if (sm.role === 'assistant' && lastUserLocalId !== null) {
            return c.msg._id > lastUserLocalId;
          }
          return true;
        })
        .sort((a, b) => {
          if (sm.timestamp) {
            const target = sm.timestamp.getTime();
            const aDelta = Math.abs(new Date(a.msg.createdAt).getTime() - target);
            const bDelta = Math.abs(new Date(b.msg.createdAt).getTime() - target);
            if (aDelta !== bDelta) return aDelta - bDelta;
          }
          return b.msg._id - a.msg._id;
        })
      : [];
    const candidate = candidates[0];
    if (candidate) {
      candidate.claimed = true;
      const updates = updateFromSync(sm);
      if (!updates.thinking && candidate.msg.thinking) updates.thinking = candidate.msg.thinking;
      await msgRepo.update(candidate.msg._id, updates as never);
      Object.assign(candidate.msg, updates);
      claimed += 1;
      knownExternalIds.add(sm.externalId);
      existingByExternalId.set(sm.externalId, candidate.msg);
      if (sm.role === 'user') lastUserLocalId = candidate.msg._id;
      continue;
    }

    const fresh = msgRepo.create({
      conversationId: conv._id,
      externalId: sm.externalId,
      text: sm.text,
      thinking: sm.thinking,
      role: sm.role,
      kind: isTimeline(sm) ? sm.kind : 'message',
      sourceSessionId: isTimeline(sm) ? sm.sourceSessionId : null,
      toolName: isTimeline(sm) ? sm.toolName : null,
      toolCallId: isTimeline(sm) ? sm.toolCallId : null,
      toolStatus: isTimeline(sm) ? sm.toolStatus : null,
      finishReason: isTimeline(sm) ? sm.finishReason : null,
      provisional: false,
      metadata: isTimeline(sm) ? sm.metadata : {},
      hidden: isTimeline(sm) ? sm.hidden : false,
      createdBy: agent?.createdBy ?? conv.createdBy,
      createdAt: sm.timestamp ?? new Date(),
    });
    try {
      const saved = await msgRepo.save(fresh);
      knownExternalIds.add(sm.externalId);
      existingByExternalId.set(sm.externalId, saved);
      if (sm.role === 'user') lastUserLocalId = saved._id;
      added.push(saved);
    } catch (err) {
      if (!(err instanceof QueryFailedError) || !isSqliteUniqueConstraint(err)) {
        throw err;
      }
      const row = await msgRepo.findOne({
        where: { conversationId: conv._id, externalId: sm.externalId },
        withDeleted: true,
      });
      if (!row) throw err;
      knownExternalIds.add(sm.externalId);
      existingByExternalId.set(sm.externalId, row);
      if (row.role === 'user') lastUserLocalId = row._id;
    }
  }

  const orphanBlankAssistants = existing.filter(
    (message) =>
      !message.hidden &&
      message.role === 'assistant' &&
      !String(message.text || '').trim() &&
      !String(message.thinking || '').trim() &&
      (!message.externalId || !knownExternalIds.has(message.externalId))
  );
  for (const message of orphanBlankAssistants) {
    await msgRepo.update(message._id, {
      kind: 'status',
      hidden: true,
      metadata: {
        ...(message.metadata || {}),
        hiddenReason: 'orphan_blank_assistant',
      },
    });
  }

  return { added, claimed };
}

async function persistStateDbIdentity(
  conv: Conversation,
  detail: HermesThreadDetail
): Promise<boolean> {
  const updates: Partial<Conversation> = {};
  if (conv.sessionKey !== detail.sessionKey) updates.sessionKey = detail.sessionKey;
  if (conv.threadKey !== detail.threadKey) updates.threadKey = detail.threadKey;
  if (conv.rootSessionKey !== detail.rootSessionKey) updates.rootSessionKey = detail.rootSessionKey;
  if (conv.messageSource !== 'state_db') updates.messageSource = 'state_db';
  if (!conv.title && detail.title) updates.title = detail.title;

  if (!Object.keys(updates).length) return false;

  await AppDataSource.getRepository(Conversation).update(conv._id, updates);
  Object.assign(conv, updates);
  return true;
}

async function persistJsonFallbackIdentity(conv: Conversation): Promise<boolean> {
  if (conv.messageSource === 'json_fallback') return false;
  await AppDataSource.getRepository(Conversation).update(conv._id, {
    messageSource: 'json_fallback',
  });
  conv.messageSource = 'json_fallback';
  return true;
}

export async function syncConversationFromHermes(
  conv: Conversation,
  agent?: Agent | null
): Promise<SyncResult> {
  const agentRepo = AppDataSource.getRepository(Agent);
  const ag = agent ?? (await agentRepo.findOneBy({ _id: conv.agentId }));
  const profile = profileFor(ag);

  const stateLookupKey = conv.threadKey || conv.sessionKey;
  if (stateLookupKey) {
    const detail = getStateDbThread(profile, stateLookupKey);
    if (detail) {
      await persistStateDbIdentity(conv, detail);
      const result = await syncMessagesIntoConversation(conv, ag, detail.messages);
      await terminalizeCompletedToolCalls({ conversationId: conv._id });
      return result;
    }
  }

  if (!conv.sessionKey) return { added: [], claimed: 0 };

  const sessionMessages = getSessionMessages(profile, conv.sessionKey);
  if (!sessionMessages.length) return { added: [], claimed: 0 };

  await persistJsonFallbackIdentity(conv);
  const result = await syncMessagesIntoConversation(conv, ag, sessionMessages);
  await terminalizeCompletedToolCalls({ conversationId: conv._id });
  return result;
}

export interface LegacyMessageRepairOptions {
  maxAssistantRows?: number;
  includeTerminalToolRepair?: boolean;
  includeToolResultNoiseRepair?: boolean;
}

export interface TerminalizeCompletedToolCallsOptions {
  conversationId?: number;
  maxRows?: number;
}

export async function terminalizeCompletedToolCalls(
  options: TerminalizeCompletedToolCallsOptions = {}
): Promise<number> {
  const msgRepo = AppDataSource.getRepository(Message);
  const runningTools = await msgRepo.find({
    where: {
      ...(typeof options.conversationId === 'number' ? { conversationId: options.conversationId } : {}),
      kind: 'tool_call',
      toolStatus: 'running',
      hidden: false,
      deletedAt: IsNull(),
    },
    order: { _id: 'ASC' },
    take: options.maxRows,
  });

  let repaired = 0;
  for (const toolCall of runningTools) {
    if (!toolCall.toolCallId) continue;
    const result = await msgRepo.findOne({
      where: {
        conversationId: toolCall.conversationId,
        toolCallId: toolCall.toolCallId,
        kind: 'tool_result',
        hidden: false,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC', _id: 'DESC' },
    });
    if (!result) continue;
    await msgRepo.update(toolCall._id, {
      toolStatus: result.toolStatus === 'error' ? 'error' : 'done',
      metadata: {
        ...(toolCall.metadata || {}),
        repairedFrom: 'running_tool_with_terminal_result',
        terminalResultId: result._id,
      },
    });
    repaired += 1;
  }

  return repaired;
}

export async function repairLegacyBlankAssistantMessages(
  options: LegacyMessageRepairOptions = {}
): Promise<number> {
  const includeTerminalToolRepair = options.includeTerminalToolRepair ?? true;
  const includeToolResultNoiseRepair = options.includeToolResultNoiseRepair ?? true;
  const msgRepo = AppDataSource.getRepository(Message);
  const assistantMessages = await msgRepo.find({
    where: {
      role: 'assistant',
      kind: 'message',
      hidden: false,
      deletedAt: IsNull(),
    },
    order: { _id: 'ASC' },
    take: options.maxAssistantRows,
  });
  let repaired = 0;

  for (const message of assistantMessages) {
    const text = String(message.text || '');
    const thinking = String(message.thinking || '').trim();
    if (!text.trim() && !thinking) {
      await msgRepo.update(message._id, {
        kind: 'status',
        hidden: true,
        metadata: {
          ...(message.metadata || {}),
          hiddenReason: 'legacy_blank_assistant_startup_repair',
        },
      });
      repaired += 1;
      continue;
    }

    if (hasRawReasoningWrapper(text)) {
      const cleanedThinking = cleanReasoningWrapperText(text);
      await msgRepo.update(message._id, {
        kind: 'reasoning',
        text: '',
        thinking: thinking || cleanedThinking || null,
        hidden: !thinking && !cleanedThinking,
        metadata: {
          ...(message.metadata || {}),
          repairedFrom: 'legacy_raw_reasoning_wrapper',
        },
      });
      repaired += 1;
      continue;
    }

    const cleanedText = cleanAssistantMessageText(text);
    if (cleanedText !== text) {
      await msgRepo.update(message._id, {
        text: cleanedText,
        kind: cleanedText || thinking ? 'message' : 'status',
        hidden: !cleanedText && !thinking,
        metadata: {
          ...(message.metadata || {}),
          repairedFrom: 'legacy_assistant_noise',
          originalTextPreview: text.slice(0, 240),
        },
      });
      repaired += 1;
    }
  }

  if (includeTerminalToolRepair) {
    repaired += await terminalizeCompletedToolCalls();
  }

  if (includeToolResultNoiseRepair) {
    const visibleToolResults = await msgRepo.find({
      where: {
        kind: 'tool_result',
        hidden: false,
        deletedAt: IsNull(),
      },
    });
    for (const toolResult of visibleToolResults) {
      const text = String(toolResult.text || '');
      const cleanedText = cleanAssistantMessageText(text);
      if (cleanedText === text) continue;
      await msgRepo.update(toolResult._id, {
        text: cleanedText,
        hidden: cleanedText.trim().length === 0,
        metadata: {
          ...(toolResult.metadata || {}),
          repairedFrom: 'legacy_tool_result_noise',
          originalTextPreview: text.slice(0, 240),
        },
      });
      repaired += 1;
    }
  }

  return repaired;
}

export interface DiscoveryResult {
  created: Conversation[];
  synced: Conversation[];
}

export interface DiscoverProfileSessionsOptions {
  /**
   * When false, discovery only upserts conversation identity rows and does not
   * import message timelines. Sidebar/list routes use this to avoid blocking
   * the API event loop on large Hermes state.db files; selected chat routes
   * and explicit sync actions can still reconcile messages on demand.
   */
  syncMessages?: boolean;
}

export function conversationTitleFromThreadForTest(input: {
  title: string | null;
  preview: string;
}): string {
  const cleanTitle = input.title?.replace(/\s+/g, ' ').trim();
  const cleanPreview = input.preview.replace(/\s+/g, ' ').trim();
  const raw =
    cleanTitle && !shouldReplaceTitle(cleanTitle)
      ? cleanTitle
      : cleanPreview || cleanTitle || 'Untitled chat';
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
}

function shouldReplaceTitle(title: string | null): boolean {
  if (!title) return true;
  const normalized = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\"/g, '"')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  return !normalized || /^(new chat|untitled chat)$/i.test(normalized);
}

function threadMatchKeys(
  profile: string,
  thread: HermesThreadSummary
): Set<string> {
  return new Set(
    [
      thread.threadKey,
      thread.rootSessionKey,
      thread.sessionKey,
      ...getStateDbThreadSessionKeys(profile, thread.threadKey),
    ].filter(Boolean)
  );
}

function matchesThread(
  conv: Conversation,
  thread: HermesThreadSummary,
  keys: Set<string>
): boolean {
  if (conv.threadKey && conv.threadKey === thread.threadKey) return true;
  if (conv.rootSessionKey && keys.has(conv.rootSessionKey)) return true;
  if (conv.sessionKey && keys.has(conv.sessionKey)) return true;
  return false;
}

async function discoverStateDbThreads(
  agent: Agent,
  threads: HermesThreadSummary[],
  options: DiscoverProfileSessionsOptions = {}
): Promise<DiscoveryResult> {
  const syncMessages = options.syncMessages !== false;
  const profile = profileFor(agent);
  const convRepo = AppDataSource.getRepository(Conversation);
  const existing = await convRepo.find({
    where: { agentId: agent._id },
    withDeleted: true,
  });

  const created: Conversation[] = [];
  const synced: Conversation[] = [];
  const matchedConversationIds = new Set<number>();

  for (const thread of threads) {
    const keys = threadMatchKeys(profile, thread);
    const match = existing.find(
      (conv) => !matchedConversationIds.has(conv._id) && matchesThread(conv, thread, keys)
    );

    if (match?.deletedAt) {
      matchedConversationIds.add(match._id);
      continue;
    }

    if (match) {
      matchedConversationIds.add(match._id);
      const updates: Partial<Conversation> = {};
      if (match.sessionKey !== thread.sessionKey) updates.sessionKey = thread.sessionKey;
      if (match.threadKey !== thread.threadKey) updates.threadKey = thread.threadKey;
      if (match.rootSessionKey !== thread.rootSessionKey) updates.rootSessionKey = thread.rootSessionKey;
      if (match.messageSource !== 'state_db') updates.messageSource = 'state_db';
      if (shouldReplaceTitle(match.title)) updates.title = conversationTitleFromThreadForTest(thread);

      if (Object.keys(updates).length) {
        await convRepo.update(match._id, updates);
        Object.assign(match, updates);
      }

      if (syncMessages) {
        const r = await syncConversationFromHermes(match, agent);
        if (Object.keys(updates).length || r.added.length || r.claimed) synced.push(match);
      } else if (Object.keys(updates).length) {
        synced.push(match);
      }
      continue;
    }

    const conv = convRepo.create({
      agentId: agent._id,
      sessionKey: thread.sessionKey,
      threadKey: thread.threadKey,
      rootSessionKey: thread.rootSessionKey,
      messageSource: 'state_db',
      title: conversationTitleFromThreadForTest(thread),
      createdBy: agent.createdBy,
      createdAt: thread.lastActive ?? new Date(),
    });
    const saved = await convRepo.save(conv);
    created.push(saved);
    if (syncMessages) {
      await syncConversationFromHermes(saved, agent);
    }
  }

  return { created, synced };
}

async function discoverJsonFallbackSessions(
  agent: Agent,
  options: DiscoverProfileSessionsOptions = {}
): Promise<DiscoveryResult> {
  const syncMessages = options.syncMessages !== false;
  const profile = profileFor(agent);
  const files = listProfileSessionFiles(profile);
  if (!files.length) return { created: [], synced: [] };
  const sessionIds = files.map((f) => f.id);

  const convRepo = AppDataSource.getRepository(Conversation);
  const linked = await convRepo.find({
    where: { agentId: agent._id, sessionKey: In(sessionIds) },
    withDeleted: true,
  });
  const linkedKeys = new Set(linked.map((c) => c.sessionKey).filter((x): x is string => !!x));

  const created: Conversation[] = [];
  const now = Date.now();
  await files.reduce<Promise<void>>(
    (chain, file) =>
      chain.then(async () => {
        if (linkedKeys.has(file.id)) return;
        if (now - file.mtimeMs < RECENT_FILE_GRACE_MS) return;

        const meta = readSessionMeta(profile, file.id);
        if (!meta || meta.messageCount === 0) return;

        try {
          const conv = convRepo.create({
            agentId: agent._id,
            sessionKey: file.id,
            messageSource: 'json_fallback',
            title: meta.title,
            createdBy: agent.createdBy,
            createdAt: meta.startedAt ?? new Date(),
          });
          const saved = await convRepo.save(conv);
          created.push(saved);
          if (syncMessages) {
            await syncConversationFromHermes(saved, agent);
          }
        } catch (err) {
          // If the chat controller raced us and bound this session to a
          // conversation in the meantime, the unique index will reject the
          // insert. Treat that as success — the row exists, just not under
          // our hand.
          // eslint-disable-next-line no-console -- surfacing non-fatal import races for operators
          console.warn(
            `[sync] failed to import session ${file.id} for ${agent.hermesProfile}:`,
            (err as Error).message
          );
        }
      }),
    Promise.resolve()
  );

  const synced: Conversation[] = [];
  const activeLinked = linked.filter((c) => !c.deletedAt);
  if (syncMessages && activeLinked.length) {
    await linked.reduce<Promise<void>>(
      (chain, c) =>
        chain.then(async () => {
          if (c.deletedAt) return;
          const r = await syncConversationFromHermes(c, agent);
          if (r.added.length || r.claimed) synced.push(c);
        }),
      Promise.resolve()
    );
  }

  return { created, synced };
}

/**
 * Discover Hermes conversations for the given agent. state.db is the
 * primary source of truth; classic JSON files are only a fallback for
 * older or broken installs where state.db has no readable visible rows.
 */
export async function discoverProfileSessions(
  agent: Agent,
  options: DiscoverProfileSessionsOptions = {}
): Promise<DiscoveryResult> {
  const profile = profileFor(agent);
  const stateThreads = listStateDbThreads(profile);
  if (stateThreads.length) return discoverStateDbThreads(agent, stateThreads, options);
  return discoverJsonFallbackSessions(agent, options);
}

export async function discoverAgentSessionsById(
  agentId: number
): Promise<DiscoveryResult> {
  const agentRepo = AppDataSource.getRepository(Agent);
  const agent = await agentRepo.findOne({ where: { _id: agentId, deletedAt: IsNull() } });
  if (!agent) return { created: [], synced: [] };
  return discoverProfileSessions(agent);
}
