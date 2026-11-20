/**
 * The pure view-model every TUI view renders from. `buildViewModel` is a function of the read
 * API (status/listRuns), the reduced snapshot and the event facts; it reads no files, starts no
 * clock and imports no engine module as a value.
 */
import type { StatusDocument } from "@loomwright/core/factory";
import type { RunState, TaskState } from "@loomwright/core/state/run";
import { totalTokens } from "@loomwright/core/usage/usage";
import type { Phase, RunSnapshot, TaskStatus } from "@loomwright/protocol";
import { emptyWorkspace, keyHint, replayNotice } from "../strings.ts";
import { linesInScope, type ScopeTask } from "./activity-scope.ts";
import type { EventFacts } from "./facts.ts";
import { flat } from "./format.ts";

export type Source = "live" | "replay";
export type Screen = "list" | "run";

export type RunRole =
  | { readonly kind: "active"; readonly pid: number }
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "idle" };

export interface KeyHint {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  /** The CLI's message; only a disabled hint whose key the CLI refuses carries one. */
  readonly reason?: string;
}

export interface RunListItem {
  readonly id: string;
  readonly summary: string;
  readonly phase: Phase;
  readonly role: RunRole;
  readonly tokens: number;
  readonly cost: number;
  readonly elapsedMs: number;
  /** Recorded spec findings; the row shows the count only when it is above zero. */
  readonly findings: number;
  readonly selected: boolean;
}

export interface SpecFindingRow {
  readonly severity: "must" | "should" | "nice";
  readonly file: string | null;
  readonly line: number | null;
  readonly what: string;
  readonly problem: string;
  readonly fix: string;
  readonly impact: string;
}

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly status: TaskStatus;
  readonly attempt: number;
  readonly failures: number;
  readonly deps: readonly string[];
  readonly selected: boolean;
}

export interface GateRow {
  readonly step: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly durationMs: number;
}

export interface AgentFact {
  readonly role: string;
  readonly model: string;
  readonly durationMs: number | null;
}

export interface ActivityLine {
  readonly seq: number;
  readonly step: string;
  readonly kind: string;
  readonly text: string;
  readonly logRef?: string;
}

export interface QuestionRow {
  readonly step: string;
  readonly question: string;
  readonly status: "answered" | "skipped" | "unanswered";
  readonly answer?: string;
  readonly questionsFile: string;
}

export interface ApprovalView {
  readonly changeId: string;
  readonly summary: string;
  readonly changeDir: string | null;
  readonly specHash: string | null;
  readonly specCommit: string | null;
  readonly approver: string | null;
}

export type RewordState = "available" | "inert" | "absent";

export interface RewordAvailability {
  readonly state: RewordState;
  /** The CLI's message, present only when `state === "inert"`. */
  readonly reason: string | null;
}

export interface TaskDetail {
  readonly task: TaskRow;
  readonly agent: AgentFact | null;
  readonly retries: number;
  readonly gates: readonly GateRow[];
  readonly activity: readonly ActivityLine[];
}

export interface RunDetail {
  readonly id: string;
  readonly summary: string;
  readonly phase: Phase;
  readonly elapsedMs: number;
  readonly tokens: number;
  readonly cost: number;
  readonly lock: RunRole;
  readonly tasks: readonly TaskRow[];
  readonly selectedTaskId: string | null;
  readonly detail: TaskDetail | null;
  readonly activity: readonly ActivityLine[];
  readonly questions: readonly QuestionRow[];
  readonly approval: ApprovalView | null;
  readonly specFindings: readonly SpecFindingRow[];
  readonly pausedReason: string | null;
  readonly replayed: boolean;
  readonly reword: RewordAvailability;
}

/** A panel is built by its owning module (intake, approval, questions, confirm, help). */
export interface PanelView {
  readonly kind: "intake" | "approval" | "questions" | "confirm" | "help";
  readonly title: string;
  readonly lines: readonly string[];
  readonly keys: readonly KeyHint[];
  readonly notice: string | null;
}

