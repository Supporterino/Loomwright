import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import type { ActiveLock } from "@loomwright/core/state/active";
import { RunState, TaskState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import {
  type EventType,
  PROTOCOL_VERSION,
  type RunEvent,
  RunEvent as RunEventSchema,
  reduce,
} from "@loomwright/protocol";
import { runTui } from "../src/entry.tsx";
import type { LaunchAction, Launcher } from "../src/launch/launcher.ts";
import { collectFacts } from "../src/model/facts.ts";
import { applyKey } from "../src/model/keys.ts";
import { buildViewModel, type ViewModel, type ViewModelInput } from "../src/model/view-model.ts";
import { createTerminalSession, type TerminalSession } from "../src/session.ts";
import { emptyWorkspace } from "../src/strings.ts";
import { renderFrame } from "../src/views/frame.tsx";
import { singlePaneTailRows, taskDetailTailRows, twoPaneTailRows } from "../src/views/run-view.tsx";

const ISO = "2026-11-17T10:00:00.000Z";
const RUN = "add-health";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};
const EVENT_USAGE = { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1, cost: 0.01 };

let seq = 0;

function event(type: EventType, data: unknown): RunEvent {
  seq += 1;
  return RunEventSchema.parse({ v: PROTOCOL_VERSION, runId: RUN, seq, ts: ISO, type, data });
}

function resetSeq(): void {
  seq = 0;
}

function runState(overrides: Record<string, unknown> = {}): RunState {
  return RunState.parse({
    version: 1,
    id: RUN,
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

function usageSummary(tokens: number, cost: number): UsageSummary {
  return {
    total: { ...ZERO_USAGE, input: tokens, cost },
    sessions: 1,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: ZERO_USAGE,
    top: [],
    wastedReads: 0,
  };
}

function statusDoc(
  entries: readonly { readonly run: RunState; readonly tokens: number; readonly cost: number }[],
  extras: { readonly active?: ActiveLock | null; readonly queue?: readonly string[] } = {},
): StatusDocument {
  const active = extras.active ?? null;
  return {
    active,
    driverAlive: active !== null,
    queue: [...(extras.queue ?? [])],
    corrupt: [],
    runs: entries.map(({ run, tokens, cost }) => ({
      ...run,
      usage: usageSummary(tokens, cost),
    })),
  };
}

function vmInput(overrides: Partial<ViewModelInput>): ViewModelInput {
  return {
    source: "live",
    screen: "run",
    columns: 120,
    rows: 40,
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

function runInput(
  run: RunState,
  events: readonly RunEvent[] = [],
  overrides: Partial<ViewModelInput> = {},
): ViewModelInput {
  return vmInput({
    status: statusDoc([{ run, tokens: 0, cost: 0 }]),
    runs: [run],
    selectedRunId: run.id,
    snapshot: events.length === 0 ? null : reduce(events),
    facts: collectFacts(events),
    ...overrides,
  });
}

async function frame(view: ViewModel, columns = 120, rows = 40, ascii = false): Promise<string> {
  return renderFrame(view, { columns, rows }, { ascii });
}

function failingTaskView(selectedTaskId: string | null = "first"): ViewModel {
  const run = runState({
    tasks: [
      taskState({ id: "first", title: "Health endpoint", repo: "app", status: "failed" }),
      taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
    ],
  });
  resetSeq();
  const events = [
    event("run.started", { phase: "implementing" }),
    event("task.started", { task: { id: "first", repo: "app" }, attempt: 2 }),
    event("agent.started", {
      step: "first",
      agent: "implementer",
      model: "claude-5",
    }),
    event("gate.finished", {
      name: "lint",
      type: "lint",
      status: "fail",
      durationMs: 1_200,
      step: "first",
    }),
    event("gate.finished", {
      name: "test",
      type: "test",
      status: "pass",
      durationMs: 3_400,
      step: "first",
    }),
    event("task.failed", { task: { id: "first", repo: "app" }, reason: "gate failed" }),
    event("agent.finished", {
      step: "first",
      role: "implementer",
      outcome: "failed",
      durationMs: 125_000,
      usage: EVENT_USAGE,
      sessionId: "session",
    }),
    event("agent.retry", { step: "first" }),
    event("agent.activity", {
      step: "first",
      detail: "test failed",
      kind: "tool",
      ref: { path: ".factory/logs/first.log", offset: 0, bytes: 42 },
    }),
    event("agent.activity", { step: "first", detail: "retrying gate", kind: "tool" }),
  ];
  return buildViewModel(runInput(run, events, { selectedTaskId }));
}

describe("run list", () => {
  test("the list is ordered and labelled: newest first, active pid, queued #1, idle", async () => {
    const oldest = runState({
      id: "oldest",
      createdAt: "2026-11-17T09:00:00.000Z",
      summary: "Oldest",
    });
    const active = runState({
      id: "running",
      createdAt: "2026-11-17T09:10:00.000Z",
      summary: "Active",
    });
    const queued = runState({
      id: "queued",
      createdAt: "2026-11-17T09:20:00.000Z",
      summary: "Queued",
    });
    const lock: ActiveLock = {
      changeId: "running",
      pid: 4242,
      host: "host",
      since: ISO,
    };
    const view = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc(
          [
            { run: oldest, tokens: 0, cost: 0 },
            { run: active, tokens: 12_345, cost: 0.42 },
            { run: queued, tokens: 0, cost: 0 },
          ],
          { active: lock, queue: ["queued"] },
        ),
        runs: [oldest, active, queued],
        selectedRunId: "oldest",
      }),
    );
    const text = await frame(view, 90, 24, true);
    const lines = text.split("\n");
    expect(lines.some((line) => line.startsWith("> > oldest  Oldest"))).toBe(true);
    expect(text).toContain("Queued");
    const queuedAt = text.indexOf("queued #1");
    const runningAt = text.indexOf("active (pid 4242)");
    const oldestAt = text.indexOf("idle");
    expect(queuedAt).toBeGreaterThan(-1);
    expect(runningAt).toBeGreaterThan(queuedAt);
    expect(oldestAt).toBeGreaterThan(runningAt);
    expect(text).toContain("12.3k tokens");
    expect(text).toContain("$0.42");
  });

  test("every run row carries its phase glyph beside the phase label", async () => {
    const running = runState({ id: "running", createdAt: "2026-11-17T09:10:00.000Z" });
    const done = runState({
      id: "finished",
      createdAt: "2026-11-17T09:00:00.000Z",
      phase: "done",
    });
    const view = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc([
          { run: running, tokens: 0, cost: 0 },
          { run: done, tokens: 0, cost: 0 },
        ]),
        runs: [running, done],
        selectedRunId: "running",
      }),
    );
    const lines = (await frame(view, 80, 24, true)).split("\n");
    expect(lines.some((line) => line.startsWith("> > ") && line.includes("implementing"))).toBe(
      true,
    );
    expect(lines.some((line) => line.startsWith("  + ") && line.includes("done"))).toBe(true);
  });

  test("an empty workspace explains itself: no changes and n in the footer", async () => {
    const view = buildViewModel(vmInput({ screen: "list" }));
    const text = await frame(view, 80, 24, true);
    expect(text).toContain(emptyWorkspace);
    expect(text).toContain("n new change");
    expect(text).toContain("? help");
    expect(text).toContain("q quit");
  });
});

