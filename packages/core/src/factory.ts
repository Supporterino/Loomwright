import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Approval } from "./approval/approval.ts";
import { findWorkspaceRoot, loadConfig } from "./config/load.ts";
import type { FactoryConfig } from "./config/schema.ts";
import { PreconditionError, UsageError } from "./errors.ts";
import { setCommandErrorReporter, writeCommand } from "./events/inbox.ts";
import { assertRunId, Command, type RunEvent } from "./events/protocol.ts";
import { readEventLines } from "./events/reader.ts";
import { tailEvents } from "./events/tailer.ts";
import { LOCK_FILE } from "./lock/lock.ts";
import { pruneLogs } from "./logs/log.ts";
import { approve as approvePipeline } from "./pipeline/approve.ts";
import type { Ask } from "./pipeline/clarify.ts";
import { Pipeline } from "./pipeline/context.ts";
import { design, intake } from "./pipeline/design.ts";
import { drive } from "./pipeline/drive.ts";
import type { Verbosity } from "./pipeline/progress.ts";
import { OpencodeRuntime } from "./runtime/opencode.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { retryTask } from "./scheduler/scheduler.ts";
import type { ActiveLock } from "./state/active.ts";
import {
  driverAlive,
  readActive,
  readQueue,
  releaseActive,
  releaseDriver,
  removeFromQueue,
} from "./state/active.ts";
import { factoryDir, readOrCorrupt } from "./state/files.ts";
import {
  listRuns as listRunStates,
  loadRun,
  type Phase,
  type RunScan,
  type RunState,
  scanRuns,
  updateRun,
} from "./state/run.ts";
import { summarizeUsage, summarizeWorkspaceUsage } from "./usage/usage.ts";

/**
 * `Factory.open` is the library command API: the CLI's `status`, `listRuns` and `events` read
 * paths without the CLI, and the write commands over the same modules the CLI uses. Reads
 * never take a lock, write run state or append an event; write commands compose `intake`,
 * `design`, `approve` and `drive` and never start a daemon or listener.
 */

export interface FactoryOptions {
  readonly cwd?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** When omitted, `Factory` owns SIGINT/SIGTERM for the duration of one write command. */
  readonly signal?: AbortSignal;
  readonly runtime?: (root: string, config: FactoryConfig, changeId: string) => AgentRuntime;
  readonly ask?: Ask;
  readonly verbosity?: Verbosity;
  /** Test seam. */
  readonly heartbeatMs?: number;
  /** Test seam. */
  readonly now?: () => number;
}

export interface StatusDocument {
  readonly active: ActiveLock | null;
  readonly driverAlive: boolean;
  readonly queue: string[];
  readonly workspaceUsage?: ReturnType<typeof summarizeWorkspaceUsage>;
  readonly runs: (RunState & { usage: ReturnType<typeof summarizeUsage> })[];
  readonly corrupt: { file?: string; id?: string; error: string }[];
}

export interface EventQuery {
  readonly fromSeq?: number;
  readonly follow?: boolean;
  readonly signal?: AbortSignal;
}

export interface EventLogLine {
  /** The stored JSONL line, byte-exact (no trailing newline). */
  readonly line: string;
  /** Parsed, when the line validates and names a known type. */
  readonly event?: RunEvent;
}

/** Options for `Factory.run`; `clarify: false` records questions instead of asking them. */
export interface RunCommandOptions {
  readonly clarify?: boolean;
}

/** What a write command reports; the exit code stays a CLI concern. */
export interface RunOutcome {
  readonly id: string;
  readonly phase: Phase;
  readonly detail?: string;
}

