import type { Usage } from "../runtime/types.ts";
import { addUsage, ZERO_USAGE } from "../runtime/types.ts";
import type { RunState } from "../state/run.ts";
import { loadUsage } from "../usage/usage.ts";
import type { ProjectionContext } from "./project.ts";
import { projectRunState } from "./project.ts";
import { type RunEventType, type RunSnapshot, reduce } from "./protocol.ts";

export interface ParityCheckpoint {
  /** "after approve", "after task 1.2", "final". */
  readonly name: string;
  /** The run file as persisted at that point. */
  readonly run: RunState;
  /** Reduce events with seq <= uptoSeq. */
  readonly uptoSeq: number;
}

export interface Divergence {
  readonly checkpoint: string;
  /** Dotted path, e.g. "tasks.1.2.status". */
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

type FieldDivergence = Omit<Divergence, "checkpoint">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Key-sorted serialisation, so object key order cannot produce a false divergence. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function compareValue(
  field: string,
  expected: unknown,
  actual: unknown,
): FieldDivergence | undefined {
  if (stable(expected) === stable(actual)) return undefined;
  return { field, expected, actual };
}

/**
 * Parity is asserted for `phase`, `pausedReason`, `abortRequested`, `branches`, `tasks`
 * (status/attempt), `questions`, `approval`, and `usage` against the ledger.
 *
 * Not asserted: `gates` (the run file has no per-gate map; `fullSuite`/`contractResults` are
 * different shapes), `lastSeq` (a count, not state), and any field outside the projection
 * (`handoffs`, `draft`, `serialOwner`, `graphSeq`, `reviewed`, `reReview`, `specFindings`,
 * `pointerCommit`, `pointers`, `archivedAs`, `archiveCommit`, `reportPath`). This is the
 * documented boundary (design Risks).
 */
function firstDivergence(expected: RunSnapshot, actual: RunSnapshot): FieldDivergence | undefined {
  for (const field of ["phase", "pausedReason", "abortRequested"] as const) {
    if (stable(expected[field]) !== stable(actual[field])) {
      return { field, expected: expected[field], actual: actual[field] };
    }
  }

  const branches = compareValue("branches", expected.branches, actual.branches);
  if (branches !== undefined) return branches;

  const taskIds = [
    ...new Set([...Object.keys(expected.tasks), ...Object.keys(actual.tasks)]),
  ].sort();
  for (const id of taskIds) {
    const want = expected.tasks[id];
    const got = actual.tasks[id];
    if (want === undefined || got === undefined) {
      return { field: `tasks.${id}`, expected: want, actual: got };
    }
    if (want.status !== got.status) {
      return { field: `tasks.${id}.status`, expected: want.status, actual: got.status };
    }
    if (want.attempt !== got.attempt) {
      return { field: `tasks.${id}.attempt`, expected: want.attempt, actual: got.attempt };
    }
  }

  return (
    compareValue("questions", expected.questions, actual.questions) ??
    compareValue("approval", expected.approval, actual.approval)
  );
}

/**
 * Compares `reduce(events up to each checkpoint)` with `projectRunState(run)`. Returns [] when
 * equal. Reports the first divergence per checkpoint; `lastSeq` and `usage` are never compared
 * here (usage parity lives in `compareUsage`).
 */
export function compareSnapshots(
  events: readonly RunEventType[],
  checkpoints: readonly ParityCheckpoint[],
  options?: {
    readonly approvalOf?: (run: RunState) => ProjectionContext["approval"];
  },
): Divergence[] {
  const divergences: Divergence[] = [];
  for (const checkpoint of checkpoints) {
    const approval = options?.approvalOf?.(checkpoint.run);
    const expected = projectRunState(
      checkpoint.run,
      approval === undefined ? undefined : { approval },
    );
    const actual = reduce(events.filter((event) => event.seq <= checkpoint.uptoSeq));
    const divergence = firstDivergence(expected, actual);
    if (divergence !== undefined) {
      divergences.push({ checkpoint: checkpoint.name, ...divergence });
    }
  }
  return divergences;
}

/** Sums every `usage` entry in the change's ledger (`.factory/usage/<id>.json`). */
export function usageFromLedger(root: string, runId: string): Usage {
  let total = ZERO_USAGE;
  for (const entry of loadUsage(root, runId).entries) {
    total = addUsage(total, entry.usage);
  }
  return total;
}

/** The snapshot's usage must equal the ledger; the event-only `agent.finished.usage` is not counted. */
export function compareUsage(snapshot: RunSnapshot, ledger: Usage): Divergence | undefined {
  if (stable(snapshot.usage) === stable(ledger)) return undefined;
  return { checkpoint: "usage", field: "usage", expected: ledger, actual: snapshot.usage };
}
