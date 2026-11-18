import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ASCII_GLYPHS, glyphsFor, UNICODE_GLYPHS } from "../src/theme/glyphs.ts";
import { colorFor, TOKENS, type TokenName } from "../src/theme/tokens.ts";

const TOKEN_NAMES = [
  "focus",
  "running",
  "approval",
  "foreground",
  "muted",
  "failed",
  "passed",
  "blocked",
  "skipped",
] as const satisfies readonly TokenName[];

/** Compile-time coverage: a missing or extra key is a type error, not just a failed assertion. */
const EXPECTED = {
  focus: true,
  running: true,
  approval: true,
  foreground: true,
  muted: true,
  failed: true,
  passed: true,
  blocked: true,
  skipped: true,
} satisfies Record<TokenName, true>;

const GLYPH_KEYS = [
  "passed",
  "failed",
  "blocked",
  "running",
  "pending",
  "merged",
  "skipped",
  "focus",
  "arrow",
  "bullet",
  "approval",
] as const;

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
const HEX = /#[0-9a-fA-F]{6}/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

function hasSgr(text: string): boolean {
  return text.includes("\\x1b[") || text.includes("\\u001b[") || text.includes("\u001b[");
}

describe("brand tokens", () => {
  test("TOKENS covers every TokenName", () => {
    expect(Object.keys(TOKENS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test("each token has a hex, a 0-255 ansi256 and a 0-15 ansi16", () => {
    for (const name of TOKEN_NAMES) {
      const token = TOKENS[name];
      expect(token.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(Number.isInteger(token.ansi256)).toBe(true);
      expect(token.ansi256).toBeGreaterThanOrEqual(0);
      expect(token.ansi256).toBeLessThanOrEqual(255);
      expect(Number.isInteger(token.ansi16)).toBe(true);
      expect(token.ansi16).toBeGreaterThanOrEqual(0);
      expect(token.ansi16).toBeLessThanOrEqual(15);
    }
  });

  test("focus and running are lilac, approval is coral", () => {
    expect(TOKENS.focus.hex).toBe("#8E9BEA");
    expect(TOKENS.running.hex).toBe("#8E9BEA");
    expect(TOKENS.approval.hex).toBe("#E0714F");
    for (const name of TOKEN_NAMES) {
      if (name !== "approval") expect(TOKENS[name].hex).not.toBe("#E0714F");
    }
  });

  test("colorFor returns an escape per depth and undefined when colour is off", () => {
    for (const name of TOKEN_NAMES) {
      expect(colorFor(name, "none")).toBeUndefined();
      expect(typeof colorFor(name, "truecolor")).toBe("string");
      expect(typeof colorFor(name, "256")).toBe("string");
      expect(typeof colorFor(name, "16")).toBe("string");
    }
    expect(colorFor("focus", "truecolor")).toContain("142;155;234");
    expect(colorFor("focus", "16")).toBe("\u001b[94m");
    expect(colorFor("muted", "16")).toBe("\u001b[90m");
  });

  test("coral appears only at the gate", () => {
    for (const name of TOKEN_NAMES) {
      const truecolor = colorFor(name, "truecolor") ?? "";
      if (name === "approval") expect(truecolor).toContain("224;113;79");
      else expect(truecolor).not.toContain("224;113;79");
    }
    const offenders = sourceFiles(srcRoot).filter(
      (file) => relative(srcRoot, file) !== "theme/tokens.ts",
    );
    for (const file of offenders) expect(readFileSync(file, "utf8")).not.toContain("#E0714F");
  });
});

describe("one module owns the colours", () => {
  test("hex values and SGR sequences appear only in theme/tokens.ts", () => {
    const files = sourceFiles(srcRoot);
    const offenders: string[] = [];
    for (const file of files) {
      if (relative(srcRoot, file) === "theme/tokens.ts") continue;
      const text = readFileSync(file, "utf8");
      if (HEX.test(text) || hasSgr(text)) offenders.push(relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);

    const tokens = readFileSync(join(srcRoot, "theme/tokens.ts"), "utf8");
    expect(HEX.test(tokens)).toBe(true);
    expect(hasSgr(tokens)).toBe(true);
  });
});

describe("glyphs", () => {
  test("the unicode and ASCII sets cover every glyph", () => {
    for (const key of GLYPH_KEYS) {
      expect(UNICODE_GLYPHS[key].length).toBeGreaterThan(0);
      expect(ASCII_GLYPHS[key].length).toBeGreaterThan(0);
    }
    expect(glyphsFor(false)).toBe(UNICODE_GLYPHS);
    expect(glyphsFor(true)).toBe(ASCII_GLYPHS);
  });

  test("ASCII markers are single-width and the focus marker carries selection", () => {
    for (const glyph of Object.values(ASCII_GLYPHS)) {
      expect(glyph.length).toBe(1);
      const code = glyph.codePointAt(0) ?? 0;
      expect(code).toBeGreaterThanOrEqual(0x20);
      expect(code).toBeLessThanOrEqual(0x7e);
    }
    expect(UNICODE_GLYPHS.focus).toBe("›");
    expect(ASCII_GLYPHS.focus).toBe(">");
  });
});
