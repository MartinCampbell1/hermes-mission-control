import { In } from 'typeorm';
import { RequestHandler } from 'express';
import AppDataSource from '../../data-source';
import { Agent, Conversation } from '../../entities';
import {
  List,
  Get,
  Create,
  Update,
  Destroy,
  AgentJson,
  ConversationSessionSettings,
  ConversationSessionSettingsResponse,
  SettingCapability,
} from '../../@types/agent';
import * as hermes from '../../services/hermes';

function decorate(agent: Agent, models: Record<string, string | null>): AgentJson {
  return {
    _id: agent._id,
    name: agent.name,
    hermesProfile: agent.hermesProfile,
    createdBy: agent.createdBy,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    model: models[agent.hermesProfile] ?? null,
    exists: hermes.profileExists(agent.hermesProfile),
    dailyCapUsd: agent.dailyCapUsd,
    monthlyCapUsd: agent.monthlyCapUsd,
    allTimeCapUsd: agent.allTimeCapUsd,
  };
}

async function syncAgentsFromHermesProfiles(ownerId: number): Promise<Agent[]> {
  const agentRepo = AppDataSource.getRepository(Agent);
  const profiles = hermes.listProfiles();
  const profileNames = profiles.length
    ? profiles.map((p) => p.name)
    : hermes.profileExists('default')
      ? ['default']
      : [];

  if (!profileNames.length) return [];

  const existing = await agentRepo.find({
    where: { hermesProfile: In(profileNames) },
    withDeleted: true,
  });
  const knownActive = new Set(
    existing.filter((agent) => !agent.deletedAt).map((agent) => agent.hermesProfile)
  );
  const toAdd = profileNames.filter((name) => !knownActive.has(name));
  if (!toAdd.length) return [];

  const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));
  return agentRepo.save(
    toAdd.map((name) => {
      const profile = profileByName.get(name);
      return agentRepo.create({
        name,
        hermesProfile: name,
        createdBy: ownerId,
        createdAt: profile?.createdAt ?? new Date(),
      });
    })
  );
}

/**
 * Sanitise a single cap field from the request body.
 *
 * Accepts:
 *   - `undefined` -> leave unchanged
 *   - `null`, `''`, `'null'`, `0` -> clear the cap
 *   - any positive finite number or numeric string -> that number
 */
function sanitiseCap(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '' || raw === 'null') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n * 1_000_000) / 1_000_000, 1_000_000_000);
}

const list: List = async (req, res, next) => {
  try {
    const { page = 0, limit = 40, sortField = 'createdAt', sortType = 'desc' } = req.query;
    const agentRepo = AppDataSource.getRepository(Agent);

    await syncAgentsFromHermesProfiles(req.user!._id);

    const qb = agentRepo.createQueryBuilder('agent');
    if (req.query.search) {
      const search = req.query.search as string;
      if (!Number.isNaN(Number(search))) {
        qb.andWhere('agent._id = :id', { id: Number(search) });
      } else {
        qb.andWhere('agent.name LIKE :s', { s: `%${search}%` });
      }
    }

    const total = await qb.getCount();
    const items = await qb
      .skip(Number(page) * Number(limit))
      .take(Number(limit))
      .orderBy(
        `agent.${sortField as string}`,
        (sortType as string).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
      )
      .getMany();

    const models = hermes.getProfileModels(items.map((a) => a.hermesProfile));
    return res.json({ total, items: items.map((a) => decorate(a, models)) });
  } catch (error) {
    return next(error);
  }
};

const get: Get = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const agent = await agentRepo.findOneBy({ _id: Number(req.params.id) });
    if (!agent) return res.json(null);
    const models = hermes.getProfileModels([agent.hermesProfile]);
    return res.json(decorate(agent, models));
  } catch (error) {
    return next(error);
  }
};

const create: Create = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const requestedProfile = req.body.hermesProfile?.trim() || hermes.toProfileName(req.body.name || '');
    if (!hermes.isValidProfileName(requestedProfile)) {
      return res
        .status(422)
        .json({ name: ['Profile name must be lowercase alphanumeric (with - or _).'] } as never);
    }
    const result = hermes.createProfile(requestedProfile);
    if (!result.ok) return res.status(500).json({ name: [result.error || 'Failed'] } as never);

    const agent = agentRepo.create({
      name: req.body.name?.trim() || requestedProfile,
      hermesProfile: requestedProfile,
      createdBy: req.user!._id,
      createdAt: new Date(),
    });
    const saved = await agentRepo.save(agent);
    const models = hermes.getProfileModels([saved.hermesProfile]);
    return res.json(decorate(saved, models));
  } catch (error) {
    return next(error);
  }
};

