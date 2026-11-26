import { describe, expect, test } from "bun:test";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState, TaskState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import {
  type EventType,
  PROTOCOL_VERSION,
  type RunEvent,
  RunEvent as RunEventSchema,
  reduce,
} from "@loomwright/protocol";
import {
  linesInScope,
  type ScopeTask,
  scopesFor,
  scopesOfLine,
  taskScopeFor,
} from "../src/model/activity-scope.ts";
import { collectFacts } from "../src/model/facts.ts";
import { type ActivityLine, buildViewModel, type ViewModelInput } from "../src/model/view-model.ts";

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

const APP_TASKS: readonly ScopeTask[] = [
  { id: "first", repo: "app" },
  { id: "test-first", repo: "app" },
  { id: "second", repo: "api" },
];

function activity(seq: number, step: string, kind = "task", text = `line ${seq}`): ActivityLine {
  return { seq, step, kind, text };
}

function texts(lines: readonly ActivityLine[]): (string | undefined)[] {
  return lines.map((line) => line.text);
}

function steps(lines: readonly ActivityLine[]): (string | undefined)[] {
  return lines.map((line) => line.step);
}

function detailFor(tasks: readonly ScopeTask[], lines: readonly ActivityLine[], taskId: string) {
  return linesInScope(tasks, lines, { kind: "task", taskId });
}

describe("activity scope", () => {
  test("the task's own lines stay: task, activity and gate lines named by its id", () => {
    const lines = [
      activity(1, "first", "task", "started"),
      activity(2, "first", "agent", "edited src/health.ts"),
      activity(3, "first", "gate", "lint pass"),
    ];
    expect(steps(detailFor(APP_TASKS, lines, "first"))).toEqual(["first", "first", "first"]);
    expect(texts(detailFor(APP_TASKS, lines, "first"))).toEqual([
      "started",
      "edited src/health.ts",
      "lint pass",
    ]);
  });

  test("the tester task's activity joins its repo: each detail keeps only its own lines", () => {
    const lines = [
      activity(1, "first", "agent", "first tool line"),
      activity(2, "test-first", "agent", "tester tool line"),
    ];
    expect(texts(detailFor(APP_TASKS, lines, "first"))).toEqual(["first tool line"]);
    expect(steps(detailFor(APP_TASKS, lines, "first"))).toEqual(["first"]);
    expect(texts(detailFor(APP_TASKS, lines, "test-first"))).toEqual(["tester tool line"]);
    expect(steps(detailFor(APP_TASKS, lines, "test-first"))).toEqual(["test-first"]);
    expect(texts(linesInScope(APP_TASKS, lines, { kind: "repo", repo: "app" }))).toEqual([
      "first tool line",
      "tester tool line",
    ]);
  });

  test("reviewer and full-suite lines join the task: the detail keeps only the task's own lines", () => {
    const lines = [
      activity(1, "first", "task", "started"),
      activity(2, "first", "agent", "edited src/health.ts"),
      activity(3, "first", "gate", "lint pass"),
      activity(4, "review:app", "agent", "review found a bug"),
      activity(5, "app", "gate", "full suite passed"),
    ];
    expect(texts(detailFor(APP_TASKS, lines, "first"))).toEqual([
      "started",
      "edited src/health.ts",
      "lint pass",
    ]);
    expect(steps(detailFor(APP_TASKS, lines, "first"))).toEqual(["first", "first", "first"]);
    expect(texts(linesInScope(APP_TASKS, lines, { kind: "repo", repo: "app" }))).toEqual([
      "started",
      "edited src/health.ts",
      "lint pass",
      "review found a bug",
      "full suite passed",
    ]);
  });

  test("the repo scope keeps the reviewer and full-suite lines, each with its step label", () => {
    const lines = [
      activity(1, "first", "agent", "first tool line"),
      activity(2, "review:app", "agent", "review found a bug"),
      activity(3, "explore:app", "agent", "explored app"),
      activity(4, "app", "gate", "full suite passed"),
    ];
    expect(texts(detailFor(APP_TASKS, lines, "first"))).toEqual(["first tool line"]);
    expect(detailFor(APP_TASKS, lines, "test-first")).toEqual([]);
    expect(scopesOfLine(APP_TASKS, lines[1] ?? activity(1, "review:app"))).toEqual([
      { kind: "repo", repo: "app" },
    ]);
    const repo = linesInScope(APP_TASKS, lines, { kind: "repo", repo: "app" });
    expect(steps(repo)).toEqual(["first", "review:app", "explore:app", "app"]);
    expect(texts(repo)).toEqual([
      "first tool line",
      "review found a bug",
      "explored app",
      "full suite passed",
    ]);
  });

  test("install lines stay in the repo scope and out of both app task details", () => {
    const lines = [
      activity(1, "app", "install", "install started"),
      activity(2, "app", "install", "install finished"),
    ];
    for (const taskId of ["first", "test-first"]) {
      expect(detailFor(APP_TASKS, lines, taskId), taskId).toEqual([]);
    }
    expect(texts(linesInScope(APP_TASKS, lines, { kind: "repo", repo: "app" }))).toEqual([
      "install started",
      "install finished",
    ]);
  });

  test("another repo's lines stay out of the app detail and join the api repo scope", () => {
    const lines = [
      activity(1, "second", "agent", "api task line"),
      activity(2, "review:api", "agent", "api review"),
    ];
    expect(detailFor(APP_TASKS, lines, "first")).toEqual([]);
    expect(detailFor(APP_TASKS, lines, "test-first")).toEqual([]);
    expect(texts(detailFor(APP_TASKS, lines, "second"))).toEqual(["api task line"]);
    expect(steps(detailFor(APP_TASKS, lines, "second"))).toEqual(["second"]);
    expect(texts(linesInScope(APP_TASKS, lines, { kind: "repo", repo: "api" }))).toEqual([
      "api task line",
      "api review",
    ]);
  });

  test("the contract review stays run-scoped while the contract-fix task keeps its own lines", () => {
    const tasks: readonly ScopeTask[] = [...APP_TASKS, { id: "fix-contracts", repo: "app" }];
    const lines = [
      activity(1, "contract-review", "agent", "contract review"),
      activity(2, "fix-contracts", "task", "contract fix"),
    ];
    expect(scopesOfLine(tasks, lines[0] ?? activity(1, "contract-review"))).toEqual([
      { kind: "run" },
    ]);
    expect(texts(linesInScope(tasks, lines, { kind: "run" }))).toEqual([
      "contract review",
      "contract fix",
    ]);
    expect(detailFor(tasks, lines, "first")).toEqual([]);
    expect(texts(detailFor(tasks, lines, "fix-contracts"))).toEqual(["contract fix"]);
    expect(texts(linesInScope(tasks, lines, { kind: "repo", repo: "app" }))).toEqual([
      "contract fix",
    ]);
  });

  test("the run scope carries everything in the ring's oldest-first order", () => {
    const lines = [
      activity(1, "run", "run", "run line"),
      activity(2, "first", "task", "first line"),
      activity(3, "review:app", "agent", "review line"),
      activity(4, "app", "gate", "gate line"),
      activity(5, "second", "agent", "api line"),
      activity(6, "contract-review", "agent", "contract line"),
    ];
    const runScope = linesInScope(APP_TASKS, lines, { kind: "run" });
    expect(runScope).toEqual(lines);
    expect(runScope.map((line) => line.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    // A task scope's lines are a subset of the run scope, not a replacement for it.
    const taskSeqs = detailFor(APP_TASKS, lines, "first").map((line) => line.seq);
    expect(taskSeqs.length).toBeGreaterThan(0);
    expect(taskSeqs.every((lineSeq) => runScope.some((line) => line.seq === lineSeq))).toBe(true);
  });

  test("a task with an empty repo yields only its id scope, and every task's scope is its id", () => {
    const solo: ScopeTask = { id: "solo", repo: "" };
    const lines = [activity(1, "solo", "task", "solo line")];
    expect(taskScopeFor(solo)).toEqual([{ kind: "task", taskId: "solo" }]);
    expect(scopesOfLine([solo], lines[0] ?? activity(1, "solo"))).toEqual([
      { kind: "task", taskId: "solo" },
    ]);
    expect(texts(detailFor([solo], lines, "solo"))).toEqual(["solo line"]);
    for (const task of APP_TASKS) {
      expect(taskScopeFor(task), task.id).toEqual([{ kind: "task", taskId: task.id }]);
    }
  });

  test("no line is ever assigned zero scopes", () => {
    const vocabulary = [
      "first",
      "test-first",
      "second",
      "review:app",
      "explore:app",
      "app",
      "api",
      "run",
      "design",
      "intake",
      "reword",
      "contract-review",
      "unknown-step",
      "",
      "review:",
      "explore:",
    ];
    for (const step of vocabulary) {
      expect(scopesOfLine(APP_TASKS, activity(1, step)).length, step).toBeGreaterThan(0);
    }
  });

  test("scopesFor lists the run, then each task and its repo once", () => {
    expect(scopesFor(APP_TASKS)).toEqual([
      { kind: "run" },
      { kind: "task", taskId: "first" },
      { kind: "repo", repo: "app" },
      { kind: "task", taskId: "test-first" },
      { kind: "task", taskId: "second" },
      { kind: "repo", repo: "api" },
    ]);
  });
});

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

function statusDoc(run: RunState): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [{ ...run, usage: usageSummary(0, 0) }],
  };
}