export interface Factory {
  // reads
  status(changeId?: string): Promise<StatusDocument>;
  listRuns(): Promise<RunState[]>;
  events(runId: string, query?: EventQuery): AsyncIterable<EventLogLine>;
  // writes
  run(request: string, options?: RunCommandOptions): Promise<RunOutcome>;
  resume(changeId: string): Promise<RunOutcome>;
  approve(changeId: string, options?: { continue?: boolean }): Promise<Approval>;
  retry(changeId: string, taskId: string): Promise<void>;
  abort(changeId: string): Promise<void>;
  answer(changeId: string, answer: string, question?: string): Promise<void>;
  pause(changeId: string): Promise<void>;
}

const noop = (): void => {};

const stderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

function requireRun(root: string, id: string): RunState {
  assertRunId(id);
  const run = loadRun(root, id);
  if (run === undefined) throw new PreconditionError(`no change ${id} in this workspace`);
  return run;
}

function report(out: (line: string) => void, outcome: RunOutcome): void {
  out(`${outcome.id}: ${outcome.phase}${outcome.detail ? ` — ${outcome.detail}` : ""}`);
  if (outcome.phase === "done")
    out(
      `next: \`loomwright land ${outcome.id}\` merges the finished change into its base branches`,
    );
}

/** Worktrees a change kept (`status`/`abort` show them; the CLI owns the same list). */
function worktreesOf(root: string, id: string): string[] {
  const dir = factoryDir(root, "worktrees", id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((repo) => repo !== ".opencode")
    .flatMap((repo) =>
      readdirSync(join(dir, repo)).map((task) => `.factory/worktrees/${id}/${repo}/${task}`),
    );
}

interface PipelineCommandOptions {
  readonly clarify?: boolean;
}

/**
 * One write command: prune logs, build the runtime, wire the signal and always close both.
 * A caller-supplied `signal` is honoured as-is; only then does `Factory` install nothing,
 * because a library must not hijack its host's process handlers.
 */
async function withPipeline<T>(
  root: string,
  config: FactoryConfig,
  options: FactoryOptions,
  changeId: string,
  work: (p: Pipeline) => Promise<T>,
  commandOptions: PipelineCommandOptions = {},
): Promise<T> {
  const out = options.out ?? noop;
  const err = options.err ?? stderr;
  pruneLogs(root, config.logs.retentionDays);
  const makeRuntime =
    options.runtime ??
    ((r: string, c: FactoryConfig, id: string): AgentRuntime =>
      new OpencodeRuntime({
        root: r,
        config: c,
        changeId: id,
        turnTimeoutMs: c.runtime.turnTimeoutMinutes * 60_000,
      }));
  const runtime = makeRuntime(root, config, changeId);
  const ownSignal = options.signal === undefined;
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const onSignal = (): void => {
    err("interrupt: stopping safely (state is kept; continue with `loomwright resume`)");
    controller.abort();
  };
  if (ownSignal) {
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }
  const p = new Pipeline(root, config, {
    runtime,
    out,
    signal,
    ...(options.verbosity === undefined ? {} : { verbosity: options.verbosity }),
    ...(options.ask === undefined ? {} : { ask: options.ask }),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(commandOptions.clarify === undefined ? {} : { clarify: commandOptions.clarify }),
  });
  setCommandErrorReporter(p, err);
  try {
    return await work(p);
  } finally {
    p.progress.stop();
    if (ownSignal) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    await runtime.close();
    const active = readOrCorrupt(() => readActive(root)).value;
    if (active?.pid === process.pid) await releaseDriver(root, active.changeId);
  }
}

function createFactory(
  root: string,
  config: () => FactoryConfig,
  options: FactoryOptions,
): Factory {
  const out = options.out ?? noop;

  return {
    async status(changeId?: string): Promise<StatusDocument> {
      // Corrupt state files are shown, not fatal: status is how they are found (audit P15).
      const lock = readOrCorrupt(() => readActive(root));
      const queued = readOrCorrupt(() => readQueue(root));
      const active = lock.value;
      const queue = queued.value?.entries.map((entry) => entry.changeId) ?? [];
      const scan: RunScan =
        changeId === undefined
          ? scanRuns(root)
          : { runs: [requireRun(root, changeId)], corrupt: [] };
      const corrupt: StatusDocument["corrupt"][number][] = [];
      if (lock.corrupt !== undefined)
        corrupt.push({ file: lock.corrupt.file, error: lock.corrupt.message });
      if (queued.corrupt !== undefined)
        corrupt.push({ file: queued.corrupt.file, error: queued.corrupt.message });
      for (const entry of scan.corrupt)
        corrupt.push({ id: entry.id, file: entry.error.file, error: entry.error.message });
      return {
        active: active ?? null,
        driverAlive: active === undefined ? false : driverAlive(active),
        queue,
        ...(changeId === undefined ? { workspaceUsage: summarizeWorkspaceUsage(root) } : {}),
        runs: scan.runs.map((run) => ({ ...run, usage: summarizeUsage(root, run.id) })),
        corrupt,
      };
    },

    async listRuns(): Promise<RunState[]> {
      return listRunStates(root);
    },

    async *events(runId: string, query: EventQuery = {}): AsyncIterable<EventLogLine> {
      assertRunId(runId);
      const fromSeq = query.fromSeq ?? 1;
      const stored = readEventLines(root, runId);
      for (const line of stored.lines) {
        if (line.seq !== undefined && line.seq < fromSeq) continue;
        yield line.event === undefined
          ? { line: line.text }
          : { line: line.text, event: line.event };
      }
      if (query.follow !== true) return;
      let lastSeq = fromSeq - 1;
      for (const line of stored.lines) {
        if (line.seq !== undefined && line.seq > lastSeq) lastSeq = line.seq;
      }
      const signal = query.signal;
      const tail = tailEvents(root, runId, {
        fromSeq: lastSeq + 1,
        ...(signal === undefined ? {} : { signal }),
      });
      for await (const item of tail) {
        // Gaps are not stored events; the CLI renders them from the stream it chooses.
        if (item.kind !== "event") continue;
        yield { line: item.text, event: item.event };
      }
    },

    async run(request: string, commandOptions?: RunCommandOptions): Promise<RunOutcome> {
      return withPipeline(
        root,
        config(),
        options,
        "intake",
        async (p) => {
          const id = await intake(p, request);
          const result = await design(p, id);
          const run = p.run(id);
          if (run.clarifications.length > 0) {
            const questions = join(
              run.draft === undefined ? p.root : join(p.root, run.draft),
              "openspec",
              "changes",
              id,
              "questions.md",
            );
            if (existsSync(questions)) out(`questions: ${relative(p.root, questions)}`);
          }
          if (!result.ok) {
            out(`${id}: the spec does not validate yet:`);
            for (const issue of result.issues) out(`  - ${issue}`);
            out(
              `fix openspec/changes/${id}/ and run \`loomwright approve ${id}\`, or \`loomwright resume ${id}\` to let the architect repair it`,
            );
            return { id, phase: "paused", detail: result.issues.join("\n") };
          }
          out(
            `${id}: awaiting approval — review openspec/changes/${id}/ then run \`loomwright approve ${id}\``,
          );
          return { id, phase: "awaiting-approval" };
        },
        { clarify: commandOptions?.clarify ?? true },
      );
    },

    async resume(changeId: string): Promise<RunOutcome> {
      const { runId } = Command.parse({ command: "resume", runId: changeId });
      requireRun(root, runId);
      return withPipeline(root, config(), options, runId, async (p) => {
        const outcome = await drive(p, runId);
        report(out, outcome);
        return outcome;
      });
    },

    async approve(changeId: string, commandOptions?: { continue?: boolean }): Promise<Approval> {
      const { runId } = Command.parse({ command: "approve", runId: changeId });
      return withPipeline(root, config(), options, runId, async (p) => {
        const approval = await approvePipeline(p, runId);
        if (commandOptions?.continue === false) return approval;
        report(out, await drive(p, runId));
        return approval;
      });
    },

    async retry(changeId: string, taskId: string): Promise<void> {
      const { runId } = Command.parse({ command: "retry", runId: changeId, task: taskId });
      const task = requireRun(root, runId).tasks.find((t) => t.id === taskId);
      if (task === undefined) throw new UsageError(`retry: ${runId} has no task ${taskId}`);
      if (task.status !== "failed")
        throw new PreconditionError(`task ${task.id} is ${task.status}, not failed`);
      const next = await updateRun(root, runId, (draft) => retryTask(draft, task.id));
      const revived = next.tasks.filter((t) => t.status === "pending").map((t) => t.id);
      out(`requeued ${task.id} with a fresh retry budget (pending: ${revived.join(", ")})`);
      out(`continue with \`loomwright resume ${runId}\``);
    },

    async abort(changeId: string): Promise<void> {
      const { runId } = Command.parse({ command: "abort", runId: changeId });
      const run = requireRun(root, runId);
      if (run.phase === "done") throw new PreconditionError(`${runId} is already closed`);
      // Read first: a corrupt lock refuses the abort before anything changed.
      const active = readActive(root);
      await updateRun(root, runId, (draft) => {
        draft.abortRequested = true;
        draft.phase = "aborted";
      });
      await removeFromQueue(root, runId);
      // A live driver in another process stops at its next safe point and frees the
      // workspace itself; otherwise nothing is running and the lock goes now.
      const driver =
        active?.changeId === runId &&
        active.pid !== null &&
        active.pid !== process.pid &&
        driverAlive(active)
          ? active.pid
          : undefined;
      if (driver === undefined) await releaseActive(root, runId);
      out(
        driver === undefined
          ? `aborted ${runId}`
          : `aborted ${runId}; pid ${driver} stops at its next safe point and frees the workspace`,
      );
      const branches = Object.entries(run.branches).map(([repo, b]) => `${repo}: ${b.branch}`);
      if (branches.length > 0) out(`kept branches: ${branches.join(", ")}`);
      const worktrees = worktreesOf(root, runId);
      if (worktrees.length > 0) out(`kept worktrees: ${worktrees.join(", ")}`);
    },

    async answer(changeId: string, answer: string, question?: string): Promise<void> {
      writeCommand(root, {
        command: "answer",
        runId: changeId,
        answer,
        ...(question === undefined ? {} : { question }),
      });
    },

    async pause(changeId: string): Promise<void> {
      writeCommand(root, { command: "pause", runId: changeId });
    },
  };
}

async function workspaceRoot(
  workspace: string | undefined,
  cwd: string | undefined,
): Promise<string> {
  const root = workspace === undefined ? await findWorkspaceRoot(cwd ?? process.cwd()) : workspace;
  if (root === undefined) throw new PreconditionError("not inside a git repository");
  return root;
}

/** The install marker and config only `run`, `resume` and `approve` need. */
function installConfig(root: string): FactoryConfig {
  if (!existsSync(join(root, LOCK_FILE)))
    throw new PreconditionError("loomwright is not installed here", ["run `loomwright init`"]);
  return loadConfig(root).config;
}

export async function open(workspace?: string, options: FactoryOptions = {}): Promise<Factory> {
  const root = await workspaceRoot(workspace, options.cwd);
  const config = (): FactoryConfig => installConfig(root);
  // `open` rejects before init and on a broken config, as it always has.
  config();
  return createFactory(root, config, options);
}

/**
 * The read and recovery variant: no install marker and no config, so `status`, `listRuns`,
 * `events`, `abort` and `retry` still work in a git repository that is not initialised or
 * whose config does not parse. The commands that need the config load it on first use.
 */
export async function openReadOnly(
  workspace?: string,
  options: FactoryOptions = {},
): Promise<Factory> {
  const root = await workspaceRoot(workspace, options.cwd);
  return createFactory(root, () => installConfig(root), options);
}