const update: Update = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const id = Number(req.params.id);

    const patch: Partial<Agent> = { updatedAt: new Date() };
    if (req.body.name !== undefined) patch.name = req.body.name;

    // Caps are optional in the body — only touched when present, so the
    // same PATCH endpoint serves both "rename agent" and "set caps" UIs.
    const daily = sanitiseCap(req.body.dailyCapUsd);
    if (daily !== undefined) patch.dailyCapUsd = daily;
    const monthly = sanitiseCap(req.body.monthlyCapUsd);
    if (monthly !== undefined) patch.monthlyCapUsd = monthly;
    const allTime = sanitiseCap(req.body.allTimeCapUsd);
    if (allTime !== undefined) patch.allTimeCapUsd = allTime;

    await agentRepo.update(id, patch);
    const agent = await agentRepo.findOneBy({ _id: id });
    if (!agent) return res.status(404).json(null);
    const models = hermes.getProfileModels([agent.hermesProfile]);
    return res.json(decorate(agent, models));
  } catch (error) {
    return next(error);
  }
};

const destroy: Destroy = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const convRepo = AppDataSource.getRepository(Conversation);
    const id = Number(req.params.id);

    const agent = await agentRepo.findOneBy({ _id: id });
    await agentRepo.softDelete(id);
    await convRepo
      .createQueryBuilder()
      .update(Conversation)
      .set({ deletedAt: new Date() })
      .where('agentId = :id', { id })
      .execute();

    if (agent?.hermesProfile && agent.hermesProfile !== 'default') {
      hermes.deleteProfile(agent.hermesProfile);
    }
    return res.json(null);
  } catch (error) {
    return next(error);
  }
};

/**
 * Reconcile our DB with `hermes profile list`. New profiles found in Hermes
 * are imported as agents owned by the requesting user; profiles deleted on
 * disk are not removed from the DB (we keep history of past sessions).
 */
const sync: RequestHandler = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const added = await syncAgentsFromHermesProfiles(req.user!._id);
    const agents = await agentRepo.find();

    let syncedConversations = 0;
    let syncedMessages = 0;
    for (const agent of agents) {
      const result = await hermes.discoverProfileSessions(agent);
      syncedConversations += result.created.length + result.synced.length;
      for (const conv of [...result.created, ...result.synced]) {
        const syncResult = await hermes.syncConversationFromHermes(conv, agent);
        syncedMessages += syncResult.added.length + syncResult.claimed;
      }
    }

    return res.json({
      syncedAgents: added.length,
      syncedConversations,
      syncedMessages,
    });
  } catch (error) {
    return next(error);
  }
};

const getSessionSettings: RequestHandler = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const convRepo = AppDataSource.getRepository(Conversation);

    const agent = await agentRepo.findOneBy({ _id: Number(req.params.id) });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const conv = await convRepo.findOneBy({ _id: Number(req.params.conversationId) });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    return res.json({
      ok: true,
      ...serializeSessionSettingsResponse(conv),
    });
  } catch (error) {
    return next(error);
  }
};

function serializeSessionSettings(conv: Conversation): ConversationSessionSettings {
  return {
    title: conv.title ?? null,
    sessionId: conv.sessionKey ?? null,
    thinkingLevel: conv.thinkingLevel ?? 'inherit',
    reasoningLevel: conv.reasoningLevel ?? 'inherit',
    verboseLevel: conv.verboseLevel ?? 'inherit',
    fastMode: conv.fastMode ?? null,
    modelOverride: conv.modelOverride ?? null,
    providerOverride: conv.providerOverride ?? null,
    skillsOverride: conv.skillsOverride ?? null,
    toolsetsOverride: conv.toolsetsOverride ?? null,
  };
}

