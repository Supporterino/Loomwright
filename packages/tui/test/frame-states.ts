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
import { confirmPanel } from "../src/controls/actions.ts";
import {
  type ActivityPaneState,
  activityPanePanel,
  openActivityPane,
} from "../src/controls/activity-pane.ts";
import {
  initialQuestions,
  openQuestions,
  type QuestionsState,
  questionsPanel,
} from "../src/controls/questions.tsx";
import { type RewordState, rewordPanel } from "../src/controls/reword.ts";
import {
  type IntakeState,
  initialIntake,
  intakePanel,
  QUEUED_NOTE,
} from "../src/intake/dialog.tsx";
import { collectFacts } from "../src/model/facts.ts";
import {
  type ActivityLine,
  buildViewModel,
  type RunDetail,
  type ViewModel,
  type ViewModelInput,
} from "../src/model/view-model.ts";
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

function designActivity(): ViewModel {
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
  return buildViewModel(runInput(run, events, 0, 0, { selectedTaskId: null }));
}

function landConfirm(): ViewModel {
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
    event("task.merged", { task: { id: "second", repo: "api" }, commit: "def456" }),
  ];
  return buildViewModel(
    runInput(run, events, 0, 0, {
      panel: confirmPanel({ kind: "land", id: RUN }, ASCII_GLYPHS),
    }),
  );
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

/** Deliberately the same overlay as `awaiting-approval`: reopening after Esc must restore it. */
function approvalReopened(): ViewModel {
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

const LONG_LIST_COUNT = 60;

/** 60 runs, oldest first: the list orders them newest first, so row 0 is `run-59`. */
function longListRuns(): RunState[] {
  return Array.from({ length: LONG_LIST_COUNT }, (_, index) =>
    runState({
      id: `run-${index}`,
      summary: `run ${index}`,
      createdAt: new Date(Date.parse(ISO) + index * 1_000).toISOString(),
    }),
  );
}

/**
 * A long list at row `position` (0 is the newest). The offset is a function of the size because the
 * bottom window depends on how many rows the terminal gives the list.
 */
function longListFrame(
  position: number,
  offsetFor: (size: FrameSize) => number,
): (size: FrameSize) => ViewModel {
  return (size) => {
    const runs = longListRuns();
    const selected = runs[LONG_LIST_COUNT - 1 - position];
    if (selected === undefined) throw new Error("the long list has no selected run");
    return buildViewModel(
      vmInput({
        screen: "list",
        columns: size.columns,
        rows: size.rows,
        status: statusDoc(
          runs.map((run, index) => ({ run, tokens: index * 1_000, cost: index / 100 })),
        ),
        runs,
        selectedRunId: selected.id,
        listOffset: offsetFor(size),
      }),
    );
  };
}

const SPEC_FINDINGS = [
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
    file: "packages/tui/src/views/run-list.tsx",
    line: 24,
    what: "the list row has no marker",
    problem: "findings are invisible in the list",
    fix: "render the finding count",
    impact: "the run looks idle",
  },
  {
    severity: "nice",
    file: "packages/tui/src/views/panel.tsx",
    line: 16,
    what: "the panel repeats the title",
    problem: "the same words take two rows",
    fix: "drop the repeated heading",
    impact: "a short terminal loses a row",
  },
] as const;

function findingCount(count: number): readonly (typeof SPEC_FINDINGS)[number][] {
  return SPEC_FINDINGS.slice(0, count);
}

function pausedInput(size: FrameSize, count: number): ViewModelInput {
  const reason = `${count} spec findings need reword`;
  const run = runState({
    phase: "paused",
    pausedReason: reason,
    specFindings: findingCount(count),
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app", status: "running" })],
  });
  resetSeq();
  const events = [
    event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
    event("agent.activity", { step: "first", detail: "edited src/health.ts", kind: "tool" }),
    event("run.paused", { reason }),
  ];
  return runInput(run, events, 12_345, 0.42, {
    selectedTaskId: null,
    columns: size.columns,
    rows: size.rows,
  });
}

function pausedFindings(size: FrameSize): ViewModel {
  return buildViewModel(pausedInput(size, 3));
}

/**
 * The findings and reword snapshots share one panel: 6.2 modelled both as `PanelView["kind"] =
 * "reword"`, so the two names pin the body (the findings) and the prompt, not two components.
 */
function rewordFrame(size: FrameSize, count: number, text: string, offset: number): ViewModel {
  const input = pausedInput(size, count);
  const base = buildViewModel(input);
  if (base.run === null) throw new Error("the reword frame has no run");
  const state: RewordState = { text, offset, notice: null, failure: null };
  const panel = rewordPanel({
    run: base.run,
    state,
    glyphs: ASCII_GLYPHS,
    rows: size.rows,
    columns: size.columns,
  });
  // `PanelBox` repeats the keys inside the border and Ink clips that row with a Unicode ellipsis
  // when it is one cell too wide; the frame footer carries the same keys and clips with ASCII "...".
  // The short ASCII snapshot keeps the footer and drops the duplicate row until PanelBox clips
  // panel lines itself.
  const keys = panel.keys
    .map((hint) => `${hint.key} ${hint.label}`)
    .join(` ${ASCII_GLYPHS.bullet} `);
  if (keys.length <= size.columns - 4) return buildViewModel({ ...input, panel });
  const view = buildViewModel({ ...input, panel: { ...panel, keys: [] } });
  return { ...view, footer: panel.keys };
}