export interface ViewModel {
  readonly source: Source;
  readonly screen: Screen;
  readonly columns: number;
  readonly rows: number;
  readonly twoPane: boolean;
  readonly list: readonly RunListItem[];
  readonly selectedRunId: string | null;
  readonly run: RunDetail | null;
  readonly panel: PanelView | null;
  readonly footer: readonly KeyHint[];
  readonly notice: string | null;
}

export interface ViewModelInput {
  readonly source: Source;
  readonly screen: Screen;
  readonly columns: number;
  readonly rows: number;
  /** Injected clock; `buildViewModel` never calls `Date.now()`. */
  readonly now: number;
  /** `null` when the run has no event log (it is still listed from run state). */
  readonly snapshot: RunSnapshot | null;
  readonly facts: EventFacts;
  readonly status: StatusDocument;
  readonly runs: readonly RunState[];
  readonly selectedRunId: string | null;
  readonly selectedTaskId: string | null;
  readonly panel?: PanelView | null;
  readonly notice?: string | null;
}

interface RunEntry {
  readonly run: RunState;
  readonly tokens: number;
  readonly cost: number;
}

function elapsedSince(createdAt: string, now: number): number {
  const created = Date.parse(createdAt);
  return Number.isNaN(created) ? 0 : Math.max(0, now - created);
}

function roleOf(id: string, status: StatusDocument): RunRole {
  // A lock left by a crashed driver is stale: only status()'s liveness makes it active.
  if (status.driverAlive && status.active?.changeId === id)
    return { kind: "active", pid: status.active.pid ?? 0 };
  const index = status.queue.indexOf(id);
  if (index !== -1) return { kind: "queued", position: index + 1 };
  return { kind: "idle" };
}

/** The run list's text label for a role; `active` carries the driver pid. */
export function roleLabel(role: RunRole): string {
  switch (role.kind) {
    case "active":
      return `active (pid ${role.pid})`;
    case "queued":
      return `queued #${role.position}`;
    case "idle":
      return "idle";
    default: {
      const unhandled: never = role;
      throw new Error(`unknown run role: ${String(unhandled)}`);
    }
  }
}

/** `status.runs` is authoritative and carries usage; `runs` is the fallback for a bare list. */
function runEntries(input: ViewModelInput): RunEntry[] {
  if (input.status.runs.length > 0)
    return input.status.runs.map((run) => ({
      run,
      tokens: totalTokens(run.usage.total),
      cost: run.usage.total.cost,
    }));
  return input.runs.map((run) => ({ run, tokens: 0, cost: 0 }));
}

function taskRow(
  task: TaskState,
  snapshot: RunSnapshot | null,
  selectedTaskId: string | null,
): TaskRow {
  const seen = snapshot?.tasks[task.id];
  const id = flat(task.id);
  return {
    id,
    title: flat(task.title),
    repo: flat(task.repo),
    status: seen?.status ?? task.status,
    attempt: seen?.attempt ?? 0,
    failures: task.failures,
    deps: task.deps,
    selected: id === selectedTaskId,
  };
}

function questionRows(run: RunState, snapshot: RunSnapshot | null): QuestionRow[] {
  const questionsFile =
    run.draft === undefined
      ? `openspec/changes/${run.id}/questions.md`
      : `${run.draft}/openspec/changes/${run.id}/questions.md`;
  // The snapshot carries `question.answered`, so rows flip without waiting for the next status poll.
  const records = snapshot?.questions ?? run.clarifications;
  return records.map((question) => ({
    step: flat(question.step),
    question: flat(question.question),
    status: question.status,
    ...(question.answer === undefined ? {} : { answer: flat(question.answer) }),
    questionsFile,
  }));
}

