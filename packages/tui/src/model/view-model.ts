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
import type { EventFacts } from "./facts.ts";

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
}

export interface RunListItem {
  readonly id: string;
  readonly summary: string;
  readonly phase: Phase;
  readonly role: RunRole;
  readonly tokens: number;
  readonly cost: number;
  readonly elapsedMs: number;
  readonly selected: boolean;
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
  readonly replayed: boolean;
}

/** A panel is built by its owning module (intake, approval, questions, confirm). */
export interface PanelView {
  readonly kind: "intake" | "approval" | "questions" | "confirm";
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
  if (status.active?.changeId === id) return { kind: "active", pid: status.active.pid ?? 0 };
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
  return {
    id: task.id,
    title: task.title,
    repo: task.repo,
    status: seen?.status ?? task.status,
    attempt: seen?.attempt ?? 0,
    failures: task.failures,
    deps: task.deps,
    selected: task.id === selectedTaskId,
  };
}

/** With duplicate gate names the later result wins, in the order the names first appeared. */
function latestGates(rows: readonly GateRow[]): GateRow[] {
  const byName = new Map<string, GateRow>();
  for (const row of rows) byName.set(row.name, row);
  return [...byName.values()];
}

function questionRows(run: RunState): QuestionRow[] {
  const questionsFile =
    run.draft === undefined
      ? `openspec/changes/${run.id}/questions.md`
      : `${run.draft}/openspec/changes/${run.id}/questions.md`;
  return run.clarifications.map((question) => ({
    step: question.step,
    question: question.question,
    status: question.status,
    ...(question.answer === undefined ? {} : { answer: question.answer }),
    questionsFile,
  }));
}

function approvalView(run: RunState, snapshot: RunSnapshot | null): ApprovalView | null {
  const pending = snapshot?.pendingApproval ?? null;
  const granted = snapshot?.approval ?? null;
  if (pending === null && granted === null && run.phase !== "awaiting-approval") return null;
  return {
    changeId: run.id,
    summary: run.summary,
    changeDir: pending?.changeDir ?? null,
    specHash: pending?.specHash ?? granted?.specHash ?? null,
    // `approval.requested` sets `approver: ""`; only `approval.granted` names a commit and person.
    specCommit: granted !== null && granted.approver !== "" ? granted.specCommit : null,
    approver: granted !== null && granted.approver !== "" ? granted.approver : null,
  };
}

function taskDetail(row: TaskRow, facts: EventFacts): TaskDetail {
  return {
    task: row,
    agent: facts.agents[row.id] ?? null,
    retries: facts.retries[row.id] ?? 0,
    gates: latestGates(facts.gates[row.id] ?? []),
    activity: facts.activity.filter((line) => line.step === row.id),
  };
}

function runDetail(entry: RunEntry, input: ViewModelInput): RunDetail {
  const { run } = entry;
  const tasks = run.tasks.map((task) => taskRow(task, input.snapshot, input.selectedTaskId));
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
    detail: selected === null ? null : taskDetail(selected, input.facts),
    activity: input.facts.activity,
    questions: questionRows(run),
    approval: approvalView(run, input.snapshot),
    replayed: input.source === "replay",
  };
}

function listFooter(input: ViewModelInput): KeyHint[] {
  return [
    keyHint("n", "new change"),
    keyHint("?", "help"),
    keyHint("q", "quit"),
    ...(input.selectedRunId === null ? [] : [keyHint("Enter", "open run")]),
  ];
}

function runFooter(run: RunDetail | null, state: RunState | undefined): KeyHint[] {
  if (run === null) return [keyHint("q", "quit"), keyHint("?", "help")];
  const hints: KeyHint[] = [];
  if (run.phase === "awaiting-approval") {
    hints.push(keyHint("a", "approve and run"), keyHint("A", "approve only"));
  }
  if (state !== undefined && state.specFindings.length > 0) hints.push(keyHint("w", "reword"));
  if (run.approval?.specCommit != null) hints.push(keyHint("R", "reapprove"));
  if (run.phase === "paused") hints.push(keyHint("r", "resume"));
  if (run.phase !== "done" && run.phase !== "aborted") hints.push(keyHint("x", "abort"));
  if (run.detail?.task.status === "failed") hints.push(keyHint("t", "retry task"));
  if (run.questions.length > 0) hints.push(keyHint("Q", "questions"));
  hints.push(keyHint("?", "help"), keyHint("q", "quit"));
  return hints;
}

function footerFor(
  input: ViewModelInput,
  run: RunDetail | null,
  state: RunState | undefined,
): readonly KeyHint[] {
  if (input.panel !== undefined && input.panel !== null) return input.panel.keys;
  return input.screen === "list" ? listFooter(input) : runFooter(run, state);
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
    footer: footerFor(input, run, entry?.run),
    notice,
  };
}
