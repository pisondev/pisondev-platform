import type { ReactNode } from "react";

// ",65" in "Rp416.551,65" or "-Rp416.551,65*": the sen and anything after them.
const SEN = /^(.*?\d)(,\d{2})(\D*)$/;

/**
 * Shows a formatted rupiah text with its sen raised and smaller ("Rp416.551" + ",65"),
 * so the whole rupiah read first. Plain text stays as it is. Screen readers get the
 * text unchanged; use the plain `rupiah()` string wherever text is needed (labels,
 * messages, aria attributes).
 */
export function SenText({ text }: { text: ReactNode }) {
  if (typeof text !== "string") return <>{text}</>;
  const m = SEN.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <sup className="sen">{m[2]}</sup>
      {m[3]}
    </>
  );
}

/** The same split for text painted outside React (AnimatedMoney). */
export function paintSen(node: HTMLElement, text: string) {
  const m = SEN.exec(text);
  if (!m) return node.replaceChildren(text);
  const sup = document.createElement("sup");
  sup.className = "sen";
  sup.textContent = m[2];
  node.replaceChildren(m[1], sup, m[3]);
}
