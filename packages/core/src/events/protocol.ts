/**
 * The event protocol as core exposes it. The CLI imports only `@loomwright/core/*`, so the
 * protocol types reach it through this module instead of the leaf package.
 */

import { RunId } from "@loomwright/protocol";
import { PreconditionError } from "../errors.ts";

export type {
  Command as CommandType,
  EventType,
  RunEvent as RunEventType,
  RunSnapshot,
  TruncationRef,
} from "@loomwright/protocol";
export {
  Command,
  EventEnvelope,
  emptySnapshot,
  PROTOCOL_VERSION,
  RunEvent,
  RunId,
  reduce,
} from "@loomwright/protocol";

/**
 * Rejects an id that cannot name a run before it becomes a path segment (`.factory/runs/<id>.json`).
 * The CLI validates through `Command`; this covers the library API and the event stream.
 */
export function assertRunId(id: string): void {
  if (!RunId.safeParse(id).success)
    throw new PreconditionError("expected a change id such as add-health");
}
