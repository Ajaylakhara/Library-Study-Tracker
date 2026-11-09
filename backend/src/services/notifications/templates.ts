import { NotificationType } from '../../models/Notification';

export interface TemplateConfig {
  templateKey: string;
  buildMessage: (vars: Record<string, string | number>) => string;
}

export const templates: Record<NotificationType, TemplateConfig> = {
  approved: {
    templateKey: 'APPROVED',
    buildMessage: (vars) =>
      `Hi ${vars.name}, your registration at ${vars.libraryName ?? 'the library'} has been APPROVED! You can now check in. Welcome aboard!`,
  },
  rejected: {
    templateKey: 'REJECTED',
    buildMessage: (vars) =>
      `Hi ${vars.name}, unfortunately your registration at ${vars.libraryName ?? 'the library'} has been rejected. Please contact admin for more info.`,
  },
  shift_reminder: {
    templateKey: 'SHIFT_REMINDER',
    buildMessage: (vars) =>
      `Hi ${vars.name}, your shift ends in 10 minutes (at ${vars.shiftEndsAt}). Please save your work and prepare to check out.`,
  },
  shift_ended: {
    templateKey: 'SHIFT_ENDED',
    buildMessage: (vars) =>
      `Hi ${vars.name}, your shift has ended at ${vars.shiftEndsAt}. Please check out at your earliest convenience.`,
  },
  auto_checkout: {
    templateKey: 'AUTO_CHECKOUT',
    buildMessage: (vars) =>
      `Hi ${vars.name}, you have been automatically checked out after your shift. Study time: ${vars.duration}. Thank you for visiting!`,
  },
  fee_unpaid: {
    templateKey: 'FEE_UNPAID',
    buildMessage: (vars) =>
      `Hi ${vars.name}, your library fee of Rs. ${vars.amount} for ${vars.month} is due. Please pay at the library counter.`,
  },
  overtime_admin: {
    templateKey: 'OVERTIME_ADMIN',
    buildMessage: (vars) =>
      `[ADMIN ALERT] Student ${vars.studentName} (Seat ${vars.seatNumber}) is in overtime by 15+ minutes. Shift ended at ${vars.shiftEndsAt}.`,
  },
  fee_generated_admin: {
    templateKey: 'FEE_GENERATED_ADMIN',
    buildMessage: (vars) =>
      `[ADMIN] Monthly fees generated for ${vars.month}. Total students: ${vars.count}. Total amount: Rs. ${vars.totalAmount}.`,
  },
  registration_pending_admin: {
    templateKey: 'REGISTRATION_PENDING_ADMIN',
    buildMessage: (vars) =>
      `[ADMIN] Registration waiting for approval: ${vars.name} (${vars.phone}).`,
  },
};