function tasks12(size: FrameSize): ViewModel {
  const tasks = Array.from({ length: 12 }, (_, index) =>
    taskState({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      repo: index % 2 === 0 ? "app" : "api",
      deps: index === 0 ? [] : [`task-${index}`],
    }),
  );
  const run = runState({ tasks });
  resetSeq();
  const events = [
    event("agent.activity", { step: "run", detail: "queued 12 tasks", kind: "tool" }),
  ];
  return buildViewModel(
    runInput(run, events, 0, 0, {
      selectedTaskId: null,
      columns: size.columns,
      rows: size.rows,
    }),
  );
}

const GATE_TYPES = ["lint", "format", "types", "test", "testAffected"] as const;

function taskDetailGates(size: FrameSize): ViewModel {
  const run = runState({
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app", status: "running" })],
  });
  resetSeq();
  // The spec's snapshot is a full 20-gate run at both sizes; the 80x24 detail windows the list.
  const gateCount = 20;
  const gates = Array.from({ length: gateCount }, (_, index) => {
    const type = GATE_TYPES[index % GATE_TYPES.length] ?? "lint";
    return event("gate.finished", {
      name: `${type}-${index + 1}`,
      type,
      status: index % 4 === 0 ? "fail" : "pass",
      durationMs: 100 + index * 50,
      step: "first",
    });
  });
  const activity = Array.from({ length: 20 }, (_, index) =>
    event("agent.activity", {
      step: "first",
      detail: `activity line ${index + 1}`,
      kind: "tool",
    }),
  );
  return buildViewModel(
    runInput(run, [...gates, ...activity], 0, 0, {
      selectedTaskId: "first",
      columns: size.columns,
      rows: size.rows,
    }),
  );
}

const QUESTION_RECORDS = [
  { step: "intake", question: "Which repo owns the endpoint?", status: "answered", answer: "app" },
  { step: "intake", question: "Is a migration needed?", status: "skipped" },
  {
    step: "design",
    question: "Which endpoints are public?",
    status: "answered",
    answer: "/health",
  },
  { step: "design", question: "Do health checks need auth?", status: "unanswered" },
  { step: "design", question: "Should the probe be cached?", status: "skipped" },
  { step: "review", question: "Is the timeout a config value?", status: "answered", answer: "yes" },
  { step: "review", question: "Should the payload be JSON?", status: "unanswered" },
  { step: "test", question: "Which responses are covered?", status: "unanswered" },
] as const;

function questionsFrame(size: FrameSize, overrides: Partial<QuestionsState>): ViewModel {
  const run = runState({
    clarifications: QUESTION_RECORDS.map((record, index) => ({
      ...record,
      at: new Date(Date.parse(ISO) + index * 1_000).toISOString(),
    })),
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
  });
  resetSeq();
  const events = [event("task.started", { task: { id: "first", repo: "app" }, attempt: 1 })];
  const input = runInput(run, events, 0, 0, {
    selectedTaskId: null,
    columns: size.columns,
    rows: size.rows,
    // The questions come from run state; the event snapshot would carry no raised questions.
    snapshot: null,
  });
  const base = buildViewModel(input);
  if (base.run === null) throw new Error("the questions frame has no run");
  const state: QuestionsState = {
    ...initialQuestions,
    selected: QUESTION_RECORDS.length - 1,
    ...overrides,
  };
  const panel = questionsPanel({ run: base.run, state, glyphs: ASCII_GLYPHS, rows: size.rows });
  return buildViewModel({ ...input, panel });
}

const APPROVAL_COMMIT = "abcdef1234567890abcdef1234567890abcdef12";

/**
 * The collapsed gate banner: no overlay, but the header still owns the coral row. The commit makes
 * `R reapprove` visible, which is the part of the banner the idle overlay cannot show without one.
 */
function approvalBanner(): ViewModel {
  const run = runState({
    phase: "awaiting-approval",
    draft: ".factory/drafts/add-health",
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app" })],
  });
  resetSeq();
  const events = [
    event("approval.pending", {
      specHash: APPROVAL_HASH,
      changeDir: `${run.draft ?? ""}/openspec/changes/${RUN}`,
    }),
    event("approval.requested", { specHash: APPROVAL_HASH, specCommit: APPROVAL_COMMIT }),
    event("approval.granted", {
      approver: "dev@example.com",
      specHash: APPROVAL_HASH,
      specCommit: APPROVAL_COMMIT,
    }),
  ];
  // The approval activity lines are longer than the frame; selecting the task shows its detail
  // instead of truncating them with Ink's non-ASCII ellipsis.
  return buildViewModel(runInput(run, events, 0, 0, { selectedTaskId: "first" }));
}

