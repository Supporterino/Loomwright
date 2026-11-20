import { describe, expect, test } from "bun:test";
import type { StatusDocument } from "@loomwright/core/factory";
import type { ActiveLock } from "@loomwright/core/state/active";
import { RunState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import {
  initialReword,
  openReword,
  REWORD_PROMPT_REQUIRED,
  type RewordState,
  rewordArgvLine,
  rewordKeys,
  rewordPanel,
} from "../src/controls/reword.ts";
import { REPLAY_READ_ONLY, replayKey } from "../src/entry.tsx";
import { actionArgs } from "../src/launch/launcher.ts";
import { collectFacts } from "../src/model/facts.ts";
import type { KeyInput } from "../src/model/keys.ts";
import {
  buildViewModel,
  type RunDetail,
  type ViewModel,
  type ViewModelInput,
} from "../src/model/view-model.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";

const ISO = "2026-11-18T10:00:00.000Z";
const RUN = "add-health";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

function usageSummary(): UsageSummary {
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

function statusDoc(
  run: RunState,
  extras: { readonly active?: ActiveLock | null; readonly driverAlive?: boolean } = {},
): StatusDocument {
  const active = extras.active ?? null;
  return {
    active,
    driverAlive: extras.driverAlive ?? active !== null,
    queue: [],
    corrupt: [],
    runs: [{ ...run, usage: usageSummary() }],
  };
}

function runState(overrides: Record<string, unknown> = {}): RunState {
  return RunState.parse({
    version: 1,
    id: RUN,
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "paused",
    summary: "Add health endpoints",
    ...overrides,
  });
}

function viewInput(
  run: RunState,
  extras: {
    readonly active?: ActiveLock | null;
    readonly driverAlive?: boolean;
    readonly source?: "live" | "replay";
  } = {},
): ViewModelInput {
  return {
    source: extras.source ?? "live",
    screen: "run",
    columns: 80,
    rows: 24,
    now: Date.parse(ISO),
    snapshot: null,
    facts: collectFacts([]),
    status: statusDoc(run, extras),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId: null,
    panel: null,
    notice: null,
  };
}

function runView(
  overrides: Record<string, unknown> = {},
  extras: {
    readonly active?: ActiveLock | null;
    readonly driverAlive?: boolean;
    readonly source?: "live" | "replay";
  } = {},
): ViewModel {
  return buildViewModel(viewInput(runState(overrides), extras));
}

function detail(
  overrides: Record<string, unknown> = {},
  extras: { readonly active?: ActiveLock | null; readonly driverAlive?: boolean } = {},
): RunDetail {
  const view = runView(overrides, extras);
  if (view.run === null) throw new Error("the fixture has no run detail");
  return view.run;
}

function opening(overrides: Record<string, unknown> = {}): RewordState {
  const state = openReword(detail(overrides));
  if (state === null) throw new Error("the reword panel did not open");
  return state;
}

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    ctrl: false,
    shift: false,
    meta: false,
    pageUp: false,
    pageDown: false,
    delete: false,
    backspace: false,
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: "must",
    what: "does the thing",
    problem: "the thing breaks",
    fix: "fix the thing",
    impact: "the thing stays broken",
    ...overrides,
  };
}

function typeText(
  run: RunDetail,
  state: RewordState,
  text: string,
  rows = 24,
  columns = 80,
): RewordState {
  let current = state;
  for (const character of text) {
    current = rewordKeys(run, current, character, key(), rows, columns).state;
  }
  return current;
}

function panel(
  run: RunDetail,
  state: RewordState,
  rows = 24,
  columns = 80,
): ReturnType<typeof rewordPanel> {
  return rewordPanel({ run, state, glyphs: ASCII_GLYPHS, rows, columns });
}

function findingBlocks(lines: readonly string[]): string[] {
  return lines.filter((line) => /^\d+\. /u.test(line));
}

