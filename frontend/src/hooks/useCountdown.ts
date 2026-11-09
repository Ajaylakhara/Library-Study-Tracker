import { useEffect, useState } from 'react';

/**
 * Ticks every second against a server-provided end time.
 * remainingMs is negative once the shift is over (overtime).
 */
export function useCountdown(endISO: string | undefined, startISO?: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endISO) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endISO]);

  if (!endISO) return { remainingMs: 0, elapsedMs: 0, totalMs: 0, progress: 0, overtime: false, ending: false };

  const end = new Date(endISO).getTime();
  const start = startISO ? new Date(startISO).getTime() : end;
  const totalMs = Math.max(1, end - start);
  const remainingMs = end - now;
  const elapsedMs = now - start;
  return {
    remainingMs,
    elapsedMs,
    totalMs,
    progress: Math.min(1, Math.max(0, elapsedMs / totalMs)),
    overtime: remainingMs < 0,
    ending: remainingMs >= 0 && remainingMs <= 10 * 60 * 1000,
  };
}
