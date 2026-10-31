"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AnimatedMoney } from "./Motion";

/** Page title block: optional back link, gradient title, subtitle, divider. */
export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: string }) {
  return (
    <header className="assistant-header px-85 pt-50">
      {back ? (
        <Link href={back} className="-ml-14 inline-block text-heading text-muted hover:text-ink">
          &lt; Back
        </Link>
      ) : (
        <div className="h-57" />
      )}
      <h1 className="text-title-gradient mt-4 text-display">{title}</h1>
      {subtitle ? <p className="text-title-gradient text-heading">{subtitle}</p> : null}
      <hr className="mt-24 border-0 border-t-[max(2px,calc(var(--spacing)*5))] border-muted" />
    </header>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`motion-panel mx-85 rounded-card bg-panel p-22 ${className}`}>{children}</section>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative rounded-card bg-card ${className}`}>{children}</div>;
}

/** Label with a value, like "Balance : Rp87.000". */
export function Figure({ label, value, tone = "green" }: { label: string; value: string | number; tone?: "green" | "maroon" }) {
  return (
    <p className="flex items-baseline gap-24 px-85 text-heading">
      <span className="text-label-gradient w-[34%] shrink-0">{label}</span>
      <span>:</span>
      <span className={`font-bold ${tone === "green" ? "text-green" : "text-maroon"}`}>{typeof value === "number" ? <AnimatedMoney value={value} /> : value}</span>
    </p>
  );
}

export type ToggleOption<T extends string> = { value: T; label: string };

/** Pill switch from the design: grey track, white active pill. */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: ToggleOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = track.current;
    const indicator = pill.current;
    if (!node || !indicator) return;
    const measure = () => {
      const selected = node.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return;
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      node.dataset.measured = "true";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div ref={track} role="group" aria-label="View" className={`motion-toggle relative inline-flex rounded-card bg-panel p-8 ${className}`}>
      <span ref={pill} aria-hidden className="motion-pill pointer-events-none absolute top-0 left-0 rounded-card bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative min-w-143 rounded-card px-18 py-8 text-small transition-colors ${
            o.value === value ? "bg-card text-ink shadow-[0_1px_2px_rgb(0_0_0/0.04)]" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Loading, error and empty states in the page's own typography. */
export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return <p className={`motion-feedback px-85 py-24 text-body ${tone === "error" ? "text-maroon" : "text-muted"}`}>{children}</p>;
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`font-chevron leading-none ${className}`}>
      &gt;
    </span>
  );
}

/**
 * Module navigation tile: a soft tinted gradient with a faint ring in the corner, an icon
 * badge, the title, an optional live summary, and the chevron. The height grows with its
 * content (minimum 292 units), so long titles never push the chevron out.
 */
export function NavTile({ href, title, icon, tone, children }: { href: string; title: string; icon: ReactNode; tone: "blue" | "green"; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className={`nav-tile relative isolate flex min-h-292 flex-col overflow-hidden rounded-card p-28 ${tone === "blue" ? "nav-tile-blue text-blue" : "nav-tile-green text-green"}`}
    >
      <span aria-hidden className="nav-tile-icon flex size-[max(30px,calc(var(--spacing)*84))] items-center justify-center rounded-full">
        <svg viewBox="0 0 24 24" className="size-[55%]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <span className="mt-18 text-heading leading-tight">{title}</span>
      {children ? <span className="mt-12 grid gap-8 text-small">{children}</span> : null}
      <Chevron className="mt-auto self-end pt-12 text-[max(28px,calc(var(--spacing)*80))]" />
    </Link>
  );
}

/**
 * Opens a detail page: the usual window-with-arrow icon. A 32 px target around a small
 * glyph, so it fits in a table header without changing its height.
 */
export function DetailLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`detail-link inline-flex size-[32px] items-center justify-center rounded-[8px] text-muted hover:bg-panel hover:text-ink ${className}`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
        <path className="detail-link-arrow" d="M14 4h6v6M20 4l-9 9" />
      </svg>
    </Link>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-[linear-gradient(90deg,var(--color-green),var(--color-gold))] px-40 font-bold text-white",
  secondary: "bg-panel px-32 text-ink hover:bg-track",
  danger: "bg-panel px-32 text-maroon hover:bg-track",
  text: "px-8 text-blue underline underline-offset-2 hover:text-ink",
};

/**
 * Shared button: the action families of the design (gradient primary, panel secondary,
 * blue text action) with a visible keyboard focus ring, a 44 px minimum touch target
 * and a busy state that keeps the button's place and blocks repeats.
 */
export function Button({
  variant = "secondary",
  busy = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`motion-button inline-flex min-h-[44px] items-center justify-center rounded-card text-body transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    >
      <span className={busy ? "motion-busy" : undefined}>{children}</span>
    </button>
  );
}
