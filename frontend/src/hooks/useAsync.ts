import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../toolkit/createAppThunk';

/**
 * Loads data with loading / error / reload handling.
 * Keeps the previous data on screen while reloading and ignores stale responses.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback((silent = false) => {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    loaderRef
      .current()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (id !== seq.current) return;
        setError(errMsg(e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setData(null);
    run();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: () => run(), refresh: () => run(true), setData };
}