function approvalView(run: RunState, snapshot: RunSnapshot | null): ApprovalView | null {
  const pending = snapshot?.pendingApproval ?? null;
  const granted = snapshot?.approval ?? null;
  if (pending === null && granted === null && run.phase !== "awaiting-approval") return null;
  const specHash = pending?.specHash ?? granted?.specHash ?? null;
  const specCommit = granted !== null && granted.approver !== "" ? granted.specCommit : null;
  const approver = granted !== null && granted.approver !== "" ? granted.approver : null;
  return {
    changeId: run.id,
    summary: run.summary,
    changeDir: pending === null ? null : flat(pending.changeDir),
    specHash: specHash === null ? null : flat(specHash),
    // `approval.requested` sets `approver: ""`; only `approval.granted` names a commit and person.
    specCommit: specCommit === null ? null : flat(specCommit),
    approver: approver === null ? null : flat(approver),
  };
}

function findingRows(run: RunState): SpecFindingRow[] {
  // Run-state order is the 1-based order `reword --finding <n>` uses; never sort it.
  return run.specFindings.map((finding) => ({
    severity: finding.severity,
    file: finding.file === undefined ? null : flat(finding.file),
    line: finding.line === undefined ? null : finding.line,
    what: flat(finding.what),
    problem: flat(finding.problem),
    fix: flat(finding.fix),
    impact: flat(finding.impact),
  }));
}

function taskDetail(row: TaskRow, facts: EventFacts, tasks: readonly ScopeTask[]): TaskDetail {
  return {
    task: row,
    agent: facts.agents[row.id] ?? null,
    retries: facts.retries[row.id] ?? 0,
    gates: facts.gates[row.id] ?? [],
    activity: linesInScope(tasks, facts.activity, { kind: "task", taskId: row.id }),
  };
}

/** The CLI's `CHANGE_PHASES`: the phases `reword` accepts once a run is approved. */
const REWORD_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  "queued",
  "implementing",
  "reviewing",
  "contracts",
  "full-suite",
  "closing",
  "paused",
  "aborted",
]);

/** The CLI's preconditions as far as the read API can see them; the approval file is not read. */
function rewordAvailability(run: RunState, input: ViewModelInput): RewordAvailability {
  if (input.source === "replay" || !REWORD_PHASES.has(run.phase))
    return { state: "absent", reason: null };
  // `roleOf` already treats a lock with a dead driver as idle, so liveness lives in one place.
  const role = roleOf(run.id, input.status);
  if (role.kind === "active")
    return {
      state: "inert",
      reason: `${run.id} is being driven by pid ${role.pid}; stop it first`,
    };
  const active = input.status.active;
  if (input.status.driverAlive && active !== null && active.changeId !== run.id)
    return {
      state: "inert",
      reason: `${active.changeId} is the active change; finish or abort it before rewording ${run.id}`,
    };
  return { state: "available", reason: null };
}

function runDetail(entry: RunEntry, input: ViewModelInput): RunDetail {
  const { run } = entry;
  const tasks = run.tasks.map((task) => taskRow(task, input.snapshot, input.selectedTaskId));
  const scopeTasks: ScopeTask[] = tasks.map(({ id, repo }) => ({ id, repo }));
  const selected = tasks.find((task) => task.id === input.selectedTaskId) ?? null;
  return {
    id: run.id,
    summary: run.summary,
    phase: run.phase,
    elapsedMs: elapsedSince(run.createdAt, input.now),
    tokens: entry.tokens,
    cost: entry.cost,
    lock: roleOf(run.id, input.status),
    tasks,
    selectedTaskId: input.selectedTaskId,
    detail: selected === null ? null : taskDetail(selected, input.facts, scopeTasks),
    activity: input.facts.activity,
    questions: questionRows(run, input.snapshot),
    approval: approvalView(run, input.snapshot),
    specFindings: findingRows(run),
    pausedReason: run.pausedReason === undefined ? null : flat(run.pausedReason),
    replayed: input.source === "replay",
    reword: rewordAvailability(run, input),
  };
}

