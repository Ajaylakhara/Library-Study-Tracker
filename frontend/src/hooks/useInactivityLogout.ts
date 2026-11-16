import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** Idle time before the warning appears. 0 or less turns the whole feature off. */
  timeoutMs: number;
  /** How long the warning stays up before `onExpire` runs. */
  warningMs: number;
  onExpire: () => void;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Idle detection for the admin screen. Uses timestamps (not one long timer), so a laptop
 * that slept past the limit is signed out as soon as it wakes. While the warning is
 * showing, only `stayActive()` (the button) keeps the session; stray mouse moves do not.
 */
export function useInactivityLogout({ timeoutMs, warningMs, onExpire }: Options) {
  const enabled = timeoutMs > 0;
  const lastActivity = useRef(Date.now());
  const warningRef = useRef(false);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now();
    warningRef.current = false;
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    lastActivity.current = Date.now();

    const onActivity = () => {
      if (!warningRef.current) lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));

    const tick = () => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= timeoutMs + warningMs) {
        warningRef.current = false;
        setSecondsLeft(null);
        expireRef.current();
      } else if (idle >= timeoutMs) {
        warningRef.current = true;
        setSecondsLeft(Math.max(1, Math.ceil((timeoutMs + warningMs - idle) / 1000)));
      }
    };
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity));
    };
  }, [enabled, timeoutMs, warningMs]);

  return { warning: secondsLeft !== null, secondsLeft: secondsLeft ?? 0, stayActive };
}
