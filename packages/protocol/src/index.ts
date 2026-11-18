/**
 * Loomwright's versioned run-event protocol.
 *
 * `PROTOCOL_VERSION` lives in `events.ts` (the schema uses it as the envelope literal) and is
 * re-exported here together with the event union, the snapshot reducer and the command union.
 * The protocol evolves additively; removing or renaming a type or field bumps the version.
 */
export * from "./command.ts";
export * from "./events.ts";
export * from "./snapshot.ts";
