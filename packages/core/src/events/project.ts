import type { RunState } from "../state/run.ts";
import { emptySnapshot, type RunSnapshot } from "./protocol.ts";

/** Approval data the caller reads from `approval/approval.ts::readApproval`. */
export interface ProjectionContext {
  /** Approval record for the run, if any (approval/approval.ts::readApproval). */
  readonly approval?: {
    readonly hash: string;
    readonly specCommit: string;
    readonly approver: string;
  };
}

/**
 * Pure: a deterministic projection of the persisted run state. No I/O.
 *
 * `lastSeq` is always 0 and `usage` is always zero: the event count comes from the stream and
 * usage comes from the ledger, so neither belongs to the run file. `gates` has no run-file
 * equivalent (it is event-only), and fields outside the snapshot are deliberately not
 * projected — see design Decision 5.
 */
export function projectRunState(run: RunState, ctx: ProjectionContext = {}): RunSnapshot {
  const branches: RunSnapshot["branches"] = {};
  for (const [repo, info] of Object.entries(run.branches)) {
    branches[repo] = { branch: info.branch, base: info.base };
  }

  const tasks: RunSnapshot["tasks"] = {};
  for (const task of run.tasks) {
    tasks[task.id] = { status: task.status, attempt: task.failures + 1 };
  }

  const approval = ctx.approval;

  return {
    ...emptySnapshot(run.id),
    phase: run.phase,
    pausedReason: run.pausedReason ?? null,
    abortRequested: run.abortRequested,
    branches,
    tasks,
    questions: run.clarifications.map((clarification) => ({
      step: clarification.step,
      question: clarification.question,
      status: clarification.status,
      ...(clarification.answer === undefined ? {} : { answer: clarification.answer }),
    })),
    approval:
      approval === undefined
        ? null
        : {
            specHash: approval.hash,
            specCommit: approval.specCommit,
            approver: approval.approver,
          },
  };
}
