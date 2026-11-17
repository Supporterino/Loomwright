import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { factoryDir } from "../state/files.ts";
import type { RunEvent, TruncationRef } from "./protocol.ts";
import type { EventSink, SinkTarget } from "./sink.ts";

/** `.factory/events/<runId>.jsonl`; the only file this module and the tree write events to. */
export function eventLogPath(root: string, runId: string): string {
  return factoryDir(root, "events", `${runId}.jsonl`);
}

/**
 * The last complete line's `seq`, or 0 when the file is missing, empty or has no newline.
 * A trailing line without a newline is a crash tail and is deliberately ignored.
 */
export function lastCompleteSeq(path: string): number {
  if (!existsSync(path)) return 0;
  const text = readFileSync(path, "utf8");
  const end = text.lastIndexOf("\n");
  if (end === -1) return 0;
  const lines = text.slice(0, end).split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "seq" in parsed &&
        typeof parsed.seq === "number"
      )
        return parsed.seq;
    } catch {
      // A malformed complete line is a reader concern; the writer only needs the last good seq.
    }
  }
  return 0;
}

/**
 * Writes the already-redacted full payload to the existing log layout and returns the exact
 * reference: the byte offset is taken before the append, the byte count is the JSON itself.
 */
export function appendTruncatedValue(
  root: string,
  runId: string,
  at: Date,
  json: string,
): TruncationRef {
  const date = at.toISOString().slice(0, 10);
  const dir = factoryDir(root, "logs", runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date}.jsonl`);
  const offset = existsSync(file) ? statSync(file).size : 0;
  appendFileSync(file, `${json}\n`);
  return {
    path: join(".factory", "logs", runId, `${date}.jsonl`),
    offset,
    bytes: Buffer.byteLength(json),
  };
}

/**
 * Append-only event log. One synchronous `appendFileSync` per event flushes the line; the
 * orchestrator is the only writer, so a plain call chain is already serialised.
 */
export class JsonlSink implements EventSink {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  bind(target: SinkTarget): void {
    this.#root = target.root;
    const file = eventLogPath(this.#root, target.runId);
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) {
      writeFileSync(file, "");
      return;
    }
    const text = readFileSync(file, "utf8");
    if (text === "" || text.endsWith("\n")) return;
    const end = text.lastIndexOf("\n");
    if (end === -1) {
      rmSync(file, { force: true });
      return;
    }
    truncateSync(file, Buffer.byteLength(text.slice(0, end + 1)));
  }

  write(event: RunEvent): void {
    const file = eventLogPath(this.#root, event.runId);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`);
  }
}
