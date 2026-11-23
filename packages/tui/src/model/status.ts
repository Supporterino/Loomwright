/**
 * The status source behind the one-second poll. With a run open it asks only for that run and
 * merges the fresh usage into the last full document; the workspace slice and every other run's
 * ledger stay untouched. Without an open run, or while a spawn is still unfound, it falls back to
 * the full `status()` refresh.
 */
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import { type LandRefresh, settleLanding } from "./controls.ts";
import { syncApproval, type UiData } from "./ui-data.ts";

export interface StatusSource {
  /** One poll: the open run only, or the full document when no run (or an unfound spawn) is open. */
  poll(): Promise<void>;
  /** The full `status()` + `listRuns()` refresh; the poll's fallback and the controls' path. */
  refresh(): Promise<LandRefresh | null>;
}

export interface StatusSourceOptions {
  readonly factory: Pick<Factory, "status">;
  /** The open run's id; null whenever the list owns the screen. */
  readonly selectedRunId: () => string | null;
  /**
   * True while a spawn has not been discovered yet. Only the full refresh settles a spawn, so the
   * poll must take it even when a run is open; the per-run read would never see the new run.
   */
  readonly pendingSpawn?: () => boolean;
  readonly update: (change: (data: UiData) => UiData) => void;
  /** The entry's full refresh: it also settles a spawn and stops the tail of a removed run. */
  readonly refresh: () => Promise<LandRefresh | null>;
}

/** Replace one run in the last full document; `status.runs` is authoritative for the list. */
function mergeRun(current: UiData, id: string, partial: StatusDocument): UiData {
  const previous = current.status;
  const fresh = partial.runs.find((run) => run.id === id);
  if (fresh === undefined) return current;
  const runs = previous.runs.some((run) => run.id === id)
    ? previous.runs.map((run) => (run.id === id ? fresh : run))
    : [...previous.runs, fresh];
  return settleLanding(syncApproval({ ...current, status: { ...previous, ...partial, runs } }));
}

export function createStatusSource(options: StatusSourceOptions): StatusSource {
  return {
    refresh: options.refresh,
    async poll(): Promise<void> {
      const id = options.pendingSpawn?.() === true ? null : options.selectedRunId();
      if (id === null) {
        await options.refresh();
        return;
      }
      let partial: StatusDocument;
      try {
        partial = await options.factory.status(id);
      } catch {
        // Landing removes the run file, so the per-run call cannot resolve: refresh the list.
        await options.refresh();
        return;
      }
      options.update((current) => mergeRun(current, id, partial));
    },
  };
}
