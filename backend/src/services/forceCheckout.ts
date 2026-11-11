import mongoose from 'mongoose';
import { Session, ISession } from '../models/Session';
import { resolveOvertimeAlerts } from './notifications/overtimeActions';
import { diffMinutes, formatDuration } from '../utils/time';

export interface ForceCheckoutResult {
  session: ISession | null;
  durationMinutes: number;
  durationFormatted: string;
  alreadyCheckedOut: boolean;
}

export async function performForceCheckout(
  sessionId: string | mongoose.Types.ObjectId,
  options: { session?: mongoose.ClientSession; resolveAlerts?: boolean } = {}
): Promise<ForceCheckoutResult> {
  const now = new Date();

  let activeQuery = Session.findOne({ _id: sessionId, status: 'active' });
  if (options.session) activeQuery = activeQuery.session(options.session);
  const session = await activeQuery;
  if (!session) {
    let existingQuery = Session.findById(sessionId);
    if (options.session) existingQuery = existingQuery.session(options.session);
    const existing = await existingQuery;
    if (!existing) {
      return { session: null, durationMinutes: 0, durationFormatted: '', alreadyCheckedOut: false };
    }
    return {
      session: existing,
      durationMinutes: existing.durationMinutes || 0,
      durationFormatted: formatDuration(existing.durationMinutes || 0),
      alreadyCheckedOut: true,
    };
  }

  const durationMinutes = Math.max(0, diffMinutes(session.checkInAt, now));
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'active' },
    {
      $set: {
        status: 'completed',
        checkoutType: 'forced',
        checkOutAt: now,
        durationMinutes,
      },
    },
    { new: true, ...(options.session && { session: options.session }) }
  );

  if (!updated) {
    let currentQuery = Session.findById(sessionId);
    if (options.session) currentQuery = currentQuery.session(options.session);
    const current = await currentQuery;
    return {
      session: current ?? session,
      durationMinutes: current?.durationMinutes ?? durationMinutes,
      durationFormatted: formatDuration(current?.durationMinutes ?? durationMinutes),
      alreadyCheckedOut: true,
    };
  }

  if (options.resolveAlerts !== false) await resolveOvertimeAlerts(updated._id);

  return {
    session: updated,
    durationMinutes,
    durationFormatted: formatDuration(durationMinutes),
    alreadyCheckedOut: false,
  };
}
