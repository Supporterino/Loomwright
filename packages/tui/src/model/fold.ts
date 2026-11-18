/**
 * The live tail's running projection: each frame folds only the events that arrived since the last
 * one, so what the UI retains is the snapshot and the facts, never the event list itself.
 */
import { type RunEvent, type RunSnapshot, reduce } from "@loomwright/protocol";
import { appendFacts, collectFacts, type EventFacts } from "./facts.ts";

export interface FoldedRun {
  readonly snapshot: RunSnapshot;
  readonly facts: EventFacts;
}

/** Folds `events` into `prior` (or a fresh projection) and hands back only the projection. */
export function foldRun(prior: FoldedRun | null, events: readonly RunEvent[]): FoldedRun {
  return {
    snapshot: reduce(events, prior?.snapshot),
    facts: appendFacts(prior?.facts ?? collectFacts([]), events),
  };
}
