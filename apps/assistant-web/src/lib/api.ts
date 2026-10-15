// Thin client for the Go API. Same origin, so the session cookie rides along.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  let body: Envelope<T> = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON answer, e.g. the API is down behind the dev proxy.
  }
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  }
  if (!res.ok || body.error) {
    const e = body.error ?? { code: "http_" + res.status, message: res.status >= 500 ? "The server is not responding." : res.statusText };
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return body.data as T;
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export const patch = <T>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });

export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });
