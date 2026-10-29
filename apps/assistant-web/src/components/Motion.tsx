"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { rupiah } from "@/lib/format";

/** Keep final amounts available to assistive technology and reserve their full width. */
export function AnimatedMoney({ value }: { value: number }) {
  const visual = useRef<HTMLSpanElement>(null);
  const current = useRef(0);

  useEffect(() => {
    const node = visual.current;
    if (!node) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let started = false;
    const finish = () => {
      cancelAnimationFrame(frame);
      current.current = value;
      node.textContent = rupiah(value);
    };
    const start = () => {
      if (started) return;
      started = true;
      if (preference.matches || document.hidden) return finish();
      const from = current.current;
      const time = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - time) / 480);
        current.current = Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
        node.textContent = rupiah(current.current);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      node.textContent = rupiah(from);
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(node);
    const onPreference = () => { if (preference.matches) finish(); };
    const onVisibility = () => { if (document.hidden) finish(); };
    preference.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      preference.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [value]);

  return (
    <span className="inline-grid tabular-nums">
      <span className="sr-only">{rupiah(value)}</span>
      <span aria-hidden className="invisible col-start-1 row-start-1">{rupiah(value)}</span>
      <span aria-hidden ref={visual} className="col-start-1 row-start-1">{rupiah(value)}</span>
    </span>
  );
}

/** Only data marks animate; axes, labels and controls keep their final geometry. */
export function ChartMarks({ children, signature }: { children: ReactNode; signature: string }) {
  return <Marks key={signature}>{children}</Marks>;
}

function Marks({ children }: { children: ReactNode }) {
  const group = useRef<SVGGElement>(null);
  useEffect(() => {
    const node = group.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.dataset.motion = "waiting";
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        node.dataset.motion = "ready";
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <g ref={group} className="motion-chart">{children}</g>;
}
