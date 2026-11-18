/**
 * Status glyphs. ASCII markers are single-width so a `--ascii` or `NO_COLOR` frame still reads;
 * the focus marker is what carries selection when colour is unavailable.
 */

export interface GlyphSet {
  readonly passed: string;
  readonly failed: string;
  readonly blocked: string;
  readonly running: string;
  readonly pending: string;
  readonly merged: string;
  readonly skipped: string;
  readonly focus: string;
  readonly arrow: string;
  readonly bullet: string;
  readonly approval: string;
}

export const UNICODE_GLYPHS: GlyphSet = {
  passed: "✔",
  failed: "✖",
  blocked: "▲",
  running: "▶",
  pending: "○",
  merged: "●",
  skipped: "–",
  focus: "›",
  arrow: "→",
  bullet: "•",
  approval: "!",
};

export const ASCII_GLYPHS: GlyphSet = {
  passed: "+",
  failed: "x",
  blocked: "!",
  running: ">",
  pending: "o",
  merged: "*",
  skipped: "-",
  focus: ">",
  arrow: ">",
  bullet: "-",
  approval: "!",
};

export function glyphsFor(ascii: boolean): GlyphSet {
  return ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
}
