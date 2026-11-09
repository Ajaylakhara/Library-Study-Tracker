import mongoose from 'mongoose';
import { Notification } from '../../models/Notification';

export async function resolveOvertimeAlerts(sessionId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await Notification.updateMany(
      {
        sessionId,
        type: 'overtime_admin',
        $or: [
          { actionStatus: { $in: ['open', 'contacted'] } },
          { actionStatus: { $exists: false } },
          { actionStatus: null },
        ],
      },
      { $set: { actionStatus: 'resolved', resolvedAt: new Date() } }
    );
  } catch (error) {
    console.error(`[OvertimeActions] Failed to resolve alerts for session ${sessionId}:`, error);
  }
}
