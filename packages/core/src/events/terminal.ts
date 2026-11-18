import type { GateInfo, GateReport, GateResult } from "../gates/run.ts";
import type { Progress } from "../pipeline/progress.ts";
import type { Usage } from "../runtime/types.ts";
import type { TaskState, TaskStatus } from "../state/run.ts";
import type { RunEvent } from "./protocol.ts";
import type { EventSink, SinkTarget, Verbosity } from "./sink.ts";
import { levelVisible } from "./sink.ts";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

const taskState = (
  ref: { readonly id: string; readonly repo: string; readonly title?: string | undefined },
  status: TaskStatus = "pending",
): TaskState => ({
  id: ref.id,
  title: ref.title ?? "",
  repo: ref.repo,
  deps: [],
  touches: [],
  kind: "task",
  status,
  failures: 0,
  serial: false,
  gatesPassed: false,
  installed: false,
  history: [],
});

const gateInfo = (gate: {
  readonly type: GateInfo["type"];
  readonly name?: string | undefined;
  readonly command?: string | undefined;
}): GateInfo => ({
  type: gate.type,
  ...(gate.name === undefined ? {} : { name: gate.name }),
  command: gate.command ?? "",
  cwd: "",
});

const gateResult = (result: {
  readonly type: GateInfo["type"];
  readonly name?: string | undefined;
  readonly status: GateResult["status"];
  readonly durationMs: number;
}): GateResult => ({
  type: result.type,
  ...(result.name === undefined ? {} : { name: result.name }),
  status: result.status,
  cwd: "",
  durationMs: result.durationMs,
  output: "",
});

const gateReport = (data: {
  readonly passed: boolean;
  readonly results: readonly {
    readonly name: string;
    readonly type: GateInfo["type"];
    readonly status: GateResult["status"];
    readonly durationMs: number;
  }[];
}): GateReport => ({
  repo: "",
  mode: "task",
  base: "",
  passed: data.passed,
  changed: [],
  results: data.results.map(gateResult),
});

/**
 * Replays events through the existing `Progress` renderer. Every event maps to the method that
 * printed the same line before; the renderer text, icons and widths stay untouched.
 */
export class TerminalSink implements EventSink {
  readonly #progress: Progress;
  #verbosity: Verbosity;
  /** The pipeline step of the latest agent/install event; old gate events carry no step. */
  #step = "";

  constructor(progress: Progress, step = "") {
    this.#progress = progress;
    this.#verbosity = progress.verbosity;
    this.#step = step;
  }

  bind(target: SinkTarget): void {
    this.#verbosity = target.verbosity;
  }

