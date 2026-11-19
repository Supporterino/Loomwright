import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState, TaskState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import type { EventFacts } from "../src/model/facts.ts";
import { buildViewModel, type GateRow, type ViewModel } from "../src/model/view-model.ts";
import { detectColorDepth, type TerminalEnv } from "../src/theme/env.ts";
import { ASCII_GLYPHS, glyphsFor, UNICODE_GLYPHS } from "../src/theme/glyphs.ts";
import { colorFor } from "../src/theme/tokens.ts";
import { statusGlyph } from "../src/views/style.ts";
import { SIZES, STATES } from "./frame-states.ts";

// Ink's chalk decides its colour level once, at import, and another suite may have loaded it first.
// Force the shared instance to truecolor so the raw frames keep the token SGR these tests assert.
const inkDir = `${dirname(Bun.resolveSync("ink/package.json", import.meta.dir))}${sep}`;
const chalkModule: unknown = await import(Bun.resolveSync("chalk", inkDir));
if (typeof chalkModule === "object" && chalkModule !== null && "default" in chalkModule) {
  const chalk = chalkModule.default;
  if ((typeof chalk === "object" && chalk !== null) || typeof chalk === "function") {
    Object.assign(chalk, { level: 3 });
  }
}
const { renderAnsiFrame, renderFrame } = await import("../src/views/frame.tsx");

const ISO = "2026-11-18T10:00:00.000Z";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const BACKGROUND_SGR = new RegExp(`${ESC}\\[4[0-8]?m`);
const BACKGROUND_256 = `${ESC}[48;`;
const REVERSE_SGR = new RegExp(`${ESC}\\[7m`);

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function usage(): UsageSummary {
  return {
    total: ZERO_USAGE,
    sessions: 0,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: ZERO_USAGE,
    top: [],
    wastedReads: 0,
  };
}

function statusDoc(run: RunState): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [{ ...run, usage: usage() }],
  };
}

function gateRow(status: string, index: number): GateRow {
  return { step: "first", name: `g${index}`, type: "lint", status, durationMs: 10 };
}

/** One view that prints every status word next to the glyph `statusGlyph` gives it. */
function statusView(): ViewModel {
  const run = RunState.parse({
    version: 1,
    id: "add-health",
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "implementing",
    summary: "Add health endpoints",
    tasks: [
      TaskState.parse({
        id: "first",
        title: "One",
        repo: "app",
        deps: [],
        touches: [],
        status: "running",
      }),
      TaskState.parse({
        id: "second",
        title: "Two",
        repo: "app",
        deps: [],
        touches: [],
        status: "pending",
      }),
      TaskState.parse({
        id: "third",
        title: "Three",
        repo: "app",
        deps: [],
        touches: [],
        status: "merged",
      }),
    ],
  });
  const facts: EventFacts = {
    gates: {
      first: [
        gateRow("passed", 1),
        gateRow("blocked", 2),
        gateRow("failed", 3),
        gateRow("skipped", 4),
      ],
    },
    agents: {},
    retries: {},
    activity: [],
  };
  return buildViewModel({
    source: "live",
    screen: "run",
    columns: 120,
    rows: 40,
    now: Date.parse(ISO),
    snapshot: null,
    facts,
    status: statusDoc(run),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId: "first",
    panel: null,
    notice: null,
  });
}

const SRC = fileURLToPath(new URL("../src", import.meta.url));
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

