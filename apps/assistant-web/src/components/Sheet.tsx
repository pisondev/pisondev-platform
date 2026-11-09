"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * State of a bottom sheet: focus trap, inert background, scroll lock, focus return, and
 * the exit animation. Set `savingRef` while a request runs so the sheet cannot be
 * dismissed; call `finish(after)` once it succeeds to animate out and then run `after`.
 */
export function useSheet(onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const mounted = useRef(false);
  const dismissing = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const afterExit = useRef(onClose);
  const [closing, setClosing] = useState(false);

  const finish = useCallback((after: () => void) => {
    dismissing.current = true;
    afterExit.current = after;
    if (reducedMotion()) return after();
    setClosing(true);
    exitTimer.current = setTimeout(() => afterExit.current(), 180);
  }, []);

  const close = useCallback(() => {
    if (saving.current || dismissing.current) return;
    finish(onClose);
  }, [finish, onClose]);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector("main");
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    (initialFocus?.current ?? form.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key !== "Tab") return;
      const controls = Array.from(form.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) ?? []).filter((node) => node.getClientRects().length > 0);
      const start = controls[0], end = controls[controls.length - 1];
      if (!start) { e.preventDefault(); form.current?.focus(); return; }
      if (e.shiftKey && (document.activeElement === start || document.activeElement === form.current)) {
        e.preventDefault(); end.focus();
      } else if (!e.shiftKey && (document.activeElement === end || !form.current?.contains(document.activeElement))) {
        e.preventDefault(); start.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mounted.current = false;
      clearTimeout(exitTimer.current);
      window.removeEventListener("keydown", onKey);
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [close, initialFocus]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const skip = () => {
      if (preference.matches && dismissing.current) {
        clearTimeout(exitTimer.current);
        afterExit.current();
      }
    };
    preference.addEventListener("change", skip);
    return () => preference.removeEventListener("change", skip);
  }, []);

  return { formRef: form, savingRef: saving, mountedRef: mounted, dismissingRef: dismissing, closing, close, finish };
}

/** The bottom sheet: backdrop, handle, a title row with `aside`, and the form body. */
export function SheetFrame({
  formRef,
  closing,
  onDismiss,
  titleId,
  title,
  aside,
  busy,
  onSubmit,
  children,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  closing: boolean;
  onDismiss: () => void;
  titleId: string;
  title: string;
  aside?: ReactNode;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return createPortal(
    <div data-closing={closing} className="transaction-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onDismiss}>
      <form
        ref={formRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="transaction-sheet scroll-thin max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[max(16px,calc(var(--spacing)*40))] bg-page px-60 pt-40 pb-60 shadow-2xl"
      >
        <fieldset disabled={busy || closing} className="contents">
          <div className="mx-auto mb-24 h-10 w-120 rounded-full bg-line" />
          <div className="flex items-center justify-between gap-16">
            <h2 id={titleId} className="text-heading-red text-heading">
              {title}
            </h2>
            {aside}
          </div>
          {children}
        </fieldset>
      </form>
    </div>,
    document.body,
  );
}

/** Cancel and the gradient Save button; `extra` sits before them (for example Delete). */
export function SheetActions({ closing, onCancel, busy, disabled, extra }: {
  closing: boolean;
  onCancel: () => void;
  busy: boolean;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="mt-40 flex gap-24">
      {extra}
      <button type="button" onClick={onCancel} disabled={busy || closing} className="flex-1 rounded-card bg-panel py-24 text-body text-muted disabled:opacity-60">
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || closing || disabled}
        aria-busy={busy || undefined}
        className="flex-[2] rounded-card py-24 text-body font-bold text-white disabled:opacity-60"
        style={{ background: "linear-gradient(90deg, #165d23, #866633)" }}
      >
        <span className={busy ? "motion-busy" : undefined}>{busy ? "Saving..." : "Save"}</span>
      </button>
    </div>
  );
}

/**
 * Delete that asks once more in place (no browser dialog): the first press arms it, the
 * second within a few seconds deletes.
 */
export function DeleteButton({ busy, onDelete, label = "Delete" }: { busy: boolean; onDelete: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      className={`flex-1 rounded-card py-24 text-body disabled:opacity-60 ${armed ? "bg-maroon text-white" : "bg-panel text-maroon"}`}
    >
      {armed ? "Confirm" : label}
    </button>
  );
}

export function SheetError({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div role="alert" className="motion-feedback mt-28 rounded-card bg-panel p-24 text-body text-maroon">
      {message}
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-card border border-line bg-card px-24 py-16 text-body text-ink outline-none focus:border-green focus:ring-2 focus:ring-green/20";

export function Field({ label, children, animated = false }: { label: string; children: ReactNode; animated?: boolean }) {
  return (
    <label className={`grid gap-8 ${animated ? "motion-feedback" : ""}`}>
      <span className="text-small text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-16 text-small text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-[max(16px,calc(var(--spacing)*40))] accent-green" />
      {children}
    </label>
  );
}

/** The API's error for one field, if any. */
export function FieldError({ fields, name }: { fields: Record<string, unknown> | undefined; name: string }) {
  return fields?.[name] ? <span className="text-small text-maroon">{String(fields[name])}</span> : null;
}
