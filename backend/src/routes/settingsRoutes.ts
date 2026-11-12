import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { getPublicSettings } from '../controllers/settingsController';

const router = Router();

router.get('/public', asyncHandler(getPublicSettings));

export default router;
