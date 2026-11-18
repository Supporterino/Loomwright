import { z } from "zod";

/**
 * Version 1 of the run-event protocol.
 *
 * The protocol evolves additively: a release may add an event type or an optional field, but
 * removing or renaming a type or field (or making an optional field required) is a version
 * change that bumps this constant and the envelope `v` together.
 */
export const PROTOCOL_VERSION = 1;

/** A change id, e.g. `add-health`; an empty or malformed id cannot name a run. */
const CHANGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RunId = z.string().regex(CHANGE_ID, "expected a change id such as add-health");

const Seq = z.int().min(1);
/** ISO-8601 in UTC, which is the only form `Date.prototype.toISOString` produces. */
const Timestamp = z.iso.datetime();

const NonNegative = z.number().min(0);
const Duration = z.number().min(0);
const Attempt = z.int().min(1);

/**
 * The five fields every event carries. Validating the envelope before looking at `type` lets a
 * reader skip an unknown type without failing the whole stream.
 */
export const EventEnvelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  runId: RunId,
  seq: Seq,
  ts: Timestamp,
  type: z.string(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

const PHASES = [
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
] as const;
export const Phase = z.enum(PHASES);
export type Phase = z.infer<typeof Phase>;

const TASK_STATUSES = ["pending", "running", "merging", "merged", "failed", "cancelled"] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

const GATE_TYPES = ["format", "lint", "types", "test", "testAffected"] as const;
const GateType = z.enum(GATE_TYPES);

const GATE_STATUSES = ["pass", "fail", "missing", "skipped", "not-check-only", "timeout"] as const;
const GateStatus = z.enum(GATE_STATUSES);

/** Mirrors `runtime/types.ts::Usage`; every field is a non-negative number. */
export const Usage = z.object({
  input: NonNegative,
  output: NonNegative,
  reasoning: NonNegative,
  cacheRead: NonNegative,
  cacheWrite: NonNegative,
  cost: NonNegative,
});
export type Usage = z.infer<typeof Usage>;

/** Where the full value of a capped payload lives in `.factory/logs/`. */
export const TruncationRef = z.object({
  path: z.string(),
  offset: z.int().min(0),
  bytes: z.int().min(0),
});
export type TruncationRef = z.infer<typeof TruncationRef>;

/**
 * Additive cap marker for payloads that can be bounded. The 8 KiB enforcement lives in core;
 * the schema only has to be able to carry the truncated form.
 */
const Bounded = {
  truncated: z.literal(true).optional(),
  ref: TruncationRef.optional(),
};

const TaskRef = z.object({
  id: z.string(),
  repo: z.string(),
  title: z.string().optional(),
});

const QuestionStatus = z.enum(["answered", "skipped", "unanswered"]);

const BranchInfo = z.object({ branch: z.string(), base: z.string() });

const GateRef = z.object({
  name: z.string(),
  type: GateType,
  command: z.string().optional(),
});

const InstallData = z.object({
  step: z.string(),
  repo: z.string(),
  durationMs: Duration.optional(),
  detail: z.string().optional(),
  ...Bounded,
});

const QuestionData = z.object({
  step: z.string(),
  question: z.string(),
  status: QuestionStatus,
  answer: z.string().optional(),
  ...Bounded,
});

/** Every event name in the union, in schema order. */
export const EVENT_TYPES = [
  "run.started",
  "run.finished",
  "run.paused",
  "run.resumed",
  "run.aborted",
  "run.branches",
  "run.pause-requested",
  "phase.changed",
  "task.queued",
  "task.started",
  "task.passed",
  "task.failed",
  "task.retried",
  "task.blocked",
  "task.skipped",
  "task.merging",
  "task.merged",
  "task.conflict",
  "task.requeued",
  "task.transient",
  "task.interrupted",
  "task.waiting",
  "task.removed",
  "gate.planned",
  "gate.started",
  "gate.finished",
  "gate.report",
  "agent.started",
  "agent.finished",
  "agent.activity",
  "agent.retry",
  "install.started",
  "install.finished",
  "install.failed",
  "question.raised",
  "question.answered",
  "approval.requested",
  "approval.granted",
  "usage.delta",
  "progress.line",
  "heartbeat",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Payload schemas are deliberately non-strict (zod strips unknown keys), so a newer release can
 * add an optional field without breaking an older reader.
 */
function event<T extends EventType, D extends z.ZodType>(type: T, data: D) {
  return z.object({
    v: z.literal(PROTOCOL_VERSION),
    runId: RunId,
    seq: Seq,
    ts: Timestamp,
    type: z.literal(type),
    data,
  });
}

export const RunEvent = z.discriminatedUnion("type", [
  event("run.started", z.object({ phase: Phase })),
  event("run.finished", z.object({ outcome: z.enum(["done", "aborted", "paused"]) })),
  event("run.paused", z.object({ reason: z.string(), ...Bounded })),
  event("run.resumed", z.object({})),
  event("run.aborted", z.object({})),
  event("run.branches", z.object({ branches: z.record(z.string(), BranchInfo) })),
  event("run.pause-requested", z.object({ reason: z.string().optional(), ...Bounded })),
  event(
    "phase.changed",
    z.object({
      from: Phase.nullable(),
      to: Phase,
      reason: z.string().optional(),
      ...Bounded,
    }),
  ),
  event("task.queued", z.object({ task: TaskRef, attempt: Attempt.optional(), ...Bounded })),
  event("task.started", z.object({ task: TaskRef, attempt: Attempt, ...Bounded })),
  event("task.passed", z.object({ task: TaskRef, attempt: Attempt.optional(), ...Bounded })),
  event(
    "task.failed",
    z.object({ task: TaskRef, reason: z.string(), attempt: Attempt.optional(), ...Bounded }),
  ),
  event(
    "task.retried",
    z.object({ task: TaskRef, attempt: Attempt, reason: z.string().optional(), ...Bounded }),
  ),
  event(
    "task.blocked",
    z.object({ task: TaskRef, reason: z.string(), attempt: Attempt.optional(), ...Bounded }),
  ),
  event("task.skipped", z.object({ task: TaskRef, reason: z.string().optional(), ...Bounded })),
  event("task.merging", z.object({ task: TaskRef, ...Bounded })),
  event("task.merged", z.object({ task: TaskRef, commit: z.string(), ...Bounded })),
  event("task.conflict", z.object({ task: TaskRef, files: z.array(z.string()), ...Bounded })),
  event("task.requeued", z.object({ task: TaskRef, reason: z.string(), ...Bounded })),
  event("task.transient", z.object({ task: TaskRef, reason: z.string(), ...Bounded })),
  event("task.interrupted", z.object({ task: TaskRef, ...Bounded })),
  event(
    "task.waiting",
    z.object({
      tasks: z.array(z.object({ id: z.string(), reason: z.string() })),
      ...Bounded,
    }),
  ),
  /** Drops a task the run file no longer keeps, e.g. a review fix routed to `specFindings`. */
  event("task.removed", z.object({ task: TaskRef, reason: z.string().optional(), ...Bounded })),
  event(
    "gate.planned",
    z.object({
      gates: z.array(GateRef),
      /** Which gate run this is, e.g. `gates after rebase`; absent in older streams. */
      stage: z.string().optional(),
      ...Bounded,
    }),
  ),
  event("gate.started", GateRef),
  event(
    "gate.finished",
    z.object({
      name: z.string(),
      type: GateType,
      status: GateStatus,
      durationMs: Duration,
      outputRef: TruncationRef.optional(),
      ...Bounded,
    }),
  ),
  event(
    "gate.report",
    z.object({
      passed: z.boolean(),
      results: z.array(
        z.object({
          name: z.string(),
          type: GateType,
          status: GateStatus,
          durationMs: Duration,
        }),
      ),
      /** Elapsed wall clock of the gate run; absent in streams written before it was added. */
      durationMs: Duration.optional(),
      /** Which gate run this is, e.g. `gates after rebase`; absent in older streams. */
      stage: z.string().optional(),
      ...Bounded,
    }),
  ),
  event(
    "agent.started",
    z.object({
      step: z.string(),
      agent: z.string(),
      model: z.string(),
      label: z.string().optional(),
      attempt: Attempt.optional(),
      ...Bounded,
    }),
  ),
  event(
    "agent.finished",
    z.object({
      step: z.string(),
      role: z.string(),
      outcome: z.enum(["succeeded", "failed", "interrupted"]),
      durationMs: Duration,
      usage: Usage,
      sessionId: z.string(),
      problem: z.string().optional(),
      ...Bounded,
    }),
  ),
  event(
    "agent.activity",
    z.object({
      step: z.string(),
      detail: z.string(),
      kind: z.enum(["step-started", "tool", "tool-done", "step-done", "retry"]),
      status: z.enum(["ok", "failed"]).optional(),
      usage: Usage.optional(),
      ...Bounded,
    }),
  ),
  event("agent.retry", z.object({ step: z.string(), reason: z.string().optional(), ...Bounded })),
  event("install.started", InstallData),
  event("install.finished", InstallData),
  event("install.failed", InstallData),
  event("question.raised", QuestionData),
  event("question.answered", QuestionData),
  event("approval.requested", z.object({ specHash: z.string(), specCommit: z.string() })),
  event(
    "approval.granted",
    z.object({ approver: z.string(), specHash: z.string(), specCommit: z.string() }),
  ),
  event(
    "usage.delta",
    z.object({
      step: z.string(),
      agent: z.string().optional(),
      model: z.string().optional(),
      usage: Usage,
    }),
  ),
  event(
    "progress.line",
    z.object({
      level: z.enum(["always", "normal", "verbose"]),
      text: z.string(),
      ...Bounded,
    }),
  ),
  event("heartbeat", z.object({ text: z.string(), ...Bounded })),
]);
export type RunEvent = z.infer<typeof RunEvent>;
