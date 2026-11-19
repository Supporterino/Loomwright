import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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
import { landFor } from "../src/controls/actions.ts";
import { ACTIVITY_LIMIT, collectFacts } from "../src/model/facts.ts";
import { formatElapsed, formatPercent, formatTokensShort, truncate } from "../src/model/format.ts";
import { applyKey } from "../src/model/keys.ts";
import { buildViewModel, roleLabel, type ViewModelInput } from "../src/model/view-model.ts";
import { emptyWorkspace, LABELS, replayNotice } from "../src/strings.ts";

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

interface StatusRun {
  readonly run: RunState;
  readonly tokens: number;
  readonly cost: number;
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
  entries: readonly StatusRun[],
  extras: {
    readonly active?: ActiveLock | null;
    readonly queue?: readonly string[];
    readonly driverAlive?: boolean;
  } = {},
): StatusDocument {
  const active = extras.active ?? null;
  return {
    active,
    driverAlive: extras.driverAlive ?? active !== null,
    queue: [...(extras.queue ?? [])],
    corrupt: [],
    runs: entries.map(({ run, tokens, cost }) => ({
      ...run,
      usage: usageSummary(tokens, cost),
    })),
  };
}

function vmInput(overrides: Partial<ViewModelInput>): ViewModelInput {
  const base: ViewModelInput = {
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
  };
  return {
    source: overrides.source ?? base.source,
    screen: overrides.screen ?? base.screen,
    columns: overrides.columns ?? base.columns,
    rows: overrides.rows ?? base.rows,
    now: overrides.now ?? base.now,
    snapshot: overrides.snapshot === undefined ? base.snapshot : overrides.snapshot,
    facts: overrides.facts ?? base.facts,
    status: overrides.status ?? base.status,
    runs: overrides.runs ?? base.runs,
    selectedRunId:
      overrides.selectedRunId === undefined ? base.selectedRunId : overrides.selectedRunId,
    selectedTaskId:
      overrides.selectedTaskId === undefined ? base.selectedTaskId : overrides.selectedTaskId,
    panel: overrides.panel === undefined ? null : overrides.panel,
    notice: overrides.notice === undefined ? null : overrides.notice,
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

describe("format", () => {
  test("elapsed, token and percentage text stays compact", () => {
    expect(formatElapsed(8_000)).toBe("8s");
    expect(formatElapsed(3 * 60_000 + 12_000)).toBe("3m12s");
    expect(formatElapsed(3_600_000 + 2 * 60_000)).toBe("1h02m");
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatTokensShort(12_345)).toBe("12.3k");
    expect(formatTokensShort(999)).toBe("999");
    expect(formatPercent(1, 4)).toBe("25%");
    expect(formatPercent(1, 0)).toBe("0%");
    expect(truncate("health endpoint", 6)).toBe("healt…");
    expect(truncate("short", 10)).toBe("short");
  });
});

describe("buildViewModel", () => {
  test("header: id, phase label, elapsed, tokens, cost and lock role", () => {
    const run = runState({ phase: "awaiting-approval" });
    const status = statusDoc([{ run, tokens: 12_345, cost: 0.42 }]);
    const view = buildViewModel(
      vmInput({
        status,
        runs: [run],
        selectedRunId: RUN,
        now: Date.parse(ISO) + 8_000,
      }),
    );
    expect(view.run?.id).toBe(RUN);
    expect(view.run?.phase).toBe("awaiting-approval");
    expect(LABELS[run.phase]).toBe("awaiting approval");
    expect(view.run?.elapsedMs).toBe(8_000);
    expect(formatElapsed(view.run?.elapsedMs ?? 0)).toBe("8s");
    expect(view.run?.tokens).toBe(12_345);
    expect(view.run?.cost).toBe(0.42);
    expect(view.run?.lock).toEqual({ kind: "idle" });
  });

  test("the list is ordered and labelled: newest first, active pid, queued #1, idle", () => {
    const oldest = runState({ id: "oldest", createdAt: "2026-11-17T09:00:00.000Z" });
    const active = runState({ id: "running", createdAt: "2026-11-17T09:10:00.000Z" });
    const queued = runState({ id: "queued", createdAt: "2026-11-17T09:20:00.000Z" });
    const lock: ActiveLock = { changeId: "running", pid: 4242, host: "host", since: ISO };
    const status = statusDoc(
      [
        { run: oldest, tokens: 0, cost: 0 },
        { run: active, tokens: 0, cost: 0 },
        { run: queued, tokens: 0, cost: 0 },
      ],
      { active: lock, queue: ["queued"] },
    );
    const view = buildViewModel(
      vmInput({
        screen: "list",
        status,
        runs: [oldest, active, queued],
        selectedRunId: "oldest",
      }),
    );
    expect(view.list.map((item) => item.id)).toEqual(["queued", "running", "oldest"]);
    expect(view.list[0]?.role).toEqual({ kind: "queued", position: 1 });
    expect(view.list[1]?.role).toEqual({ kind: "active", pid: 4242 });
    expect(view.list[2]?.role).toEqual({ kind: "idle" });
    expect(roleLabel(view.list[1]?.role ?? { kind: "idle" })).toContain("4242");
    expect(roleLabel(view.list[0]?.role ?? { kind: "idle" })).toBe("queued #1");
    expect(roleLabel(view.list[2]?.role ?? { kind: "idle" })).toBe("idle");
    expect(view.list.filter((item) => item.selected).map((item) => item.id)).toEqual(["oldest"]);
    expect(view.footer.map((hint) => hint.key)).toEqual(["n", "?", "q", "Enter"]);
  });

  test("the list is ordered and labelled: a stale lock reads idle until a driver is alive", () => {
    const stale = runState({ id: "stale" });
    const lock: ActiveLock = { changeId: "stale", pid: 4242, host: "host", since: ISO };
    const status = statusDoc([{ run: stale, tokens: 0, cost: 0 }], {
      active: lock,
      driverAlive: false,
    });
    const view = buildViewModel(
      vmInput({ screen: "list", status, runs: [stale], selectedRunId: "stale" }),
    );
    expect(view.list[0]?.role).toEqual({ kind: "idle" });
    expect(roleLabel(view.list[0]?.role ?? { kind: "idle" })).toBe("idle");
    expect(view.run?.lock).toEqual({ kind: "idle" });
  });

  test("a replay source is read-only and says so", () => {
    const run = runState();
    const view = buildViewModel(runInput(run, [], { source: "replay" }));
    expect(view.run?.replayed).toBe(true);
    expect(view.notice).toBe(replayNotice);
  });

  test("task order is kept from run state, with attempt and failures shown", () => {
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
    const view = buildViewModel(runInput(run, events, { selectedTaskId: "first" }));
    expect(view.run?.tasks.map((task) => task.id)).toEqual(["second", "first"]);
    expect(view.run?.tasks[0]?.selected).toBe(false);
    expect(view.run?.tasks[1]?.selected).toBe(true);
    expect(view.run?.tasks[1]?.attempt).toBe(3);
    expect(view.run?.tasks[1]?.failures).toBe(2);
  });

  test("gate results are grouped per step and the last result per name wins", () => {
    const run = runState({ tasks: [taskState({ id: "first", status: "running" })] });
    resetSeq();
    const events = [
      event("gate.finished", {
        name: "lint",
        type: "lint",
        status: "pass",
        durationMs: 10,
        step: "first",
      }),
      event("gate.finished", {
        name: "test",
        type: "test",
        status: "fail",
        durationMs: 20,
        step: "first",
      }),
      event("gate.finished", {
        name: "lint",
        type: "lint",
        status: "fail",
        durationMs: 30,
        step: "first",
      }),
      event("gate.finished", {
        name: "format",
        type: "format",
        status: "pass",
        durationMs: 5,
        step: "other",
      }),
    ];
    const view = buildViewModel(runInput(run, events, { selectedTaskId: "first" }));
    expect(view.run?.detail?.gates.map((gate) => gate.name)).toEqual(["lint", "test"]);
    expect(view.run?.detail?.gates[0]?.status).toBe("fail");
    expect(view.run?.detail?.gates[0]?.step).toBe("first");
  });

  test("agent role, model and duration come from events; retries are counted", () => {
    const run = runState({ tasks: [taskState({ id: "first", status: "running" })] });
    resetSeq();
    const events = [
      event("agent.started", {
        step: "first",
        agent: "implementer",
        model: "anthropic/claude-sonnet-5",
      }),
      event("agent.finished", {
        step: "first",
        role: "implementer",
        outcome: "succeeded",
        durationMs: 1_234,
        usage: EVENT_USAGE,
        sessionId: "session",
      }),
      event("agent.retry", { step: "first" }),
      event("task.retried", { task: { id: "first", repo: "app" }, attempt: 2 }),
    ];
    const view = buildViewModel(runInput(run, events, { selectedTaskId: "first" }));
    expect(view.run?.detail?.agent).toEqual({
      role: "implementer",
      model: "anthropic/claude-sonnet-5",
      durationMs: 1_234,
    });
    expect(view.run?.detail?.retries).toBe(2);
  });

  test("question.answered flips the snapshot row to answered and keeps the questions file", () => {
    const run = runState({ draft: ".factory/drafts/add-health" });
    resetSeq();
    const events = [
      event("question.raised", {
        step: "intake",
        question: "Which repo?",
        status: "unanswered",
      }),
      event("question.raised", { step: "intake", question: "Need auth?", status: "skipped" }),
      event("question.raised", { step: "design", question: "Path?", status: "unanswered" }),
      event("question.answered", {
        step: "design",
        question: "Path?",
        status: "answered",
        answer: "/health",
      }),
    ];
    const view = buildViewModel(runInput(run, events));
    const questions = view.run?.questions ?? [];
    expect(questions[0]?.status).toBe("unanswered");
    expect(questions[0]?.questionsFile).toBe(
      ".factory/drafts/add-health/openspec/changes/add-health/questions.md",
    );
    expect(questions[0]?.answer).toBeUndefined();
    expect(questions[1]?.status).toBe("skipped");
    expect(questions[2]?.status).toBe("answered");
    expect(questions[2]?.answer).toBe("/health");
  });

  test("a logless run falls back to run state questions", () => {
    const plain = runState({
      clarifications: [{ step: "intake", question: "Which repo?", status: "unanswered", at: ISO }],
    });
    const questions = buildViewModel(runInput(plain)).run?.questions ?? [];
    expect(questions[0]?.status).toBe("unanswered");
    expect(questions[0]?.questionsFile).toBe("openspec/changes/add-health/questions.md");
  });

  test("approval: pending gives hash and change dir, granted adds commit and approver", () => {
    const run = runState({ phase: "awaiting-approval" });
    resetSeq();
    const pendingEvents = [
      event("approval.pending", {
        specHash: "sha256:abc",
        changeDir: "openspec/changes/add-health",
      }),
    ];
    const pending = buildViewModel(runInput(run, pendingEvents)).run?.approval;
    expect(pending?.specHash).toBe("sha256:abc");
    expect(pending?.changeDir).toBe("openspec/changes/add-health");
    expect(pending?.specCommit).toBeNull();
    expect(pending?.approver).toBeNull();

    resetSeq();
    const grantedEvents = [
      ...pendingEvents,
      event("approval.granted", {
        approver: "lars@example.com",
        specHash: "sha256:abc",
        specCommit: "abc123",
      }),
    ];
    const granted = buildViewModel(runInput(run, grantedEvents)).run?.approval;
    expect(granted?.specCommit).toBe("abc123");
    expect(granted?.approver).toBe("lars@example.com");
    expect(granted?.specHash).toBe("sha256:abc");
  });

  test("approval: no pending event leaves the spec hash null", () => {
    const run = runState({ phase: "awaiting-approval" });
    const approval = buildViewModel(runInput(run)).run?.approval;
    expect(approval).not.toBeNull();
    expect(approval?.specHash).toBeNull();
    expect(approval?.changeDir).toBeNull();
  });

  test("an empty workspace explains itself: notice names n and the footer has n, ?, q", () => {
    const view = buildViewModel(vmInput({ screen: "list" }));
    expect(view.list).toEqual([]);
    expect(view.notice).toBe(emptyWorkspace);
    expect(emptyWorkspace).toContain("n");
    expect(view.footer.map((hint) => hint.key)).toEqual(["n", "?", "q"]);
  });

  test("a run exists because run state says so: no event log still lists it", () => {
    const run = runState({ tasks: [taskState({ id: "first", status: "merged" })] });
    const view = buildViewModel(
      runInput(run, [], {
        status: statusDoc([{ run, tokens: 500, cost: 0.25 }]),
      }),
    );
    expect(view.list.map((item) => item.id)).toEqual([RUN]);
    expect(view.list[0]?.tokens).toBe(500);
    expect(view.list[0]?.cost).toBe(0.25);
    expect(view.run?.tasks).toHaveLength(1);
    expect(view.run?.activity).toEqual([]);
    expect(view.run?.replayed).toBe(false);
  });

  test("no run is invented for an event log without run state", () => {
    resetSeq();
    const events: RunEvent[] = [event("run.started", { phase: "design" })];
    const view = buildViewModel(
      vmInput({
        screen: "list",
        snapshot: reduce(events),
        facts: collectFacts(events),
        status: statusDoc([]),
        runs: [],
      }),
    );
    expect(view.list).toEqual([]);
    expect(view.run).toBeNull();
    expect(view.notice).toBe(emptyWorkspace);
  });

  test("live detail arrives from the tail: task row and gate update, header totals wait", () => {
    const run = runState({ tasks: [taskState({ id: "first", status: "running" })] });
    resetSeq();
    const events = [
      event("task.merged", { task: { id: "first", repo: "app" }, commit: "abc" }),
      event("gate.finished", {
        name: "lint",
        type: "lint",
        status: "pass",
        durationMs: 10,
        step: "first",
      }),
    ];
    const view = buildViewModel(
      runInput(run, events, {
        status: statusDoc([{ run, tokens: 100, cost: 0.1 }]),
        selectedTaskId: "first",
      }),
    );
    expect(view.run?.tasks[0]?.status).toBe("merged");
    expect(view.run?.detail?.gates[0]?.status).toBe("pass");
    expect(view.run?.tokens).toBe(100);
  });

  test("activity cap keeps the newest 2,000 lines and names a log reference", () => {
    resetSeq();
    const withRef = event("agent.activity", {
      step: "first",
      detail: "tool output",
      kind: "tool",
      ref: { path: ".factory/logs/add-health/task.log", offset: 0, bytes: 12 },
    });
    const events: RunEvent[] = [withRef];
    for (let index = 0; index < ACTIVITY_LIMIT + 5; index += 1)
      events.push(
        event("agent.activity", { step: "first", detail: `line ${index}`, kind: "tool" }),
      );
    const facts = collectFacts(events);
    expect(facts.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(facts.activity[0]?.seq).toBe(7);
    expect(facts.activity[0]?.text).toBe("line 5");
    expect(facts.activity.at(-1)?.seq).toBe(ACTIVITY_LIMIT + 6);
    expect(facts.activity.at(-1)?.logRef).toBeUndefined();

    const withLog = collectFacts([
      event("agent.activity", {
        step: "first",
        detail: "tool output",
        kind: "tool",
        ref: { path: ".factory/logs/add-health/task.log", offset: 0, bytes: 12 },
      }),
    ]);
    expect(withLog.activity[0]?.logRef).toBe(".factory/logs/add-health/task.log");
  });
});

describe("applyKey", () => {
  test("the list and run keys return their intents", () => {
    const run = runState();
    const list = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc([{ run, tokens: 0, cost: 0 }]),
        runs: [run],
        selectedRunId: RUN,
      }),
    );
    expect(applyKey(list, "q")).toEqual({ kind: "quit" });
    expect(applyKey(list, "?")).toEqual({ kind: "help" });
    // `n` opens intake in entry.tsx before `applyKey` is reached; it is not an intent.
    expect(applyKey(list, "n")).toEqual({ kind: "none" });
    expect(applyKey(list, "Enter")).toEqual({ kind: "open-run", runId: RUN });
    expect(applyKey(list, "Down")).toEqual({ kind: "next-run" });
    expect(applyKey(list, "j")).toEqual({ kind: "next-run" });
    expect(applyKey(list, "Up")).toEqual({ kind: "prev-run" });
    expect(applyKey(list, "k")).toEqual({ kind: "prev-run" });
    expect(applyKey(list, "Esc")).toEqual({ kind: "none" });

    const runView = buildViewModel(runInput(run));
    expect(applyKey(runView, "Esc")).toEqual({ kind: "back" });
    expect(applyKey(runView, "Down")).toEqual({ kind: "next-task" });
    expect(applyKey(runView, "j")).toEqual({ kind: "next-task" });
    expect(applyKey(runView, "Up")).toEqual({ kind: "prev-task" });
    expect(applyKey(runView, "k")).toEqual({ kind: "prev-task" });
    // The approval overlay owns a/A/w/R; the run screen leaves them inert.
    expect(applyKey(runView, "a")).toEqual({ kind: "none" });
    expect(applyKey(runView, "A")).toEqual({ kind: "none" });
    expect(applyKey(runView, "w")).toEqual({ kind: "none" });
    expect(applyKey(runView, "R")).toEqual({ kind: "none" });
    expect(applyKey(runView, "r")).toEqual({ kind: "resume" });
    expect(applyKey(runView, "x")).toEqual({ kind: "abort" });
    expect(applyKey(runView, "t")).toEqual({ kind: "retry" });
    expect(applyKey(runView, "l")).toEqual({ kind: "land" });
    expect(applyKey(runView, "Q")).toEqual({ kind: "open-questions" });
    expect(applyKey(runView, "q")).toEqual({ kind: "quit" });
    expect(applyKey(runView, "?")).toEqual({ kind: "help" });
  });

  test("the run footer leaves a, A, w and R to the approval overlay", () => {
    const implementing = runState({
      specFindings: [
        {
          severity: "nice",
          what: "the spec is wordy",
          problem: "it repeats the request",
          fix: "shorten it",
          impact: "review is slower",
        },
      ],
    });
    const pending = runState({ phase: "awaiting-approval" });
    for (const run of [implementing, pending]) {
      const view = buildViewModel(runInput(run));
      const keys = view.footer.map((hint) => hint.key);
      expect(keys).not.toContain("a");
      expect(keys).not.toContain("A");
      expect(keys).not.toContain("w");
      expect(keys).not.toContain("R");
    }
  });

  test("the land footer hint shares landFor's predicate and appears only for a done run", () => {
    for (const phase of [
      "intake",
      "design",
      "awaiting-approval",
      "queued",
      "implementing",
      "reviewing",
      "contracts",
      "full-suite",
      "closing",
      "done",
      "paused",
      "aborted",
    ] as const) {
      const view = buildViewModel(runInput(runState({ phase })));
      expect(
        view.footer.some((hint) => hint.key === "l"),
        phase,
      ).toBe(landFor(view) !== null);
    }
    const done = buildViewModel(runInput(runState({ phase: "done" })));
    expect(done.footer).toContainEqual({ key: "l", label: "land", enabled: true });
  });

  test("two panes become one: Esc backs out of the drilled task before it leaves the run", () => {
    const run = runState({ tasks: [taskState({ id: "first", status: "running" })] });
    const graph = buildViewModel(runInput(run, [], { columns: 80, selectedTaskId: null }));
    const drilled = buildViewModel(runInput(run, [], { columns: 80, selectedTaskId: "first" }));
    expect(applyKey(graph, "Esc")).toEqual({ kind: "back" });
    expect(applyKey(drilled, "Esc")).toEqual({ kind: "clear-task" });
  });

  test("a panel owns its keys and applyKey stays inert", () => {
    const run = runState();
    const view = buildViewModel(
      vmInput({
        screen: "run",
        status: statusDoc([{ run, tokens: 0, cost: 0 }]),
        runs: [run],
        selectedRunId: RUN,
        panel: {
          kind: "confirm",
          title: "Abort?",
          lines: ["This stops the run."],
          keys: [{ key: "y", label: "yes", enabled: true }],
          notice: null,
        },
      }),
    );
    expect(view.footer.map((hint) => hint.key)).toEqual(["y"]);
    expect(applyKey(view, "a")).toEqual({ kind: "none" });
  });
});

