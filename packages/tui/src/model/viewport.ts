/**
 * Pure scroll arithmetic shared by every scrolling region. The callers own the state; these
 * functions only clamp, slice and describe a window so views can render rows instead of relying on
 * Ink's `height`/`overflowY`.
 */

/** One scrolling region as the caller sees it: how many rows it has and which row starts it. */
export interface Window {
  readonly offset: number;
  readonly size: number;
  readonly total: number;
}

/** `[0, max(0, length - size)]`; a zero-size or empty region is always 0. */
export function clampOffset(offset: number, length: number, size: number): number {
  if (size <= 0 || length <= 0) return 0;
  return Math.min(Math.max(0, length - size), Math.max(0, offset));
}

/** The visible slice bounds: `start = offset`, `end = min(length, offset + size)`. */
export function window(offset: number, length: number, size: number): Window {
  return { offset, size, total: length };
}

/** The rows to render: `lines.slice(start, end)`. */
export function sliceWindow<T>(items: readonly T[], w: Window): readonly T[] {
  return items.slice(w.offset, Math.min(w.total, w.offset + w.size));
}

/** A page is the viewport height, at least one row. */
export function pageSize(size: number): number {
  return Math.max(1, size);
}

export function moveBy(offset: number, delta: number, length: number, size: number): number {
  return clampOffset(offset + delta, length, size);
}

export function firstOffset(length: number): number {
  return clampOffset(0, length, length);
}

export function lastOffset(length: number, size: number): number {
  return clampOffset(length - size, length, size);
}

/**
 * Clamps around the selected row: after a data change or resize the offset is the smallest move
 * that puts `index` inside `[offset, offset + size)`.
 */
export function nextOffset(offset: number, index: number, length: number, size: number): number {
  if (size <= 0 || length <= 0) return 0;
  const current = clampOffset(offset, length, size);
  if (index < current) return clampOffset(index, length, size);
  if (index >= current + size) return clampOffset(index - size + 1, length, size);
  return current;
}

/** Follow pins to the newest row; when off, the offset is only clamped and data arrival never moves it. */
export function followOffset(offset: number, length: number, size: number, follow = true): number {
  return follow ? lastOffset(length, size) : clampOffset(offset, length, size);
}

/** `runs 3-9/12`, or null when `total <= size` (the title only names a window when one exists). */
export function windowTitle(label: string, w: Window): string | null {
  if (w.total <= w.size) return null;
  const start = w.offset + 1;
  const end = Math.min(w.total, w.offset + w.size);
  return `${label} ${start}-${end}/${w.total}`;
}
