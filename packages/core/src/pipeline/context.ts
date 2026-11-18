import { join } from "node:path";
import { type FactoryConfig, modelFor, type RepoConfig, type Role } from "../config/schema.ts";
import { type Emitter, EventEmitter } from "../events/emitter.ts";
import { JsonlSink } from "../events/jsonl.ts";
import type { EventType } from "../events/protocol.ts";
import type { EventSink } from "../events/sink.ts";
import { TerminalSink } from "../events/terminal.ts";
import type { Handoff } from "../handoff/schema.ts";
import { appendLog } from "../logs/log.ts";
import type { AgentRole } from "../policy/permissions.ts";
import { promptForHandoff } from "../runtime/handoff.ts";
import { limited, RateLimiter } from "../runtime/rate-limit.ts";
import {
  type AgentRuntime,
  type AgentSession,
  addUsage,
  type SessionActivity,
  type SessionSpec,
  type Usage,
  ZERO_USAGE,
} from "../runtime/types.ts";
import { loadRun, type RunState, updateRun } from "../state/run.ts";
import { recordUsage, type UsageEntry } from "../usage/usage.ts";
import { Semaphore } from "../util/semaphore.ts";
import type { Ask } from "./clarify.ts";
import { describeTool, failedToolLine, Progress, type Verbosity } from "./progress.ts";

/** Everything a pipeline step needs; one per CLI command invocation. */
export interface PipelineDeps {
  readonly runtime: AgentRuntime;
  /** Progress lines for the user. */
  readonly out: (line: string) => void;
  readonly signal: AbortSignal;
  /** How much progress to print; defaults to "normal". */
  readonly verbosity?: Verbosity;
  /** Tests: 0 disables the heartbeat, `now` freezes elapsed time. */
  readonly heartbeatMs?: number;
  readonly now?: () => number;
  /** Asks the user free text; undefined when nobody can answer (no TTY). */
  readonly ask?: Ask;
  /** Whether agent-raised questions may be asked; false records them and continues. */
  readonly clarify?: boolean;
  /** Tests: an extra sink (a `MemorySink`) receives the same events as the terminal. */
  readonly events?: { readonly sink?: EventSink };
}

export interface AgentCall {
  readonly changeId: string;
  readonly agent: string;
  readonly role: AgentRole;
  readonly modelRole: Role;
  readonly context: Omit<SessionSpec["context"], "changeId" | "role">;
  readonly title: string;
  /** Progress label, usually the task title. */
  readonly label?: string;
  readonly prompt: string;
  /** Usage bookkeeping: task id or step name, and the attempt kind (§11). */
  readonly step: string;
  readonly kind?: UsageEntry["kind"];
  readonly attempt?: number;
  /** Follow-up prompts in the same session when `retry` returns text (design repair). */
  readonly retry?: (handoff: Handoff | undefined, attempt: number) => Promise<string | undefined>;
  /**
   * Follow-up prompts for questions the CLI asked the user. Called after each successful
   * handoff; returning undefined ends the clarification rounds.
   */
  readonly clarify?: (handoff: Handoff, round: number) => Promise<string | undefined>;
}

export interface AgentResult {
  readonly handoff?: Handoff;
  readonly problem?: string;
  readonly outcome: "succeeded" | "failed" | "interrupted";
  readonly usage: Usage;
  readonly sessionId: string;
  readonly model: string;
}

/** `loomwright abort` was requested for the change: stop at the next safe point. */
export class ChangeAborted extends Error {
  constructor(readonly changeId: string) {
    super(`${changeId} was aborted`);
  }
}

export class Pipeline {
  readonly limiter = new RateLimiter();
  readonly agents: Semaphore;
  readonly gates: Semaphore;
  readonly progress: Progress;
  #events: Emitter;
  #bound: string | undefined;

