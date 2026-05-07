import AppDataSource from '../../data-source';
import { Agent, Conversation, Message } from '../../entities';
import { ListAll, ListByAgent, Create, Update, Destroy } from '../../@types/conversation';
import * as hermes from '../../services/hermes';

type ConversationWithStats = Conversation & {
  messageCount: number;
  lastActive: Date | null;
};

async function attachConversationStats(items: Conversation[]): Promise<ConversationWithStats[]> {
  if (!items.length) return [];

  const ids = items.map((item) => item._id);
  const stats = await AppDataSource.getRepository(Message)
    .createQueryBuilder('message')
    .select('message.conversationId', 'conversationId')
    .addSelect('COUNT(*)', 'messageCount')
    .addSelect('MAX(message.createdAt)', 'lastActive')
    .where('message.conversationId IN (:...ids)', { ids })
    .andWhere('message.deletedAt IS NULL')
    .andWhere('message.hidden = :hidden', { hidden: false })
    .groupBy('message.conversationId')
    .getRawMany<{ conversationId: number | string; messageCount: number | string; lastActive: string | null }>();

  const byConversation = new Map(
    stats.map((row) => [
      Number(row.conversationId),
      {
        messageCount: Number(row.messageCount || 0),
        lastActive: row.lastActive ? new Date(row.lastActive) : null,
      },
    ])
  );

  return items.map((item) => {
    const stat = byConversation.get(item._id) || { messageCount: 0, lastActive: null };
    return Object.assign({}, item, stat);
  });
}

const listAll: ListAll = async (req, res, next) => {
  try {
    const convRepo = AppDataSource.getRepository(Conversation);
    const agentRepo = AppDataSource.getRepository(Agent);

    // Keep the list path fast. Discovery can read a large state.db, so
    // coalesce it in the background and return cached DB rows immediately.
    const agents = await agentRepo.find();

    const items = await convRepo.find({ order: { createdAt: 'DESC' } });
    const enrichedItems = await attachConversationStats(items);
    res.json({ total: enrichedItems.length, items: enrichedItems });

    agents.forEach((agent) => {
      hermes.enqueueProfileSync(agent).catch((err) => {
        console.error('[conversations.listAll] background sync failed for', agent.hermesProfile, err);
      });
    });
    return;
  } catch (error) {
    return next(error);
  }
};

const listByAgent: ListByAgent = async (req, res, next) => {
  try {
    const agentId = Number(req.params.agentId);
    const agentRepo = AppDataSource.getRepository(Agent);
    const convRepo = AppDataSource.getRepository(Conversation);

    // Queue discovery for this profile without blocking the sidebar.
    const agent = await agentRepo.findOneBy({ _id: agentId });
    const items = await convRepo.find({
      where: { agentId },
      order: { createdAt: 'DESC' },
    });
    const enrichedItems = await attachConversationStats(items);
    res.json({ total: enrichedItems.length, items: enrichedItems });

    if (agent) {
      hermes.enqueueProfileSync(agent).catch((err) => {
        console.error('[conversations.listByAgent] background sync failed:', err);
      });
    }
    return;
  } catch (error) {
    return next(error);
  }
};

const create: Create = async (req, res, next) => {
  try {
    const convRepo = AppDataSource.getRepository(Conversation);
    const conversation = convRepo.create({
      agentId: Number(req.body.agentId),
      createdBy: req.user!._id,
      createdAt: new Date(),
    });
    const saved = await convRepo.save(conversation);
    return res.json(saved);
  } catch (error) {
    return next(error);
  }
};

const update: Update = async (req, res, next) => {
  try {
    const convRepo = AppDataSource.getRepository(Conversation);
    const id = Number(req.params.id);

    await convRepo.update(id, { title: req.body.title });
    const conversation = await convRepo.findOneBy({ _id: id });
    if (!conversation) return res.status(404).json(null);

    if (conversation.sessionKey) {
      const agentRepo = AppDataSource.getRepository(Agent);
      const agent = await agentRepo.findOneBy({ _id: conversation.agentId });
      if (agent?.hermesProfile && req.body.title) {
        hermes.renameSession(agent.hermesProfile, conversation.sessionKey, req.body.title);
      }
    }
    return res.json(conversation);
  } catch (error) {
    return next(error);
  }
};

const destroy: Destroy = async (req, res, next) => {
  try {
    const convRepo = AppDataSource.getRepository(Conversation);
    const msgRepo = AppDataSource.getRepository(Message);
    const id = Number(req.params.id);

    const conv = await convRepo.findOneBy({ _id: id });
    await convRepo.softDelete(id);
    await msgRepo
      .createQueryBuilder()
      .update(Message)
      .set({ deletedAt: new Date() })
      .where('conversationId = :id', { id })
      .execute();

    if (conv?.sessionKey) {
      const agentRepo = AppDataSource.getRepository(Agent);
      const agent = await agentRepo.findOneBy({ _id: conv.agentId });
      if (agent?.hermesProfile) {
        hermes.deleteSession(agent.hermesProfile, conv.sessionKey);
      }
    }
    return res.json(null);
  } catch (error) {
    return next(error);
  }
};

export { listAll, listByAgent, create, update, destroy };
