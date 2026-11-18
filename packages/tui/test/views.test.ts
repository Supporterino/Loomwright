import { describe, expect, test } from "bun:test";
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
import { applyKey } from "../src/model/keys.ts";
import { buildViewModel, type ViewModel, type ViewModelInput } from "../src/model/view-model.ts";
import { createTerminalSession } from "../src/session.ts";
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

function failingTaskView(): ViewModel {
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
      ref: { path: ".factory/logs/first.log", offset: 0, bytes: 42 },
    }),
    event("agent.activity", { step: "first", detail: "retrying gate", kind: "tool" }),
  ];
  return buildViewModel(runInput(run, events, { selectedTaskId: "first" }));
}

describe("run list", () => {
  test("the list is ordered and labelled: newest first, active pid, queued #1, idle", async () => {
    const oldest = runState({ id: "oldest", createdAt: "2026-11-17T09:00:00.000Z" });
    const active = runState({ id: "running", createdAt: "2026-11-17T09:10:00.000Z" });
    const queued = runState({ id: "queued", createdAt: "2026-11-17T09:20:00.000Z" });
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
    const text = await frame(view, 120, 40, true);
    const lines = text.split("\n");
    expect(lines.some((line) => line.startsWith("> oldest"))).toBe(true);
    const queuedAt = text.indexOf("queued #1");
    const runningAt = text.indexOf("active (pid 4242)");
    const oldestAt = text.indexOf("idle");
    expect(queuedAt).toBeGreaterThan(-1);
    expect(runningAt).toBeGreaterThan(queuedAt);
    expect(oldestAt).toBeGreaterThan(runningAt);
    expect(text).toContain("12.3k tokens");
    expect(text).toContain("$0.42");
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
    expect(drilled).toContain("attempt 0");
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
      .some((line) => line.includes("second") && line.includes("agent"));
    expect(sideBySide).toBe(true);
    expect(graph.run?.tasks).toHaveLength(2);

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
});

describe("task detail", () => {
  test("a task detail shows the evidence: role, duration, attempt, gates and the log tail", async () => {
    const text = await frame(failingTaskView(), 120, 40, false);
    expect(text).toContain("implementer");
    expect(text).toContain("claude-5");
    expect(text).toContain("2m05s");
    expect(text).toContain("attempt 2");
    expect(text).toContain("retries 1");
    const lint = text.indexOf("lint fail");
    const testGate = text.indexOf("test pass");
    expect(lint).toBeGreaterThan(-1);
    expect(testGate).toBeGreaterThan(lint);
    expect(text).toContain("test failed");
    expect(text).toContain("→ .factory/logs/first.log");
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