describe("run view layout", () => {
  test("two panes become one: Enter drills into the selected run or task", async () => {
    const graph = failingTaskView();
    const single = await frame(
      buildViewModel(
        runInput(runState({ tasks: [taskState({ id: "first", status: "running" })] }), [], {
          selectedTaskId: null,
        }),
      ),
      80,
      24,
      true,
    );
    expect(single).toContain("Tasks");
    expect(single).not.toContain("agent implementer");

    const drilled = await frame(
      buildViewModel(
        runInput(runState({ tasks: [taskState({ id: "first", status: "running" })] }), [], {
          selectedTaskId: "first",
        }),
      ),
      80,
      24,
      true,
    );
    expect(drilled.replace(/\s+/gu, " ")).toContain("attempt 0");
    expect(drilled).not.toContain("Repo");

    const wide = await frame(
      buildViewModel(
        runInput(
          runState({
            tasks: [
              taskState({ id: "first", status: "running" }),
              taskState({ id: "second", title: "Wire client", repo: "api" }),
            ],
          }),
          [],
          { selectedTaskId: "first" },
        ),
      ),
      120,
      40,
      true,
    );
    const sideBySide = wide
      .split("\n")
      .some((line) => line.includes("Tasks") && line.includes("task"));
    expect(sideBySide).toBe(true);
    expect(graph.run?.tasks).toHaveLength(2);

    const selectedRun = runState({ tasks: [taskState({ id: "first", status: "running" })] });
    resetSeq();
    const activity = [
      event("agent.activity", { step: "first", detail: "edited src/health.ts", kind: "tool" }),
    ];
    const listInput = vmInput({
      screen: "list",
      status: statusDoc([{ run: selectedRun, tokens: 0, cost: 0 }]),
      runs: [selectedRun],
      selectedRunId: RUN,
      snapshot: reduce(activity),
      facts: collectFacts(activity),
    });
    const wideList = await frame(buildViewModel(listInput), 120, 40, true);
    const sharedRow = wideList
      .split("\n")
      .find((line) => line.includes(`> ${RUN}`) && line.includes("edited src/health.ts"));
    expect(sharedRow).toBeDefined();
    const narrowList = await frame(buildViewModel(listInput), 80, 24, true);
    expect(narrowList).toContain(`> ${RUN}`);
    expect(narrowList).not.toContain("edited src/health.ts");

    const list = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc([{ run: runState(), tokens: 0, cost: 0 }]),
        runs: [runState()],
        selectedRunId: RUN,
      }),
    );
    expect(applyKey(list, "Enter")).toEqual({ kind: "open-run", runId: RUN });
  });

  test("task rows keep tasks.md order with status, repo, attempt and title", async () => {
    const run = runState({
      tasks: [
        taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
        taskState({
          id: "first",
          title: "Health endpoint",
          repo: "app",
          status: "running",
          failures: 2,
        }),
      ],
    });
    resetSeq();
    const events = [event("task.started", { task: { id: "first", repo: "app" }, attempt: 3 })];
    const text = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: null })),
      80,
      24,
      true,
    );
    const second = text.indexOf("second pending api attempt 0 Wire client");
    const first = text.indexOf("first running app attempt 3 Health endpoint");
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(second);
  });

  test("design and install activity is visible at 80 and 120 columns", async () => {
    const run = runState({ phase: "design" });
    resetSeq();
    const events = [
      event("run.started", { phase: "design" }),
      event("phase.changed", { from: "intake", to: "design" }),
      event("install.started", { step: "install", repo: "loomwright" }),
      event("install.finished", {
        step: "install",
        repo: "loomwright",
        durationMs: 1_200,
        detail: "bun install",
      }),
      event("progress.line", { level: "normal", text: "design: 3 capabilities planned" }),
    ];
    const view = buildViewModel(runInput(run, events, { selectedTaskId: null }));
    for (const [columns, rows] of [
      [80, 24],
      [120, 40],
    ] as const) {
      const text = await frame(view, columns, rows, true);
      const tasks = text.indexOf("Tasks");
      expect(tasks).toBeGreaterThan(-1);
      for (const line of [
        "run - run - started in design",
        "run - phase - intake -> design",
        "loomwright - install - install started",
        "loomwright - install - install finished in 1.2s: bun install",
        "run - log - design: 3 capabilities planned",
      ]) {
        expect(text).toContain(line);
        expect(text.indexOf(line)).toBeGreaterThan(tasks);
      }
    }
  });

  test("a log reference is named: an 80x24 frame keeps it visible on a long progress line", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
    });
    resetSeq();
    const events = [
      event("progress.line", {
        level: "normal",
        text: "implementer finished the task and the rest of this long line is cut by the pane width",
        ref: { path: ".factory/logs/add-health/2026-11-19.jsonl", offset: 0, bytes: 42 },
      }),
    ];
    const view = buildViewModel(runInput(run, events, { selectedTaskId: null }));
    const text = await frame(view, 80, 24, true);
    expect(text).toContain(".factory/logs/add-health/2026-11-19.jsonl");
  });

  test("the activity tail appears in one pane: graph then tail, selecting a task replaces both", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
    });
    resetSeq();
    const events = [
      event("progress.line", { level: "normal", text: "run-level line" }),
      event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
      event("agent.activity", { step: "first", detail: "task tool line", kind: "tool" }),
    ];
    const open = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: null })),
      80,
      24,
      true,
    );
    expect(open).toContain("Tasks");
    expect(open).toContain("run-level line");
    expect(open.indexOf("run-level line")).toBeGreaterThan(open.indexOf("Tasks"));

    const drilled = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: "first" })),
      80,
      24,
      true,
    );
    expect(drilled).not.toContain("Tasks");
    expect(drilled).not.toContain("run-level line");
    expect(drilled).toContain("first - Health endpoint");
  });

  test("a long narrow run keeps its run-level tail instead of claiming no activity", async () => {
    const tasks = Array.from({ length: 18 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const run = runState({ tasks });
    resetSeq();
    const events = [event("progress.line", { level: "normal", text: "run-level line" })];
    const text = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: null })),
      80,
      24,
      true,
    );
    expect(text).toContain("Tasks");
    expect(text).toContain("run-level line");
    expect(text).not.toContain("no activity yet");
  });

  test("the tail renders nothing rather than no activity when zero rows are left", async () => {
    const tasks = Array.from({ length: 24 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const run = runState({ tasks });
    resetSeq();
    const events = [event("progress.line", { level: "normal", text: "hidden line" })];
    const text = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: null })),
      80,
      24,
      true,
    );
    expect(text).not.toContain("hidden line");
    expect(text).not.toContain("no activity yet");
  });

  test("a multi-line failure notice counts its rows so the newest activity stays visible", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
    });
    resetSeq();
    const events = Array.from({ length: 12 }, (_, index) =>
      event("progress.line", { level: "normal", text: `activity-${index + 1}` }),
    );
    const notice = [
      `land ${RUN} exited with code 5`,
      "spawn log: .factory/logs/land.log",
      ...Array.from({ length: 10 }, (_, index) => `log line ${index + 1}`),
    ].join("\n");
    const view = buildViewModel(runInput(run, events, { selectedTaskId: null, notice, rows: 24 }));
    // 24 rows - header - 12 notice rows - graph (title + 1 task) - footer.
    expect(singlePaneTailRows(view)).toBe(8);
    const text = await frame(view, 80, 24, true);
    expect(text).toContain(`land ${RUN} exited with code 5`);
    expect(text).toContain("log line 10");
    expect(text).toContain("activity-12");
  });

  test("a multi-line failure notice counts its rows in two panes so the newest activity stays visible", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
    });
    resetSeq();
    const events = Array.from({ length: 40 }, (_, index) =>
      event("progress.line", { level: "normal", text: `activity-${index + 1}` }),
    );
    const notice = [
      `land ${RUN} exited with code 5`,
      "spawn log: .factory/logs/land.log",
      ...Array.from({ length: 10 }, (_, index) => `log line ${index + 1}`),
    ].join("\n");
    const view = buildViewModel(runInput(run, events, { selectedTaskId: null, notice, rows: 40 }));
    // 40 rows - header - 12 notice rows - footer.
    expect(twoPaneTailRows(view)).toBe(26);
    const text = await frame(view, 120, 40, true);
    expect(text).toContain(`land ${RUN} exited with code 5`);
    expect(text).toContain("log line 10");
    expect(text).toContain("activity-40");
  });

  test("the activity tail says no activity yet only when there are no lines", async () => {
    const run = runState({ tasks: [taskState({ id: "first", title: "Health endpoint" })] });
    const text = await frame(
      buildViewModel(runInput(run, [], { selectedTaskId: null })),
      80,
      24,
      true,
    );
    expect(text).toContain("no activity yet");
  });

  test("the task detail stays task-scoped", async () => {
    const run = runState({
      tasks: [
        taskState({ id: "first", title: "Health endpoint", repo: "app" }),
        taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
      ],
    });
    resetSeq();
    const events = [
      event("progress.line", { level: "normal", text: "run-level progress" }),
      event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
      event("agent.activity", { step: "first", detail: "first tool line", kind: "tool" }),
      event("task.started", { task: { id: "second", repo: "api" }, attempt: 1 }),
      event("agent.activity", { step: "second", detail: "second tool line", kind: "tool" }),
    ];

    const tail = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: null })),
      120,
      40,
      true,
    );
    expect(tail).toContain("run-level progress");
    expect(tail).toContain("first tool line");
    expect(tail).toContain("second tool line");

    const detail = await frame(
      buildViewModel(runInput(run, events, { selectedTaskId: "first" })),
      120,
      40,
      true,
    );
    expect(detail).toContain("first tool line");
    expect(detail).not.toContain("run-level progress");
    expect(detail).not.toContain("second tool line");
  });
});

