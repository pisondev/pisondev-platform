"use client";

import { useId, useState } from "react";
import { QrCode } from "../QrCode";
import { Card, PageHeader, Panel } from "../ui";

// A version 40 code at level M holds 2331 bytes; stay well under it.
const MAX_BYTES = 2000;

const input =
  "w-full rounded-card border border-line bg-card px-24 py-16 text-body text-ink outline-none focus:border-green focus:ring-2 focus:ring-green/20 aria-invalid:border-maroon";

/** What the code will hold: a bare domain like "example.com/a" gets https:// so phones open it. */
function encoded(raw: string) {
  const v = raw.trim();
  // A scheme (https:, mailto:, tel:) is kept; "host:8080" is a port, not a scheme.
  if (!v || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v) ||/\s/.test(v) || !/^[^/]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(v)) return v;
  return `https://${v}`;
}

/** Name from the link's host; QrCode saves it as qr-<name>.png, e.g. qr-example-com.png. */
function fileName(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  } catch {
    return "code";
  }
}

/** Turns a link (or any short text) into a QR code, entirely in the browser. */
export function QrScreen() {
  const [raw, setRaw] = useState("");
  const id = useId();
  const value = encoded(raw);
  const tooLong = new TextEncoder().encode(value).length > MAX_BYTES;

  return (
    <>
      <PageHeader title="Link to QR" subtitle="Turn a link into a QR code" back="/" />

      <Panel className="mt-38">
        <label htmlFor={id} className="text-heading-green block px-10 pb-16 text-heading">
          Link
        </label>
        <input
          id={id}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="https://example.com"
          aria-invalid={tooLong || undefined}
          aria-describedby={`${id}-note`}
          className={input}
        />
        <p id={`${id}-note`} className={`px-10 pt-12 text-small ${tooLong ? "text-maroon" : "text-muted"}`}>
          {tooLong
            ? "Too long for a QR code. Shorten it first, for example in Links."
            : value && value !== raw.trim()
              ? `Encodes ${value}`
              : "Nothing leaves this page; the code is drawn in your browser."}
        </p>

        <Card className="mt-28 px-24 py-40">
          {value && !tooLong ? (
            <div className="motion-feedback">
              <QrCode value={value} name={fileName(value)} />
            </div>
          ) : (
            <p className="py-60 text-center text-body text-muted">Paste a link to see its QR code.</p>
          )}
        </Card>
      </Panel>
    </>
  );
}
