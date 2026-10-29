import { rupiah } from "@/lib/format";
import type { CSSProperties } from "react";

const FILL = {
  green: "linear-gradient(90deg, #59ceba, #5cd38a)",
  yellow: "linear-gradient(90deg, #cea159, #d3c95c)",
  red: "linear-gradient(90deg, #ce5959, #d37c5c)",
} as const;

const TONE = { empty: "text-muted", green: "text-green", yellow: "text-gold", red: "text-wine" } as const;

/**
 * Quota bar with the five states of the design (0%, green, yellow, red, over 100%).
 * The amount text is drawn twice: coloured over the track, white over the fill, so
 * the colour switches exactly at the edge of the fill.
 */
export function ProgressBar({
  spent,
  max,
  percent,
  level,
}: {
  spent: number;
  max: number;
  percent: number;
  level: "empty" | "green" | "yellow" | "red";
}) {
  const width = Math.max(0, Math.min(100, percent));
  const over = percent > 100;
  const fill = level === "empty" ? undefined : FILL[level];

  const label = (overlay: boolean) =>
    over ? (
      <>
        <span className="text-wine">{rupiah(spent)}</span>{" "}
        <span className={overlay ? "text-white" : "text-wine"}>/ {rupiah(max)}</span>
      </>
    ) : (
      `${rupiah(spent)} / ${rupiah(max)}`
    );

  return (
    <div
      className="motion-quota relative mx-85 h-67 overflow-hidden rounded-card bg-track text-heading font-bold"
      style={{ "--quota-target": `${width}%` } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-label="Weekly quota used"
      aria-valuetext={`${percent}% used, ${rupiah(spent)} of ${rupiah(max)}`}
    >
      {fill ? <div className="absolute inset-y-0 left-0 rounded-card" style={{ width: "var(--quota-fill)", background: fill }} /> : null}
      <div className={`text-glow absolute inset-0 flex items-center justify-between px-32 ${TONE[level]}`}>
        <span className="truncate">{label(false)}</span>
        <span>{percent}%</span>
      </div>
      {fill ? (
        <div
          aria-hidden
          className="text-glow absolute inset-0 flex items-center px-32 text-white"
          style={{ clipPath: "inset(0 calc(100% - var(--quota-fill)) 0 0)" }}
        >
          <span className="truncate">{label(true)}</span>
        </div>
      ) : null}
    </div>
  );
}
