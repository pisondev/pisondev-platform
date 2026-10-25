"use client";

import Link from "next/link";
import { post } from "@/lib/api";
import type { User } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Chevron, PageHeader } from "../ui";

const ASSISTANTS = [
  { href: "/finance", title: "Finance", note: "Balance, quota, subscriptions", bg: "bg-mint", fg: "text-green", ready: true },
  { href: "/links", title: "Links", note: "Short links, QR and visits", bg: "bg-sky", fg: "text-blue", ready: true },
  { href: "/meeting", title: "Meeting", note: "Coming soon", bg: "bg-sky", fg: "text-blue", ready: false },
];

export function Hub() {
  const { data: user } = useApi<User>("/auth/me");

  async function signOut() {
    await post("/auth/logout").catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <>
      <PageHeader title="Assistant" subtitle="Your private workspace" />
      <div className="mt-60 grid grid-cols-2 gap-60 px-85">
        {ASSISTANTS.map((a) =>
          a.ready ? (
            <Link key={a.href} href={a.href} className={`flex h-292 flex-col justify-between rounded-card p-32 ${a.bg} ${a.fg}`}>
              <span>
                <span className="block text-heading">{a.title}</span>
                <span className="block text-small opacity-80">{a.note}</span>
              </span>
              <Chevron className="self-end text-[max(36px,calc(var(--spacing)*100))]" />
            </Link>
          ) : (
            <div key={a.href} aria-disabled className={`flex h-292 flex-col justify-between rounded-card p-32 opacity-60 ${a.bg} ${a.fg}`}>
              <span>
                <span className="block text-heading">{a.title}</span>
                <span className="block text-small opacity-80">{a.note}</span>
              </span>
            </div>
          ),
        )}
      </div>
      {user ? (
        <p className="mt-80 px-85 text-small text-muted">
          Signed in as {user.email} ({user.role}).{" "}
          <button type="button" onClick={signOut} className="text-blue underline">
            Sign out
          </button>
        </p>
      ) : null}
    </>
  );
}
