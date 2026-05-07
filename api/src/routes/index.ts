import Router from 'express';
import auth from './auth';
import user from './user';
import agent from './agent';
import conversation from './conversation';
import message from './message';
import plugin from './plugin';
import skill from './skill';
import slash from './slash';
import workspace from './workspace';
import kanban from './kanban';
import cron from './cron';
import insights from './insights';
import update from './update';

const router = Router();

router.use(user);
router.use(agent);
router.use(conversation);
router.use(message);
router.use(plugin);
router.use(skill);
router.use(slash);
router.use(workspace);
router.use(kanban);
router.use(cron);
router.use(insights);
router.use(auth);
router.use(update);

export default router;
