/** Plain text formatting for the view-model: no colour, no terminal access. */

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

/** Cuts text to `width` cells, ending in an ellipsis when anything was dropped. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}
