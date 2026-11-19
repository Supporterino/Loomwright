/**
 * The intake dialog's spawn watch rides the shared status poll: it never schedules a poll of its
 * own. Each poll says whether the new run started, and reads the launcher's local spawn log.
 */
import type { StatusDocument } from "@loomwright/core/factory";

export interface SpawnWatch {
  /** The run id absent before the spawn, or null while the run has not started yet. */
  readonly started: string | null;
  /** The spawn log's tail; empty once the run started and the dialog is about to close. */
  readonly tail: readonly string[];
}

export function watchSpawn(
  baseline: ReadonlySet<string>,
  status: StatusDocument,
  logPath: string,
  readTail: (path: string) => readonly string[],
): SpawnWatch {
  const started = status.runs.find((run) => !baseline.has(run.id))?.id ?? null;
  return { started, tail: started === null ? readTail(logPath) : [] };
}
