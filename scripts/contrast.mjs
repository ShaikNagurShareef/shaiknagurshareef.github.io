// WCAG contrast check for the design tokens (light and dark). Usage: node scripts/contrast.mjs
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../packages/tokens/tokens.css", import.meta.url), "utf8");
const block = (sel) => Object.fromEntries([...css.split(sel)[1].split("}")[0].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = block(":root {");
const dark = { ...light, ...block(':root[data-theme="dark"] {') };
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  ["ink", "bg", 4.5], ["ink-2", "bg", 4.5], ["muted", "bg", 4.5], ["muted", "surface-2", 4.5], ["accent-ink", "bg", 4.5],
  ["bg", "ink", 4.5], ["on-accent", "accent", 4.5], ["accent-ink", "accent-soft", 4.5], ["ok", "ok-soft", 4.5],
  ["info", "info-soft", 4.5], ["warn", "warn-soft", 4.5], ["border-strong", "bg", 1.5], ["focus", "bg", 3],
];
let fail = 0;
for (const [name, t] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${name.padEnd(5)} ${fg.padEnd(13)} on ${bg.padEnd(12)} ${r.toFixed(2).padStart(5)}:1 ${ok ? "ok" : `FAIL (< ${min})`}`);
  }
}
process.exit(fail ? 1 : 0);