describe("task detail", () => {
  test("a task detail shows the evidence: role, duration, attempt, gates and the log tail", async () => {
    const tail = await frame(failingTaskView(null), 120, 40, false);
    expect(tail).toContain("started in implementing");

    const text = await frame(failingTaskView(), 120, 40, false);
    expect(text).not.toContain("started in implementing");
    expect(text).toContain("implementer");
    expect(text).toContain("claude-5");
    expect(text).toContain("2m05s");
    const spaced = text.replace(/\s+/gu, " ");
    expect(spaced).toContain("attempt 2");
    expect(spaced).toContain("retries 1");
    const lint = text.indexOf("lint fail");
    const testGate = text.indexOf("test pass");
    expect(lint).toBeGreaterThan(-1);
    expect(testGate).toBeGreaterThan(lint);
    expect(text).toContain("test failed");
    expect(text).toContain("→ .factory/logs/first.log");
  });

  test("an 80x24 task detail keeps the newest of a 20-line tail and its log reference", async () => {
    const run = runState({
      tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app", status: "failed" })],
    });
    resetSeq();
    const events = [
      event("task.started", { task: { id: "first", repo: "app" }, attempt: 2 }),
      event("agent.started", { step: "first", agent: "implementer", model: "claude-5" }),
      event("gate.finished", {
        name: "lint",
        type: "lint",
        status: "fail",
        durationMs: 1_200,
        step: "first",
      }),
      event("gate.finished", {
        name: "test",
        type: "test",
        status: "pass",
        durationMs: 3_400,
        step: "first",
      }),
      ...Array.from({ length: 20 }, (_, index) =>
        event("agent.activity", {
          step: "first",
          detail: `activity-${index + 1}`,
          kind: "tool",
          ...(index === 19
            ? { ref: { path: ".factory/logs/last.log", offset: 0, bytes: 42 } }
            : {}),
        }),
      ),
    ];
    const view = buildViewModel(runInput(run, events, { selectedTaskId: "first", rows: 24 }));
    // 24 rows - header - detail facts - two gate rows - footer.
    expect(taskDetailTailRows(view)).toBe(14);
    const text = await frame(view, 80, 24, true);
    expect(text).toContain("activity-20");
    expect(text).toContain(".factory/logs/last.log");
    expect(text).not.toContain("activity-1\n");
  });
});

