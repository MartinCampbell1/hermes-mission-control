import Router from 'express';
import auth from '../../middlewares/auth';
import {
  createKanbanTask,
  deleteKanbanTask,
  getKanban,
  moveKanbanTask,
  nudgeDispatcher,
  updateKanbanTask,
} from './controller';

const router = Router();

router.route('/kanban').get(auth, getKanban).post(auth, createKanbanTask);
router.route('/kanban/nudge').post(auth, nudgeDispatcher);
router.route('/kanban/:id').patch(auth, updateKanbanTask).delete(auth, deleteKanbanTask);
router.route('/kanban/:id/move').post(auth, moveKanbanTask);

export default router;
