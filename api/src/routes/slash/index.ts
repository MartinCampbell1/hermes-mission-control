import Router from 'express';
import { catalog, complete, resolve } from './controller';
import auth from '../../middlewares/auth';

const router = Router();

router.route('/slash').get(auth, catalog);
router.route('/slash/catalog').get(auth, catalog);
router.route('/slash/complete').get(auth, complete);
router.route('/slash/resolve').post(auth, resolve);

export default router;
