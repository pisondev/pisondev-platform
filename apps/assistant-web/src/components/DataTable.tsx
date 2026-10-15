import type { CSSProperties, ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: string;
  width: number; // relative share of the row, like the column widths in Figma
  align?: "left" | "center";
  cell: (row: T, index: number) => ReactNode;
  className?: (row: T, index: number) => string;
};

/**
 * Table card from the design: grey header with a dark rule, light row rules, and a
 * scroll area showing `visibleRows` rows at a time.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  size = "body",
  visibleRows = 3,
  empty = "Nothing yet.",
  rowClassName,
  rowStyle,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  size?: "body" | "small";
  visibleRows?: number;
  empty?: string;
  rowClassName?: (row: T, index: number) => string;
  rowStyle?: (row: T, index: number) => CSSProperties;
}) {
  const template = columns.map((c) => `${c.width}fr`).join(" ");
  const rowHeight = size === "body" ? "max(calc(var(--spacing) * 64), 32px)" : "max(calc(var(--spacing) * 61), 28px)";
  const text = size === "body" ? "text-body" : "text-small";
  const grid: CSSProperties = { gridTemplateColumns: template };

  return (
    <div className={`px-18 pb-18 ${text}`}>
      <div className="grid items-center gap-x-12 border-b-[max(1.5px,calc(var(--spacing)*3))] border-muted px-6 pt-8 pb-6 text-muted" style={grid}>
        {columns.map((c) => (
          <span key={c.key} className={c.align === "center" ? "text-center" : ""}>
            {c.label}
          </span>
        ))}
      </div>
      <div className="scroll-thin overflow-y-auto pr-12" style={{ maxHeight: `calc(${visibleRows} * ${rowHeight})` }}>
        {rows.length === 0 ? (
          <p className="px-6 text-muted" style={{ lineHeight: rowHeight }}>
            {empty}
          </p>
        ) : (
          rows.map((row, i) => (
            <div
              key={rowKey(row, i)}
              className={`grid items-center gap-x-12 border-b border-line px-6 last:border-b-0 ${rowClassName?.(row, i) ?? ""}`}
              style={{ ...grid, minHeight: rowHeight, ...rowStyle?.(row, i) }}
            >
              {columns.map((c) => (
                <span
                  key={c.key}
                  className={`min-w-0 truncate ${c.align === "center" ? "text-center" : ""} ${c.className?.(row, i) ?? ""}`}
                >
                  {c.cell(row, i)}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
