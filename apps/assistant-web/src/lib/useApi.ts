"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

// settled is the request (path and reload count) the current data or error belongs to.
type State<T> = { data: T | undefined; error: ApiError | undefined; settled: string | undefined };

/**
 * Loads a GET endpoint and exposes a reload function. Pass null to skip loading.
 * `loading` is true while nothing has arrived yet; `refreshing` is true while a newer
 * request (reload or new path) is pending and earlier data is still shown.
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, settled: undefined });
  const [tick, setTick] = useState(0);
  const key = `${path}#${tick}`;

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    api<T>(path)
      .then((data) => alive && setState({ data, error: undefined, settled: key }))
      .catch((error: ApiError) => alive && setState((s) => ({ data: s.data, error, settled: key })));
    return () => {
      alive = false;
    };
  }, [path, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const pending = path !== null && state.settled !== key;
  return {
    data: state.data,
    error: state.error,
    loading: pending && state.data === undefined,
    refreshing: pending && state.data !== undefined,
    reload,
  };
}
