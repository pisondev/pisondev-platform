import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { rupiah } from "@/lib/format";
import type { CashflowKind, CashflowPoint } from "@/lib/types";
import { ChartMarks } from "./Motion";

/*
 * Charts drawn in the coordinate space of their Figma cards. Shapes are SVG; labels are
 * HTML placed by percentage, so text keeps the readable minimum size of the page.
 */

export type Swatch = { text: string; from: string; to: string };

// Colour per subscription, in the order the design assigns them.
export const MONTHLY_SWATCHES: Swatch[] = [
  { text: "#866633", from: "#ce6359", to: "#d3ad5c" },
  { text: "#2a5fc2", from: "#59ceba", to: "#5c90d3" },
  { text: "#810f0f", from: "#ce5959", to: "#d35cc3" },
  { text: "#165d23", from: "#70ce59", to: "#298352" },
  { text: "#db4b6f", from: "#e25fb2", to: "#ce863d" },
  { text: "#5d1616", from: "#95bc3c", to: "#298352" },
];
export const YEARLY_SWATCHES: Swatch[] = [
  { text: "#165d23", from: "#95bc3c", to: "#298352" },
  { text: "#db4b6f", from: "#e25fb2", to: "#ce863d" },
  ...MONTHLY_SWATCHES,
];

function Label({ x, y, w, h, vw, vh, children, style, className = "" }: {
  x: number; y: number; w: number; h: number; vw: number; vh: number; children: ReactNode; style?: CSSProperties; className?: string;
}) {
  return (
    <span
      className={`absolute flex items-center justify-center text-center text-small leading-tight ${className}`}
      style={{ left: `${(x / vw) * 100}%`, top: `${(y / vh) * 100}%`, width: `${(w / vw) * 100}%`, height: `${(h / vh) * 100}%`, ...style }}
    >
      {children}
    </span>
  );
}

