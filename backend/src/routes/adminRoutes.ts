import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { changeAdminPhone, changeAdminPin } from '../controllers/adminAccountController';
import { getAdminSettings, putAdminSettings, updateAdminDisplayName } from '../controllers/settingsController';
import {
  getSmsReminderAction,
  markFeeReminderSent,
  prepareFeeReminder,
  sendFeeReminder,
} from '../controllers/feeReminderController';
import {
  createAdminTelegramLink,
  deleteAdminTelegramLink,
  getAdminTelegramStatus,
  testAdminTelegram,
} from '../controllers/telegramController';
import {
  getManualNotifications,
  markManualNotificationSent,
} from '../controllers/manualNotificationController';
import {
  getLiveSeats,
  createStudent,
  getStudents,
  getStudentById,
  getAssignableStudentSeats,
  editStudent,
  updateStudentStatus,
  resetStudentPin,
  deleteStudent,
  restoreStudent,
  getStudentAttendance,
  getSessions,
  forceCheckout,
  getFees,
  markFeePaid,
  generateFeesManual,
  getReportSummary,
  getStudentsReport,
  exportAttendanceCsv,
  getNotifications,
  getFailedNotifications,
  // Temporarily disabled with admin overtime follow-up alerts.
  // getNeedsActionNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  // markNotificationContacted,
} from '../controllers/adminController';
import { getJobsStatus } from '../controllers/jobsController';

const router = Router();
const accountChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many account changes. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const settingsUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many settings updates. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const feeReminderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many reminder actions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// All admin routes require admin role
router.use(authenticate, requireAdmin);

// Account security
router.post('/account/change-pin', accountChangeLimiter, asyncHandler(changeAdminPin));
router.post('/account/change-phone', accountChangeLimiter, asyncHandler(changeAdminPhone));
router.patch('/account/profile', asyncHandler(updateAdminDisplayName));
router.get('/settings', asyncHandler(getAdminSettings));
router.put('/settings', settingsUpdateLimiter, asyncHandler(putAdminSettings));
router.get('/jobs/status', asyncHandler(getJobsStatus));
router.get('/notifications/sms-action/:token', feeReminderLimiter, asyncHandler(getSmsReminderAction));
router.post('/notifications/:id/mark-sent', feeReminderLimiter, asyncHandler(markFeeReminderSent));

// Telegram
router.post('/telegram/link', asyncHandler(createAdminTelegramLink));
router.get('/telegram/status', asyncHandler(getAdminTelegramStatus));
router.delete('/telegram', asyncHandler(deleteAdminTelegramLink));
router.delete('/telegram/link', asyncHandler(deleteAdminTelegramLink));
router.post('/telegram/test', asyncHandler(testAdminTelegram));

// Seats
router.get('/seats/live', asyncHandler(getLiveSeats));

// Students
router.post('/students', asyncHandler(createStudent));
router.get('/students', asyncHandler(getStudents));
router.get('/students/:id/available-seats', asyncHandler(getAssignableStudentSeats));
router.get('/students/:id', asyncHandler(getStudentById));
router.patch('/students/:id', asyncHandler(editStudent));
router.patch('/students/:id/status', asyncHandler(updateStudentStatus));
router.patch('/students/:id/restore', asyncHandler(restoreStudent));
router.post('/students/:id/reset-pin', asyncHandler(resetStudentPin));
router.delete('/students/:id', asyncHandler(deleteStudent));
router.get('/students/:id/attendance', asyncHandler(getStudentAttendance));

// Sessions
router.get('/sessions', asyncHandler(getSessions));
router.post('/sessions/:id/force-checkout', asyncHandler(forceCheckout));

// Fees
router.get('/fees', asyncHandler(getFees));
router.patch('/fees/:id/pay', asyncHandler(markFeePaid));
router.post('/fees/:feeId/reminder/prepare', feeReminderLimiter, asyncHandler(prepareFeeReminder));
router.post('/fees/:feeId/reminder/send', feeReminderLimiter, asyncHandler(sendFeeReminder));
router.post('/fees/generate', asyncHandler(generateFeesManual));

// Reports
router.get('/reports/summary', asyncHandler(getReportSummary));
router.get('/reports/students', asyncHandler(getStudentsReport));
router.get('/export/attendance.csv', asyncHandler(exportAttendanceCsv));

// Notifications
router.get('/notifications', asyncHandler(getNotifications));
router.get('/notifications/failed', asyncHandler(getFailedNotifications));
router.get('/notifications/manual', asyncHandler(getManualNotifications));
router.patch('/notifications/:id/mark-sent', asyncHandler(markManualNotificationSent));
// Temporarily disabled with admin overtime follow-up alerts.
// router.get('/notifications/needs-action', asyncHandler(getNeedsActionNotifications));
router.get('/notifications/unread-count', asyncHandler(getUnreadNotificationCount));
router.post('/notifications/read-all', asyncHandler(markAllNotificationsRead));
// router.patch('/notifications/:id/contacted', asyncHandler(markNotificationContacted));
router.patch('/notifications/:id/read', asyncHandler(markNotificationRead));

export default router;