describe("footer", () => {
  test("the footer lists only the keys valid in the current state", async () => {
    const list = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc([{ run: runState(), tokens: 0, cost: 0 }]),
        runs: [runState()],
        selectedRunId: RUN,
      }),
    );
    const listText = await frame(list, 120, 40, true);
    expect(listText).toContain("n new change");
    expect(listText).toContain("? help");
    expect(listText).toContain("q quit");
    expect(listText).toContain("Enter open run");

    const finished = buildViewModel(
      runInput(runState({ phase: "done", tasks: [taskState({ id: "first", status: "merged" })] })),
    );
    const finishedText = await frame(finished, 120, 40, true);
    expect(finishedText).not.toContain("x abort");
    expect(finishedText).toContain("q quit");
  });
});

describe("frame rendering", () => {
  test("no colour and no background SGR when depth is none", async () => {
    const text = await frame(failingTaskView(), 120, 40, true);
    expect(text.includes("\u001b[")).toBe(false);
  });
});

describe("panel keys", () => {
  test("repeated panel lines get unique keys and render without a React warning", async () => {
    const view = buildViewModel(
      vmInput({
        panel: {
          kind: "confirm",
          title: "Confirm",
          lines: ["", "", "same row", "same row"],
          keys: [],
          notice: null,
        },
      }),
    );
    const warnings: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    let text: string;
    try {
      text = await frame(view, 80, 24, true);
    } finally {
      console.error = original;
    }
    expect(text).toContain("same row");
    expect(warnings.filter((warning) => warning.includes("same key"))).toEqual([]);
  });
});