/** Rounded-top bar: radius only on the top corners, like the Figma bars. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function Axes({ x, top, bottom, right }: { x: number; top: number; bottom: number; right: number }) {
  return (
    <g stroke="#787878" strokeWidth={3} fill="none">
      <line x1={x} y1={top} x2={x} y2={bottom} />
      <line x1={x} y1={bottom + 1} x2={right} y2={bottom + 1} />
    </g>
  );
}

// -----------------------------------------------------------------------------
// Subscriptions: one bar per subscription (card 866 x 529).

export function SubscriptionChart({ items, swatches, toggle }: {
  items: { id: string; name: string; price: number }[];
  swatches: Swatch[];
  toggle: ReactNode;
}) {
  const VW = 866, VH = 529, AX = 40, BOTTOM = 434, TOP = 93, RIGHT = 828;
  const maxPrice = Math.max(1, ...items.map((i) => i.price));
  const slot = (RIGHT - AX) / Math.max(1, items.length);
  const barW = items.length > 2 ? 87 : slot * 0.82;
  const bars = items.map((it, i) => {
    const h = ((BOTTOM - TOP) * Math.max(0, it.price)) / maxPrice;
    const x = AX + slot * i + (slot - barW) / 2;
    return { ...it, x, y: BOTTOM - h, h, sw: swatches[i % swatches.length] };
  });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="block w-full" role="img" aria-label="Subscription prices">
        <defs>
          {bars.map((b) => (
            <linearGradient key={b.id} id={`bar-${b.id}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={b.sw.from} />
              <stop offset="1" stopColor={b.sw.to} />
            </linearGradient>
          ))}
        </defs>
        <Axes x={AX} top={15} bottom={BOTTOM} right={RIGHT} />
        <circle cx={AX} cy={93} r={4} fill="#787878" />
        <circle cx={AX} cy={207} r={4} fill="#787878" />
        <ChartMarks signature={JSON.stringify(items)}>
          {bars.map((b, i) => (
            <path key={b.id} className="motion-bar" style={{ transformOrigin: `0px ${BOTTOM}px`, animationDelay: `${Math.min(i, 5) * 30}ms` }} d={barPath(b.x, b.y, barW, b.h, 25)} fill={`url(#bar-${b.id})`} />
          ))}
        </ChartMarks>
      </svg>
      {bars.map((b) => (
        <Label key={`v-${b.id}`} x={b.x - 40} y={b.y - 52} w={barW + 80} h={44} vw={VW} vh={VH} style={{ color: b.sw.text }}>
          {rupiah(b.price)}
        </Label>
      ))}
      {bars.map((b) => (
        <Label key={`n-${b.id}`} x={b.x - 50} y={BOTTOM + 8} w={barW + 100} h={80} vw={VW} vh={VH} className="items-start" style={{ color: b.sw.text }}>
          {b.name}
        </Label>
      ))}
      {items.length === 0 ? (
        <Label x={AX} y={200} w={RIGHT - AX} h={60} vw={VW} vh={VH} className="text-muted">
          No subscriptions.
        </Label>
      ) : null}
      <div className="absolute top-[3%] right-[2%]">{toggle}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Savings: Target vs Now with the gap marked (card 847 x 496). Value labels sit left of the
// axis and the gap label right of the dashed marker; the two bars share the width between.

export function SavingsChart({ target, now }: { target: number; now: number }) {
  const VW = 847, VH = 496, AX = 168, BOTTOM = 435, TOP = 94;
  const GAP_X = 640; // dashed gap marker
  const BAR_GAP = 48;
  const tX = AX + 30;
  const barW = (GAP_X - 24 - tX - BAR_GAP) / 2;
  const nX = tX + barW + BAR_GAP;
  const maxV = Math.max(1, target, now);
  const hOf = (v: number) => ((BOTTOM - TOP) * Math.max(0, v)) / maxV;
  const tTop = BOTTOM - hOf(target);
  const nTop = BOTTOM - hOf(now);
  const gap = target - now;
  const hi = Math.min(tTop, nTop), lo = Math.max(tTop, nTop);
  // Keep the two value labels apart when the bars are almost the same height.
  const spread = Math.max(0, 64 - (lo - hi)) / 2;
  const tLabel = tTop + (tTop <= nTop ? -spread : spread);
  const nLabel = nTop + (nTop < tTop ? -spread : spread);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="block w-full" role="img" aria-label={`Savings target ${rupiah(target)}, now ${rupiah(now)}`}>
        <defs>
          <linearGradient id="sv-target" x1="0" x2="1">
            <stop offset="0" stopColor="#5982ce" />
            <stop offset="1" stopColor="#5cafd3" />
          </linearGradient>
          <linearGradient id="sv-now" x1="0" x2="1">
            <stop offset="0" stopColor="#59ceba" />
            <stop offset="1" stopColor="#5cd38a" />
          </linearGradient>
        </defs>
        <line x1={AX} y1={tTop} x2={GAP_X} y2={tTop} stroke="#c0c0c0" strokeWidth={1.5} />
        <line x1={AX} y1={nTop} x2={GAP_X} y2={nTop} stroke="#c0c0c0" strokeWidth={1.5} />
        <Axes x={AX} top={16} bottom={BOTTOM} right={GAP_X + 10} />
        <circle cx={AX} cy={tTop} r={4} fill="#787878" />
        <circle cx={AX} cy={nTop} r={4} fill="#787878" />
        <ChartMarks signature={`${target}:${now}`}>
          <path className="motion-bar" style={{ transformOrigin: `0px ${BOTTOM}px` }} d={barPath(tX, tTop, barW, BOTTOM - tTop, 25)} fill="url(#sv-target)" />
          <path className="motion-bar" style={{ transformOrigin: `0px ${BOTTOM}px`, animationDelay: "60ms" }} d={barPath(nX, nTop, barW, BOTTOM - nTop, 25)} fill="url(#sv-now)" />
        </ChartMarks>
        {lo - hi > 2 ? (
          <line x1={GAP_X} y1={hi} x2={GAP_X} y2={lo} stroke={gap > 0 ? "#810f0f" : "#165d23"} strokeWidth={1.5} strokeDasharray="6 5" />
        ) : null}
      </svg>
      <Label x={0} y={tLabel - 22} w={AX - 10} h={44} vw={VW} vh={VH} className="justify-end text-blue">
        {rupiah(target)}
      </Label>
      <Label x={0} y={nLabel - 22} w={AX - 10} h={44} vw={VW} vh={VH} className="justify-end text-green">
        {rupiah(now)}
      </Label>
      {lo - hi > 2 ? (
        <Label x={GAP_X + 10} y={(hi + lo) / 2 - 22} w={VW - GAP_X - 14} h={44} vw={VW} vh={VH} className={`justify-start ${gap > 0 ? "text-maroon" : "text-green"}`}>
          {gap > 0 ? rupiah(gap) : `+${rupiah(-gap)}`}
        </Label>
      ) : null}
      <Label x={tX} y={BOTTOM + 10} w={barW} h={44} vw={VW} vh={VH} className="text-blue">
        Target
      </Label>
      <Label x={nX} y={BOTTOM + 10} w={barW} h={44} vw={VW} vh={VH} className="text-green">
        Now
      </Label>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cash flow: one line per series (income, outcome) with drop lines (card 847 x 496).

export type CashflowSeries = { name: string; color: string; values: number[] };

/** Chart input for a filter: income green, outcome red, both for "all". */
export function cashflowSeries(points: CashflowPoint[], kind: CashflowKind) {
  const income: CashflowSeries = { name: "Income", color: "var(--color-leaf)", values: points.map((p) => p.income) };
  const outcome: CashflowSeries = { name: "Outcome", color: "var(--color-maroon)", values: points.map((p) => p.outcome) };
  return {
    labels: points.map((p) => p.label),
    series: kind === "income" ? [income] : kind === "outcome" ? [outcome] : [income, outcome],
  };
}

