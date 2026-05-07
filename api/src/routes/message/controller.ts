import path from 'path';
import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';
import { LessThan, MoreThan, FindOptionsWhere, Repository } from 'typeorm';
import AppDataSource from '../../data-source';
import { Message, Conversation, ConversationRun, Agent } from '../../entities';
import {
  ListByConversation,
  Create,
  Chat,
  Destroy,
  MessageFile,
  MessageResponse,
  ConversationRunResponse,
} from '../../@types/message';
import * as hermes from '../../services/hermes';

/**
 * Resolve the public origin to use when minting URLs back to the client.
 *
 * Hermes Client is deployed in two patterns:
 *   1. Local-only: browser on the install host. `Host` header reads
 *      `localhost:<port>` and the API_PUBLIC_URL env (default
 *      `http://localhost:18889`) was historically hardcoded — fine.
 *   2. LAN/Tailscale/IP: browser on a different device. `Host` reads
 *      `<remote-host>:<port>`. A hardcoded localhost URL would point
 *      the remote browser at *its own machine*, breaking upload
 *      previews and downloads silently.
 *
 * So we prefer `req.headers.host` (already validated by Express + the
 * cors middleware) and only fall back to the env override / default
 * for non-HTTP callers. `x-forwarded-host` is honoured for users
 * running behind a reverse proxy.
 */
const apiPublicUrl = (req: { headers: Record<string, string | string[] | undefined>; protocol?: string }): string => {
  const envOverride = process.env.API_PUBLIC_URL;
  const xfHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(xfHost) ? xfHost[0] : xfHost) || req.headers.host;
  if (host) {
    const xfProto = req.headers['x-forwarded-proto'];
    const proto =
      (Array.isArray(xfProto) ? xfProto[0] : xfProto) || req.protocol || 'http';
    return `${proto}://${host}`;
  }
  return envOverride || 'http://localhost:18889';
};

const DEFAULT_PAGE_SIZE = 20;
const REASONING_OUTPUT_RE = /^\s*(?:┌|╭|─)\s*Reasoning\b/i;

function displayTextForMessage(message: Message): string {
  const text = String(message.text || '');
  if (message.role === 'assistant' && message.kind === 'message') {
    return hermes.cleanAssistantMessageText(text);
  }
  if (message.kind === 'tool_result') {
    return hermes.cleanAssistantMessageText(text);
  }
  return text;
}

function isRenderableMessage(message: Message): boolean {
  if (message.hidden) return false;
  const displayText = displayTextForMessage(message);
  const hasText = displayText.trim().length > 0;
  const hasThinking = String(message.thinking || '').trim().length > 0;
  if (
    message.role === 'assistant' &&
    (REASONING_OUTPUT_RE.test(String(message.text || '')) ||
      hermes.hasRawReasoningWrapper(String(message.text || '')))
  ) {
    return false;
  }
  const isLegacyBlankAssistant =
    message.role === 'assistant' &&
    !hasText &&
    !hasThinking &&
    (!message.kind || message.kind === 'message' || message.kind === 'status');
  return !isLegacyBlankAssistant;
}

function toMessageResponse(message: Message): Exclude<MessageResponse, null> {
  return {
    ...(message as unknown as Exclude<MessageResponse, null>),
    text: displayTextForMessage(message),
  };
}

function terminalizeToolCalls(
  messages: Exclude<MessageResponse, null>[]
): Exclude<MessageResponse, null>[] {
  const terminalByCallId = new Map<string, 'done' | 'error'>();
  for (const message of messages) {
    if (message.kind !== 'tool_result' || !message.toolCallId) continue;
    terminalByCallId.set(message.toolCallId, message.toolStatus === 'error' ? 'error' : 'done');
  }
  if (!terminalByCallId.size) return messages;

  return messages.map((message) => {
    if (
      message.kind !== 'tool_call' ||
      message.toolStatus !== 'running' ||
      !message.toolCallId ||
      !terminalByCallId.has(message.toolCallId)
    ) {
      return message;
    }
    return {
      ...message,
      toolStatus: terminalByCallId.get(message.toolCallId)!,
    };
  });
}

function prepareMessagesForResponse(messages: Message[]): Exclude<MessageResponse, null>[] {
  return terminalizeToolCalls(messages.filter(isRenderableMessage).map(toMessageResponse));
}

function toRunStateResponse(run: ConversationRun): Exclude<ConversationRunResponse, null> {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    upstreamRunId: run.upstreamRunId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    lastEventAt: run.lastEventAt,
    error: run.error,
  };
}

