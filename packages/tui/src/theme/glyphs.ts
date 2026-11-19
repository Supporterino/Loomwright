/**
 * Status glyphs. ASCII markers are single-width so an `--ascii` or `NO_COLOR` frame still reads;
 * the focus marker is what carries selection when colour is unavailable.
 */
import { isUtf8Locale, type TerminalEnv } from "./env.ts";

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

export interface GlyphOptions {
  readonly ascii: boolean;
  readonly env: TerminalEnv;
}

/**
 * ASCII when asked, on `TERM=dumb`, or when the locale is explicitly not UTF-8. The boolean form
 * stays for callers that only pass `--ascii`.
 */
export function glyphsFor(options: GlyphOptions | boolean): GlyphSet {
  if (typeof options === "boolean") return options ? ASCII_GLYPHS : UNICODE_GLYPHS;
  if (options.ascii || options.env.TERM === "dumb" || !isUtf8Locale(options.env)) {
    return ASCII_GLYPHS;
  }
  return UNICODE_GLYPHS;
}
