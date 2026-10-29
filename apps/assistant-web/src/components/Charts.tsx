import type { CSSProperties, ReactNode } from "react";
import { rupiah } from "@/lib/format";
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
        <circle cx={38} cy={93} r={4} fill="#787878" />
        <circle cx={38} cy={207} r={4} fill="#787878" />
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
// Savings: Target vs Now with the gap marked (card 847 x 496).

export function SavingsChart({ target, now }: { target: number; now: number }) {
  const VW = 847, VH = 496, AX = 162, BOTTOM = 435, TOP = 94;
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
        <line x1={AX} y1={tTop} x2={430} y2={tTop} stroke="#c0c0c0" strokeWidth={1.5} />
        <line x1={AX} y1={nTop} x2={430} y2={nTop} stroke="#c0c0c0" strokeWidth={1.5} />
        <Axes x={AX} top={16} bottom={BOTTOM} right={440} />
        <circle cx={AX - 2} cy={tTop} r={4} fill="#787878" />
        <circle cx={AX - 2} cy={nTop} r={4} fill="#787878" />
        <ChartMarks signature={`${target}:${now}`}>
          <path className="motion-bar" style={{ transformOrigin: `0px ${BOTTOM}px` }} d={barPath(192, tTop, 87, BOTTOM - tTop, 25)} fill="url(#sv-target)" />
          <path className="motion-bar" style={{ transformOrigin: `0px ${BOTTOM}px`, animationDelay: "60ms" }} d={barPath(324, nTop, 87, BOTTOM - nTop, 25)} fill="url(#sv-now)" />
        </ChartMarks>
        {lo - hi > 2 ? (
          <line x1={430} y1={hi} x2={430} y2={lo} stroke={gap > 0 ? "#810f0f" : "#165d23"} strokeWidth={1.5} strokeDasharray="6 5" />
        ) : null}
      </svg>
      <Label x={0} y={tLabel - 22} w={AX - 10} h={44} vw={VW} vh={VH} className="justify-end text-blue">
        {rupiah(target)}
      </Label>
      <Label x={0} y={nLabel - 22} w={AX - 10} h={44} vw={VW} vh={VH} className="justify-end text-green">
        {rupiah(now)}
      </Label>
      {lo - hi > 2 ? (
        <Label x={440} y={(hi + lo) / 2 - 22} w={240} h={44} vw={VW} vh={VH} className={`justify-start ${gap > 0 ? "text-maroon" : "text-green"}`}>
          {gap > 0 ? rupiah(gap) : `+${rupiah(-gap)}`}
        </Label>
      ) : null}
      <Label x={172} y={BOTTOM + 10} w={128} h={44} vw={VW} vh={VH} className="text-blue">
        Target
      </Label>
      <Label x={304} y={BOTTOM + 10} w={128} h={44} vw={VW} vh={VH} className="text-green">
        Now
      </Label>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cash flow: one value per period with drop lines (card 847 x 496).

export function CashflowChart({ points, toggle }: { points: { label: string; value: number }[]; toggle: ReactNode }) {
  const VW = 847, VH = 496, AX = 40, BOTTOM = 508, TOP = 175, RIGHT = 770;
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const y = (v: number) => BOTTOM - 8 - ((v - lo) / span) * (BOTTOM - 8 - TOP);
  const step = points.length > 1 ? (RIGHT - 60 - (AX + 76)) / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? AX + 76 + step * i : (AX + RIGHT) / 2);
  const every = Math.max(1, Math.ceil(points.length / 6)); // keep labels from crowding
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VW} ${VH + 50}`} className="block w-full" role="img" aria-label="Cash flow chart">
        <Axes x={AX} top={89} bottom={BOTTOM} right={RIGHT} />
        {lo < 0 ? <line x1={AX} y1={y(0)} x2={RIGHT} y2={y(0)} stroke="#c0c0c0" strokeWidth={1.5} /> : null}
        <circle cx={AX - 2} cy={y(hi)} r={4} fill="#787878" />
        <ChartMarks signature={JSON.stringify(points)}>
          <g className="motion-chart-detail">
            {points.map((p, i) => (
              <line key={`d-${p.label}`} x1={x(i)} y1={y(p.value)} x2={x(i)} y2={BOTTOM} stroke="#787878" strokeWidth={1} strokeDasharray="5 5" />
            ))}
          </g>
          {points.length > 1 ? <path className="motion-line" pathLength={1} d={line} fill="none" stroke="#298352" strokeWidth={3} strokeLinejoin="round" /> : null}
          <g className="motion-chart-detail">
            {points.map((p, i) => (
              <circle key={`p-${p.label}`} cx={x(i)} cy={y(p.value)} r={points.length > 1 ? 4 : 7} fill="#298352" />
            ))}
          </g>
        </ChartMarks>
      </svg>
      {points.map((p, i) =>
        i % every === 0 || i === points.length - 1 ? (
          <Label key={`l${i}`} x={x(i) - 70} y={BOTTOM + 6} w={140} h={44} vw={VW} vh={VH + 50} className="text-ink">
            {p.label}
          </Label>
        ) : null,
      )}
      {points.length === 0 ? (
        <Label x={AX} y={280} w={RIGHT - AX} h={60} vw={VW} vh={VH + 50} className="text-muted">
          No transactions yet.
        </Label>
      ) : null}
      <div className="absolute top-[3%] right-[3%]">{toggle}</div>
    </div>
  );
}