/** Paused, aborted and queued runs resume; the footer and `resumeFor` share this predicate. */
export function canResume(phase: Phase): boolean {
  return phase === "paused" || phase === "aborted" || phase === "queued";
}

/** Only a done run lands; the footer and `landFor` share this predicate. */
export function canLand(phase: Phase): boolean {
  return phase === "done";
}

function listFooter(input: ViewModelInput): KeyHint[] {
  return [
    keyHint("n", "new change"),
    keyHint("?", "help"),
    keyHint("q", "quit"),
    ...(input.selectedRunId === null ? [] : [keyHint("Enter", "open run")]),
  ];
}

// The approval overlay owns a/A/R: its panel keys replace this footer while it is open.
function runFooter(input: ViewModelInput, run: RunDetail | null): KeyHint[] {
  if (run === null) return [keyHint("q", "quit"), keyHint("?", "help")];
  // Replay intercepts every write key (see `REPLAY_WRITE_KEYS` in the entry), so only help and quit remain.
  if (input.source === "replay") return [keyHint("?", "help"), keyHint("q", "quit")];
  const hints: KeyHint[] = [];
  if (canResume(run.phase)) hints.push(keyHint("r", "resume"));
  if (canLand(run.phase)) hints.push(keyHint("l", "land"));
  hints.push(...rewordHints(run.reword));
  if (run.phase !== "done" && run.phase !== "aborted") hints.push(keyHint("x", "abort"));
  if (run.detail?.task.status === "failed") hints.push(keyHint("t", "retry task"));
  if (run.questions.length > 0) hints.push(keyHint("Q", "questions"));
  hints.push(keyHint("?", "help"), keyHint("q", "quit"));
  return hints;
}

/** One hint at most: an inert key keeps the CLI's reason for the footer that learns to print it. */
function rewordHints(reword: RewordAvailability): KeyHint[] {
  switch (reword.state) {
    case "available":
      return [keyHint("w", "reword")];
    case "inert":
      return [
        {
          key: "w",
          label: "reword",
          enabled: false,
          ...(reword.reason === null ? {} : { reason: reword.reason }),
        },
      ];
    case "absent":
      return [];
    default: {
      const unhandled: never = reword.state;
      throw new Error(`unknown reword state: ${String(unhandled)}`);
    }
  }
}

function footerFor(input: ViewModelInput, run: RunDetail | null): readonly KeyHint[] {
  if (input.panel !== undefined && input.panel !== null) return input.panel.keys;
  return input.screen === "list" ? listFooter(input) : runFooter(input, run);
}

export function buildViewModel(input: ViewModelInput): ViewModel {
  const ordered = runEntries(input).sort(
    (a, b) => Date.parse(b.run.createdAt) - Date.parse(a.run.createdAt),
  );
  const list: RunListItem[] = ordered.map(({ run, tokens, cost }) => ({
    id: run.id,
    summary: run.summary,
    phase: run.phase,
    role: roleOf(run.id, input.status),
    tokens,
    cost,
    elapsedMs: elapsedSince(run.createdAt, input.now),
    findings: run.specFindings.length,
    selected: run.id === input.selectedRunId,
  }));

  const entry = ordered.find((candidate) => candidate.run.id === input.selectedRunId);
  const run = entry === undefined ? null : runDetail(entry, input);
  const notice =
    input.notice ??
    (input.source === "replay" ? replayNotice : null) ??
    (list.length === 0 ? emptyWorkspace : null);

  return {
    source: input.source,
    screen: input.screen,
    columns: input.columns,
    rows: input.rows,
    twoPane: input.columns >= 100,
    list,
    selectedRunId: input.selectedRunId,
    run,
    panel: input.panel ?? null,
    footer: footerFor(input, run),
    notice,
  };
}
