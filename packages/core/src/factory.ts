import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Approval } from "./approval/approval.ts";
import { findWorkspaceRoot, loadConfig } from "./config/load.ts";
import type { FactoryConfig } from "./config/schema.ts";
import { PreconditionError } from "./errors.ts";
import type { RunEvent } from "./events/protocol.ts";
import { readEventLines } from "./events/reader.ts";
import { tailEvents } from "./events/tailer.ts";
import { LOCK_FILE } from "./lock/lock.ts";
import type { Ask } from "./pipeline/clarify.ts";
import type { Verbosity } from "./pipeline/progress.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import type { ActiveLock } from "./state/active.ts";
import { driverAlive, readActive, readQueue } from "./state/active.ts";
import { readOrCorrupt } from "./state/files.ts";
import {
  listRuns as listRunStates,
  loadRun,
  type RunScan,
  type RunState,
  scanRuns,
} from "./state/run.ts";
import { summarizeUsage, summarizeWorkspaceUsage } from "./usage/usage.ts";

/**
 * `Factory.open` is the library command API: the CLI's `status`, `listRuns` and `events` read
 * paths without the CLI, and (from 5.2) the write commands. Reads never take a lock, write run
 * state or append an event; `open` only resolves the workspace config and lock.
 */

export interface FactoryOptions {
  readonly cwd?: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
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

/** Options for `Factory.run`; the write half lands in 5.2. */
export interface RunCommandOptions {
  readonly quick?: boolean;
}

/** What `Factory.run` and `Factory.resume` report; the write half lands in 5.2. */
export type RunOutcome = RunState;

export interface Factory {
  // reads
  status(changeId?: string): Promise<StatusDocument>;
  listRuns(): Promise<RunState[]>;
  events(runId: string, query?: EventQuery): AsyncIterable<EventLogLine>;
  // writes (5.2)
  run(request: string, options?: RunCommandOptions): Promise<RunOutcome>;
  resume(changeId: string): Promise<RunOutcome>;
  approve(changeId: string, options?: { continue?: boolean }): Promise<Approval>;
  retry(changeId: string, taskId: string): Promise<void>;
  abort(changeId: string): Promise<void>;
  answer(changeId: string, answer: string, question?: string): Promise<void>;
  pause(changeId: string): Promise<void>;
}

function requireRun(root: string, id: string): RunState {
  const run = loadRun(root, id);
  if (run === undefined) throw new PreconditionError(`no change ${id} in this workspace`);
  return run;
}

function createFactory(root: string, _config: FactoryConfig, _options: FactoryOptions): Factory {
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
        yield { line: JSON.stringify(item.event), event: item.event };
      }
    },

    async run(_request: string, _options?: RunCommandOptions): Promise<RunOutcome> {
      throw new PreconditionError("Factory.run is not implemented yet");
    },
    async resume(_changeId: string): Promise<RunOutcome> {
      throw new PreconditionError("Factory.resume is not implemented yet");
    },
    async approve(_changeId: string, _options?: { continue?: boolean }): Promise<Approval> {
      throw new PreconditionError("Factory.approve is not implemented yet");
    },
    async retry(_changeId: string, _taskId: string): Promise<void> {
      throw new PreconditionError("Factory.retry is not implemented yet");
    },
    async abort(_changeId: string): Promise<void> {
      throw new PreconditionError("Factory.abort is not implemented yet");
    },
    async answer(_changeId: string, _answer: string, _question?: string): Promise<void> {
      throw new PreconditionError("Factory.answer is not implemented yet");
    },
    async pause(_changeId: string): Promise<void> {
      throw new PreconditionError("Factory.pause is not implemented yet");
    },
  };
}

export async function open(workspace?: string, options: FactoryOptions = {}): Promise<Factory> {
  const root =
    workspace === undefined ? await findWorkspaceRoot(options.cwd ?? process.cwd()) : workspace;
  if (root === undefined) throw new PreconditionError("not inside a git repository");
  if (!existsSync(join(root, LOCK_FILE)))
    throw new PreconditionError("loomwright is not installed here", ["run `loomwright init`"]);
  const { config } = loadConfig(root);
  return createFactory(root, config, options);
}
