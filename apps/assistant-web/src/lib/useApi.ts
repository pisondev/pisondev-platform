"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

type State<T> = { data: T | undefined; error: ApiError | undefined; loading: boolean };

/** Loads a GET endpoint and exposes a reload function. Pass null to skip loading. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, loading: path !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    api<T>(path)
      .then((data) => alive && setState({ data, error: undefined, loading: false }))
      .catch((error: ApiError) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
