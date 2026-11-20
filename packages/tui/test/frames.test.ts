import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState, TaskState } from "@loomwright/core/state/run";
import { activityPanePanel, openActivityPane } from "../src/controls/activity-pane.ts";
import { collectFacts, type EventFacts } from "../src/model/facts.ts";
import {
  type ActivityLine,
  buildViewModel,
  type ViewModel,
  type ViewModelInput,
} from "../src/model/view-model.ts";
import { lastOffset } from "../src/model/viewport.ts";
import { emptyWorkspace } from "../src/strings.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";
import { renderFrame } from "../src/views/frame.tsx";
import { SIZES, STATES } from "./frame-states.ts";

const framesDir = fileURLToPath(new URL("./fixtures/frames", import.meta.url));

const ISO = "2026-11-17T10:00:00.000Z";

function runState(overrides: Record<string, unknown> = {}): RunState {
  return RunState.parse({
    version: 1,
    id: "run",
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "implementing",
    summary: "Add health endpoints",
    ...overrides,
  });
}

function taskState(overrides: Record<string, unknown>): TaskState {
  return TaskState.parse({
    id: "first",
    title: "Health endpoint",
    repo: "app",
    deps: [],
    touches: [],
    status: "pending",
    ...overrides,
  });
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

function statusDoc(runs: readonly RunState[]): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: runs.map((run) => ({
      ...run,
      usage: {
        total: ZERO_USAGE,
        sessions: 0,
        byAgent: {},
        byStep: {},
        byModel: {},
        retryOverhead: ZERO_USAGE,
        top: [],
        wastedReads: 0,
      },
    })),
  };
}

function vmInput(overrides: Partial<ViewModelInput>): ViewModelInput {
  return {
    source: "live",
    screen: "list",
    columns: 80,
    rows: 24,
    now: Date.parse(ISO) + 8_000,
    snapshot: null,
    facts: collectFacts([]),
    status: statusDoc([]),
    runs: [],
    selectedRunId: null,
    selectedTaskId: null,
    panel: null,
    notice: null,
    ...overrides,
  };
}

/** 60 runs newest first: `run-0` is the oldest and last row. */
function sixtyRuns(): RunState[] {
  return Array.from({ length: 60 }, (_, index) =>
    runState({
      id: `run-${index}`,
      summary: `run ${index}`,
      createdAt: new Date(Date.parse(ISO) + index * 1_000).toISOString(),
    }),
  );
}

function sixtyView(selectedRunId: string, listOffset = 0): ViewModel {
  const runs = sixtyRuns();
  return buildViewModel(
    vmInput({
      status: statusDoc(runs),
      runs,
      selectedRunId,
      listOffset,
    }),
  );
}

describe("every screen has both sizes", () => {
  for (const [state, make] of Object.entries(STATES)) {
    for (const size of SIZES) {
      const file = join(framesDir, `${state}-${size.columns}x${size.rows}.txt`);
      test(`${state} at ${size.columns}x${size.rows}`, async () => {
        const actual = await renderFrame(make(size), size, { ascii: true });
        expect(actual.includes("\u001b[")).toBe(false);
        expect(actual).toMatch(/^[\t\n -~]*$/u);
        expect(actual.split("\n").length).toBeLessThanOrEqual(size.rows);
        if (process.env.UPDATE_FRAMES === "1") {
          mkdirSync(framesDir, { recursive: true });
          writeFileSync(file, `${actual}\n`);
          return;
        }
        const expected = readFileSync(file, "utf8").replace(/\n$/u, "");
        expect(actual, `${state} ${size.columns}x${size.rows}`).toBe(expected);
      });
    }
  }
});

describe("the frame budget is pinned", () => {
  for (const [state, size] of [
    ["long-list-bottom", { columns: 80, rows: 24 }],
    ["tasks-12", { columns: 80, rows: 24 }],
  ] as const) {
    test(`${state} at 80x24 fits ${size.rows} lines with the footer last`, async () => {
      const text = await renderFrame(STATES[state](size), size, { ascii: true });
      const lines = text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(size.rows);
      expect(lines.at(-1)).toContain("q quit");
    });
  }
});

describe("an empty workspace frame", () => {
  test("says no changes exist and names n", async () => {
    const text = await renderFrame(
      STATES["no-runs"]({ columns: 80, rows: 24 }),
      { columns: 80, rows: 24 },
      { ascii: true },
    );
    expect(text).toContain(emptyWorkspace);
    expect(text).toContain("n");
  });
});

