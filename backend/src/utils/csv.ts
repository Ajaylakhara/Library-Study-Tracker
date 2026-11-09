import { ISession } from '../models/Session';
import { formatDuration } from './time';

/** Convert a session document to a safe API response shape */
export function sessionToResponse(session: ISession & { seatNumber?: number; studentName?: string }) {
  const base = session.toObject ? session.toObject() : { ...session };
  const dur = base.durationMinutes ?? null;
  return {
    ...base,
    durationFormatted: dur !== null ? formatDuration(dur) : null,
    seatNumber: session.seatNumber ?? undefined,
    studentName: session.studentName ?? undefined,
  };
}

/** Build CSV rows from an array of objects using given headers */
export function buildCsv(
  headers: string[],
  rows: Record<string, string | number | null | undefined>[]
): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const str = String(v);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.join(',');
  const dataLines = rows.map((row) => headers.map((h) => escape(row[h])).join(','));
  return [headerLine, ...dataLines].join('\n');
}