describe("the findings panel lists every finding in order", () => {
  const findings = [
    {
      severity: "must",
      file: "src/app.ts",
      line: 42,
      what: "does one",
      problem: "one",
      fix: "fix one",
      impact: "one breaks",
    },
    {
      severity: "should",
      file: "src/b.ts",
      line: 7,
      what: "does two",
      problem: "two",
      fix: "fix two",
      impact: "two breaks",
    },
    {
      severity: "nice",
      file: "src/c.ts",
      line: 9,
      what: "does three",
      problem: "three",
      fix: "fix three",
      impact: "three breaks",
    },
  ];

  test("the findings panel lists every finding in order", () => {
    const run = detail({ specFindings: findings });
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const lines = panel(run, state).lines;
    expect(findingBlocks(lines)).toEqual([
      "1. must  src/app.ts:42",
      "2. should  src/b.ts:7",
      "3. nice  src/c.ts:9",
    ]);

    const text = lines.join("\n");
    for (const [index, entry] of findings.entries()) {
      expect(text).toContain(`${index + 1}. ${entry.severity ?? ""}  ${entry.file}:${entry.line}`);
      expect(text).toContain(`   problem: ${entry.problem}`);
      expect(text).toContain(`   fix: ${entry.fix}`);
    }
    expect(text.indexOf("1. must")).toBeLessThan(text.indexOf("2. should"));
    expect(text.indexOf("2. should")).toBeLessThan(text.indexOf("3. nice"));
    // Run-state order is the 1-based order `reword --finding 1` uses.
    expect(run.specFindings[0]?.problem).toBe("one");
  });

  test("a finding without a file or line omits both, never printing null", () => {
    const run = detail({ specFindings: [finding({ severity: "nice" })] });
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const lines = panel(run, state).lines;
    expect(lines[0]).toBe("1. nice");
    expect(lines.join("\n")).not.toContain("null");
  });

  test("a line without a file is omitted rather than printed as :42", () => {
    const run = detail({ specFindings: [finding({ file: undefined, line: 42 })] });
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const lines = panel(run, state).lines;
    expect(lines[0]).toBe("1. must");
    expect(lines[0]).not.toContain(":42");
  });
});

describe("a long problem scrolls instead of being cut", () => {
  const problem = Array.from(
    { length: 20 },
    (_, index) => `block${String(index).padStart(2, "0")}-${"x".repeat(12)}`,
  ).join("");

  test("a long problem scrolls instead of being cut", () => {
    expect(problem).toHaveLength(400);
    const run = detail({
      specFindings: [
        finding({ file: "src/a.ts", line: 1, problem: "short", fix: "fix one" }),
        finding({ file: "src/b.ts", line: 2, problem, fix: "fix two" }),
        finding({ file: "src/c.ts", line: 3, problem: "short", fix: "fix three" }),
      ],
    });
    const opened = openReword(run);
    if (opened === null) throw new Error("the reword panel did not open");
    let state: RewordState = opened;

    const found = new Map<number, string>();
    for (;;) {
      const view = panel(run, state);
      for (const line of view.lines) {
        const segment = line.startsWith("   problem: ")
          ? line.slice("   problem: ".length)
          : /^ {12}\S/u.test(line)
            ? line.slice(12)
            : null;
        if (segment === null) continue;
        // Only finding 2's problem lines are exact slices of the long problem.
        const at = problem.indexOf(segment);
        if (at !== -1) found.set(at, segment);
      }
      // The panel's own keys row is never inside the scrolling body.
      expect(view.keys.some((hint) => hint.key === "Esc")).toBe(true);
      expect(view.lines.length).toBeLessThanOrEqual(24);
      const next: RewordState = rewordKeys(run, state, "", key({ pageDown: true }), 24, 80).state;
      if (next.offset === state.offset) break;
      state = next;
    }

    // Walk the window at 24 rows; every emitted line is a whole chunk of the problem.
    const assembled = [...found.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, segment]) => segment)
      .join("");
    expect(assembled).toBe(problem);
    for (let at = 0; at < problem.length; at += 20) {
      expect(assembled.slice(at, at + 20)).toBe(problem.slice(at, at + 20));
    }
  });
});

