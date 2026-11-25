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
import {
  buildViewModel,
  roleLabel,
  type SpecFindingRow,
  singlePaneTailRows,
  taskDetailGateRows,
  taskDetailTailRows,
  twoPaneTailRows,
  type ViewModelInput,
} from "../src/model/view-model.ts";
import { lastOffset, moveBy, pageSize, windowTitle } from "../src/model/viewport.ts";
import {
  emptyWorkspace,
  findingsCount,
  LABELS,
  pausedFindings,
  replayNotice,
} from "../src/strings.ts";
import { ASCII_GLYPHS, UNICODE_GLYPHS } from "../src/theme/glyphs.ts";

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
    listOffset: overrides.listOffset ?? 0,
    taskOffset: overrides.taskOffset ?? 0,
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
    expect(truncate("health endpoint", 6, UNICODE_GLYPHS)).toBe("healt…");
    expect(truncate("short", 10, UNICODE_GLYPHS)).toBe("short");
    expect(truncate("health endpoint", 6, ASCII_GLYPHS)).toBe("hea...");
  });
});

describe("buildViewModel", () => {
  test("a run summary with controls and newlines is flattened before any pane renders it", () => {
    const run = runState({
      phase: "awaiting-approval",
      summary: "Add\u001b[2J health\nendpoints",
    });
    const status = statusDoc([{ run, tokens: 0, cost: 0 }]);
    const view = buildViewModel(vmInput({ status, runs: [run], selectedRunId: RUN }));
    expect(view.list[0]?.summary).toBe("Add[2J health endpoints");
    expect(view.run?.summary).toBe("Add[2J health endpoints");
    expect(view.run?.approval?.summary).toBe("Add[2J health endpoints");
  });

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
    const finding = {
      severity: "should",
      file: "packages/tui/src/model/view-model.ts",
      line: 28,
      what: "the row lacks the count",
      problem: "findings are invisible",
      fix: "carry the count",
      impact: "the run looks idle",
    };
    const oldest = runState({
      id: "oldest",
      createdAt: "2026-11-17T09:00:00.000Z",
      summary: "Oldest change",
    });
    const active = runState({
      id: "running",
      createdAt: "2026-11-17T09:10:00.000Z",
      summary: "Active change",
    });
    const queued = runState({
      id: "queued",
      createdAt: "2026-11-17T09:20:00.000Z",
      summary: "Queued change",
      specFindings: [finding, { ...finding, severity: "must", line: 97 }],
    });
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
    expect(view.list.map((item) => item.summary)).toEqual([
      "Queued change",
      "Active change",
      "Oldest change",
    ]);
    expect(view.list.map((item) => item.findings)).toEqual([2, 0, 0]);
    expect(view.list[0]?.role).toEqual({ kind: "queued", position: 1 });
    expect(view.list[1]?.role).toEqual({ kind: "active", pid: 4242 });
    expect(view.list[2]?.role).toEqual({ kind: "idle" });
    expect(roleLabel(view.list[1]?.role ?? { kind: "idle" })).toContain("4242");
    expect(roleLabel(view.list[0]?.role ?? { kind: "idle" })).toBe("queued #1");
    expect(roleLabel(view.list[2]?.role ?? { kind: "idle" })).toBe("idle");
    expect(view.list.filter((item) => item.selected).map((item) => item.id)).toEqual(["oldest"]);
    // Every row carries its elapsed time even when no event has updated the run.
    expect(view.list.map((item) => formatElapsed(item.elapsedMs))).toEqual([
      "40m08s",
      "50m08s",
      "1h00m",
    ]);
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

  test("replay is read-only: the footer lists only log, help and quit", () => {
    for (const phase of ["implementing", "paused", "done", "aborted"] as const) {
      const run = runState({
        phase,
        tasks: [taskState({ id: "first", status: "failed" })],
      });
      const view = buildViewModel(runInput(run, [], { source: "replay", selectedTaskId: "first" }));
      expect(
        view.footer.map((hint) => hint.key),
        phase,
      ).toEqual(["L", "?", "q"]);
    }
  });

  test("the keys are documented: the run footer offers L for the activity log in live and replay", () => {
    const run = runState();
    for (const source of ["live", "replay"] as const) {
      const view = buildViewModel(runInput(run, [], { source }));
      expect(view.footer, source).toContainEqual({ key: "L", label: "log", enabled: true });
    }
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

  test("control characters are stripped from task rows, questions and approval evidence", () => {
    const task = taskState({
      id: "\u001b[2Jtask",
      title: "\u001b]52;c;title\u0007",
      repo: "rep\u001b[2Jo",
    });
    const run = runState({ phase: "awaiting-approval", tasks: [task] });
    resetSeq();
    const view = buildViewModel(
      runInput(
        run,
        [
          event("task.started", {
            task: { id: "\u001b[2Jtask", repo: "rep\u001b[2Jo" },
            attempt: 1,
          }),
          event("agent.started", {
            step: "\u001b[2Jtask",
            agent: "\u001b[2Jimpl",
            model: "model\u001b]52;c;x\u0007",
          }),
          event("question.raised", {
            step: "\u001b[2Jintake",
            question: "\u001b]52;c;q\u0007",
            status: "unanswered",
          }),
          event("approval.pending", {
            specHash: "\u001b]52;c;hash\u0007",
            changeDir: "\u001b[2Jdir",
          }),
        ],
        { selectedTaskId: "[2Jtask" },
      ),
    );

    const row = view.run?.tasks[0];
    expect(row?.id).toBe("[2Jtask");
    expect(row?.title).toBe("]52;c;title");
    expect(row?.repo).toBe("rep[2Jo");
    expect(row?.selected).toBe(true);
    expect(view.run?.detail?.agent?.role).toBe("[2Jimpl");
    expect(view.run?.detail?.agent?.model).toBe("model]52;c;x");
    expect(view.run?.questions[0]?.step).toBe("[2Jintake");
    expect(view.run?.questions[0]?.question).toBe("]52;c;q");
    expect(view.run?.approval?.specHash).toBe("]52;c;hash");
    expect(view.run?.approval?.changeDir).toBe("[2Jdir");

    resetSeq();
    const granted = buildViewModel(
      runInput(run, [
        event("approval.granted", {
          approver: "\u001b[2Jdev\u0007",
          specHash: "\u001b]52;c;h\u0007",
          specCommit: "\u001b[2Jabc\u0007",
        }),
      ]),
    ).run?.approval;
    expect(granted?.specHash).toBe("]52;c;h");
    expect(granted?.specCommit).toBe("[2Jabc");
    expect(granted?.approver).toBe("[2Jdev");
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

  test("an answered run-state record beats a stale unanswered snapshot row", () => {
    // The status poll persisted the idle answer; the event tail has not folded question.answered.
    const run = runState({
      clarifications: [
        { step: "intake", question: "Which repo?", status: "answered", answer: "app", at: ISO },
      ],
    });
    resetSeq();
    const events = [
      event("question.raised", {
        step: "intake",
        question: "Which repo?",
        status: "unanswered",
      }),
    ];
    const questions = buildViewModel(runInput(run, events)).run?.questions ?? [];
    expect(questions).toHaveLength(1);
    expect(questions[0]?.status).toBe("answered");
    expect(questions[0]?.answer).toBe("app");
  });

  test("a record only the event tail knows yet still renders", () => {
    const run = runState();
    resetSeq();
    const events = [
      event("question.raised", { step: "intake", question: "Which repo?", status: "unanswered" }),
    ];
    const questions = buildViewModel(runInput(run, events)).run?.questions ?? [];
    expect(questions[0]?.status).toBe("unanswered");
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

describe("spec findings", () => {
  const finding: SpecFindingRow = {
    severity: "must",
    file: "packages/core/src/state/run.ts",
    line: 111,
    what: "carries the paused reason",
    problem: "the run view cannot say why it stopped",
    fix: "carry pausedReason in RunDetail",
    impact: "the user rewords blind",
  };

  test("RunDetail carries severity, file, line and the flattened text in run-state order", () => {
    const second: SpecFindingRow = {
      severity: "nice",
      file: "packages/tui/src/strings.ts",
      line: 40,
      what: "the count reads twice",
      problem: "the label repeats",
      fix: "name it once",
      impact: "the row is noisy",
    };
    const run = runState({
      phase: "paused",
      pausedReason: "spec findings need reword",
      specFindings: [finding, second],
    });
    const detail = buildViewModel(runInput(run)).run;
    expect(detail?.specFindings.map((row) => row.severity)).toEqual(["must", "nice"]);
    expect(detail?.specFindings[0]).toEqual(finding);
    expect(detail?.specFindings[1]).toEqual(second);
    expect(detail?.pausedReason).toBe("spec findings need reword");
  });

  test("the run list marks findings: the count is carried and a run without findings reads 0", () => {
    const paused = runState({
      phase: "paused",
      specFindings: [finding, { ...finding, severity: "should", line: 97 }],
    });
    const clean = runState({ id: "clean" });
    const view = buildViewModel(
      vmInput({
        screen: "list",
        status: statusDoc([
          { run: paused, tokens: 0, cost: 0 },
          { run: clean, tokens: 0, cost: 0 },
        ]),
        runs: [paused, clean],
        selectedRunId: RUN,
      }),
    );
    expect(view.list.find((item) => item.id === RUN)?.findings).toBe(2);
    expect(view.list.find((item) => item.id === "clean")?.findings).toBe(0);
  });

  test("control characters are stripped from spec findings and pausedReason", () => {
    const run = runState({
      phase: "paused",
      pausedReason: "\u001b[2Jblocked\u0007",
      specFindings: [
        {
          severity: "must",
          what: "\u001b[2Jwhat\u0007",
          problem: "\u001b]52;c;problem\u0007",
          fix: "\u001b[2Jfix\u0007",
          impact: "\u001b]52;c;impact\u0007",
        },
      ],
    });
    const detail = buildViewModel(runInput(run)).run;
    expect(detail?.specFindings[0]?.what).toBe("[2Jwhat");
    expect(detail?.specFindings[0]?.problem).toBe("]52;c;problem");
    expect(detail?.specFindings[0]?.fix).toBe("[2Jfix");
    expect(detail?.specFindings[0]?.impact).toBe("]52;c;impact");
    expect(detail?.pausedReason).toBe("[2Jblocked");
  });

  test("a finding with no file or line carries null, never undefined or an empty string", () => {
    const run = runState({
      phase: "paused",
      specFindings: [{ severity: "should", what: "w", problem: "p", fix: "f", impact: "i" }],
    });
    const row = buildViewModel(runInput(run)).run?.specFindings[0];
    expect(row?.file).toBeNull();
    expect(row?.line).toBeNull();
    expect(buildViewModel(runInput(runState())).run?.pausedReason).toBeNull();
  });

  test("the banner says reword is needed: the words name the count and the singular", () => {
    expect(pausedFindings("—", 3)).toBe("paused — 3 spec findings need reword");
    expect(pausedFindings("—", 1)).toBe("paused — 1 spec finding needs reword");
    expect(pausedFindings("-", 2)).toBe("paused - 2 spec findings need reword");
    expect(findingsCount(2)).toBe("2 findings");
    expect(findingsCount(1)).toBe("1 finding");
  });
});

describe("reword availability", () => {
  const ACCEPTED = [
    "queued",
    "implementing",
    "reviewing",
    "contracts",
    "full-suite",
    "closing",
    "paused",
    "aborted",
  ] as const;
  const REFUSED = ["intake", "design", "awaiting-approval", "done"] as const;
  const LOCK: ActiveLock = { changeId: RUN, pid: 4242, host: "host", since: ISO };

  function viewWith(
    run: RunState,
    extras: { readonly active?: ActiveLock | null; readonly driverAlive?: boolean } = {},
  ) {
    return buildViewModel(
      runInput(run, [], { status: statusDoc([{ run, tokens: 0, cost: 0 }], extras) }),
    );
  }

  test("the eight phases the CLI accepts offer a reword", () => {
    for (const phase of ACCEPTED) {
      const view = buildViewModel(runInput(runState({ phase })));
      expect(view.run?.reword, phase).toEqual({ state: "available", reason: null });
      expect(view.footer, phase).toContainEqual({ key: "w", label: "reword", enabled: true });
    }
  });

  test("phases the CLI refuses offer no reword", () => {
    for (const phase of REFUSED) {
      const view = buildViewModel(runInput(runState({ phase })));
      expect(view.run?.reword, phase).toEqual({ state: "absent", reason: null });
      expect(
        view.footer.some((hint) => hint.key === "w"),
        phase,
      ).toBe(false);
    }
  });

  test("a replay source offers no reword even at implementing", () => {
    const view = buildViewModel(
      runInput(runState({ phase: "implementing" }), [], { source: "replay" }),
    );
    expect(view.run?.reword).toEqual({ state: "absent", reason: null });
    expect(view.footer.some((hint) => hint.key === "w")).toBe(false);
  });

  test("a driven run explains why w is inert", () => {
    const view = viewWith(runState({ phase: "implementing" }), { active: LOCK });
    const reason = "add-health is being driven by pid 4242; stop it first";
    expect(view.run?.reword).toEqual({ state: "inert", reason });
    expect(view.footer).toContainEqual({ key: "w", label: "reword", enabled: false, reason });
  });

  test("another change holding the lock names that change", () => {
    const other: ActiveLock = { changeId: "faster-imports", pid: 99, host: "host", since: ISO };
    const view = viewWith(runState({ phase: "implementing" }), { active: other });
    const reason =
      "faster-imports is the active change; finish or abort it before rewording add-health";
    expect(view.run?.reword).toEqual({ state: "inert", reason });
    expect(view.footer).toContainEqual({ key: "w", label: "reword", enabled: false, reason });
  });

  test("a stale lock with a dead driver leaves the reword available", () => {
    const view = viewWith(runState({ phase: "implementing" }), {
      active: LOCK,
      driverAlive: false,
    });
    expect(view.run?.lock).toEqual({ kind: "idle" });
    expect(view.run?.reword).toEqual({ state: "available", reason: null });
    expect(view.footer).toContainEqual({ key: "w", label: "reword", enabled: true });
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
    expect(applyKey(list, "PgUp")).toEqual({ kind: "page-up" });
    expect(applyKey(list, "PgDn")).toEqual({ kind: "page-down" });
    expect(applyKey(list, "g")).toEqual({ kind: "first" });
    expect(applyKey(list, "G")).toEqual({ kind: "last" });
    expect(applyKey(list, "Esc")).toEqual({ kind: "none" });

    const runView = buildViewModel(runInput(run));
    expect(applyKey(runView, "Esc")).toEqual({ kind: "back" });
    expect(applyKey(runView, "Down")).toEqual({ kind: "next-task" });
    expect(applyKey(runView, "j")).toEqual({ kind: "next-task" });
    expect(applyKey(runView, "Up")).toEqual({ kind: "prev-task" });
    expect(applyKey(runView, "k")).toEqual({ kind: "prev-task" });
    expect(applyKey(runView, "PgUp")).toEqual({ kind: "page-up" });
    expect(applyKey(runView, "PgDn")).toEqual({ kind: "page-down" });
    expect(applyKey(runView, "g")).toEqual({ kind: "first" });
    expect(applyKey(runView, "G")).toEqual({ kind: "last" });
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

  test("the run footer leaves a, A and R to the approval overlay", () => {
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

describe("scroll windows", () => {
  /** `count` runs newest first: `run-0` is the oldest row. */
  function manyRuns(count: number): RunState[] {
    return Array.from({ length: count }, (_, index) =>
      runState({
        id: `run-${index}`,
        summary: `run ${index}`,
        createdAt: new Date(Date.parse(ISO) + index * 1_000).toISOString(),
      }),
    );
  }

  function listView(
    runs: readonly RunState[],
    selectedRunId: string,
    overrides: Partial<ViewModelInput> = {},
  ) {
    return buildViewModel(
      vmInput({
        screen: "list",
        rows: 24,
        status: statusDoc(runs.map((run) => ({ run, tokens: 0, cost: 0 }))),
        runs,
        selectedRunId,
        ...overrides,
      }),
    );
  }

  test("a 60-run list keeps the frame still", () => {
    const runs = manyRuns(60);
    const top = listView(runs, "run-59");
    expect(top.listWindow).toEqual({ offset: 0, size: 22, total: 60 });

    const bottom = listView(runs, "run-0");
    expect(bottom.listWindow.offset).toBe(60 - 22);
    expect(bottom.listWindow.offset + bottom.listWindow.size).toBe(60);
  });

  test("resize re-clamps the offset", () => {
    const runs = manyRuns(60);
    const small = listView(runs, "run-0", { rows: 24 });
    expect(small.listWindow).toEqual({ offset: 38, size: 22, total: 60 });
    expect(windowTitle("runs", small.listWindow)).toBe("runs 39-60/60");

    // Growing to 120x40 keeps the same requested offset but clamps it to the larger window.
    const grown = listView(runs, "run-0", { rows: 40, listOffset: small.listWindow.offset });
    expect(grown.listWindow).toEqual({ offset: 22, size: 38, total: 60 });
    expect(grown.listWindow.offset + grown.listWindow.size).toBe(60);
    expect(windowTitle("runs", grown.listWindow)).toBe("runs 23-60/60");

    // Shrinking back re-clamps in the other direction and keeps the selection visible.
    const shrunk = listView(runs, "run-0", { rows: 24, listOffset: grown.listWindow.offset });
    expect(shrunk.listWindow.offset).toBe(38);
    expect(shrunk.listWindow.offset).toBeLessThanOrEqual(60 - shrunk.listWindow.size);
  });

  test("the selection stays visible for every requested offset", () => {
    const runs = manyRuns(60);
    // Newest first, so `run-30` sits at index 29.
    for (let offset = 0; offset <= 40; offset += 1) {
      const view = listView(runs, "run-30", { listOffset: offset });
      expect(view.listWindow.offset, `offset ${offset}`).toBeLessThanOrEqual(29);
      expect(view.listWindow.offset + view.listWindow.size, `offset ${offset}`).toBeGreaterThan(29);
    }
  });

  test("the title names the window only when needed", () => {
    const runs = manyRuns(12);
    // 9 rows fit at 11 terminal rows; offset 2 puts the window over rows 3-11.
    const windowed = listView(runs, "run-3", { rows: 11, listOffset: 2 });
    expect(windowed.listWindow).toEqual({ offset: 2, size: 9, total: 12 });
    expect(windowTitle("runs", windowed.listWindow)).toBe("runs 3-11/12");

    const fits = listView(runs, "run-3", { rows: 40 });
    expect(fits.listWindow).toEqual({ offset: 0, size: 38, total: 12 });
    expect(windowTitle("runs", fits.listWindow)).toBeNull();
  });

  test("a page move keeps the selection in the window", () => {
    const tasks = Array.from({ length: 30 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const run = runState({ tasks });
    const input = runInput(run, [], { rows: 24, selectedTaskId: "task-0" });
    const first = buildViewModel(input);
    expect(first.taskWindow).toEqual({ offset: 0, size: 17, total: 30 });

    let selected = "task-0";
    let offset = first.taskWindow.offset;
    for (let press = 0; press < 2; press += 1) {
      const index = tasks.findIndex((task) => task.id === selected);
      const next = Math.min(tasks.length - 1, index + pageSize(first.taskWindow.size));
      offset = moveBy(offset, pageSize(first.taskWindow.size), tasks.length, first.taskWindow.size);
      selected = `task-${next}`;
      const view = buildViewModel({ ...input, selectedTaskId: selected, taskOffset: offset });
      expect(view.taskWindow.offset).toBeLessThanOrEqual(next);
      expect(view.taskWindow.offset + view.taskWindow.size).toBeGreaterThan(next);
      offset = view.taskWindow.offset;
    }
    expect(offset).toBe(lastOffset(30, first.taskWindow.size));
    expect(selected).toBe("task-29");
  });

  test("a requested offset clamps at both ends", () => {
    const runs = manyRuns(60);
    expect(listView(runs, "run-0", { listOffset: 999 }).listWindow.offset).toBe(38);
    expect(listView(runs, "run-59", { listOffset: -5 }).listWindow.offset).toBe(0);
  });

  test("singlePaneTailRows keeps its notice fixture and sizes from the graph window", () => {
    const notice = Array.from({ length: 12 }, (_, index) => `notice line ${index + 1}`).join("\n");
    const oneTask = buildViewModel(
      runInput(runState({ tasks: [taskState({ id: "first" })] }), [], {
        rows: 24,
        notice,
        selectedTaskId: null,
      }),
    );
    expect(singlePaneTailRows(oneTask)).toBe(8);

    const twelve = Array.from({ length: 12 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    // The four-row floor wins over the graph, so all twelve still fit with the tail intact.
    const fits = buildViewModel(
      runInput(runState({ tasks: twelve }), [], { rows: 24, selectedTaskId: null }),
    );
    expect(fits.taskWindow.size).toBe(12);
    expect(singlePaneTailRows(fits)).toBe(9);
  });

  test("a paused run with findings counts its banner row in every budget", () => {
    const findings: readonly SpecFindingRow[] = [
      {
        severity: "must",
        file: "packages/tui/src/views/header.tsx",
        line: 42,
        what: "the banner hides the count",
        problem: "a paused run looks like a generic pause",
        fix: "name the findings in words",
        impact: "the user cannot see why the run stopped",
      },
      {
        severity: "should",
        file: "packages/tui/src/model/view-model.ts",
        line: 437,
        what: "the banner row is missing",
        problem: "the budget counts one header row for a two-row header",
        fix: "count the paused banner",
        impact: "a long paused run overflows",
      },
      {
        severity: "nice",
        file: "packages/tui/src/strings.ts",
        line: 44,
        what: "the third finding is a fixture",
        problem: "three findings exercise the plural banner",
        fix: "keep three",
        impact: "none",
      },
    ];
    const tasks = Array.from({ length: 24 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const view = buildViewModel(
      runInput(runState({ phase: "paused", specFindings: findings, tasks }), [], {
        rows: 24,
        selectedTaskId: "task-0",
      }),
    );
    // 24 rows - two header rows - graph and titles - footer; the graph gives way to the tail floor.
    expect(view.taskWindow.size).toBe(16);
    expect(singlePaneTailRows(view)).toBe(4);
    expect(twoPaneTailRows(view)).toBe(21);
    // The empty gate list and activity tail each keep a row, leaving the same tail floor.
    expect(taskDetailGateRows(view)).toBe(5);
    expect(taskDetailTailRows(view)).toBe(8);
  });

  test("the overview never loses the tail", () => {
    const tasks = Array.from({ length: 24 }, (_, index) =>
      taskState({ id: `task-${index}`, title: `Task ${index}` }),
    );
    const run = runState({ tasks });
    const input = runInput(run, [], { rows: 24, selectedTaskId: null });
    const view = buildViewModel(input);
    expect(view.taskWindow).toEqual({ offset: 0, size: 17, total: 24 });
    expect(singlePaneTailRows(view)).toBe(4);

    // The graph scrolls instead of taking the tail's floor away.
    const scrolled = buildViewModel({ ...input, selectedTaskId: "task-23" });
    expect(scrolled.taskWindow.offset).toBe(7);
    expect(scrolled.taskWindow.offset + scrolled.taskWindow.size).toBe(24);
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
