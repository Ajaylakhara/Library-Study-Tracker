import { FilterQuery } from 'mongoose';
import { Fee, FeeStatus, IFee } from '../models/Fee';
import { IUser } from '../models/User';

export interface FeeQuery {
  status?: FeeStatus;
  month?: string;
  months?: string[];
  studentId?: string;
}

export function buildFeeFilter(query: FeeQuery): FilterQuery<IFee> {
  const filter: FilterQuery<IFee> = {};
  if (query.status) filter.status = query.status;
  if (query.month) filter.month = query.month;
  else if (query.months) filter.month = { $in: query.months };
  if (query.studentId) filter.student = query.studentId;
  return filter;
}

export async function listFees(
  query: FeeQuery,
  options: { skip?: number; limit?: number } = {}
) {
  const filter = buildFeeFilter(query);
  const [fees, total] = await Promise.all([
    Fee.find(filter)
      .sort({ month: -1, createdAt: -1 })
      .skip(options.skip ?? 0)
      .limit(options.limit ?? 100)
      .populate<{ student: Pick<IUser, '_id' | 'name' | 'phone'> | null }>('student', 'name phone'),
    Fee.countDocuments(filter),
  ]);
  return { fees, total };
}

export async function summarizeFees(query: FeeQuery): Promise<{ total: number; count: number }> {
  const [summary] = await Fee.aggregate<{ total: number; count: number }>([
    { $match: buildFeeFilter(query) },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return summary ?? { total: 0, count: 0 };
}
