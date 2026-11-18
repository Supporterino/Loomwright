/** Shared view helpers: colour lookup, separators and the status/phase glyph mapping. */
import type { Phase } from "@loomwright/protocol";
import type { GlyphSet } from "../theme/glyphs.ts";
import { type ColorDepth, TOKENS, type TokenName } from "../theme/tokens.ts";

/** Ink wants a colour string, not an SGR sequence; the token module stays the only palette. */
export function inkColor(token: TokenName, depth: ColorDepth): string | undefined {
  return depth === "none" ? undefined : TOKENS[token].hex;
}

/** Spread onto `Text`/`Box`: `exactOptionalPropertyTypes` forbids passing `color: undefined`. */
export function colorProps(token: TokenName, depth: ColorDepth): { readonly color?: string } {
  const color = inkColor(token, depth);
  return color === undefined ? {} : { color };
}

export function joinFields(glyphs: GlyphSet, fields: readonly string[]): string {
  return fields.join(` ${glyphs.bullet} `);
}

export function statusGlyph(status: string, glyphs: GlyphSet): string {
  switch (status) {
    case "merged":
    case "pass":
    case "passed":
      return glyphs.passed;
    case "failed":
    case "fail":
    case "timeout":
      return glyphs.failed;
    case "blocked":
    case "cancelled":
    case "missing":
    case "not-check-only":
      return glyphs.blocked;
    case "skipped":
      return glyphs.skipped;
    case "running":
    case "merging":
      return glyphs.running;
    default:
      return glyphs.pending;
  }
}

export function statusToken(status: string): TokenName {
  switch (status) {
    case "merged":
    case "pass":
    case "passed":
      return "passed";
    case "failed":
    case "fail":
    case "timeout":
      return "failed";
    case "blocked":
    case "cancelled":
    case "missing":
    case "not-check-only":
      return "blocked";
    case "skipped":
      return "skipped";
    case "running":
    case "merging":
      return "running";
    default:
      return "muted";
  }
}

export function phaseGlyph(phase: Phase, glyphs: GlyphSet): string {
  switch (phase) {
    case "done":
      return glyphs.passed;
    case "aborted":
      return glyphs.failed;
    case "paused":
    case "awaiting-approval":
      return glyphs.blocked;
    default:
      return glyphs.running;
  }
}

export function phaseToken(phase: Phase): TokenName {
  switch (phase) {
    case "done":
      return "passed";
    case "aborted":
      return "failed";
    case "paused":
    case "awaiting-approval":
      return "muted";
    default:
      return "running";
  }
}
