/**
 * The event protocol as core exposes it. The CLI imports only `@loomwright/core/*`, so the
 * protocol types reach it through this module instead of the leaf package.
 */

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
  reduce,
} from "@loomwright/protocol";