describe("the terminal session", () => {
  test("a crash restores the terminal", () => {
    const writes: string[] = [];
    const raw: boolean[] = [];
    const stdin = {
      isRaw: false,
      setRawMode(value: boolean): void {
        raw.push(value);
      },
      on(): void {},
      off(): void {},
      resume(): void {},
      pause(): void {},
    };
    const stdout = {
      columns: 80,
      rows: 24,
      write(chunk: string): boolean {
        writes.push(chunk);
        return true;
      },
      on(): void {},
      off(): void {},
    };
    // The session reads only this structural subset of the Node stream types.
    const session = createTerminalSession(
      stdin as unknown as NodeJS.ReadStream,
      stdout as unknown as NodeJS.WriteStream,
    );
    session.enter();
    expect(writes[0]).toContain("[?1049h");
    expect(raw).toEqual([true]);
    try {
      throw new Error("view threw");
    } catch {
      session.leave();
    }
    expect(writes.at(-1)).toContain("[?25h");
    expect(raw).toEqual([true, false]);
    session.leave();
    expect(writes).toHaveLength(2);
  });
});

class FakeInput extends EventEmitter {
  readonly isTTY = true;
  isRaw = false;
  readonly #chunks: string[] = [];

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
  }

  setEncoding(): void {}

  ref(): void {}

  unref(): void {}

  resume(): void {}

  pause(): void {}

  read(): string | null {
    return this.#chunks.shift() ?? null;
  }

  press(text: string): void {
    this.#chunks.push(text);
    this.emit("readable");
  }
}