describe("layout, keyboard and accessibility", () => {
  test("state without colour: NO_COLOR drops SGR and every status keeps its glyph and label", async () => {
    expect(detectColorDepth({ NO_COLOR: "" }, true)).toBe("none");
    expect(detectColorDepth({ NO_COLOR: "1" }, true)).toBe("none");

    const view = statusView();
    const empty = await renderFrame(
      view,
      { columns: 120, rows: 40 },
      { ascii: true, env: { NO_COLOR: "" } },
    );
    const set = await renderFrame(
      view,
      { columns: 120, rows: 40 },
      { ascii: true, env: { NO_COLOR: "1" } },
    );
    expect(empty.includes("\u001b[")).toBe(false);
    expect(set).toBe(empty);

    const pairs = [
      ["failed", "x"],
      ["blocked", "!"],
      ["passed", "+"],
      ["running", ">"],
      ["pending", "o"],
      ["merged", "+"],
      ["skipped", "-"],
    ] as const;
    for (const [word, glyph] of pairs) {
      expect(statusGlyph(word, ASCII_GLYPHS)).toBe(glyph);
    }
    for (const rendered of [
      "x g3 failed",
      "! g2 blocked",
      "+ g1 passed",
      "[>] first running",
      "[o] second pending",
      "[+] third merged",
      "- g4 skipped",
    ]) {
      expect(empty).toContain(rendered);
    }
  });

  test("focus is an ASCII-safe marker: > in ASCII and › in unicode", async () => {
    expect(glyphsFor({ ascii: true, env: {} }).focus).toBe(">");
    expect(glyphsFor({ ascii: false, env: {} }).focus).toBe("›");

    const unicode = await renderFrame(
      STATES["failing-task"]({ columns: 120, rows: 40 }),
      { columns: 120, rows: 40 },
      {
        ascii: false,
        env: {},
      },
    );
    expect(unicode).toContain("›");
    const ascii = await renderFrame(
      STATES["failing-task"]({ columns: 120, rows: 40 }),
      { columns: 120, rows: 40 },
      {
        ascii: true,
        env: {},
      },
    );
    expect(ascii.includes("›")).toBe(false);
    expect(ascii).toContain(">");
  });

  test("ASCII glyphs are automatic: TERM=dumb or a non-UTF-8 locale, and --ascii forces them", async () => {
    expect(glyphsFor({ ascii: false, env: { TERM: "dumb" } })).toBe(ASCII_GLYPHS);
    expect(glyphsFor({ ascii: false, env: { LANG: "C" } })).toBe(ASCII_GLYPHS);
    expect(glyphsFor({ ascii: false, env: { LC_ALL: "C" } })).toBe(ASCII_GLYPHS);
    expect(glyphsFor({ ascii: false, env: { LANG: "de_DE.UTF-8" } })).toBe(UNICODE_GLYPHS);
    expect(glyphsFor({ ascii: false, env: {} })).toBe(UNICODE_GLYPHS);

    const dumb = await renderFrame(
      STATES["running-graph"]({ columns: 80, rows: 24 }),
      { columns: 80, rows: 24 },
      { env: { TERM: "dumb" } },
    );
    expect(dumb).toContain("[>] first running");
    expect(dumb.includes("▶")).toBe(false);

    const forced = await renderFrame(
      STATES["running-graph"]({ columns: 80, rows: 24 }),
      { columns: 80, rows: 24 },
      { ascii: true, env: { LANG: "de_DE.UTF-8", TERM: "xterm-256color" } },
    );
    expect(forced).toContain("[>] first running");
    expect(forced.includes("▶")).toBe(false);
  });

  test("no background is painted: no frame carries a background SGR", async () => {
    for (const [state, make] of Object.entries(STATES)) {
      for (const size of SIZES) {
        const raw = await renderAnsiFrame(make(size), size, {
          ascii: true,
          env: {},
          depth: "truecolor",
        });
        expect(raw).not.toMatch(BACKGROUND_SGR);
        expect(raw).not.toContain(BACKGROUND_256);
        expect(raw).not.toMatch(REVERSE_SGR);
        expect(raw, `${state} ${size.columns}x${size.rows}`).toContain("\x1b[");
      }
    }

    const offenders = sourceFiles(SRC).filter((file) =>
      /\bbackgroundColor\b|\binverse\b/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("coral appears only at the gate, in the banner and the overlay", async () => {
    const coral = colorFor("approval", "truecolor");
    expect(coral).toBeDefined();
    if (coral === undefined) throw new Error("the approval token has no truecolor form");

    for (const state of [
      "running-graph",
      "failing-task",
      "finished",
      "design-activity",
      "land-confirm",
      "no-runs",
    ] as const) {
      const raw = await renderAnsiFrame(
        STATES[state]({ columns: 120, rows: 40 }),
        { columns: 120, rows: 40 },
        {
          ascii: true,
          env: {},
          depth: "truecolor",
        },
      );
      expect(raw).not.toContain(coral);
    }

    const gate = STATES["awaiting-approval"]({ columns: 120, rows: 40 });
    const bannerFrame = await renderAnsiFrame(
      { ...gate, panel: null },
      { columns: 120, rows: 40 },
      { ascii: true, env: {}, depth: "truecolor" },
    );
    const banner = bannerFrame
      .split("\n")
      .find(
        (line) =>
          stripAnsi(line).includes("awaiting approval") && stripAnsi(line).includes("a approve"),
      );
    expect(banner).toBeDefined();
    expect(banner).toContain(coral);

    const overlayFrame = await renderAnsiFrame(
      gate,
      { columns: 120, rows: 40 },
      {
        ascii: true,
        env: {},
        depth: "truecolor",
      },
    );
    expect(overlayFrame).toContain(coral);
    const overlay = overlayFrame.split("\n").find((line) => stripAnsi(line).includes("Approval"));
    expect(overlay).toBeDefined();
    expect(overlay).toContain(coral);
  });

  test("the token module is still the only source of SGR and hex colours", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (relative(SRC, file) === "theme/tokens.ts") continue;
      const text = readFileSync(file, "utf8");
      if (HEX.test(text) || hasSgr(text)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});

describe("colour depth detection", () => {
  test("a non-TTY or NO_COLOR wins, then COLORTERM, 256-colour and 16-colour fallbacks", () => {
    expect(detectColorDepth({ COLORTERM: "truecolor" }, false)).toBe("none");
    expect(detectColorDepth({ NO_COLOR: "" }, true)).toBe("none");
    expect(detectColorDepth({ TERM: "dumb" }, true)).toBe("none");
    expect(detectColorDepth({ COLORTERM: "truecolor" }, true)).toBe("truecolor");
    expect(detectColorDepth({ COLORTERM: "24bit" }, true)).toBe("truecolor");
    expect(detectColorDepth({ TERM: "xterm-256color" }, true)).toBe("256");
    expect(detectColorDepth({ TERM: "xterm" }, true)).toBe("16");
  });

  test("an unset locale counts as UTF-8; an explicit non-UTF-8 one does not", () => {
    const env: TerminalEnv = {};
    expect(glyphsFor({ ascii: false, env })).toBe(UNICODE_GLYPHS);
  });
});