async function loadVisibleConversationRunState(
  runRepo: Repository<ConversationRun>,
  msgRepo: Repository<Message>,
  conversationId: number
): Promise<ConversationRunResponse> {
  const runs = await runRepo.find({
    where: { conversationId },
    order: { _id: 'DESC' },
    take: 5,
  });
  const run = runs.find((item) => item.status === 'running' || item.status === 'error') ?? runs[0];
  if (!run) return null;

  const assistantForRun = await msgRepo.findOne({
    where: {
      conversationId,
      runId: run.runId,
      role: 'assistant' as const,
      hidden: false,
    },
    order: { _id: 'DESC' },
  });

  if (run.status === 'completed' && assistantForRun && isRenderableMessage(assistantForRun)) {
    return null;
  }

  return toRunStateResponse(run);
}

async function claimConversationSession(
  convRepo: Repository<Conversation>,
  msgRepo: Repository<Message>,
  conv: Conversation,
  sessionId: string
): Promise<void> {
  if (conv.sessionKey === sessionId) return;

  const duplicate = await convRepo.findOne({
    where: {
      agentId: conv.agentId,
      sessionKey: sessionId,
    },
  });

  if (duplicate && duplicate._id !== conv._id) {
    await msgRepo.update({ conversationId: duplicate._id }, { conversationId: conv._id });
    await convRepo.update(duplicate._id, {
      sessionKey: null,
      threadKey: null,
      rootSessionKey: null,
    });
    await convRepo.softDelete(duplicate._id);
  }

  await convRepo.update(conv._id, { sessionKey: sessionId });
  conv.sessionKey = sessionId;
}

function selectReusableAssistantMessage(
  messages: Message[],
  resultText: string
): Message | undefined {
  const resultKey = hermes.normalizeForMatch('assistant', resultText);
  return messages.find((message) => hermes.normalizeForMatch('assistant', message.text) === resultKey);
}

async function loadConversationHistoryForGateway(
  msgRepo: Repository<Message>,
  conversationId: number,
  excludeMessageId: number
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await msgRepo.find({
    where: { conversationId, hidden: false },
    order: { createdAt: 'ASC', _id: 'ASC' },
  });

  return messages
    .filter((message) => message._id !== excludeMessageId)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => String(message.text || '').trim().length > 0)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.text,
    }));
}

const listByConversation: ListByConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || '', 10) || DEFAULT_PAGE_SIZE, 1),
      200
    );
    const { before } = req.query;

    const convRepo = AppDataSource.getRepository(Conversation);
    const msgRepo = AppDataSource.getRepository(Message);
    const runRepo = AppDataSource.getRepository(ConversationRun);
    const conv = await convRepo.findOneBy({ _id: Number(conversationId) });
    const visibleLocalCount = conv && !before
      ? await msgRepo.countBy({ conversationId: Number(conversationId), hidden: false })
      : 0;
    if (conv && !before && visibleLocalCount === 0 && (conv.threadKey || conv.sessionKey)) {
      try {
        await hermes.syncConversationFromHermes(conv);
      } catch (err) {
        console.error('[messages.list] sync failed for conv', conversationId, err);
      }
    }

    const where: FindOptionsWhere<Message> = {
      conversationId: Number(conversationId),
      hidden: false,
    };
    if (before) where.createdAt = LessThan(new Date(before));

    const items = await msgRepo.find({
      where,
      order: { createdAt: 'DESC', _id: 'DESC' },
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    const renderableItems = prepareMessagesForResponse(items.reverse());
    const runState = !before
      ? await loadVisibleConversationRunState(runRepo, msgRepo, Number(conversationId))
      : null;

    return res.json({ total: renderableItems.length, items: renderableItems, hasMore, runState });
  } catch (error) {
    return next(error);
  }
};

