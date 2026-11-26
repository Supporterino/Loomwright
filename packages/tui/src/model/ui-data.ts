/**
 * The UI's own state document and the pure helpers that read it. No Ink or React, so the controls
 * suites can drive the same view model without rendering a terminal.
 */
import type { StatusDocument } from "@loomwright/core/factory";
import type { RunState } from "@loomwright/core/state/run";
import type { RunSnapshot } from "@loomwright/protocol";
import {
  type ApprovalEvidence,
  type ApprovalState,
  approvalForPhase,
  approvalProgress,
} from "../approval/overlay.ts";
import type { ControlAction } from "../controls/actions.ts";
import type { ActivityPaneState } from "../controls/activity-pane.ts";
import type { DiffPaneState } from "../controls/diff-pane.ts";
import type { QuestionsState } from "../controls/questions.tsx";
import type { RewordState } from "../controls/reword.ts";
import type { IntakeState } from "../intake/dialog.tsx";
import type { EventFacts } from "./facts.ts";
import type { Screen } from "./view-model.ts";

export interface UiData {
  readonly screen: Screen;
  readonly selectedRunId: string | null;
  readonly selectedTaskId: string | null;
  readonly columns: number;
  readonly rows: number;
  readonly status: StatusDocument;
  readonly runs: readonly RunState[];
  readonly snapshot: RunSnapshot | null;
  readonly facts: EventFacts;
  readonly notice: string | null;
  /** The requested run-list scroll offset; the model re-clamps it every build. */
  readonly listOffset?: number;
  /** The requested task-graph scroll offset; the model re-clamps it every build. */
  readonly taskOffset?: number;
  /** The new-run dialog, or null when no panel is open. */
  readonly intake: IntakeState | null;
  /** The approval overlay, or null when the selected run is not at the gate. */
  readonly approval: ApprovalState | null;
  /**
   * The user hid the overlay with Esc; the run view's coral banner stays. Optional so `UiData`
   * literals owned by other tasks stay valid; every reader normalises it with `=== true`.
   */
  readonly approvalCollapsed?: boolean;
  /** The questions pane, or null when it is closed. */
  readonly questions: QuestionsState | null;
  /**
   * The activity log pane, or null when it is closed. Optional so `UiData` literals owned by other
   * tasks stay valid; every reader normalises it with `?? null`.
   */
  readonly activity?: ActivityPaneState | null;
  /**
   * The diff pane, or null when it is closed. Optional so `UiData` literals owned by other tasks
   * stay valid; every reader normalises it with `?? null`.
   */
  readonly diff?: DiffPaneState | null;
  /**
   * The reword panel, or null when it is closed. Optional so `UiData` literals owned by other
   * tasks stay valid; every reader normalises it with `?? null`.
   */
  readonly reword?: RewordState | null;
  /** The abort confirmation, or null when no confirmation is open. */
  readonly confirmation: ControlAction | null;
  /** The help panel is open; `?` sets it and Esc clears it. */
  readonly help: boolean;
  /** `git config user.email`; null until the overlay has read it once. */
  readonly identity: string | null;
  /** A zero-exit land whose refresh failed; the next successful poll settles it. */
  readonly pendingLand: string | null;
}

export function selectedRunState(data: UiData): RunState | undefined {
  const id = data.selectedRunId;
  if (id === null) return undefined;
  return data.status.runs.find((run) => run.id === id) ?? data.runs.find((run) => run.id === id);
}

export function grantedCommit(snapshot: RunSnapshot | null): string | null {
  const approval = snapshot?.approval ?? null;
  return approval === null || approval.approver === "" ? null : approval.specCommit;
}

export function evidenceOf(data: UiData): ApprovalEvidence {
  return {
    // `null` means the async read has not resolved yet; only a real `""` is a missing identity.
    ...(data.identity === null ? {} : { identity: data.identity }),
    findings: selectedRunState(data)?.specFindings.length ?? 0,
    specCommit: grantedCommit(data.snapshot),
  };
}

/** Intake, questions, reword, help, the log pane and confirmations own the screen while open. */
export function panelOpen(data: UiData): boolean {
  return (
    data.intake !== null ||
    data.questions !== null ||
    (data.reword ?? null) !== null ||
    data.confirmation !== null ||
    data.help ||
    (data.activity ?? null) !== null ||
    (data.diff ?? null) !== null
  );
}

/**
 * Opens on the phase and advances a launch from the facts the stream now carries. Run state is
 * canonical: a tail snapshot can lag behind a phase another process already drove.
 */
export function syncApproval(data: UiData): UiData {
  if (data.screen !== "run" || data.selectedRunId === null) return data;
  const run = selectedRunState(data);
  const phase = run?.phase ?? data.snapshot?.phase ?? null;
  if (data.approval === null) {
    // A poll never steals an open panel; the next one opens the gate once the panel closes.
    if (panelOpen(data)) return data;
    if (phase === null) return data;
    const opened = approvalForPhase(phase, null);
    return opened === null
      ? data
      : { ...data, approval: opened, approvalCollapsed: false, identity: null };
  }
  // Another process may approve while the overlay sits idle: clear it once the run leaves the
  // gate, but keep a launch that is still waiting for its own outcome.
  if (
    (data.approval.kind === "idle" || data.approval.kind === "failed") &&
    phase !== null &&
    phase !== "awaiting-approval"
  ) {
    return { ...data, approval: null, approvalCollapsed: false };
  }
  if (data.approval.kind !== "waiting") return data;
  const next = approvalProgress(data.approval, {
    phase,
    granted: grantedCommit(data.snapshot) !== null,
  });
  if (next === data.approval) return data;
  return { ...data, approval: next.kind === "done" ? null : next, approvalCollapsed: false };
}
