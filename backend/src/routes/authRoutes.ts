import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, logout, me, getRegistrationSeats } from '../controllers/authController';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate } from '../middleware/auth';
import { config } from '../config';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.authRateLimitMax,
  message: { success: false, message: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, asyncHandler(register));
router.get('/seats/available', asyncHandler(getRegistrationSeats));
router.post('/login', authLimiter, asyncHandler(login));
router.post('/admin/login', authLimiter, asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', authenticate, asyncHandler(me));

export default router;