const create: Create = async (req, res, next) => {
  try {
    const msgRepo = AppDataSource.getRepository(Message);
    const message = msgRepo.create({
      conversationId: Number(req.body.conversationId),
      text: req.body.text || '',
      role: 'user' as const,
      createdBy: req.user!._id,
      createdAt: new Date(),
    });
    const saved = await msgRepo.save(message);
    const result = Object.fromEntries(
      Object.entries(saved as object).filter(([k]) => k !== 'deletedAt')
    ) as MessageResponse;
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Persist user input + uploads, then spawn `hermes chat -Q -q "<msg>"` and
 * stream stdout to the client over SSE. After the child exits, persist the
 * assistant response and bind the conversation to the resolved Hermes
 * session id (so subsequent turns can `--resume`).
 */
const chat: Chat = async (req, res, next) => {
  try {
    const { conversationId, text } = req.body;
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];

    const convRepo = AppDataSource.getRepository(Conversation);
    const agentRepo = AppDataSource.getRepository(Agent);
    const msgRepo = AppDataSource.getRepository(Message);
    const runRepo = AppDataSource.getRepository(ConversationRun);

    const conv = await convRepo.findOneBy({ _id: Number(conversationId) });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const agent = await agentRepo.findOneBy({ _id: conv.agentId });
    const profile = agent?.hermesProfile || 'default';

    const persistedFiles = uploadedFiles.map((uf) =>
      hermes.persistUpload(conv._id, uf.path, uf.originalname, uf.mimetype, uf.size)
    );
    const publicUrl = apiPublicUrl(req);
    const messageFiles: MessageFile[] = persistedFiles.map((f) => ({
      filename: f.storedName,
      originalName: f.originalName,
      mimetype: f.mimetype,
      size: f.size,
      url: `${publicUrl}/api/conversation/${conv._id}/uploads/${encodeURIComponent(f.storedName)}`,
    }));

    const runId = randomUUID();
    const clientTurnId = randomUUID();
    const userMessage = msgRepo.create({
      conversationId: conv._id,
      text: text || (messageFiles.length ? `[Attached ${messageFiles.length} file(s)]` : ''),
      files: messageFiles,
      role: 'user' as const,
      runId,
      clientTurnId,
      createdBy: req.user!._id,
      createdAt: new Date(),
    });
    const savedUser = await msgRepo.save(userMessage);
    const runRow = await runRepo.save(
      runRepo.create({
        conversationId: conv._id,
        runId,
        sessionId: conv.sessionKey,
        status: 'running',
        startedAt: new Date(),
        lastEventAt: new Date(),
      })
    );

    const isFirstMessage = !conv.title && !!text;
    if (isFirstMessage) {
      await convRepo.update(conv._id, { title: text!.slice(0, 200) });
    }

    const promptForHermes = (() => {
      if (!persistedFiles.length) return text || '';
      const fileNotes = persistedFiles.map((f) => `- ${f.originalName}: ${f.absolutePath}`).join('\n');
      const prefix = text ? `${text}\n\n` : '';
      return `${prefix}Attached file(s):\n${fileNotes}`;
    })();

    const imagePaths = persistedFiles
      .filter((f) => hermes.isImage(f.originalName))
      .map((f) => f.absolutePath);

    const liveTip = (conv.threadKey || conv.sessionKey)
      ? hermes.resolveLiveTipFast({
        profile,
        key: conv.threadKey || conv.sessionKey!,
      })
      : null;
    const resumeTarget = liveTip?.sessionId ?? conv.sessionKey ?? null;
    if (liveTip && liveTip.sessionId !== conv.sessionKey) {
      await convRepo.update(conv._id, {
        sessionKey: liveTip.sessionId,
        threadKey: liveTip.threadKey,
        rootSessionKey: liveTip.rootSessionKey,
      });
      conv.sessionKey = liveTip.sessionId;
      conv.threadKey = liveTip.threadKey;
      conv.rootSessionKey = liveTip.rootSessionKey;
    }
    const settings = {
      thinkingLevel: conv.thinkingLevel,
      reasoningLevel: conv.reasoningLevel,
      verboseLevel: conv.verboseLevel,
      fastMode: conv.fastMode,
      modelOverride: conv.modelOverride,
      providerOverride: conv.providerOverride,
      skillsOverride: conv.skillsOverride,
      toolsetsOverride: conv.toolsetsOverride,
    };
    const conversationHistory = resumeTarget
      ? []
      : await loadConversationHistoryForGateway(msgRepo, conv._id, savedUser._id);

    const dryRun = process.env.HERMES_CLIENT_DRY_RUN === '1';
    const sendAdapter = await hermes.selectSendAdapter({
      dryRun,
      sessionId: resumeTarget,
    });

    const result = sendAdapter === 'dry-run'
      ? await hermes.streamDryRun(res, promptForHermes, resumeTarget, settings, runId)
      : sendAdapter === 'gateway'
        ? await hermes.streamGatewayRun(res, {
          sessionId: resumeTarget!,
          input: promptForHermes,
          conversationHistory,
          settings,
          runId,
        })
        : await hermes.streamChat(res, promptForHermes, {
          profile,
          sessionId: resumeTarget,
          imagePaths,
          settings,
          runId,
        });

    await runRepo.update(runRow._id, {
      sessionId: result.sessionId ?? conv.sessionKey,
      status: result.error ? 'error' : 'completed',
      completedAt: new Date(),
      lastEventAt: new Date(),
      error: result.error ?? null,
    });

    if (result.sessionId && conv.sessionKey !== result.sessionId) {
      await claimConversationSession(convRepo, msgRepo, conv, result.sessionId);
    }

    let savedAssistantId: number | null = null;
    if (result.text) {
      const existingAssistant = selectReusableAssistantMessage(await msgRepo.find({
        where: {
          conversationId: conv._id,
          role: 'assistant' as const,
          hidden: false,
          _id: MoreThan(savedUser._id),
        },
        order: { _id: 'ASC' },
        take: 20,
      }), result.text);

      if (existingAssistant) {
        savedAssistantId = existingAssistant._id;
        if (result.externalId && existingAssistant.externalId !== result.externalId) {
          await msgRepo.update(existingAssistant._id, {
            externalId: result.externalId,
            provisional: false,
          });
        }
      } else {
        const assistantMessage = msgRepo.create({
          conversationId: conv._id,
          externalId: result.externalId,
          text: result.text,
          role: 'assistant' as const,
          runId,
          clientTurnId,
          provisional: !result.externalId,
          createdBy: req.user!._id,
          createdAt: new Date(),
        });
        const savedAssistant = await msgRepo.save(assistantMessage);
        savedAssistantId = savedAssistant._id;
      }
    }

    if (isFirstMessage && result.sessionId) {
      hermes.renameSession(profile, result.sessionId, text!.slice(0, 200));
    }

    // Reconcile our just-written rows with the Hermes source of truth. This
    // stamps the user/assistant rows with stable externalIds so a subsequent
    // poll-driven sync doesn't re-import them as duplicates.
    if (conv.sessionKey) {
      try {
        await hermes.syncConversationFromHermes(conv, agent);
      } catch (err) {
        console.error('[chat] post-stream sync failed:', err);
      }
    }

    if (!res.writableEnded && !res.destroyed) {
      if (result.sessionId) {
        hermes.writeSse(res, { type: 'session.update', sessionId: result.sessionId });
      }
      if (savedAssistantId !== null) {
        hermes.writeSse(res, { type: 'message.saved', messageId: savedAssistantId });
      }
      hermes.writeSse(res, '[DONE]');
      if (!res.writableEnded && !res.destroyed) res.end();
    }
    if (savedUser) return undefined;
    return undefined;
  } catch (error) {
    if (!res.headersSent) return next(error);
    if (!res.writableEnded) {
      try {
        res.write(
          `data: ${JSON.stringify({ type: 'response.error', delta: (error as Error).message })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {
        /* response already torn down */
      }
    }
    return undefined;
  }
};

const destroy: Destroy = async (req, res, next) => {
  try {
    const msgRepo = AppDataSource.getRepository(Message);
    const id = Number(req.params.id);
    await msgRepo.softDelete(id);
    return res.json(null);
  } catch (error) {
    return next(error);
  }
};

/**
 * Lightweight poll endpoint. Full Hermes reconciliation can read very large
 * state.db lineages and must not block the route-switch/composer path every
 * five seconds. The selected chat is reconciled on explicit loads/sends; this
 * endpoint only returns durable local rows newer than the caller's cursor.
 *
 * Set HERMES_CLIENT_POLL_SYNC=1 only when debugging external CLI/TUI writes and
 * accepting the latency tradeoff.
 */
const poll: RequestHandler<{ conversationId: string }, unknown, never, { after?: string }> = async (
  req,
  res,
  next
) => {
  try {
    const convId = Number(req.params.conversationId);
    const { after } = req.query;

    const convRepo = AppDataSource.getRepository(Conversation);
    const msgRepo = AppDataSource.getRepository(Message);
    const runRepo = AppDataSource.getRepository(ConversationRun);
    const conv = await convRepo.findOneBy({ _id: convId });

    let synced = 0;
    if (process.env.HERMES_CLIENT_POLL_SYNC === '1' && conv?.sessionKey) {
      try {
        const r = await hermes.syncConversationFromHermes(conv);
        synced = r.added.length + r.claimed;
      } catch (err) {
        console.error('[poll] sync failed for conv', convId, err);
      }
    }

    const where: FindOptionsWhere<Message> = { conversationId: convId, hidden: false };
    if (after) where.createdAt = MoreThan(new Date(after));
    const items = await msgRepo.find({
      where,
      order: { createdAt: 'ASC', _id: 'ASC' },
      take: 200,
    });
    const runState = await loadVisibleConversationRunState(runRepo, msgRepo, convId);
    return res.json({ items: prepareMessagesForResponse(items), synced, runState });
  } catch (error) {
    return next(error);
  }
};

const serveUpload: RequestHandler<{ conversationId: string; filename: string }> = async (
  req,
  res,
  next
) => {
  try {
    const fp = hermes.uploadAbsolutePath(Number(req.params.conversationId), req.params.filename);
    if (!fp) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(path.resolve(fp));
  } catch (error) {
    return next(error);
  }
};

export {
  listByConversation,
  create,
  chat,
  destroy,
  poll,
  serveUpload,
  selectReusableAssistantMessage as selectReusableAssistantMessageForTest,
  isRenderableMessage as isRenderableMessageForTest,
  prepareMessagesForResponse as prepareMessagesForResponseForTest,
  claimConversationSession as claimConversationSessionForTest,
};
