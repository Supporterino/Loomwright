import {
  EVENT_TYPES,
  type Phase,
  PROTOCOL_VERSION,
  type RunEvent,
  type TaskStatus,
  type Usage,
} from "./events.ts";

/** The reader's view of a run, rebuilt from the event stream without reading `.factory/`. */
export interface RunSnapshot {
  v: typeof PROTOCOL_VERSION;
  runId: string;
  lastSeq: number;
  phase: Phase | null;
  pausedReason: string | null;
  abortRequested: boolean;
  branches: Record<string, { branch: string; base: string }>;
  tasks: Record<string, { status: TaskStatus; attempt: number }>;
  questions: {
    step: string;
    question: string;
    status: "answered" | "skipped" | "unanswered";
    answer?: string;
  }[];
  approval: { specHash: string; specCommit: string; approver: string } | null;
  usage: Usage;
  gates: Record<string, { status: string; durationMs: number }>;
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

/** An empty snapshot for a run that has emitted nothing yet. */
export function emptySnapshot(runId: string): RunSnapshot {
  return {
    v: PROTOCOL_VERSION,
    runId,
    lastSeq: 0,
    phase: null,
    pausedReason: null,
    abortRequested: false,
    branches: {},
    tasks: {},
    questions: [],
    approval: null,
    usage: { ...ZERO_USAGE },
    gates: {},
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cost: a.cost + b.cost,
  };
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);

type SnapshotQuestion = RunSnapshot["questions"][number];

function toQuestion(data: {
  step: string;
  question: string;
  status: "answered" | "skipped" | "unanswered";
  answer?: string | undefined;
}): SnapshotQuestion {
  return {
    step: data.step,
    question: data.question,
    status: data.status,
    ...(data.answer === undefined ? {} : { answer: data.answer }),
  };
}

/**
 * Replays a run's events into a snapshot. Pure and deterministic: it reads only the events,
 * never the filesystem, and copies every map it keeps so the input stays untouched.
 */
export function reduce(events: readonly RunEvent[]): RunSnapshot {
  const first = events[0];
  const snapshot = emptySnapshot(first?.runId ?? "");

  const upsertTask = (task: { id: string }, status: TaskStatus, attempt?: number): void => {
    const previous = snapshot.tasks[task.id];
    snapshot.tasks[task.id] = { status, attempt: attempt ?? previous?.attempt ?? 0 };
  };

  for (const event of events) {
    // An unknown type is skipped completely, as if the line were absent.
    if (!KNOWN_TYPES.has(event.type)) continue;
    if (event.seq > snapshot.lastSeq) snapshot.lastSeq = event.seq;

    switch (event.type) {
      case "run.started":
        snapshot.phase = event.data.phase;
        break;
      case "run.finished":
        break;
      case "run.paused":
        snapshot.phase = "paused";
        snapshot.pausedReason = event.data.reason;
        break;
      case "run.resumed":
        snapshot.pausedReason = null;
        snapshot.abortRequested = false;
        break;
      case "run.aborted":
        snapshot.phase = "aborted";
        snapshot.abortRequested = true;
        break;
      case "run.branches": {
        const branches: RunSnapshot["branches"] = {};
        for (const [repo, info] of Object.entries(event.data.branches)) {
          branches[repo] = { branch: info.branch, base: info.base };
        }
        snapshot.branches = branches;
        break;
      }
      case "run.pause-requested":
        // Informational: only `run.paused` changes the snapshot.
        break;
      case "phase.changed":
        snapshot.phase = event.data.to;
        // Leaving `paused` drops the reason in the run file, so the replay must drop it too.
        if (event.data.to !== "paused") snapshot.pausedReason = null;
        break;
      case "task.queued":
        upsertTask(event.data.task, "pending", event.data.attempt);
        break;
      case "task.started":
        upsertTask(event.data.task, "running", event.data.attempt);
        break;
      case "task.passed":
        upsertTask(event.data.task, "running", event.data.attempt);
        break;
      case "task.failed":
        upsertTask(event.data.task, "failed", event.data.attempt);
        break;
      case "task.retried":
        upsertTask(event.data.task, "running", event.data.attempt);
        break;
      case "task.blocked":
        upsertTask(event.data.task, "failed", event.data.attempt);
        break;
      case "task.skipped":
        upsertTask(event.data.task, "cancelled");
        break;
      case "task.merging":
        upsertTask(event.data.task, "merging");
        break;
      case "task.merged":
        upsertTask(event.data.task, "merged");
        break;
      case "task.conflict":
        upsertTask(event.data.task, "merging");
        break;
      case "task.requeued":
        upsertTask(event.data.task, "pending");
        break;
      case "task.transient":
        upsertTask(event.data.task, "pending");
        break;
      case "task.interrupted":
        upsertTask(event.data.task, "pending");
        break;
      case "task.waiting":
        break;
      case "gate.finished":
        snapshot.gates[event.data.name] = {
          status: event.data.status,
          durationMs: event.data.durationMs,
        };
        break;
      case "question.raised":
        snapshot.questions.push(toQuestion(event.data));
        break;
      case "question.answered": {
        const { step, question } = event.data;
        const record = toQuestion(event.data);
        const index = snapshot.questions.findIndex(
          (q) => q.step === step && q.question === question,
        );
        if (index === -1) snapshot.questions.push(record);
        else snapshot.questions[index] = record;
        break;
      }
      case "approval.requested":
        snapshot.approval = {
          specHash: event.data.specHash,
          specCommit: event.data.specCommit,
          approver: "",
        };
        break;
      case "approval.granted":
        snapshot.approval = {
          specHash: event.data.specHash,
          specCommit: event.data.specCommit,
          approver: event.data.approver,
        };
        break;
      case "usage.delta":
        snapshot.usage = addUsage(snapshot.usage, event.data.usage);
        break;
      // Display-only or non-projection events; `agent.finished.usage` must not reach usage.
      case "gate.planned":
      case "gate.started":
      case "gate.report":
      case "agent.started":
      case "agent.finished":
      case "agent.activity":
      case "agent.retry":
      case "install.started":
      case "install.finished":
      case "install.failed":
      case "progress.line":
      case "heartbeat":
        break;
      default: {
        const unhandled: never = event;
        throw new Error(`unhandled event: ${String(unhandled)}`);
      }
    }
  }

  return snapshot;
}