function runInput(run: RunState, events: readonly RunEvent[]): ViewModelInput {
  return {
    source: "live",
    screen: "run",
    columns: 120,
    rows: 40,
    now: Date.parse(ISO) + 8_000,
    snapshot: reduce(events),
    facts: collectFacts(events),
    status: statusDoc(run),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId: "first",
    panel: null,
    notice: null,
  };
}

describe("the run view derives the task detail", () => {
  test("the task detail stays task-scoped", () => {
    const run = runState({
      tasks: [
        taskState({ id: "first", repo: "app" }),
        taskState({ id: "second", repo: "app" }),
        taskState({ id: "third", repo: "api" }),
      ],
    });
    resetSeq();
    const events = [
      event("progress.line", { level: "normal", text: "run-level progress" }),
      event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
      event("agent.activity", { step: "review:app", detail: "review app", kind: "tool" }),
      event("gate.finished", {
        name: "test",
        type: "test",
        status: "pass",
        durationMs: 10,
        step: "app",
      }),
      event("task.started", { task: { id: "second", repo: "app" }, attempt: 1 }),
      event("agent.activity", { step: "second", detail: "second line", kind: "tool" }),
      event("task.started", { task: { id: "third", repo: "api" }, attempt: 1 }),
      event("agent.activity", { step: "third", detail: "api line", kind: "tool" }),
    ];
    const detail = buildViewModel(runInput(run, events)).run;

    expect(steps(detail?.detail?.activity ?? [])).toEqual(["first"]);
    expect(texts(detail?.detail?.activity ?? [])).toEqual(["started (attempt 1)"]);
    expect(texts(detail?.activity ?? [])).toContain("run-level progress");
    expect(texts(detail?.activity ?? [])).toContain("api line");
  });
});
