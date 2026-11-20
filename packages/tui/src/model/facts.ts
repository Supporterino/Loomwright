import type { RunEvent } from "@loomwright/protocol";
import { ActivityRing } from "./activity.ts";
import type { ActivityLine, AgentFact, GateRow } from "./view-model.ts";

export { ACTIVITY_LIMIT, ActivityRing } from "./activity.ts";

export interface EventFacts {
  /** Gate results keyed by the task (or step) they ran for, at most one row per gate name. */
  readonly gates: Readonly<Record<string, readonly GateRow[]>>;
  /** The last agent seen for a step. */
  readonly agents: Readonly<Record<string, AgentFact>>;
  /** Retry counts keyed by task id or step, from `agent.retry` and `task.retried`. */
  readonly retries: Readonly<Record<string, number>>;
  /** The newest activity lines, oldest first. */
  readonly activity: readonly ActivityLine[];
}

/** One left-to-right pass over the events; no filesystem and no clock. */
export function collectFacts(events: readonly RunEvent[]): EventFacts {
  return appendFacts({ gates: {}, agents: {}, retries: {}, activity: [] }, events);
}

/** The task id or step an event names; `run` when it names none. */
function sourceOf(step: string | undefined): string {
  return step === undefined || step === "" ? "run" : step;
}

function attemptText(attempt: number | undefined): string {
  return attempt === undefined ? "" : ` (attempt ${attempt})`;
}

/**
 * Readable text stays one line and carries no terminal controls: a payload's newlines never split
 * an activity row, and its escape sequences never reach the terminal (an `ESC[2J` or `OSC 52`
 * would clear the screen, write the clipboard or draw a fake prompt).
 */
