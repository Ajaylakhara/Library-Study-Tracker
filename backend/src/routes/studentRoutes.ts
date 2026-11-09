import { Router } from 'express';
import { authenticate, requireStudent } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import {
  getStatus,
  getAvailableSeats,
  checkIn,
  checkOut,
  getAttendance,
  getSummary,
  getMyFees,
  getProfile,
  updateProfile,
  changePin,
} from '../controllers/studentController';
import {
  createStudentTelegramLink,
  deleteStudentTelegramLink,
  getStudentTelegramStatus,
} from '../controllers/telegramController';

const router = Router();

// All student routes require authentication and student role
router.use(authenticate, requireStudent);

router.get('/status', asyncHandler(getStatus));
router.get('/seats/available', asyncHandler(getAvailableSeats));
router.post('/checkin', asyncHandler(checkIn));
router.post('/checkout', asyncHandler(checkOut));
router.get('/attendance', asyncHandler(getAttendance));
router.get('/summary', asyncHandler(getSummary));
router.get('/fees', asyncHandler(getMyFees));
router.get('/profile', asyncHandler(getProfile));
router.patch('/profile', asyncHandler(updateProfile));
router.post('/change-pin', asyncHandler(changePin));
router.post('/telegram/link', asyncHandler(createStudentTelegramLink));
router.get('/telegram/status', asyncHandler(getStudentTelegramStatus));
router.delete('/telegram', asyncHandler(deleteStudentTelegramLink));
router.delete('/telegram/link', asyncHandler(deleteStudentTelegramLink));

export default router;