describe("w opens the reword panel with findings", () => {
  test("w opens the reword panel with findings", () => {
    const run = detail({
      specFindings: [finding({ problem: "first" }), finding({ severity: "should" })],
    });
    expect(run.reword).toEqual({ state: "available", reason: null });
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");

    const view = panel(run, state);
    expect(view.kind).toBe("reword");
    expect(view.title).toContain(RUN);
    expect(findingBlocks(view.lines)).toHaveLength(2);
    expect(state.text).toBe("");
    expect(view.lines.join("\n")).toContain(`reword ${RUN} --prompt <text>`);

    const confirmed = rewordKeys(run, state, "Enter", key({ return: true }), 24, 80);
    expect(confirmed.launch).toEqual({});
    expect(actionArgs({ kind: "reword", id: run.id })).toEqual(["reword", RUN]);
  });
});

describe("w needs a prompt when there are no findings", () => {
  test("w needs a prompt when there are no findings", () => {
    const run = detail({ specFindings: [] });
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const view = panel(run, state);
    expect(findingBlocks(view.lines)).toHaveLength(0);
    expect(view.lines.join("\n")).toContain(`reword ${RUN} --prompt <text>`);
    expect(view.keys.find((hint) => hint.key === "Enter")).toMatchObject({
      enabled: false,
      reason: REWORD_PROMPT_REQUIRED,
    });

    const refused = rewordKeys(run, state, "Enter", key({ return: true }), 24, 80);
    expect(refused.launch).toBeUndefined();
    expect(refused.state.notice).toBe(REWORD_PROMPT_REQUIRED);

    const blank = typeText(run, state, "   ");
    const stillRefused = rewordKeys(run, blank, "Enter", key({ return: true }), 24, 80);
    expect(stillRefused.launch).toBeUndefined();
    expect(stillRefused.state.notice).toBe(REWORD_PROMPT_REQUIRED);

    const typed = typeText(run, state, "tighten the spec");
    expect(panel(run, typed).keys.find((hint) => hint.key === "Enter")?.enabled).toBe(true);
    const confirmed = rewordKeys(run, typed, "Enter", key({ return: true }), 24, 80);
    expect(confirmed.launch).toEqual({ prompt: "tighten the spec" });
    expect(actionArgs({ kind: "reword", id: run.id, prompt: "tighten the spec" })).toEqual([
      "reword",
      RUN,
      "--prompt",
      "tighten the spec",
    ]);
  });
});

describe("a driven run explains why w is inert", () => {
  test("a driven run explains why w is inert", () => {
    const lock: ActiveLock = { changeId: RUN, pid: 4242, host: "host", since: ISO };
    const run = detail({ phase: "implementing" }, { active: lock, driverAlive: true });
    const reason = "add-health is being driven by pid 4242; stop it first";
    expect(run.reword).toEqual({ state: "inert", reason });
    expect(openReword(run)).toBeNull();
    const view = runView({ phase: "implementing" }, { active: lock, driverAlive: true });
    expect(view.footer).toContainEqual({ key: "w", label: "reword", enabled: false, reason });
  });
});

describe("replay refuses the reword key", () => {
  test("replay refuses the reword key", () => {
    const view = runView(
      { specFindings: [finding()] },
      { source: "replay", active: null, driverAlive: false },
    );
    expect(view.run?.reword.state).toBe("absent");
    expect(view.panel).toBeNull();
    const outcome = replayKey(view, "w", key());
    expect(outcome.notice).toBe(REPLAY_READ_ONLY);
    expect(outcome.quit).toBe(false);
  });
});