  constructor(
    readonly root: string,
    readonly config: FactoryConfig,
    readonly deps: PipelineDeps,
  ) {
    this.agents = new Semaphore(config.parallel.maxAgents);
    this.gates = new Semaphore(config.parallel.maxGateProcesses);
    this.progress = new Progress({
      out: (line) => this.deps.out(line),
      ...(deps.verbosity === undefined ? {} : { verbosity: deps.verbosity }),
      maxAttempts: config.gates.maxRetries + 1,
      ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      onHeartbeat: (text) => {
        if (this.#bound === undefined) this.deps.out(text);
        else this.#events.emit("heartbeat", { text });
      },
    });
    this.#events = this.#newEmitter();
  }

  /** The event stream of the bound run. */
  get events(): Emitter {
    return this.#events;
  }

  /** Whether the stream is bound to a run; before that every line stays terminal-only. */
  get bound(): boolean {
    return this.#bound !== undefined;
  }

  /** The run this pipeline reached, once a step bound its stream. */
  get runId(): string | undefined {
    return this.#bound;
  }

  /** Binds to a run's stream, continuing its sequence; a different run gets a fresh emitter. */
  bindRun(id: string): void {
    if (this.#bound === id) return;
    if (this.#bound !== undefined) {
      this.#events.close();
      this.#events = this.#newEmitter();
    }
    // `resumed` keeps a second `run.started` out of an existing log; a fresh log starts where we say.
    this.#events.bind(id, { resumed: true });
    this.#bound = id;
  }

  /** Emits one event when bound; unbound steps print directly instead (there is no run id yet). */
  emit(type: EventType, data: unknown): void {
    if (this.#bound !== undefined) this.#events.emit(type, data);
  }

  #newEmitter(): Emitter {
    const extra = this.deps.events?.sink;
    return new EventEmitter({
      root: this.root,
      sinks: [
        new JsonlSink(this.root),
        new TerminalSink(this.progress),
        ...(extra === undefined ? [] : [extra]),
      ],
      ...(this.deps.verbosity === undefined ? {} : { verbosity: this.deps.verbosity }),
      redact: this.config.logs.redact,
    });
  }

  codeRepos(): RepoConfig[] {
    return this.config.repos.filter((r) => r.role === "code");
  }

  repo(name: string): RepoConfig {
    const repo = this.config.repos.find((r) => r.name === name);
    if (repo === undefined) throw new Error(`unknown repo ${name}`);
    return repo;
  }

  repoDir(repo: RepoConfig): string {
    return join(this.root, repo.path);
  }

  /** `▶ …` banners print once: as a `progress.line` event once bound, on the terminal before. */
  out(line: string): void {
    if (this.#bound === undefined) this.deps.out(line);
    else this.#events.emit("progress.line", { level: "always", text: line });
  }

  run(id: string): RunState {
    const run = loadRun(this.root, id);
    if (run === undefined) throw new Error(`no run state for ${id}`);
    return run;
  }

  update(id: string, mutate: (draft: RunState) => void): Promise<RunState> {
    return updateRun(this.root, id, mutate);
  }

  /** Whether `loomwright abort` asked this change to stop. */
  abortRequested(id: string): boolean {
    return id !== "intake" && loadRun(this.root, id)?.abortRequested === true;
  }

  /**
   * A signal that fires on SIGINT/SIGTERM or when `abort` marks the change (polled), so a
   * running session is interrupted either way.
   */
  #callSignal(id: string): { signal: AbortSignal; stop: () => void } {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (this.abortRequested(id)) controller.abort();
    }, 1000);
    return {
      signal: AbortSignal.any([this.deps.signal, controller.signal]),
      stop: () => clearInterval(timer),
    };
  }

  /** One agent session: open, prompt for a handoff (one repair), optional follow-ups. */
  async call(call: AgentCall): Promise<AgentResult> {
    if (this.abortRequested(call.changeId)) throw new ChangeAborted(call.changeId);
    const watch = this.#callSignal(call.changeId);
    try {
      return await this.#call(call, watch.signal);
    } finally {
      watch.stop();
    }
  }