describe("the frame never exceeds the terminal", () => {
  test("the footer is the last row and the frame fits", async () => {
    const text = await renderFrame(sixtyView("run-59"), { columns: 80, rows: 24 }, { ascii: true });
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(lines[0]).toContain("Runs");
    expect(text).toContain("runs 1-22/60");
    expect(lines.at(-1)).toContain("q quit");
  });

  test("a 60-run list keeps the frame still", async () => {
    const text = await renderFrame(sixtyView("run-59"), { columns: 80, rows: 24 }, { ascii: true });
    const lines = text.split("\n");
    expect(lines).toHaveLength(24);
    expect(lines[0]).toContain("Runs");
    expect(text).toContain("runs 1-22/60");
    expect(lines.at(-1)).toContain("q quit");

    const bottom = await renderFrame(
      sixtyView("run-0", lastOffset(60, 22)),
      { columns: 80, rows: 24 },
      { ascii: true },
    );
    expect(bottom.split("\n")).toHaveLength(24);
    expect(bottom).toContain("run-0  run 0");
    expect(bottom).not.toContain("run-59  run 59");
    expect(bottom.match(/runs 39-60\/60/u)).not.toBeNull();
  });

  test("the selection stays visible at the last and first row", async () => {
    const top = await renderFrame(sixtyView("run-59"), { columns: 80, rows: 24 }, { ascii: true });
    expect(top).toContain("run-59  run 59");
    expect(top).not.toContain("run-0  run 0");

    const bottom = await renderFrame(
      sixtyView("run-0", lastOffset(60, 22)),
      { columns: 80, rows: 24 },
      { ascii: true },
    );
    expect(bottom).toContain("run-0  run 0");
    expect(bottom).not.toContain("run-59  run 59");
  });

  test("an empty answer notice keeps the questions frame at 24 lines with the footer last", async () => {
    const size = { columns: 80, rows: 24 };
    const text = await renderFrame(STATES["questions-notice"](size), size, { ascii: true });
    const lines = text.split("\n");
    expect(lines).toHaveLength(24);
    expect(lines.at(-1)).toContain("Ctrl-J newline");
    expect(text).toContain("the answer is empty");
  });

  test("a 12-task run never exceeds the terminal", async () => {
    const tasks = Array.from({ length: 12 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const run = runState({ tasks });
    const view = buildViewModel(
      vmInput({
        screen: "run",
        status: statusDoc([run]),
        runs: [run],
        selectedRunId: run.id,
      }),
    );
    const text = await renderFrame(view, { columns: 80, rows: 24 }, { ascii: true });
    expect(text.split("\n").length).toBeLessThanOrEqual(24);
  });
});

function activityLines(count: number): ActivityLine[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    step: index % 4 === 0 ? "run" : "first",
    kind: index % 4 === 0 ? "log" : "agent",
    text: `activity line ${index + 1}`,
    ...(index === count - 1 ? { logRef: ".factory/logs/add-health/task.log" } : {}),
  }));
}

function factsWith(lines: readonly ActivityLine[]): EventFacts {
  return { gates: {}, agents: {}, retries: {}, activity: lines };
}

function activityPaneView(columns: number, rows: number): ViewModel {
  const run = runState({
    tasks: [
      taskState({ id: "first", title: "Health endpoint", repo: "app" }),
      taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
    ],
  });
  const input = vmInput({
    screen: "run",
    columns,
    rows,
    status: statusDoc([run]),
    runs: [run],
    selectedRunId: run.id,
    facts: factsWith(activityLines(24)),
  });
  const base = buildViewModel(input);
  if (base.run === null) throw new Error("the activity pane needs a run");
  return buildViewModel({
    ...input,
    panel: activityPanePanel({
      run: base.run,
      state: openActivityPane(base.run),
      glyphs: ASCII_GLYPHS,
      rows,
    }),
  });
}

describe("the activity pane fills the frame", () => {
  for (const size of SIZES) {
    const file = join(framesDir, `activity-run-${size.columns}x${size.rows}.txt`);
    test(`activity-run at ${size.columns}x${size.rows}`, async () => {
      const actual = await renderFrame(activityPaneView(size.columns, size.rows), size, {
        ascii: true,
      });
      expect(actual.includes("\u001b[")).toBe(false);
      expect(actual).toMatch(/^[\t\n -~]*$/u);
      const lines = actual.split("\n");
      expect(lines).toHaveLength(size.rows);
      // The pane's bottom border is the row above the footer: the pane fills the height.
      expect(lines.at(-2)).toMatch(/^\+-+\+$/u);
      if (process.env.UPDATE_FRAMES === "1") {
        mkdirSync(framesDir, { recursive: true });
        writeFileSync(file, `${actual}\n`);
        return;
      }
      const expected = readFileSync(file, "utf8").replace(/\n$/u, "");
      expect(actual, `activity-run ${size.columns}x${size.rows}`).toBe(expected);
    });
  }
});

function longRunView(count: number, selectedTaskId: string | null): ViewModel {
  const tasks = Array.from({ length: count }, (_, index) =>
    taskState({ id: `task-${index}`, title: `Task ${index}` }),
  );
  const run = runState({ tasks });
  return buildViewModel(
    vmInput({
      screen: "run",
      columns: 80,
      rows: 24,
      status: statusDoc([run]),
      runs: [run],
      selectedRunId: run.id,
      selectedTaskId,
      facts: factsWith(
        Array.from({ length: 5 }, (_, index) => ({
          seq: index + 1,
          step: "run",
          kind: "log",
          text: `tail line ${index + 1}`,
        })),
      ),
    }),
  );
}

describe("the overview never loses the tail", () => {
  test("the overview never loses the tail", async () => {
    const view = longRunView(24, null);
    expect(view.taskWindow).toEqual({ offset: 0, size: 17, total: 24 });

    const text = await renderFrame(view, { columns: 80, rows: 24 }, { ascii: true });
    const lines = text.split("\n");
    expect(lines).toHaveLength(24);
    expect(lines.at(-1)).toContain("q quit");
    // Five lines exist; the four-row floor keeps the newest four.
    expect(text).toContain("tail line 5");
    expect(text).toContain("tail line 2");
    expect(text).not.toContain("tail line 1");

    // The graph scrolls with the selection instead of taking the tail's floor away.
    const scrolled = longRunView(24, "task-23");
    expect(scrolled.taskWindow.offset).toBe(7);
    expect(scrolled.taskWindow.offset + scrolled.taskWindow.size).toBe(24);
  });
});
