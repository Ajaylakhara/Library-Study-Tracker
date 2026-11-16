import type { ShiftHours } from '../types';

export const TOTAL_SEATS = 70;
export const POLL_MS = 15_000;

/**
 * Admin screen only: minutes without activity before the sign-out warning appears.
 * Set to 0 to turn the inactivity timeout off.
 */
export const ADMIN_INACTIVITY_TIMEOUT_MINUTES = 30;
/** How long the warning stays up before the admin is signed out. */
export const ADMIN_INACTIVITY_WARNING_SECONDS = 60;
export const SHIFTS: { hours: ShiftHours; label: string }[] = [
  { hours: 4, label: '4 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
];
