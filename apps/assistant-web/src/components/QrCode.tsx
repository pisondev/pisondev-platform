"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { Button } from "./ui";

const QUIET = 4; // modules of white border, required for reliable scanning

function matrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path for all dark modules, in module units, offset by the quiet zone. */
function pathOf(m: boolean[][]): string {
  let d = "";
  m.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`)));
  return d;
}

/** Draws the code on a canvas and saves it as a PNG, for printing or sending. */
function downloadPng(m: boolean[][], name: string) {
  const scale = 16;
  const size = (m.length + QUIET * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  m.forEach((row, r) => row.forEach((dark, c) => dark && ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale)));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

/** QR code of a short link, black on white whatever the page colors are. */
export function QrCode({ value, name }: { value: string; name: string }) {
  const m = useMemo(() => matrix(value), [value]);
  const size = m.length + QUIET * 2;
  return (
    <figure className="grid justify-items-center gap-16">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`QR code for ${value}`}
        shapeRendering="crispEdges"
        className="w-[max(140px,calc(var(--spacing)*340))] rounded-card bg-white"
      >
        <path d={pathOf(m)} fill="#000000" />
      </svg>
      <Button variant="text" onClick={() => downloadPng(m, `qr-${name}`)}>
        Download PNG
      </Button>
    </figure>
  );
}
