/**
 * The terminal environment the theme depends on. `NO_COLOR` is an opt-out even when it is empty,
 * and an unset locale is not evidence against UTF-8 (the narrow reading: only an explicit
 * non-UTF-8 locale switches the glyphs to ASCII).
 */
import type { ColorDepth } from "./tokens.ts";

export interface TerminalEnv {
  readonly TERM?: string | undefined;
  readonly COLORTERM?: string | undefined;
  readonly NO_COLOR?: string | undefined;
  readonly LANG?: string | undefined;
  readonly LC_ALL?: string | undefined;
  readonly LC_CTYPE?: string | undefined;
}

/** Copies only the variables the theme reads, so a `ProcessEnv` is accepted without a cast. */
export function terminalEnv(source: NodeJS.ProcessEnv | undefined): TerminalEnv {
  if (source === undefined) return {};
  return {
    ...(source.TERM === undefined ? {} : { TERM: source.TERM }),
    ...(source.COLORTERM === undefined ? {} : { COLORTERM: source.COLORTERM }),
    ...(source.NO_COLOR === undefined ? {} : { NO_COLOR: source.NO_COLOR }),
    ...(source.LANG === undefined ? {} : { LANG: source.LANG }),
    ...(source.LC_ALL === undefined ? {} : { LC_ALL: source.LC_ALL }),
    ...(source.LC_CTYPE === undefined ? {} : { LC_CTYPE: source.LC_CTYPE }),
  };
}

/** The first non-empty locale variable is the one the process actually uses. */
function localeOf(env: TerminalEnv): string | undefined {
  for (const value of [env.LC_ALL, env.LC_CTYPE, env.LANG]) {
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/** An unset locale is treated as UTF-8; `C`, `POSIX` and every other explicit value are not. */
export function isUtf8Locale(env: TerminalEnv): boolean {
  const locale = localeOf(env);
  if (locale === undefined) return true;
  return /utf-?8/i.test(locale);
}

export function detectColorDepth(env: TerminalEnv, isTTY: boolean): ColorDepth {
  if (!isTTY) return "none";
  if (env.NO_COLOR !== undefined) return "none";
  if (env.TERM === "dumb") return "none";
  const colorterm = env.COLORTERM;
  if (colorterm !== undefined && /truecolor|24bit/i.test(colorterm)) return "truecolor";
  const term = env.TERM;
  if (term !== undefined && /256color/i.test(term)) return "256";
  return "16";
}

export function wantsColor(env: TerminalEnv, isTTY: boolean): boolean {
  return detectColorDepth(env, isTTY) !== "none";
}
