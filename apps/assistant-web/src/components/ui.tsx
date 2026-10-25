import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Page title block: optional back link, gradient title, subtitle, divider. */
export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: string }) {
  return (
    <header className="px-85 pt-50">
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
  return <section className={`mx-85 rounded-card bg-panel p-22 ${className}`}>{children}</section>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative rounded-card bg-card ${className}`}>{children}</div>;
}

/** Label with a value, like "Balance : Rp87.000". */
export function Figure({ label, value, tone = "green" }: { label: string; value: string; tone?: "green" | "maroon" }) {
  return (
    <p className="flex items-baseline gap-24 px-85 text-heading">
      <span className="text-label-gradient w-[34%] shrink-0">{label}</span>
      <span>:</span>
      <span className={`font-bold ${tone === "green" ? "text-green" : "text-maroon"}`}>{value}</span>
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
  return (
    <div role="tablist" className={`inline-flex rounded-card bg-panel p-8 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-w-143 rounded-card px-18 py-8 text-small transition-colors ${
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
  return <p className={`px-85 py-24 text-body ${tone === "error" ? "text-maroon" : "text-muted"}`}>{children}</p>;
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`font-chevron leading-none ${className}`}>
      &gt;
    </span>
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
      className={`inline-flex min-h-[44px] items-center justify-center rounded-card text-body transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
