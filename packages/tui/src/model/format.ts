/** Plain text formatting for the view-model: no colour, no terminal access. */
import { stripControls } from "@loomwright/core/util/controls";
import type { GlyphSet } from "../theme/glyphs.ts";

export { stripControls };

/** `1h02m`, `3m12s`, `8s`; negative or invalid spans read as zero. */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Token counts for dense rows: `999`, `12.3k`, `1.2M`. */
export function formatTokensShort(n: number): string {
  const value = Math.max(0, n);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** A rounded whole percentage; an empty total reads as `0%`. */
export function formatPercent(part: number, whole: number): string {
  if (!(whole > 0)) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * Readable text stays one line and carries no terminal controls: a payload's newlines never split
 * a row, and its escape sequences never reach the terminal.
 */
export function flat(text: string): string {
  return stripControls(text)
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * Cuts text to `width` cells, ending in the frame's ellipsis when anything was dropped. Ink's own
 * truncation is always `…`, so the mark follows the glyph set to keep an ASCII frame printable.
 */
export function truncate(text: string, width: number, glyphs: GlyphSet): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  const mark = glyphs.bullet === "-" ? "..." : "…";
  if (width <= mark.length) return mark.slice(0, width);
  return `${text.slice(0, width - mark.length)}${mark}`;
}