function settingCapabilities(): ConversationSessionSettingsResponse['capabilities'] {
  const cliGatewayDryRun: SettingCapability = {
    supported: true,
    appliedOn: ['cli', 'gateway', 'dry_run'],
  };
  return {
    modelOverride: cliGatewayDryRun,
    providerOverride: cliGatewayDryRun,
    skillsOverride: cliGatewayDryRun,
    toolsetsOverride: cliGatewayDryRun,
    verboseLevel: { supported: true, appliedOn: ['cli', 'dry_run'] },
    thinkingLevel: {
      supported: true,
      appliedOn: ['gateway', 'dry_run'],
      reason: 'Current local Hermes CLI does not expose --thinking.',
    },
    reasoningLevel: {
      supported: true,
      appliedOn: ['gateway', 'dry_run'],
      reason: 'Current local Hermes CLI does not expose --reasoning.',
    },
    fastMode: {
      supported: true,
      appliedOn: ['gateway', 'dry_run'],
      reason: 'Current local Hermes CLI does not expose --fast/--no-fast.',
    },
  };
}

function serializeSessionSettingsResponse(conv: Conversation): ConversationSessionSettingsResponse {
  return {
    settings: serializeSessionSettings(conv),
    capabilities: settingCapabilities(),
  };
}

function normalizeStringSetting(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 'inherit') return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function normalizeFastMode(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 'inherit') return null;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function invalidSettingKeys(body: Record<string, unknown>): string[] {
  const stringFields = [
    'thinkingLevel',
    'reasoningLevel',
    'verboseLevel',
    'modelOverride',
    'providerOverride',
    'skillsOverride',
    'toolsetsOverride',
  ];
  const invalid = stringFields.filter((field) => {
    if (!(field in body)) return false;
    const value = body[field];
    return value !== null && value !== 'inherit' && typeof value !== 'string';
  });
  if ('fastMode' in body) {
    const value = body.fastMode;
    if (value !== null && value !== 'inherit' && typeof value !== 'boolean') invalid.push('fastMode');
  }
  return invalid;
}

/**
 * Patch a conversation's title; if hermes has the underlying session, the
 * rename is also pushed to the hermes session store so `hermes sessions list`
 * reflects the new label.
 */
const patchSessionSettings: RequestHandler = async (req, res, next) => {
  try {
    const agentRepo = AppDataSource.getRepository(Agent);
    const convRepo = AppDataSource.getRepository(Conversation);

    const agent = await agentRepo.findOneBy({ _id: Number(req.params.id) });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const conv = await convRepo.findOneBy({ _id: Number(req.params.conversationId) });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const body = (req.body ?? {}) as Record<string, unknown> & {
      label?: string | null;
      title?: string | null;
    };
    const invalid = invalidSettingKeys(body);
    if (invalid.length) {
      return res.status(400).json({
        error: `Invalid setting value for: ${invalid.join(', ')}`,
      });
    }
    const updates: Partial<Conversation> = {};
    const newTitle = body.title ?? body.label;
    if (newTitle !== undefined) {
      updates.title = newTitle;
      if (conv.sessionKey && newTitle) {
        hermes.renameSession(agent.hermesProfile, conv.sessionKey, String(newTitle));
      }
    }

    const thinkingLevel = normalizeStringSetting(body.thinkingLevel);
    if (thinkingLevel !== undefined) updates.thinkingLevel = thinkingLevel;
    const reasoningLevel = normalizeStringSetting(body.reasoningLevel);
    if (reasoningLevel !== undefined) updates.reasoningLevel = reasoningLevel;
    const verboseLevel = normalizeStringSetting(body.verboseLevel);
    if (verboseLevel !== undefined) updates.verboseLevel = verboseLevel;
    const fastMode = normalizeFastMode(body.fastMode);
    if (fastMode !== undefined) updates.fastMode = fastMode;
    const modelOverride = normalizeStringSetting(body.modelOverride);
    if (modelOverride !== undefined) updates.modelOverride = modelOverride;
    const providerOverride = normalizeStringSetting(body.providerOverride);
    if (providerOverride !== undefined) updates.providerOverride = providerOverride;
    const skillsOverride = normalizeStringSetting(body.skillsOverride);
    if (skillsOverride !== undefined) updates.skillsOverride = skillsOverride;
    const toolsetsOverride = normalizeStringSetting(body.toolsetsOverride);
    if (toolsetsOverride !== undefined) updates.toolsetsOverride = toolsetsOverride;

    if (Object.keys(updates).length) {
      await convRepo.update(conv._id, updates);
      Object.assign(conv, updates);
    }
    return res.json({
      ok: true,
      ...serializeSessionSettingsResponse(conv),
    });
  } catch (error) {
    return next(error);
  }
};

export {
  list,
  get,
  create,
  update,
  destroy,
  sync,
  getSessionSettings,
  patchSessionSettings,
};
