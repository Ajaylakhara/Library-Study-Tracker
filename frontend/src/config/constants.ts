import type { ShiftHours } from '../types';

export const TOTAL_SEATS = 70;
export const POLL_MS = 15_000;
export const SHIFTS: { hours: ShiftHours; label: string }[] = [
  { hours: 4, label: '4 hours' },
  { hours: 12, label: '12 hours' },
  { hours: 24, label: '24 hours' },
];
