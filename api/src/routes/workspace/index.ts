import Router from 'express';
import auth from '../../middlewares/auth';
import { getSwarm, launchSwarmMission } from './controller';

const router = Router();

router.route('/workspace/swarm').get(auth, getSwarm);
router.route('/workspace/swarm/launch').post(auth, launchSwarmMission);

export default router;