  write(event: RunEvent): void {
    switch (event.type) {
      case "progress.line": {
        const { level, text } = event.data;
        if (!levelVisible(level, this.#verbosity)) return;
        if (level === "normal") this.#progress.note(text);
        else this.#progress.line(text);
        return;
      }
      case "agent.started":
        this.#step = event.data.step;
        this.#progress.agentStarted({
          step: event.data.step,
          agent: event.data.agent,
          model: event.data.model,
          ...(event.data.label === undefined ? {} : { label: event.data.label }),
          ...(event.data.attempt === undefined ? {} : { attempt: event.data.attempt }),
        });
        return;
      case "agent.finished":
        this.#step = event.data.step;
        this.#progress.agentFinished({
          step: event.data.step,
          outcome: event.data.outcome,
          durationMs: event.data.durationMs,
          usage: event.data.usage,
          ...(event.data.problem === undefined ? {} : { problem: event.data.problem }),
        });
        return;
      case "agent.activity": {
        const { step, detail, kind, status } = event.data;
        this.#step = step;
        switch (kind) {
          case "step-started":
            this.#progress.activity(step, { kind: "step-started" });
            return;
          case "step-done":
            this.#progress.activity(step, {
              kind: "step-done",
              usage: event.data.usage ?? ZERO_USAGE,
            });
            return;
          case "retry":
            this.#progress.activity(step, { kind: "retry", reason: detail });
            return;
          case "tool":
            this.#progress.activity(step, { kind: "tool", tool: detail });
            return;
          case "tool-done":
            this.#progress.activity(step, {
              kind: "tool-done",
              tool: detail,
              status: status ?? "ok",
            });
            return;
          default: {
            const unhandled: never = kind;
            throw new Error(`unhandled activity kind: ${String(unhandled)}`);
          }
        }
      }
      case "agent.retry":
        this.#step = event.data.step;
        this.#progress.activity(event.data.step, {
          kind: "retry",
          ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
        });
        return;
      case "gate.planned":
        this.#progress.gate(
          event.data.step ?? this.#step,
          {
            phase: "plan",
            gates: event.data.gates.map(gateInfo),
          },
          event.data.stage,
        );
        return;
      case "gate.started":
        this.#progress.gate(event.data.step ?? this.#step, {
          phase: "start",
          gate: gateInfo(event.data),
        });
        return;
      case "gate.finished":
        this.#progress.gate(event.data.step ?? this.#step, {
          phase: "end",
          gate: gateInfo(event.data),
          status: event.data.status,
          durationMs: event.data.durationMs,
        });
        return;
      case "gate.report":
        this.#progress.gatesDone(
          event.data.step ?? this.#step,
          gateReport(event.data),
          // Old streams predate the elapsed duration; the sum is the closest reconstruction.
          event.data.durationMs ??
            event.data.results.reduce((total, result) => total + result.durationMs, 0),
          event.data.stage,
        );
        return;
      case "install.started":
        this.#step = event.data.step;
        this.#progress.install(event.data.step, event.data.repo, "start");
        return;
      case "install.finished":
        this.#step = event.data.step;
        this.#progress.install(
          event.data.step,
          event.data.repo,
          "done",
          event.data.durationMs ?? 0,
          event.data.detail,
        );
        return;
      case "install.failed":
        this.#step = event.data.step;
        this.#progress.install(
          event.data.step,
          event.data.repo,
          "failed",
          event.data.durationMs ?? 0,
          event.data.detail,
        );
        return;
      case "task.started":
        this.#progress.task({
          type: "started",
          task: taskState(event.data.task, "running"),
          attempt: event.data.attempt,
        });
        return;
      case "task.retried":
        this.#progress.task({
          type: "retry",
          task: taskState(event.data.task, "running"),
          attempt: event.data.attempt,
          reason: event.data.reason ?? "",
        });
        return;
      case "task.failed":
        this.#progress.task({
          type: "failed",
          task: taskState(event.data.task, "failed"),
          reason: event.data.reason,
        });
        return;
      case "task.merging":
        this.#progress.task({ type: "merging", task: taskState(event.data.task, "merging") });
        return;
      case "task.merged":
        this.#progress.task({
          type: "merged",
          task: taskState(event.data.task, "merged"),
          commit: event.data.commit,
        });
        return;
      case "task.conflict":
        this.#progress.task({
          type: "conflict",
          task: taskState(event.data.task, "merging"),
          files: event.data.files,
        });
        return;
      case "task.requeued":
        this.#progress.task({
          type: "requeued",
          task: taskState(event.data.task, "pending"),
          reason: event.data.reason,
        });
        return;
      case "task.transient":
        this.#progress.task({
          type: "transient",
          task: taskState(event.data.task, "pending"),
          reason: event.data.reason,
        });
        return;
      case "task.interrupted":
        this.#progress.task({
          type: "interrupted",
          task: taskState(event.data.task, "pending"),
        });
        return;
      case "task.waiting":
        this.#progress.task({ type: "waiting", tasks: event.data.tasks });
        return;
      case "task.queued":
      case "task.passed":
      case "task.blocked":
      case "task.skipped":
      case "task.removed":
        return;
      case "heartbeat":
        this.#progress.line(event.data.text);
        return;
      case "run.started":
      case "run.finished":
      case "run.paused":
      case "run.resumed":
      case "run.aborted":
      case "run.branches":
      case "run.pause-requested":
      case "phase.changed":
      case "question.raised":
      case "question.answered":
      case "approval.requested":
      case "approval.granted":
      case "usage.delta":
        return;
      default: {
        const unhandled: never = event;
        throw new Error(`unhandled event: ${String(unhandled)}`);
      }
    }
  }
}
