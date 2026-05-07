import {
  CreateKanbanTask,
  DeleteKanbanTask,
  GetKanbanSummary,
  MoveKanbanTask,
  NudgeKanbanDispatcher,
  UpdateKanbanTask,
} from '../../@types/kanban';
import {
  createKanbanTask as createTask,
  deleteKanbanTask as deleteTask,
  getKanbanSummary,
  nudgeKanbanDispatcher,
  updateKanbanTask as updateTask,
} from '../../services/kanban/kanban';

export const getKanban: GetKanbanSummary = async (req, res, next) => {
  try {
    return res.json(await getKanbanSummary(req.query.mode));
  } catch (error) {
    return next(error);
  }
};

export const createKanbanTask: CreateKanbanTask = async (req, res, next) => {
  try {
    return res.status(201).json({ task: await createTask(req.body ?? {}) });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message } as never);
  }
};

export const updateKanbanTask: UpdateKanbanTask = async (req, res, next) => {
  try {
    const task = await updateTask(req.params.id, req.body ?? {});
    if (!task) return res.status(404).json({ error: 'task not found' } as never);
    return res.json({ task });
  } catch (error) {
    return next(error);
  }
};

export const moveKanbanTask: MoveKanbanTask = async (req, res, next) => {
  try {
    const task = await updateTask(req.params.id, {
      lane: req.body?.lane,
      position: req.body?.position,
    });
    if (!task) return res.status(404).json({ error: 'task not found' } as never);
    return res.json({ task });
  } catch (error) {
    return next(error);
  }
};

export const deleteKanbanTask: DeleteKanbanTask = async (req, res, next) => {
  try {
    const ok = await deleteTask(req.params.id);
    if (!ok) return res.status(404).json({ ok: false });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

export const nudgeDispatcher: NudgeKanbanDispatcher = async (req, res, next) => {
  try {
    const result = await nudgeKanbanDispatcher(req.body?.boardId);
    if (!result.ok) {
      const status = result.error === 'no ready tasks' ? 400 : 502;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
