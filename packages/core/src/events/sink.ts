import type { Verbosity } from "../pipeline/progress.ts";
import type { RunEvent } from "./protocol.ts";

export type { Verbosity };

/** What the emitter is bound to: the workspace root, the run id and the chosen verbosity. */
export interface SinkTarget {
  readonly root: string;
  readonly runId: string;
  readonly verbosity: Verbosity;
}

/** A destination for the orchestrator's events. Sinks never read state or allocate `seq`. */
export interface EventSink {
  /** Called once per event, in seq order, on the writing process only. */
  write(event: RunEvent): void;
  /** Optional: a per-run sink prepares its destination (create or repair) when bound. */
  bind?(target: SinkTarget): void;
  /** Flush/close; must be idempotent. */
  close?(): void;
}

export type ProgressLevel = "always" | "normal" | "verbose";

/** Whether a `progress.line` level survives the terminal's verbosity. */
export function levelVisible(level: ProgressLevel, verbosity: Verbosity): boolean {
  switch (level) {
    case "always":
      return true;
    case "normal":
      return verbosity !== "quiet";
    case "verbose":
      return verbosity === "verbose";
    default: {
      const unhandled: never = level;
      throw new Error(`unhandled progress level: ${String(unhandled)}`);
    }
  }
}
