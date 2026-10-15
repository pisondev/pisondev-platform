"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, post } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { PageHeader } from "../ui";

const MESSAGES: Record<string, string> = {
  not_allowed: "This Google account has no access to this workspace.",
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in failed. Please try again.",
  unavailable: "Google sign-in is not configured yet.",
};

export function Login() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const error = params.get("error");
  const { data: config } = useApi<{ google: boolean; devLogin: boolean }>("/auth/config");
  const [email, setEmail] = useState("");
  const [devError, setDevError] = useState<string>();

  async function devSignIn(e: FormEvent) {
    e.preventDefault();
    try {
      await post("/auth/dev-login", { email });
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setDevError((err as ApiError).message);
    }
  }

  return (
    <>
      <PageHeader title="Assistant" subtitle="Private workspace" />
      <div className="mt-80 px-85">
        <p className="text-body text-muted">Only the owner&apos;s accounts can sign in.</p>
        {error ? <p className="mt-24 rounded-card bg-panel p-24 text-body text-maroon">{MESSAGES[error] ?? MESSAGES.failed}</p> : null}
        <a
          href={`/api/v1/auth/google/login?next=${encodeURIComponent(next)}`}
          aria-disabled={config ? !config.google : undefined}
          className={`mt-40 flex items-center justify-center gap-20 rounded-card py-28 text-heading text-white ${
            config && !config.google ? "pointer-events-none opacity-50" : ""
          }`}
          style={{ background: "linear-gradient(90deg, #03310a, #866633)" }}
        >
          Sign in with Google
        </a>
        {config && !config.google ? <p className="mt-16 text-small text-muted">{MESSAGES.unavailable}</p> : null}

        {config?.devLogin ? (
          <form onSubmit={devSignIn} className="mt-80 grid gap-16 rounded-card bg-panel p-32">
            <span className="text-small text-muted">Development sign-in (disabled in production)</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="allowed email"
              className="rounded-card border border-line bg-card px-24 py-16 text-body outline-none focus:border-green"
            />
            <button type="submit" className="rounded-card bg-card py-16 text-body text-green">
              Continue
            </button>
            {devError ? <span className="text-small text-maroon">{devError}</span> : null}
          </form>
        ) : null}
      </div>
    </>
  );
}
