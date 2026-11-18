/**
 * The brand palette. This is the only module under `src` allowed to carry hex colours or SGR
 * escapes, so every view asks `colorFor` instead of writing an escape itself.
 *
 * failed, blocked and passed are deliberately not separate hues: they share the foreground and
 * muted values and let a glyph, a label and weight carry the state.
 */

export type TokenName =
  | "focus"
  | "running"
  | "approval"
  | "foreground"
  | "muted"
  | "failed"
  | "passed"
  | "blocked"
  | "skipped";

export type ColorDepth = "truecolor" | "256" | "16" | "none";

export interface Token {
  readonly hex: string;
  readonly ansi256: number;
  readonly ansi16: number;
}

export const TOKENS = {
  focus: { hex: "#8E9BEA", ansi256: 104, ansi16: 12 },
  running: { hex: "#8E9BEA", ansi256: 104, ansi16: 12 },
  approval: { hex: "#E0714F", ansi256: 167, ansi16: 9 },
  foreground: { hex: "#D4D4D4", ansi256: 188, ansi16: 7 },
  muted: { hex: "#8A8A8A", ansi256: 245, ansi16: 8 },
  failed: { hex: "#D4D4D4", ansi256: 188, ansi16: 7 },
  passed: { hex: "#D4D4D4", ansi256: 188, ansi16: 7 },
  blocked: { hex: "#8A8A8A", ansi256: 245, ansi16: 8 },
  skipped: { hex: "#8A8A8A", ansi256: 245, ansi16: 8 },
} as const satisfies Readonly<Record<TokenName, Token>>;

function rgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** The SGR foreground sequence for a token, or `undefined` when colour is off. */
export function colorFor(token: TokenName, depth: ColorDepth): string | undefined {
  if (depth === "none") return undefined;
  const value = TOKENS[token];
  switch (depth) {
    case "truecolor": {
      const [r, g, b] = rgb(value.hex);
      return `\x1b[38;2;${r};${g};${b}m`;
    }
    case "256":
      return `\x1b[38;5;${value.ansi256}m`;
    case "16":
      return value.ansi16 < 8 ? `\x1b[${30 + value.ansi16}m` : `\x1b[${90 + value.ansi16 - 8}m`;
    default: {
      const unhandled: never = depth;
      throw new Error(`unknown colour depth: ${String(unhandled)}`);
    }
  }
}