function flat(text: string): string {
  return text
    .replace(/[^\P{Cc}\t\n]/gu, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

function isRef(value: unknown): value is { readonly path: string } {
  return (
    typeof value === "object" && value !== null && "path" in value && typeof value.path === "string"
  );
}

/** The truncation path a payload carries, if any: `ref.path` or `gate.finished.outputRef.path`. */
function refOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  if ("ref" in data && isRef(data.ref)) return data.ref.path;
  if ("outputRef" in data && isRef(data.outputRef)) return data.outputRef.path;
  return undefined;
}

/** A compact duration for one line; no clock, only the event's own milliseconds. */
function duration(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function line(event: RunEvent, step: string, kind: string, text: string): ActivityLine {
  const logRef = refOf(event.data);
  return {
    seq: event.seq,
    step: flat(step),
    kind,
    text: flat(text),
    ...(logRef === undefined ? {} : { logRef: flat(logRef) }),
  };
}

/**
 * Folds new events into facts an earlier frame already collected, so the live tail keeps only the
 * projection and never the events. Copies every map it keeps: `prior` stays untouched.
 */
export function appendFacts(prior: EventFacts, events: readonly RunEvent[]): EventFacts {
  const gates: Record<string, GateRow[]> = {};
  for (const [step, rows] of Object.entries(prior.gates)) gates[step] = [...rows];
  const agents: Record<string, AgentFact> = { ...prior.agents };
  const retries: Record<string, number> = { ...prior.retries };
  const activity = new ActivityRing(prior.activity);

  const bump = (key: string): void => {
    retries[key] = (retries[key] ?? 0) + 1;
  };

  for (const event of events) {
    switch (event.type) {
      case "gate.finished": {
        const step = flat(event.data.step ?? "");
        const row: GateRow = {
          step,
          name: event.data.name,
          type: event.data.type,
          status: event.data.status,
          durationMs: event.data.durationMs,
        };
        // A retry replaces the earlier result, so retained rows are bounded by gate name.
        const rows = gates[step];
        if (rows === undefined) {
          gates[step] = [row];
        } else {
          const index = rows.findIndex((existing) => existing.name === row.name);
          if (index === -1) rows.push(row);
          else rows[index] = row;
        }
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "gate",
            `${event.data.name} ${event.data.status} in ${duration(event.data.durationMs)}`,
          ),
        );
        break;
      }
      case "agent.started":
        agents[event.data.step] = {
          role: event.data.agent,
          model: event.data.model,
          durationMs: null,
        };
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "agent",
            `${event.data.agent} started on ${event.data.model}${event.data.label === undefined ? "" : ` (${event.data.label})`}`,
          ),
        );
        break;
      case "agent.finished": {
        const step = event.data.step;
        const priorAgent = agents[step];
        agents[step] = {
          role: event.data.role,
          model: priorAgent?.model ?? "",
          durationMs: event.data.durationMs,
        };
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "agent",
            `${event.data.role} ${event.data.outcome} in ${duration(event.data.durationMs)}${event.data.problem === undefined ? "" : `: ${event.data.problem}`}`,
          ),
        );
        break;
      }
      case "agent.retry":
        bump(event.data.step);
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "agent",
            `retry${event.data.reason === undefined ? "" : `: ${event.data.reason}`}`,
          ),
        );
        break;
      case "task.retried":
        bump(event.data.task.id);
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `retried${attemptText(event.data.attempt)}${event.data.reason === undefined ? "" : `: ${event.data.reason}`}`,
          ),
        );
        break;
      case "agent.activity": {
        const ref = event.data.ref?.path;
        activity.push({
          seq: event.seq,
          step: flat(event.data.step),
          kind: event.data.kind,
          text: flat(event.data.detail),
          ...(ref === undefined ? {} : { logRef: flat(ref) }),
        });
        break;
      }
      case "run.started":
        activity.push(line(event, "run", "run", `started in ${event.data.phase}`));
        break;
      case "run.finished":
        activity.push(line(event, "run", "run", `finished: ${event.data.outcome}`));
        break;
      case "run.paused":
        activity.push(line(event, "run", "run", `paused: ${event.data.reason}`));
        break;
      case "run.resumed":
        activity.push(line(event, "run", "run", "resumed"));
        break;
      case "run.aborted":
        activity.push(line(event, "run", "run", "aborted"));
        break;
      case "run.branches": {
        const branches = Object.entries(event.data.branches).map(
          ([name, info]) => `${name} (base ${info.base})`,
        );
        activity.push(
          line(
            event,
            "run",
            "run",
            branches.length === 0 ? "branches: none" : `branches: ${branches.join(", ")}`,
          ),
        );
        break;
      }
      case "run.pause-requested":
        activity.push(
          line(
            event,
            "run",
            "run",
            event.data.reason === undefined
              ? "pause requested"
              : `pause requested: ${event.data.reason}`,
          ),
        );
        break;
      case "phase.changed":
        activity.push(
          line(
            event,
            "run",
            "phase",
            `${event.data.from ?? "start"} -> ${event.data.to}${event.data.reason === undefined ? "" : `: ${event.data.reason}`}`,
          ),
        );
        break;
      case "task.queued":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `queued${attemptText(event.data.attempt)}`,
          ),
        );
        break;
      case "task.started":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `started${attemptText(event.data.attempt)}`,
          ),
        );
        break;
      case "task.passed":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `passed${attemptText(event.data.attempt)}`,
          ),
        );
        break;
      case "task.failed":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `failed: ${event.data.reason}${attemptText(event.data.attempt)}`,
          ),
        );
        break;
      case "task.blocked":
        activity.push(
          line(event, sourceOf(event.data.task.id), "task", `blocked: ${event.data.reason}`),
        );
        break;
      case "task.skipped":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `skipped${event.data.reason === undefined ? "" : `: ${event.data.reason}`}`,
          ),
        );
        break;
      case "task.merging":
        activity.push(line(event, sourceOf(event.data.task.id), "task", "merging"));
        break;
      case "task.merged":
        activity.push(
          line(event, sourceOf(event.data.task.id), "task", `merged ${event.data.commit}`),
        );
        break;
      case "task.conflict":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `conflict: ${event.data.files.join(", ")}`,
          ),
        );
        break;
      case "task.requeued":
        activity.push(
          line(event, sourceOf(event.data.task.id), "task", `requeued: ${event.data.reason}`),
        );
        break;
      case "task.transient":
        activity.push(
          line(event, sourceOf(event.data.task.id), "task", `transient: ${event.data.reason}`),
        );
        break;
      case "task.interrupted":
        activity.push(line(event, sourceOf(event.data.task.id), "task", "interrupted"));
        break;
      case "task.waiting": {
        const waiting = event.data.tasks.map((task) => `${task.id} (${task.reason})`);
        activity.push(
          line(
            event,
            "run",
            "task",
            waiting.length === 0 ? "waiting" : `waiting on ${waiting.join(", ")}`,
          ),
        );
        break;
      }
      case "task.removed":
        activity.push(
          line(
            event,
            sourceOf(event.data.task.id),
            "task",
            `removed${event.data.reason === undefined ? "" : `: ${event.data.reason}`}`,
          ),
        );
        break;
      case "gate.planned": {
        const planned = event.data.gates.map((gate) => gate.name);
        const stage = event.data.stage === undefined ? "" : `${event.data.stage}: `;
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "gate",
            `${stage}planned ${planned.length === 0 ? "no gates" : planned.join(", ")}`,
          ),
        );
        break;
      }
      case "gate.started":
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "gate",
            `${event.data.name} started${event.data.command === undefined ? "" : `: ${event.data.command}`}`,
          ),
        );
        break;
      case "gate.report":
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "gate",
            `${event.data.passed ? "passed" : "failed"}: ${event.data.results.length} gates`,
          ),
        );
        break;
      case "install.started":
        activity.push(
          line(
            event,
            sourceOf(event.data.repo),
            "install",
            `${event.data.step} started${event.data.detail === undefined ? "" : `: ${event.data.detail}`}`,
          ),
        );
        break;
      case "install.finished":
        activity.push(
          line(
            event,
            sourceOf(event.data.repo),
            "install",
            `${event.data.step} finished${event.data.durationMs === undefined ? "" : ` in ${duration(event.data.durationMs)}`}${event.data.detail === undefined ? "" : `: ${event.data.detail}`}`,
          ),
        );
        break;
      case "install.failed":
        activity.push(
          line(
            event,
            sourceOf(event.data.repo),
            "install",
            `${event.data.step} failed${event.data.detail === undefined ? "" : `: ${event.data.detail}`}`,
          ),
        );
        break;
      case "question.raised":
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "question",
            `${event.data.question} (${event.data.status})`,
          ),
        );
        break;
      case "question.answered":
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "question",
            `${event.data.question}: ${event.data.answer ?? event.data.status}`,
          ),
        );
        break;
      case "approval.pending":
        activity.push(
          line(
            event,
            "run",
            "approval",
            `pending ${event.data.specHash} in ${event.data.changeDir}`,
          ),
        );
        break;
      case "approval.requested":
        activity.push(
          line(
            event,
            "run",
            "approval",
            `requested ${event.data.specHash} at ${event.data.specCommit}`,
          ),
        );
        break;
      case "approval.granted":
        activity.push(
          line(
            event,
            "run",
            "approval",
            `granted by ${event.data.approver} at ${event.data.specCommit}`,
          ),
        );
        break;
      case "usage.delta": {
        const who = event.data.agent ?? event.data.model;
        activity.push(
          line(
            event,
            sourceOf(event.data.step),
            "usage",
            `${who === undefined ? "" : `${who}: `}in ${event.data.usage.input} out ${event.data.usage.output}`,
          ),
        );
        break;
      }
      case "progress.line":
        activity.push(line(event, "run", "log", event.data.text));
        break;
      case "heartbeat": {
        const heartbeat = line(event, "run", "heartbeat", event.data.text);
        if (activity.lastIs("heartbeat")) activity.replaceLast(heartbeat);
        else activity.push(heartbeat);
        break;
      }
      default: {
        const unhandled: never = event;
        throw new Error(`unhandled run event: ${String(unhandled)}`);
      }
    }
  }

  return { gates, agents, retries, activity: activity.toArray() };
}
