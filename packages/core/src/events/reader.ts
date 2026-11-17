import { readFileSync } from "node:fs";
import { formatZodIssues } from "../config/load.ts";
import { eventLogPath } from "./jsonl.ts";
import { EventEnvelope, RunEvent } from "./protocol.ts";

export interface ReadOptions {
  /** First sequence number to return, inclusive. Default 1. */
  readonly fromSeq?: number;
}

export interface SkippedLine {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly reason: "unknown-type" | "invalid" | "invalid-envelope";
  readonly error?: string;
}

export interface ReadResult {
  /** Valid events with `seq >= fromSeq`, in file order. */
  readonly events: RunEvent[];
  /** Sequence numbers expected but absent; duplicates are not gaps. */
  readonly missing: number[];
  /** Complete lines that did not validate or named an unknown type. */
  readonly skipped: SkippedLine[];
}

export interface EventLine {
  /** The stored line, byte-exact and without its trailing newline. */
  readonly text: string;
  /** The parsed event, when the line validates and names a known type. */
  readonly event?: RunEvent;
  /** The envelope's sequence number, when the line is a readable envelope. */
  readonly seq?: number;
}

export interface ReadLinesResult {
  /** Every complete non-empty line, in file order, valid or not. */
  readonly lines: EventLine[];
  /** Sequence numbers expected but absent; duplicates are not gaps. */
  readonly missing: number[];
  /** Complete lines that did not validate or named an unknown type. */
  readonly skipped: SkippedLine[];
}

const isMissingFile = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";

const isEmpty = (value: string): boolean => value.trim() === "";

/**
 * Reads `.factory/events/<runId>.jsonl` without ever writing it, returning one entry per
 * complete non-empty line. A missing log is empty, a partial last line is ignored, and a
 * malformed or unknown line keeps its raw `text` while `event` stays absent.
 */
export function readEventLines(root: string, runId: string): ReadLinesResult {
  const path = eventLogPath(root, runId);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err: unknown) {
    if (isMissingFile(err)) return { lines: [], missing: [], skipped: [] };
    throw err;
  }
  // The split always ends with an element: "" after a trailing newline, or the partial tail.
  // Dropping it leaves only complete lines.
  const rawLines = text.split("\n").slice(0, -1);
  const lines: EventLine[] = [];
  const events: RunEvent[] = [];
  const skipped: SkippedLine[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    if (line === undefined || isEmpty(line)) continue;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err: unknown) {
      skipped.push({
        line: lineNumber,
        reason: "invalid",
        error: err instanceof Error ? err.message : String(err),
      });
      lines.push({ text: line });
      continue;
    }
    const envelope = EventEnvelope.safeParse(value);
    if (!envelope.success) {
      skipped.push({
        line: lineNumber,
        reason: "invalid-envelope",
        error: formatZodIssues(envelope.error).join("; "),
      });
      lines.push({ text: line });
      continue;
    }
    const event = RunEvent.safeParse(value);
    if (!event.success) {
      const unknownType = event.error.issues.some(
        (issue) => issue.code === "invalid_union" && issue.discriminator === "type",
      );
      skipped.push({
        line: lineNumber,
        reason: unknownType ? "unknown-type" : "invalid",
        error: formatZodIssues(event.error).join("; "),
      });
      lines.push({ text: line, seq: envelope.data.seq });
      continue;
    }
    events.push(event.data);
    lines.push({ text: line, event: event.data, seq: event.data.seq });
  }

  const missing: number[] = [];
  let expected = 1;
  for (const event of events) {
    for (let seq = expected; seq < event.seq; seq += 1) missing.push(seq);
    expected = Math.max(expected, event.seq + 1);
  }

  return { lines, missing, skipped };
}

/**
 * Reads `.factory/events/<runId>.jsonl` without ever writing it. A missing log is an empty
 * result, a partial last line is ignored and corrupt complete lines are reported in `skipped`.
 */
export function readEvents(root: string, runId: string, options: ReadOptions = {}): ReadResult {
  const fromSeq = options.fromSeq ?? 1;
  const { lines, skipped } = readEventLines(root, runId);
  const events = lines.flatMap((line) =>
    line.event !== undefined && line.event.seq >= fromSeq ? [line.event] : [],
  );

  const missing: number[] = [];
  let expected = fromSeq;
  for (const event of events) {
    for (let seq = expected; seq < event.seq; seq += 1) missing.push(seq);
    expected = Math.max(expected, event.seq + 1);
  }

  return { events, missing, skipped };
}
