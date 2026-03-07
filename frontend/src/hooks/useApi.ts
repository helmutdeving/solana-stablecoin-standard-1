import { useState, useCallback } from "react";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiReturn<T, A extends unknown[]> extends ApiState<T> {
  execute: (...args: A) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T, A extends unknown[]>(
  fn: (...args: A) => Promise<T>,
): UseApiReturn<T, A> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: A): Promise<T | null> => {
      setState({ data: null, loading: true, error: null });
      try {
        const data = await fn(...args);
        setState({ data, loading: false, error: null });
        return data;
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        setState({ data: null, loading: false, error });
        return null;
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}

// Polling hook: fetches data at a given interval
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs = 5000,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    try {
      const result = await fn();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch error");
    } finally {
      setLoading(false);
    }
  }, [fn]);

  // Initial fetch + interval
  useState(() => {
    if (!enabled) return;
    setLoading(true);
    void fetch();
    const id = setInterval(() => void fetch(), intervalMs);
    return () => clearInterval(id);
  });

  return { data, error, loading };
}