describe("the view-model is tested without Ink", () => {
  test("the suite imports no Ink or React module", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const imports = /^\s*import\s+([\s\S]*?)["']([^"']+)["']/gm;
    const specifiers = [...text.matchAll(imports)].map((match) => match[2] ?? "");
    expect(specifiers).not.toContain("ink");
    expect(specifiers).not.toContain("react");
    expect(specifiers.some((specifier) => specifier.startsWith("ink/"))).toBe(false);
    expect(specifiers.some((specifier) => specifier.startsWith("react/"))).toBe(false);
  });
});

describe("no engine imports", () => {
  const packageSrc = fileURLToPath(new URL("../src", import.meta.url));

  function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...sourceFiles(full));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
    }
    return files;
  }

  test("packages/tui/src imports neither the CLI nor an engine module", () => {
    const violations: string[] = [];
    const engine = /^@loomwright\/core\/(pipeline|scheduler|gates?|lock|state)(\/|$)/;
    const imports = /^\s*import\s+([\s\S]*?)["']([^"']+)["']/gm;
    for (const file of sourceFiles(packageSrc)) {
      const name = relative(packageSrc, file);
      const text = readFileSync(file, "utf8");
      // 1.5: the intake dialog names the draft dir and request completion ranks factory files;
      // runs, approvals and event logs stay off limits everywhere.
      const namesFactoryPath = name === "intake/dialog.tsx" || name === "intake/paths.ts";
      if (text.includes(".factory/") && !namesFactoryPath)
        violations.push(`${name}: references .factory/`);
      // Land is a detached CLI child, never an imported pipeline function.
      if (/\blandChange\b/.test(text)) violations.push(`${name}: references landChange`);
      for (const match of text.matchAll(imports)) {
        const clause = match[1] ?? "";
        const specifier = match[2] ?? "";
        const typeOnly = /^\s*type\b/.test(clause);
        if (specifier === "@loomwright/cli" || specifier.startsWith("@loomwright/cli/"))
          violations.push(`${name}: imports the CLI`);
        if (!typeOnly && engine.test(specifier))
          violations.push(`${name}: value-imports ${specifier}`);
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          if (target !== packageSrc && !target.startsWith(`${packageSrc}${sep}`))
            violations.push(`${name}: escapes the package via ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("only the short commands run in-process", () => {
  const packageSrc = fileURLToPath(new URL("../src", import.meta.url));

  function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...sourceFiles(full));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
    }
    return files;
  }

  function factoryCalls(): Set<string> {
    const calls = new Set<string>();
    for (const file of sourceFiles(packageSrc)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bfactory\.(\w+)\s*\(/g)) {
        const method = match[1];
        if (method !== undefined) calls.add(method);
      }
    }
    return calls;
  }

  test("Factory.run, approve, resume, pause and land are never driven from the UI", () => {
    const calls = factoryCalls();
    for (const forbidden of ["run", "approve", "resume", "pause", "land"]) {
      expect(calls.has(forbidden), `factory.${forbidden} must not be called in-process`).toBe(
        false,
      );
    }
  });

  test("the only write methods called are answer, abort and retry", () => {
    const calls = factoryCalls();
    const reads = new Set(["status", "listRuns", "events"]);
    expect([...calls].filter((method) => !reads.has(method)).sort()).toEqual([
      "abort",
      "answer",
      "retry",
    ]);
  });
});