export function CashflowChart({ labels, series, toggle }: { labels: string[]; series: CashflowSeries[]; toggle: ReactNode }) {
  // TOP leaves room for the toggle and the stacked legend in the top-right corner.
  const VW = 847, VH = 496, AX = 40, BOTTOM = 508, TOP = 235, RIGHT = 770;
  const n = labels.length;
  const values = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const y = (v: number) => BOTTOM - 8 - ((v - lo) / span) * (BOTTOM - 8 - TOP);
  const step = n > 1 ? (RIGHT - 60 - (AX + 76)) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? AX + 76 + step * i : (AX + RIGHT) / 2);
  const every = Math.max(1, Math.ceil(n / 6)); // keep labels from crowding
  const peak = labels.map((_, i) => Math.max(...series.map((s) => s.values[i] ?? 0)));
  const signature = JSON.stringify({ labels, series });

  // Hover or focus shows a point's amount; a click pins it until clicked again.
  // Pins belong to one dataset, so a filter or period change clears them.
  const [active, setActive] = useState<string | null>(null);
  const [pins, setPins] = useState<{ signature: string; keys: string[] }>({ signature: "", keys: [] });
  const pinned = pins.signature === signature ? pins.keys : [];
  const points = series.flatMap((s) =>
    s.values.map((v, i) => ({ key: `${s.name}:${i}`, name: s.name, color: s.color, label: labels[i], value: v, i, px: x(i), py: y(v), top: v >= peak[i] })),
  );
  const togglePin = (key: string) => {
    const on = !pinned.includes(key);
    setPins({ signature, keys: on ? [...pinned, key] : pinned.filter((k) => k !== key) });
    if (!on) setActive(null); // hide it right away, even under the pointer
  };
  const onKey = (e: KeyboardEvent, key: string) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    togglePin(key);
  };
  const shown = points.filter((p) => p.key === active || pinned.includes(p.key));

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${VW} ${VH + 50}`} className="block w-full" role="group" aria-label={`Cash flow chart: ${series.map((s) => s.name).join(" and ")}`}>
          <Axes x={AX} top={89} bottom={BOTTOM} right={RIGHT} />
          {lo < 0 ? <line x1={AX} y1={y(0)} x2={RIGHT} y2={y(0)} stroke="#c0c0c0" strokeWidth={1.5} /> : null}
          <ChartMarks signature={signature}>
            <g className="motion-chart-detail">
              {labels.map((l, i) => (
                <line key={`d-${l}`} x1={x(i)} y1={y(peak[i])} x2={x(i)} y2={BOTTOM} stroke="#787878" strokeWidth={1} strokeDasharray="5 5" />
              ))}
            </g>
            {n > 1
              ? series.map((s) => (
                  <path
                    key={`line-${s.name}`}
                    className="motion-line"
                    pathLength={1}
                    d={s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                ))
              : null}
            {/* Each point projects onto both axes: its value on y (series color), its period on x. */}
            <g className="motion-chart-detail">
              {labels.map((l, i) => (
                <circle key={`ax-${l}-${i}`} cx={x(i)} cy={BOTTOM + 1} r={4} fill="#787878" />
              ))}
              {series.map((s) =>
                s.values.map((v, i) => <circle key={`ay-${s.name}-${i}`} cx={AX} cy={y(v)} r={4} fill={s.color} />),
              )}
            </g>
            <g className="motion-chart-detail">
              {series.map((s) =>
                s.values.map((v, i) => (
                  <circle key={`p-${s.name}-${labels[i]}`} cx={x(i)} cy={y(v)} r={n > 1 ? 4 : 7} fill={s.color} />
                )),
              )}
            </g>
          </ChartMarks>
          {points.map((p) =>
            pinned.includes(p.key) ? (
              <g key={`pin-${p.key}`}>
                <line x1={AX} y1={p.py} x2={p.px} y2={p.py} stroke={p.color} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.6} />
                <circle cx={AX} cy={p.py} r={6} fill={p.color} />
                <circle cx={p.px} cy={p.py} r={10} fill={p.color} stroke="var(--color-card)" strokeWidth={3} />
              </g>
            ) : p.key === active ? (
              <g key={`act-${p.key}`}>
                <line x1={AX} y1={p.py} x2={p.px} y2={p.py} stroke={p.color} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.6} />
                <circle cx={AX} cy={p.py} r={6} fill={p.color} />
                <circle cx={p.px} cy={p.py} r={14} fill={p.color} opacity={0.15} />
                <circle cx={p.px} cy={p.py} r={6} fill={p.color} />
              </g>
            ) : null,
          )}
          {points.map((p) => (
            <circle
              key={`hit-${p.key}`}
              className="chart-hit"
              cx={p.px}
              cy={p.py}
              r={28}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-pressed={pinned.includes(p.key)}
              aria-label={`${p.name} ${p.label}: ${rupiah(p.value)}`}
              onPointerEnter={(e) => { if (e.pointerType !== "touch") setActive(p.key); }}
              onPointerLeave={() => setActive((k) => (k === p.key ? null : k))}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive((k) => (k === p.key ? null : k))}
              onClick={() => togglePin(p.key)}
              onKeyDown={(e) => onKey(e, p.key)}
            />
          ))}
        </svg>
        {shown.map((p) => {
          // The higher series labels above its point, the lower one below, so pairs never collide.
          const above = p.top ? p.py - 58 >= 0 : p.py + 58 > BOTTOM;
          return (
            <Label
              key={`tip-${p.key}`}
              x={Math.max(0, Math.min(VW - 260, p.px - 130))}
              y={above ? p.py - 58 : p.py + 14}
              w={260}
              h={44}
              vw={VW}
              vh={VH + 50}
              className="chart-tip pointer-events-none"
            >
              <span className="rounded-full bg-card/95 px-14 py-2 font-bold shadow-[0_1px_4px_rgb(0_0_0/0.12)]" style={{ color: p.color }}>
                {rupiah(p.value)}
              </span>
            </Label>
          );
        })}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <Label key={`l${i}`} x={x(i) - 70} y={BOTTOM + 6} w={140} h={44} vw={VW} vh={VH + 50} className="text-ink">
              {l}
            </Label>
          ) : null,
        )}
        {n === 0 ? (
          <Label x={AX} y={280} w={RIGHT - AX} h={60} vw={VW} vh={VH + 50} className="text-muted">
            No transactions yet.
          </Label>
        ) : null}
        <div className="absolute top-[3%] right-[3%] flex flex-col items-end gap-10">
          {toggle}
          <ul className="grid justify-items-end gap-4 pr-8 text-small leading-tight">
            {series.map((s) => (
              <li key={s.name} className="flex items-center gap-10" style={{ color: s.color }}>
                <span aria-hidden className="inline-block h-[3px] w-40 rounded-full" style={{ background: s.color }} />
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