class FakeOutput {
  readonly columns = 80;
  readonly rows = 24;
  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  on(): void {}

  off(): void {}

  text(): string {
    return this.writes.join("");
  }
}

/** The list only reads; every write method fails so a stray control call is visible. */
function listFactory(status: StatusDocument, runs: readonly RunState[]): Factory {
  const fail = (): never => {
    throw new Error("opening the run list must not write");
  };
  return {
    status: async () => status,
    listRuns: async () => [...runs],
    events: async function* () {},
    run: async () => fail(),
    resume: async () => fail(),
    approve: async () => fail(),
    retry: async () => fail(),
    abort: async () => fail(),
    answer: async () => fail(),
    pause: async () => fail(),
  };
}

async function until(
  predicate: () => boolean,
  what = "the run list",
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Ink subscribes to stdin after paint, so a single press can race the mount and vanish. */
async function pressUntil(
  input: FakeInput,
  text: string,
  what: string,
  ready: () => boolean,
): Promise<void> {
  await until(() => {
    if (ready()) return true;
    input.press(text);
    return false;
  }, what);
}

/** Past Ink's 33 ms frame throttle, so the frame a key produced has been written. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

interface DrivenRun {
  readonly code: number;
  readonly writes: readonly string[];
}

/**
 * Runs the interactive UI with fake stdio, drives keys until it quits and returns what Ink
 * wrote. With `CI` set Ink only writes the final frame, so a run asserts on that frame.
 */
async function driveTui(
  factory: Factory,
  drive: (input: FakeInput, output: FakeOutput) => Promise<void>,
  launcher?: Launcher,
  frames = false,
): Promise<DrivenRun> {
  const input = new FakeInput();
  const output = new FakeOutput();
  const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
  const realStdout = Object.getOwnPropertyDescriptor(process, "stdout");
  const session: TerminalSession = {
    enter: () => {},
    leave: () => {},
    get columns(): number {
      return 80;
    },
    get rows(): number {
      return 24;
    },
    onKey: () => () => {},
    onResize: () => () => {},
    onSignal: () => () => {},
  };
  try {
    Object.defineProperty(process, "stdin", { value: input, configurable: true });
    Object.defineProperty(process, "stdout", { value: output, configurable: true });
    const code = runTui({
      workspace: "/workspace",
      once: false,
      ascii: true,
      columns: 80,
      rows: 24,
      out: () => {},
      env: {},
      isTTY: false,
      frames,
      factory,
      launcher: launcher ?? {
        launch: async () => {
          throw new Error("the help panel must not launch");
        },
      },
      session,
    });
    // A failed drive must not also surface as an unhandled rejection from the TUI.
    void code.catch(() => {});
    await until(() => input.isRaw);
    await drive(input, output);
    return { code: await code, writes: [...output.writes] };
  } finally {
    if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
    if (realStdout !== undefined) Object.defineProperty(process, "stdout", realStdout);
  }
}

describe("the interactive entry", () => {
  test("a terminal opens the run list: newest selected, no exit until quit", async () => {
    const oldest = runState({ id: "oldest", createdAt: "2026-11-17T09:00:00.000Z" });
    const newest = runState({ id: "newest", createdAt: "2026-11-17T10:00:00.000Z" });
    const status = statusDoc([
      { run: oldest, tokens: 0, cost: 0 },
      { run: newest, tokens: 0, cost: 0 },
    ]);
    const input = new FakeInput();
    const output = new FakeOutput();
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const realStdout = Object.getOwnPropertyDescriptor(process, "stdout");
    let settled = false;
    let leaves = 0;
    const session: TerminalSession = {
      enter: () => {},
      leave: () => {
        leaves += 1;
      },
      get columns(): number {
        return 80;
      },
      get rows(): number {
        return 24;
      },
      onKey: () => () => {},
      onResize: () => () => {},
      onSignal: () => () => {},
    };

    try {
      Object.defineProperty(process, "stdin", { value: input, configurable: true });
      Object.defineProperty(process, "stdout", { value: output, configurable: true });
      const code = runTui({
        workspace: "/workspace",
        once: false,
        ascii: true,
        columns: 80,
        rows: 24,
        out: () => {},
        env: {},
        isTTY: false,
        factory: listFactory(status, [newest, oldest]),
        launcher: {
          launch: async () => {
            throw new Error("the run list must not launch");
          },
        },
        session,
      }).then((value) => {
        settled = true;
        return value;
      });

      await until(() => input.isRaw);
      expect(settled).toBe(false);
      await pressUntil(input, "q", "the exit on q", () => settled);
      expect(await code).toBe(0);
    } finally {
      if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
      if (realStdout !== undefined) Object.defineProperty(process, "stdout", realStdout);
    }

    expect(leaves).toBe(1);
    expect(output.text()).toContain("> newest");
  });

  test("quitting leaves the run alone: q exits 0 while the implementing run keeps its child", async () => {
    const run = runState({
      phase: "implementing",
      tasks: [taskState({ id: "first", status: "running" })],
    });
    let launches = 0;
    let pid: number | undefined;
    const launcher: Launcher = {
      launch: async () => {
        launches += 1;
        pid = 4242;
        return {
          pid,
          logPath: "/workspace/.factory/logs/tui-spawn-2026-11-18T10-00-00-000Z.log",
          displayPath: ".factory/logs/tui-spawn-2026-11-18T10-00-00-000Z.log",
          // A detached child the UI never waits on.
          exited: new Promise<never>(() => {}),
        };
      },
    };

    // The run was started from the TUI before the user pressed q.
    await launcher.launch({ kind: "run-text", text: "add a health endpoint" });

    const result = await driveTui(
      listFactory(statusDoc([{ run, tokens: 0, cost: 0 }]), [run]),
      async (input) => {
        await pause();
        input.press("q");
      },
      launcher,
    );

    expect(result.code).toBe(0);
    // The quit path left the child alone: no second launch, no signal and no wait.
    expect(launches).toBe(1);
    expect(pid).toBe(4242);
  });

  test("l opens the land confirmation: Esc launches nothing and Enter launches one land child", async () => {
    const run = runState({ phase: "done" });
    const launches: LaunchAction[] = [];
    const launcher: Launcher = {
      launch: async (action) => {
        launches.push(action);
        return {
          pid: 4242,
          logPath: "/workspace/.factory/logs/tui-spawn-2026-11-18T10-00-00-000Z.log",
          displayPath: ".factory/logs/tui-spawn-2026-11-18T10-00-00-000Z.log",
          // A detached child the UI never waits on.
          exited: new Promise<never>(() => {}),
        };
      },
    };

    const result = await driveTui(
      listFactory(statusDoc([{ run, tokens: 0, cost: 0 }]), [run]),
      async (input, output) => {
        await until(() => output.text().includes(RUN), "the run row");
        input.press("\r");
        await until(() => output.text().includes("l land"), "the done run view");

        // Esc cancels the confirmation: no land child may start.
        input.press("l");
        await until(() => output.text().includes(`Land ${RUN}?`), "the land confirmation");
        input.press("\u001b");
        await pause();
        expect(launches).toEqual([]);

        // A second l opens it again and Enter confirms exactly one detached land.
        const mark = output.writes.length;
        input.press("l");
        await until(
          () => output.writes.slice(mark).join("").includes(`Land ${RUN}?`),
          "the land confirmation again",
        );
        input.press("\r");
        await until(() => launches.length === 1, "the land launch");
        await pause();
        input.press("q");
      },
      launcher,
      true,
    );

    expect(result.code).toBe(0);
    expect(launches).toEqual([{ kind: "land", id: RUN }]);
  });

  test("live detail arrives from the tail: a queued run opened before its log exists updates", async () => {
    const run = runState({
      phase: "queued",
      tasks: [taskState({ id: "first", status: "running" })],
    });
    const status = statusDoc([{ run, tokens: 0, cost: 0 }], { queue: [RUN] });
    resetSeq();
    const merged = event("task.merged", { task: { id: "first", repo: "app" }, commit: "abc" });
    const queries: {
      readonly runId: string;
      readonly follow: boolean;
      readonly fromSeq: number | undefined;
    }[] = [];
    const fail = (): never => {
      throw new Error("opening a run must not write");
    };
    const factory: Factory = {
      status: async () => status,
      listRuns: async () => [run],
      events: async function* (runId, query) {
        queries.push({ runId, follow: query?.follow === true, fromSeq: query?.fromSeq });
        if (query?.follow !== true) return;
        yield { line: JSON.stringify(merged), event: merged };
      },
      run: async () => fail(),
      resume: async () => fail(),
      approve: async () => fail(),
      retry: async () => fail(),
      abort: async () => fail(),
      answer: async () => fail(),
      pause: async () => fail(),
    };
    const input = new FakeInput();
    const output = new FakeOutput();
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const realStdout = Object.getOwnPropertyDescriptor(process, "stdout");
    const session: TerminalSession = {
      enter: () => {},
      leave: () => {},
      get columns(): number {
        return 80;
      },
      get rows(): number {
        return 24;
      },
      onKey: () => () => {},
      onResize: () => () => {},
      onSignal: () => () => {},
    };

    try {
      Object.defineProperty(process, "stdin", { value: input, configurable: true });
      Object.defineProperty(process, "stdout", { value: output, configurable: true });
      const code = runTui({
        workspace: "/workspace",
        once: false,
        ascii: true,
        columns: 80,
        rows: 24,
        out: () => {},
        env: {},
        isTTY: false,
        factory,
        launcher: {
          launch: async () => {
            throw new Error("the run view must not launch");
          },
        },
        session,
      });

      await until(() => input.isRaw);
      input.press("\r");
      await until(() => queries.some((query) => query.follow && query.fromSeq === 1));
      expect(queries).toContainEqual({ runId: RUN, follow: false, fromSeq: undefined });
      // A run with no log yet still gets a tail. Ink writes no frames mid-run under CI, so let
      // the 100 ms frame flush fold the tail; the frame written on unmount shows it.
      await Bun.sleep(1_000);
      input.press("q");
      expect(await code).toBe(0);
      expect(output.text()).toContain("first merged");
    } finally {
      if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
      if (realStdout !== undefined) Object.defineProperty(process, "stdout", realStdout);
    }
  });

  test("q quits from the approval overlay instead of trapping the user at the gate", async () => {
    const run = runState({ phase: "awaiting-approval" });
    const status = statusDoc([{ run, tokens: 0, cost: 0 }]);
    resetSeq();
    const pending = [
      event("approval.pending", {
        specHash: "0123456789abcdef0123456789abcdef",
        changeDir: "openspec/changes/add-health",
      }),
    ];
    const factory: Factory = {
      ...listFactory(status, [run]),
      // The gate's overlay opens from the phase; the stream carries the pending approval.
      events: async function* () {
        for (const item of pending) yield { line: JSON.stringify(item), event: item };
      },
    };
    const input = new FakeInput();
    const output = new FakeOutput();
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const realStdout = Object.getOwnPropertyDescriptor(process, "stdout");
    const session: TerminalSession = {
      enter: () => {},
      leave: () => {},
      get columns(): number {
        return 80;
      },
      get rows(): number {
        return 24;
      },
      onKey: () => () => {},
      onResize: () => () => {},
      onSignal: () => () => {},
    };

    try {
      Object.defineProperty(process, "stdin", { value: input, configurable: true });
      Object.defineProperty(process, "stdout", { value: output, configurable: true });
      let settled = false;
      const code = runTui({
        workspace: "/workspace",
        once: false,
        ascii: true,
        columns: 80,
        rows: 24,
        out: () => {},
        env: {},
        isTTY: false,
        // Ink writes only the last frame when CI is set; this test reads the live screen.
        frames: true,
        factory,
        launcher: {
          launch: async () => {
            throw new Error("the approval gate must not launch on q");
          },
        },
        session,
      }).then((value) => {
        settled = true;
        return value;
      });
      await until(() => input.isRaw);
      // Open only once the list is on screen; otherwise Enter could race the first paint.
      await until(() => output.text().includes(`! ${run.id}`), "the run row");
      // One Enter only: a repeat would call openRun again and abort the load that opens the gate.
      input.press("\r");
      await until(() => output.text().includes("Approval - add-health"), "the approval overlay");
      expect(output.text()).toContain("q quit");
      input.press("q");
      await until(() => settled, "the exit on q");
      expect(await code).toBe(0);
    } finally {
      if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
      if (realStdout !== undefined) Object.defineProperty(process, "stdout", realStdout);
    }
  }, 60_000);

  test("help opens on ? and closes on Esc; q still quits", async () => {
    const run = runState();
    const factory = listFactory(statusDoc([{ run, tokens: 0, cost: 0 }]), [run]);

    const opened = await driveTui(factory, async (input) => {
      input.press("?");
      await pause();
      input.press("q");
    });
    expect(opened.code).toBe(0);
    expect(opened.writes.join("")).toContain("Esc close");

    let mark = 0;
    const closed = await driveTui(factory, async (input, output) => {
      input.press("?");
      await pause();
      input.press("\u001b");
      mark = output.writes.length;
      await pause();
      input.press("q");
    });
    expect(closed.code).toBe(0);
    const afterEscape = closed.writes.slice(mark).join("");
    expect(afterEscape).not.toContain("Help");
    expect(afterEscape).toContain("new change");
  });
});
