import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatusDocument } from "@loomwright/core/factory";
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
import { collectFacts } from "../src/model/facts.ts";
import { buildViewModel, type ViewModel, type ViewModelInput } from "../src/model/view-model.ts";
import { emptyWorkspace } from "../src/strings.ts";
import { renderFrame } from "../src/views/frame.tsx";

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
  events: readonly RunEvent[],
  tokens: number,
  cost: number,
  overrides: Partial<ViewModelInput> = {},
): ViewModelInput {
  return vmInput({
    status: statusDoc([{ run, tokens, cost }]),
    runs: [run],
    selectedRunId: run.id,
    snapshot: reduce(events),
    facts: collectFacts(events),
    ...overrides,
  });
}

function noRuns(): ViewModel {
  return buildViewModel(vmInput({ screen: "list" }));
}

function runningGraph(): ViewModel {
  const run = runState({
    tasks: [
      taskState({ id: "first", title: "Health endpoint", repo: "app", status: "running" }),
      taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
    ],
  });
  const lock: ActiveLock = { changeId: RUN, pid: 4242, host: "host", since: ISO };
  resetSeq();
  const events = [
    event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
    event("agent.started", {
      step: "first",
      agent: "implementer",
      model: "claude-5",
    }),
    event("gate.finished", {
      name: "lint",
      type: "lint",
      status: "pass",
      durationMs: 900,
      step: "first",
    }),
    event("agent.activity", { step: "first", detail: "edited src/health.ts", kind: "tool" }),
  ];
  return buildViewModel(
    runInput(run, events, 12_345, 0.42, {
      selectedTaskId: null,
      status: statusDoc([{ run, tokens: 12_345, cost: 0.42 }], { active: lock }),
    }),
  );
}

function failingTask(): ViewModel {
  const run = runState({
    tasks: [
      taskState({ id: "first", title: "Health endpoint", repo: "app", status: "failed" }),
      taskState({ id: "second", title: "Wire client", repo: "api", deps: ["first"] }),
    ],
  });
  resetSeq();
  const events = [
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
      ref: { path: ".factory/logs/f.log", offset: 0, bytes: 42 },
    }),
  ];
  return buildViewModel(runInput(run, events, 12_345, 0.42, { selectedTaskId: "first" }));
}

function finished(): ViewModel {
  const run = runState({
    phase: "done",
    tasks: [
      taskState({ id: "first", title: "Health endpoint", repo: "app", status: "merged" }),
      taskState({
        id: "second",
        title: "Wire client",
        repo: "api",
        status: "merged",
        deps: ["first"],
      }),
    ],
  });
  resetSeq();
  const events = [
    event("task.merged", { task: { id: "first", repo: "app" }, commit: "abc123" }),
    event("gate.finished", {
      name: "test",
      type: "test",
      status: "pass",
      durationMs: 4_000,
      step: "first",
    }),
    event("task.merged", { task: { id: "second", repo: "api" }, commit: "def456" }),
    event("agent.activity", { step: "second", detail: "merge complete", kind: "step-done" }),
  ];
  return buildViewModel(runInput(run, events, 54_321, 1.23, { selectedTaskId: null }));
}

const STATES = {
  "no-runs": noRuns,
  "running-graph": runningGraph,
  "failing-task": failingTask,
  finished,
} satisfies Record<string, () => ViewModel>;

const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 120, rows: 40 },
] as const;

const framesDir = fileURLToPath(new URL("./fixtures/frames", import.meta.url));

describe("every screen has both sizes", () => {
  for (const [state, make] of Object.entries(STATES)) {
    for (const size of SIZES) {
      const file = join(framesDir, `${state}-${size.columns}x${size.rows}.txt`);
      test(`${state} at ${size.columns}x${size.rows}`, async () => {
        const actual = await renderFrame(make(), size, { ascii: true });
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

describe("an empty workspace frame", () => {
  test("says no changes exist and names n", async () => {
    const text = await renderFrame(noRuns(), { columns: 80, rows: 24 }, { ascii: true });
    expect(text).toContain(emptyWorkspace);
    expect(text).toContain("n");
  });
});