function logLines(): ActivityLine[] {
  const lines: ActivityLine[] = [];
  let nextSeq = 0;
  const push = (step: string, kind: string, text: string): void => {
    nextSeq += 1;
    lines.push({ seq: nextSeq, step, kind, text });
  };
  // Enough task lines that both scoped panes scroll at 80x24 and 120x40.
  for (let index = 1; index <= 48; index += 1) push("first", "agent", `first line ${index}`);
  for (let index = 1; index <= 24; index += 1) push("run", "log", `run line ${index}`);
  return lines;
}

/** A full-height log pane over the run; `stateFor` picks the scope and offset. */
function logFrame(
  size: FrameSize,
  selectedTaskId: string | null,
  stateFor: (run: RunDetail) => ActivityPaneState,
): ViewModel {
  const run = runState({
    tasks: [taskState({ id: "first", title: "Health endpoint", repo: "app", status: "running" })],
  });
  const input = vmInput({
    screen: "run",
    columns: size.columns,
    rows: size.rows,
    status: statusDoc([{ run, tokens: 0, cost: 0 }]),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId,
    facts: { gates: {}, agents: {}, retries: {}, activity: logLines() },
  });
  const base = buildViewModel(input);
  if (base.run === null) throw new Error("the log frame has no run");
  const panel = activityPanePanel({
    run: base.run,
    state: stateFor(base.run),
    glyphs: ASCII_GLYPHS,
    rows: size.rows,
  });
  return buildViewModel({ ...input, panel });
}

function logTaskScrolled(): ActivityPaneState {
  return { scope: "task", taskId: "first", offset: 10, follow: false };
}

function logRepoScrolled(): ActivityPaneState {
  return { scope: "repo", taskId: "first", offset: 10, follow: false };
}

/** Every snapshot state, built for the size it renders at. */
type StateName =
  | "no-runs"
  | "list-with-runs"
  | "running-graph"
  | "failing-task"
  | "finished"
  | "design-activity"
  | "land-confirm"
  | "new-run-text"
  | "new-run-file"
  | "queued-after-approval"
  | "awaiting-approval"
  | "approve-and-run-confirm"
  | "approve-only-confirm"
  | "question-open"
  | "long-list-top"
  | "long-list-middle"
  | "long-list-bottom"
  | "paused-findings"
  | "findings-panel"
  | "reword-panel"
  | "reword-confirm"
  | "tasks-12"
  | "task-detail-gates"
  | "questions-records"
  | "questions-composer"
  | "questions-composer-multiline"
  | "questions-notice"
  | "approval-banner"
  | "approval-reopened"
  | "log-follow"
  | "log-task-scrolled"
  | "log-repo-scrolled";

export const STATES: Record<StateName, (size: FrameSize) => ViewModel> = {
  "no-runs": noRuns,
  "list-with-runs": listWithRuns,
  "running-graph": runningGraph,
  "failing-task": failingTask,
  finished,
  "design-activity": designActivity,
  "land-confirm": landConfirm,
  "new-run-text": newRunText,
  "new-run-file": newRunFile,
  "queued-after-approval": queuedAfterApproval,
  "awaiting-approval": awaitingApproval,
  "approve-and-run-confirm": approveAndRunConfirm,
  "approve-only-confirm": approveOnlyConfirm,
  "question-open": questionOpen,
  "long-list-top": longListFrame(0, () => 0),
  "long-list-middle": longListFrame(30, () => 20),
  "long-list-bottom": longListFrame(59, (size) => Math.max(0, LONG_LIST_COUNT - (size.rows - 2))),
  "paused-findings": pausedFindings,
  "findings-panel": (size) => rewordFrame(size, 3, "", 0),
  "reword-panel": (size) => rewordFrame(size, 2, "apply finding 2", 0),
  "reword-confirm": (size) => rewordFrame(size, 2, "apply finding 1", 999),
  "tasks-12": tasks12,
  "task-detail-gates": taskDetailGates,
  "questions-records": (size) => questionsFrame(size, { focus: "record", text: "" }),
  "questions-composer": (size) =>
    questionsFrame(size, { focus: "composer", text: "public /health" }),
  "questions-composer-multiline": (size) =>
    questionsFrame(size, { focus: "composer", text: "first\nsecond" }),
  "questions-notice": (size) =>
    questionsFrame(size, { focus: "composer", text: "  ", notice: "the answer is empty" }),
  "approval-banner": approvalBanner,
  "approval-reopened": approvalReopened,
  "log-follow": (size) => logFrame(size, null, openActivityPane),
  "log-task-scrolled": (size) => logFrame(size, "first", logTaskScrolled),
  "log-repo-scrolled": (size) => logFrame(size, "first", logRepoScrolled),
};

export const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 120, rows: 40 },
] as const;