  async #call(call: AgentCall, signal: AbortSignal): Promise<AgentResult> {
    const started = this.progress.now();
    const first = modelFor(this.config, call.modelRole, {
      ...(call.context.repo === undefined ? {} : { repo: call.context.repo }),
      agent: call.agent,
    });
    let model = first;
    let raw: AgentSession | undefined;
    let lastError: unknown;
    for (const candidate of [first, ...this.config.models.fallback]) {
      try {
        raw = await this.deps.runtime.open({
          agent: call.agent,
          model: candidate,
          title: call.title,
          context: { ...call.context, changeId: call.changeId, role: call.role },
          onActivity: (activity) => this.#activity(call.step, activity),
        });
        model = candidate;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (raw === undefined) {
      const err =
        lastError instanceof Error
          ? lastError
          : new Error(`could not open a session for ${call.agent}`);
      if (this.bound)
        this.#events.emit("agent.finished", {
          step: call.step,
          role: call.role,
          outcome: "failed",
          durationMs: this.progress.now() - started,
          usage: ZERO_USAGE,
          sessionId: "",
          problem: err.message,
        });
      else
        this.progress.agentFinished({
          step: call.step,
          outcome: "failed",
          durationMs: this.progress.now() - started,
          usage: ZERO_USAGE,
          problem: err.message,
        });
      throw err;
    }
    const sessionId = raw.id;
    if (this.bound)
      this.#events.emit("agent.started", {
        step: call.step,
        agent: call.agent,
        model,
        ...(call.label === undefined ? {} : { label: call.label }),
        ...(call.attempt === undefined ? {} : { attempt: call.attempt }),
      });
    else
      this.progress.agentStarted({
        step: call.step,
        agent: call.agent,
        model,
        ...(call.label === undefined ? {} : { label: call.label }),
        ...(call.attempt === undefined ? {} : { attempt: call.attempt }),
      });
    const finish = (
      outcome: "succeeded" | "failed" | "interrupted",
      usage: Usage,
      problem?: string,
    ) => {
      if (this.bound)
        this.#events.emit("agent.finished", {
          step: call.step,
          role: call.role,
          outcome,
          durationMs: this.progress.now() - started,
          usage,
          sessionId,
          ...(problem === undefined ? {} : { problem }),
        });
      else
        this.progress.agentFinished({
          step: call.step,
          outcome,
          durationMs: this.progress.now() - started,
          usage,
          ...(problem === undefined ? {} : { problem }),
        });
    };
    try {
      const provider = model.split("/")[0] ?? model;
      const session = limited(raw, this.limiter, provider);
      let turn = await promptForHandoff(session, call.prompt, signal);
      let usage = turn.usage;
      for (let round = 1; call.clarify && turn.outcome === "succeeded" && turn.handoff; round++) {
        const next = await call.clarify(turn.handoff, round);
        if (next === undefined) break;
        turn = await promptForHandoff(session, next, signal);
        usage = addUsage(usage, turn.usage);
      }
      for (let attempt = 1; call.retry && turn.outcome === "succeeded"; attempt++) {
        const next = await call.retry(turn.handoff, attempt);
        if (next === undefined) break;
        turn = await promptForHandoff(session, next, signal);
        usage = addUsage(usage, turn.usage);
      }
      appendLog(
        this.root,
        call.changeId,
        {
          kind: "session",
          session: raw.id,
          agent: call.agent,
          model,
          title: call.title,
          outcome: turn.outcome,
          usage,
          ...(turn.problem ? { problem: turn.problem } : {}),
        },
        { redact: this.config.logs.redact },
      );
      const entry: UsageEntry = {
        at: new Date().toISOString(),
        sessionId: raw.id,
        agent: call.agent,
        model,
        step: call.step,
        kind: call.kind ?? "step",
        ...(call.attempt === undefined ? {} : { attempt: call.attempt }),
        usage,
      };
      // Intake runs before the change id exists; `intake` records its entry under the id.
      if (call.changeId !== "intake") {
        await recordUsage(this.root, call.changeId, entry);
        if (this.bound)
          this.#events.emit("usage.delta", {
            step: call.step,
            agent: call.agent,
            model,
            usage,
          });
      }
      finish(turn.outcome, usage, turn.problem);
      return {
        ...(turn.handoff ? { handoff: turn.handoff } : {}),
        ...(turn.problem ? { problem: turn.problem } : {}),
        outcome: turn.outcome,
        usage,
        sessionId: raw.id,
        model,
      };
    } catch (err) {
      finish("failed", ZERO_USAGE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Session activity as events. A failed tool call has no slot for its error in
   * `agent.activity`, so it travels as the pre-rendered line the terminal printed before.
   */
  #activity(step: string, activity: SessionActivity): void {
    if (!this.bound) {
      this.progress.activity(step, activity);
      return;
    }
    switch (activity.kind) {
      case "step-started":
        this.#events.emit("agent.activity", { step, detail: "", kind: "step-started" });
        return;
      case "step-done":
        this.#events.emit("agent.activity", {
          step,
          detail: "",
          kind: "step-done",
          usage: activity.usage,
        });
        return;
      case "retry":
        this.#events.emit("agent.retry", {
          step,
          ...(activity.reason === undefined ? {} : { reason: activity.reason }),
        });
        return;
      case "tool":
        this.#events.emit("agent.activity", {
          step,
          detail: describeTool(activity.tool, activity.input),
          kind: "tool",
        });
        return;
      case "tool-done":
        if (activity.status === "failed") {
          this.#events.emit("progress.line", {
            level: "normal",
            text: failedToolLine(step, activity.tool, activity.error),
          });
          return;
        }
        this.#events.emit("agent.activity", {
          step,
          detail: activity.tool,
          kind: "tool-done",
          status: "ok",
        });
        return;
      default: {
        const unhandled: never = activity;
        throw new Error(`unhandled session activity: ${String(unhandled)}`);
      }
    }
  }
}
