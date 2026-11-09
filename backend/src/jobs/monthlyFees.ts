import { User } from '../models/User';
import { Fee } from '../models/Fee';
import { NotificationService } from '../services/notifications/NotificationService';
import { previousMonthString, toMonthString } from '../utils/time';

/**
 * Generate monthly fees for all approved students.
 * Safe to run multiple times (skips if fee already exists).
 * @param month - "YYYY-MM" (defaults to previous month)
 */
export async function generateMonthlyFees(month?: string): Promise<{
  created: number;
  skipped: number;
  totalAmount: number;
}> {
  const targetMonth = month ?? previousMonthString();

  const students = await User.find({
    role: 'student',
    status: 'approved',
    isDeleted: false,
    monthlyFee: { $gt: 0 },
  });

  let created = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const student of students) {
    try {
      await Fee.create({
        student: student._id,
        month: targetMonth,
        amount: student.monthlyFee,
        status: 'unpaid',
      });
      created++;
      totalAmount += student.monthlyFee;

      // Notify student
      await NotificationService.enqueue({
        userId: student._id,
        type: 'fee_unpaid',
        vars: { name: student.name, amount: student.monthlyFee, month: targetMonth },
      });
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        // Already exists — skip silently
        skipped++;
      } else {
        console.error(`[MonthlyFees] Error creating fee for student ${student._id}:`, err);
      }
    }
  }

  // Notify admin
  if (created > 0) {
    await NotificationService.enqueueAdmin({
      type: 'fee_generated_admin',
      vars: { month: targetMonth, count: created, totalAmount },
    });
  }

  console.log(
    `[MonthlyFees] Month=${targetMonth}: created=${created}, skipped=${skipped}, total=Rs.${totalAmount}`
  );

  return { created, skipped, totalAmount };
}
