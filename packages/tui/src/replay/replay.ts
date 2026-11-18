/**
 * Reads a recorded event stream from an arbitrary path and turns it into the same model the live
 * entry builds from `Factory`. Corrupt lines are reported, never fatal: the replay keeps the
 * events it could read, matching the event-log reader semantics without importing it.
 */
import { readFile } from "node:fs/promises";
import type { StatusDocument } from "@loomwright/core/factory";
import type { RunState, TaskState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import {
  type RunEvent,
  RunEvent as RunEventSchema,
  type RunSnapshot,
  reduce,
} from "@loomwright/protocol";
import { collectFacts, type EventFacts } from "../model/facts.ts";

export interface ReplayLoad {
  readonly events: readonly RunEvent[];
  readonly skipped: { readonly line: number; readonly reason: string }[];
}

/**
 * Parses each complete line once. A trailing partial line (no newline) is ignored, as is a blank
 * line; a line that is not JSON or not a known event is collected in `skipped` and skipped.
 */
export async function readReplayFile(path: string): Promise<ReplayLoad> {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n").slice(0, -1);
  const events: RunEvent[] = [];
  const skipped: { line: number; reason: string }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err: unknown) {
      skipped.push({
        line: index + 1,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const parsed = RunEventSchema.safeParse(value);
    if (!parsed.success) {
      skipped.push({
        line: index + 1,
        reason: parsed.error.issues[0]?.message ?? "invalid event",
      });
      continue;
    }
    events.push(parsed.data);
  }

  return { events, skipped };
}

export interface ReplayModel {
  readonly snapshot: RunSnapshot;
  readonly facts: EventFacts;
  readonly run: RunState;
  readonly status: StatusDocument;
}

function tasksFrom(snapshot: RunSnapshot): TaskState[] {
  return Object.entries(snapshot.tasks).map(([id, seen]) => ({
    id,
    title: id,
    repo: "",
    deps: [],
    touches: [],
    kind: "task",
    status: seen.status,
    failures: 0,
    serial: false,
    gatesPassed: false,
    installed: false,
    history: [],
  }));
}

function zeroSummary(): UsageSummary {
  const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  return {
    total: zero,
    sessions: 0,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: zero,
    top: [],
    wastedReads: 0,
  };
}

/**
 * The synthetic run file the view-model needs: a strict `RunState` at the run-file defaults, with
 * the id, phase and task statuses coming from the reduced stream. There is no summary event, so
 * the summary stays empty rather than inventing one.
 */
function runFrom(snapshot: RunSnapshot): RunState {
  return {
    version: 1,
    id: snapshot.runId,
    factoryVersion: "",
    origin: "factory",
    preserveProgress: false,
    request: "",
    createdAt: "",
    updatedAt: "",
    phase: snapshot.phase ?? "intake",
    abortRequested: false,
    branches: {},
    tasks: tasksFrom(snapshot),
    mergeSeq: 0,
    graphSeq: 0,
    serialOwner: {},
    summary: "",
    likelyRepos: [],
    reviewed: [],
    reviewRound: 0,
    reReview: [],
    specFindings: [],
    suiteRounds: 0,
    handoffs: {},
    clarifications: [],
    fullSuite: {},
    contractRounds: 0,
    contractReviewed: false,
    contractResults: {},
    pointersBumped: false,
    pointers: [],
  };
}

export function replayModel(load: ReplayLoad, _now: number): ReplayModel {
  const snapshot = reduce(load.events);
  const run = runFrom(snapshot);
  return {
    snapshot,
    facts: collectFacts(load.events),
    run,
    status: {
      active: null,
      driverAlive: false,
      queue: [],
      runs: [{ ...run, usage: zeroSummary() }],
      corrupt: [],
    },
  };
}
