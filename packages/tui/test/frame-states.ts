/**
 * The 1.4–1.7 frame fixtures, shared by the snapshot suite and the accessibility suite. Every
 * state is built from the same view-model the live entry renders.
 */
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
import { type ApprovalState, approvalPanel } from "../src/approval/overlay.ts";
import { openQuestions, questionsPanel } from "../src/controls/questions.tsx";
import {
  type IntakeState,
  initialIntake,
  intakePanel,
  QUEUED_NOTE,
} from "../src/intake/dialog.tsx";
import { collectFacts } from "../src/model/facts.ts";
import { buildViewModel, type ViewModel, type ViewModelInput } from "../src/model/view-model.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";
import type { FrameSize } from "../src/views/frame.tsx";

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

function listWithRuns(): ViewModel {
  const selected = runState({
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app", status: "running" })],
  });
  const older = runState({
    id: "faster-imports",
    createdAt: "2026-11-17T09:00:00.000Z",
    phase: "done",
  });
  resetSeq();
  const events = [
    event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
    event("agent.activity", { step: "first", detail: "edited src/health.ts", kind: "tool" }),
  ];
  return buildViewModel(
    vmInput({
      screen: "list",
      status: statusDoc([
        { run: older, tokens: 0, cost: 0 },
        { run: selected, tokens: 0, cost: 0 },
      ]),
      runs: [older, selected],
      selectedRunId: selected.id,
      snapshot: reduce(events),
      facts: collectFacts(events),
    }),
  );
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

function newRunText(): ViewModel {
  return buildViewModel(
    vmInput({
      screen: "list",
      panel: intakePanel({ ...initialIntake, text: "add a health endpoint" }, ASCII_GLYPHS),
    }),
  );
}

function newRunFile({ rows }: FrameSize): ViewModel {
  const preview = Array.from({ length: 20 }, (_, index) => `request line ${index + 1}`);
  const state: IntakeState = {
    ...initialIntake,
    mode: "file",
    path: ".factory/requests/faster-imports.md",
    candidates: [
      {
        path: ".factory/requests/faster-imports.md",
        absolute: "/work/app/.factory/requests/faster-imports.md",
        kind: "file",
      },
    ],
    file: {
      absolute: "/work/app/.factory/requests/faster-imports.md",
      bytes: 512,
      preview,
    },
  };
  return buildViewModel(vmInput({ screen: "list", panel: intakePanel(state, ASCII_GLYPHS, rows) }));
}

function queuedAfterApproval(): ViewModel {
  const run = runState({ id: "another-change" });
  const lock: ActiveLock = { changeId: "another-change", pid: 4242, host: "host", since: ISO };
  return buildViewModel(
    vmInput({
      screen: "list",
      status: statusDoc([{ run, tokens: 0, cost: 0 }], { active: lock }),
      runs: [run],
      selectedRunId: run.id,
      panel: intakePanel(
        { ...initialIntake, text: "add a health endpoint", queuedNote: QUEUED_NOTE },
        ASCII_GLYPHS,
      ),
    }),
  );
}

const APPROVAL_HASH = "0123456789abcdef0123456789abcdef";

function approvalFrame(state: ApprovalState): ViewModel {
  const run = runState({
    phase: "awaiting-approval",
    draft: ".factory/drafts/add-health",
  });
  resetSeq();
  const events = [
    event("approval.pending", {
      specHash: APPROVAL_HASH,
      changeDir: `${run.draft ?? ""}/openspec/changes/${RUN}`,
    }),
  ];
  const base = buildViewModel(runInput(run, events, 0, 0));
  if (base.run === null) throw new Error("the approval frame has no run");
  const panel = approvalPanel({
    run: base.run,
    evidence: { identity: "dev@example.com", findings: 0, specCommit: null },
    state,
    glyphs: ASCII_GLYPHS,
    ...(run.draft === undefined ? {} : { draft: run.draft }),
  });
  return buildViewModel(runInput(run, events, 0, 0, { panel }));
}

function awaitingApproval(): ViewModel {
  return approvalFrame({ kind: "idle" });
}

function approveAndRunConfirm(): ViewModel {
  return approvalFrame({ kind: "confirming", action: "approve" });
}

function approveOnlyConfirm(): ViewModel {
  return approvalFrame({ kind: "confirming", action: "approve-only" });
}

function questionOpen(): ViewModel {
  const run = runState();
  resetSeq();
  const events = [
    event("question.raised", {
      step: "design",
      question: "Which endpoints should be public?",
      status: "unanswered",
    }),
    event("question.raised", {
      step: "design",
      question: "Do health checks need auth?",
      status: "skipped",
    }),
  ];
  const input = runInput(run, events, 0, 0);
  const base = buildViewModel(input);
  if (base.run === null) throw new Error("the question frame has no run");
  const state = openQuestions(base.run);
  if (state === null) throw new Error("the question frame has no questions");
  const panel = questionsPanel({ run: base.run, state, glyphs: ASCII_GLYPHS });
  return buildViewModel({ ...input, panel });
}

/** Every snapshot state, built for the size it renders at. */
type StateName =
  | "no-runs"
  | "list-with-runs"
  | "running-graph"
  | "failing-task"
  | "finished"
  | "new-run-text"
  | "new-run-file"
  | "queued-after-approval"
  | "awaiting-approval"
  | "approve-and-run-confirm"
  | "approve-only-confirm"
  | "question-open";

export const STATES: Record<StateName, (size: FrameSize) => ViewModel> = {
  "no-runs": noRuns,
  "list-with-runs": listWithRuns,
  "running-graph": runningGraph,
  "failing-task": failingTask,
  finished,
  "new-run-text": newRunText,
  "new-run-file": newRunFile,
  "queued-after-approval": queuedAfterApproval,
  "awaiting-approval": awaitingApproval,
  "approve-and-run-confirm": approveAndRunConfirm,
  "approve-only-confirm": approveOnlyConfirm,
  "question-open": questionOpen,
};

export const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 120, rows: 40 },
] as const;
