import { useEffect, useRef } from 'react';

/**
 * Calls fn every `ms`. Pauses while the tab is hidden and refreshes
 * immediately when it becomes visible again.
 */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        saved.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
}
