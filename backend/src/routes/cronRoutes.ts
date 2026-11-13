import { Router } from 'express';
import {
  runCronTick,
  runNotificationWorkerCron,
  runShiftMonitorCron,
} from '../controllers/cronController';

const router = Router();

router.get('/shift-monitor', runShiftMonitorCron);
router.post('/shift-monitor', runShiftMonitorCron);
router.get('/notification-worker', runNotificationWorkerCron);
router.post('/notification-worker', runNotificationWorkerCron);
router.get('/tick', runCronTick);
router.post('/tick', runCronTick);

export default router;
