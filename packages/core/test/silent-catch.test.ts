import { describe, expect, test } from "bun:test";
import {
  type Dirent,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadUsage } from "../src/usage/usage.ts";

export interface Violation {
  file: string;
  line: number;
  text: string;
}

interface Token {
  readonly kind: "word" | "punct" | "string" | "template" | "regex" | "comment";
  readonly text: string;
  readonly start: number;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Tokens after which a `/` starts division instead of a regular expression. */
const VALUE_END = new Set([")", "]", "}", "++", "--"]);

/** Keywords whose expression still starts after them (so `/` can open a regex). */
const REGEX_PREFIX = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "else",
  "do",
  "instanceof",
  "yield",
  "await",
]);

function skipQuoted(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") i += 2;
    else if (src[i] === quote) return i + 1;
    else if (src[i] === "\n") return i;
    else i++;
  }
  return i;
}

function skipTemplate(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") i += 2;
    else if (src[i] === "`") return i + 1;
    else i++;
  }
  return i;
}

function skipRegex(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") i += 2;
    else if (ch === "[") {
      inClass = true;
      i++;
    } else if (ch === "]") {
      inClass = false;
      i++;
    } else if (ch === "/" && !inClass) {
      i++;
      while (i < src.length && /[a-z]/i.test(src[i] ?? "")) i++;
      return i;
    } else if (ch === "\n") return i;
    else i++;
  }
  return i;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let prev: Token | undefined;
  const push = (kind: Token["kind"], text: string, start: number): void => {
    const token: Token = { kind, text, start };
    tokens.push(token);
    if (kind !== "comment") prev = token;
  };
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i + 2);
      const stop = end === -1 ? src.length : end;
      push("comment", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push("comment", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = skipQuoted(src, i, ch);
      push("string", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (ch === "`") {
      const stop = skipTemplate(src, i);
      push("template", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    const regexAllowed =
      prev === undefined ||
      (prev.kind === "punct" && !VALUE_END.has(prev.text)) ||
      (prev.kind === "word" && REGEX_PREFIX.has(prev.text));
    if (ch === "/" && regexAllowed) {
      const stop = skipRegex(src, i);
      push("regex", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let stop = i + 1;
      while (stop < src.length && IDENT_PART.test(src[stop] ?? "")) stop++;
      push("word", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let stop = i + 1;
      while (stop < src.length && /[0-9A-Za-z_.]/.test(src[stop] ?? "")) stop++;
      push("word", src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if ((ch === "+" || ch === "-") && src[i + 1] === ch) {
      push("punct", `${ch}${ch}`, i);
      i += 2;
      continue;
    }
    push("punct", ch, i);
    i++;
  }
  return tokens;
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** Binding-less catches whose block does not open with a comment. */
export function scanSilentCatches(file: string, source: string): Violation[] {
  const tokens = tokenize(source);
  const violations: Violation[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token === undefined || token.kind !== "word" || token.text !== "catch") continue;
    let open = k + 1;
    while (tokens[open]?.kind === "comment") open++;
    const brace = tokens[open];
    if (brace === undefined || brace.kind !== "punct" || brace.text !== "{") continue;
    let depth = 0;
    let close = tokens.length;
    for (let m = open; m < tokens.length; m++) {
      const candidate = tokens[m];
      if (candidate?.kind !== "punct") continue;
      if (candidate.text === "{") depth++;
      else if (candidate.text === "}" && --depth === 0) {
        close = m;
        break;
      }
    }
    let first = open + 1;
    while (first < close && tokens[first]?.kind === "comment") first++;
    const documented = tokens
      .slice(open + 1, first)
      .some((candidate) => candidate.kind === "comment");
    if (documented) continue;
    const line = lineAt(source, token.start);
    violations.push({ file, line, text: source.split("\n")[line - 1]?.trim() ?? "" });
  }
  return violations;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("a silent catch states why the failure is ignored", () => {
  const root = join(import.meta.dir, "../../..");

  test("every silent catch carries a reason", () => {
    const sources: string[] = [];
    for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
      if (entry.isDirectory()) sourceFiles(join(root, "packages", entry.name, "src"), sources);
    }
    sourceFiles(join(root, "scripts"), sources);
    const violations = sources.flatMap((file) =>
      scanSilentCatches(relative(root, file), readFileSync(file, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  test("an unreasoned catch fails the scan", () => {
    expect(scanSilentCatches("fixture.ts", "try { work(); } catch { return undefined; }")).toEqual([
      {
        file: "fixture.ts",
        line: 1,
        text: "try { work(); } catch { return undefined; }",
      },
    ]);
  });

  test("a documented catch passes", () => {
    expect(
      scanSilentCatches("fixture.ts", "try { work(); } catch {\n  // Empty by design.\n}"),
    ).toEqual([]);
    expect(
      scanSilentCatches(
        "fixture.ts",
        "try { work(); } catch {\n  // Empty by design.\n  return undefined;\n}",
      ),
    ).toEqual([]);
  });

  test("a catch with a binding passes regardless", () => {
    expect(
      scanSilentCatches("fixture.ts", "try { work(); } catch (err) {\n  return err;\n}"),
    ).toEqual([]);
  });

  test("a deliberate fallback stays quiet", () => {
    const workspace = mkdtempSync(join(tmpdir(), "loomwright-silent-catch-"));
    try {
      mkdirSync(join(workspace, ".factory", "usage"), { recursive: true });
      writeFileSync(join(workspace, ".factory", "usage", "add-x.json"), "{not json");
      // The corrupt ledger reads as empty and the run continues; the catch says so in source.
      expect(loadUsage(workspace, "add-x").entries).toEqual([]);
      const usage = readFileSync(join(root, "packages/core/src/usage/usage.ts"), "utf8");
      expect(usage).toContain("A corrupt ledger reads as empty: usage never blocks a run");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