describe("the prompt is a multi-line text field", () => {
  const run = detail({ specFindings: [finding()] });

  test("typing appends, Ctrl-J inserts a newline and backspace deletes one code point", () => {
    let state = opening({ specFindings: [finding()] });
    state = typeText(run, state, "apply finding 2");
    expect(state.text).toBe("apply finding 2");

    state = rewordKeys(run, state, "j", key({ ctrl: true }), 24, 80).state;
    expect(state.text).toBe("apply finding 2\n");
    state = typeText(run, state, "second line");
    expect(state.text).toBe("apply finding 2\nsecond line");

    state = rewordKeys(run, state, "", key({ backspace: true }), 24, 80).state;
    expect(state.text).toBe("apply finding 2\nsecond lin");
  });

  test("Esc closes and discards the text without launching", () => {
    const typed = typeText(run, opening({ specFindings: [finding()] }), "draft");
    const closed = rewordKeys(run, typed, "", key({ escape: true }), 24, 80);
    expect(closed.close).toBe(true);
    expect(closed.launch).toBeUndefined();
    expect(closed.state.text).toBe("draft");
  });

  test("Enter trims the prompt and keeps an internal newline in one value", () => {
    const spaced = typeText(run, opening({ specFindings: [finding()] }), "  apply finding 1  ");
    const trimmed = rewordKeys(run, spaced, "Enter", key({ return: true }), 24, 80);
    expect(trimmed.launch).toEqual({ prompt: "apply finding 1" });

    let twoLines = typeText(run, opening({ specFindings: [finding()] }), "first");
    twoLines = rewordKeys(run, twoLines, "j", key({ ctrl: true }), 24, 80).state;
    twoLines = typeText(run, twoLines, "second");
    const emitted = rewordKeys(run, twoLines, "Enter", key({ return: true }), 24, 80);
    expect(emitted.launch).toEqual({ prompt: "first\nsecond" });
  });
});

describe("the confirm line names the exact argv", () => {
  test("rewordArgvLine is the template when empty and the typed prompt once set", () => {
    const run = detail({ specFindings: [finding()] });
    expect(rewordArgvLine(run, "")).toBe(`reword ${RUN} --prompt <text>`);
    expect(rewordArgvLine(run, "   ")).toBe(`reword ${RUN} --prompt <text>`);
    expect(rewordArgvLine(run, "apply finding 2")).toBe(`reword ${RUN} --prompt apply finding 2`);
    expect(rewordArgvLine(run, "first\nsecond")).toBe(`reword ${RUN} --prompt first…`);
  });
});

describe("scrolling is non-printable only", () => {
  const run = detail({
    specFindings: [
      finding({
        problem: Array.from({ length: 200 }, (_, index) => `line ${index} `).join(""),
      }),
    ],
  });

  test("arrows and pages move the offset while j types", () => {
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");

    const down = rewordKeys(run, state, "", key({ downArrow: true }), 24, 80).state;
    expect(down.offset).toBe(1);
    const up = rewordKeys(run, down, "", key({ upArrow: true }), 24, 80).state;
    expect(up.offset).toBe(0);

    const paged = rewordKeys(run, state, "", key({ pageDown: true }), 24, 80).state;
    expect(paged.offset).toBeGreaterThan(0);
    const back = rewordKeys(run, paged, "", key({ pageUp: true }), 24, 80).state;
    expect(back.offset).toBe(0);

    const typed = rewordKeys(run, state, "j", key(), 24, 80).state;
    expect(typed.text).toBe("j");
  });
});

describe("the panel opens only where the CLI accepts reword", () => {
  test("openReword is null on inert and absent and a clean state on available", () => {
    expect(openReword(detail({ phase: "design" }))).toBeNull();
    const lock: ActiveLock = { changeId: RUN, pid: 7, host: "host", since: ISO };
    expect(openReword(detail({ phase: "implementing" }, { active: lock }))).toBeNull();
    expect(openReword(detail())).toEqual(initialReword);
    expect(openReword(detail())).toEqual({
      text: "",
      offset: 0,
      notice: null,
      failure: null,
    });
  });

  test("the panel kind is reword and the title names the change id", () => {
    const run = detail();
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const view = panel(run, state);
    expect(view.kind).toBe("reword");
    expect(view.title).toBe(`Reword - ${RUN}`);
    expect(view.keys.map((hint) => hint.key)).toContain("Ctrl-J");
  });

  test("the reword keys row fits the panel's inner width and advertises no q quit", () => {
    const run = detail();
    const state = openReword(run);
    if (state === null) throw new Error("the reword panel did not open");
    const view = panel(run, state);
    expect(view.keys.map((hint) => hint.key)).not.toContain("q");
    const row = view.keys.map((hint) => `${hint.key} ${hint.label}`).join(" - ");
    // The 80-column frame leaves 76 cells inside the panel's border and padding.
    expect(row.length).toBeLessThanOrEqual(76);
    expect(row).toMatch(/^[\t\n -~]*$/u);
  });
});
