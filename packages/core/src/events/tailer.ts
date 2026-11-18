import { closeSync, type FSWatcher, fstatSync, openSync, readSync, watch } from "node:fs";
import { factoryDir } from "../state/files.ts";
import { eventLogPath } from "./jsonl.ts";
import { EventEnvelope, RunEvent } from "./protocol.ts";
import type { SkipReason } from "./reader.ts";

export type TailItem =
  | {
      readonly kind: "event";
      readonly event: RunEvent;
      /** The stored line, byte-exact and without its trailing newline. */
      readonly text: string;
    }
  | {
      /** A stored line that is not an event: malformed, a bad envelope or an unknown type. */
      readonly kind: "raw";
      /** The stored line, byte-exact and without its trailing newline. */
      readonly text: string;
      readonly reason: SkipReason;
      /** The envelope's sequence number, when the line has a readable envelope. */
      readonly seq?: number;
    }
  | { readonly kind: "gap"; readonly missing: number[] };

/** A line the file can carry: an event, or the raw bytes that failed to become one. */
type StoredItem = Exclude<TailItem, { kind: "gap" }>;

export interface TailOptions {
  readonly fromSeq?: number;
  readonly signal?: AbortSignal;
  /** Polling period: the safety net for changes `fs.watch` coalesces or drops. */
  readonly pollMs?: number;
  /** Test seam: disable `fs.watch` and rely on polling alone (default: use both). */
  readonly useWatch?: boolean;
}

const NEWLINE = 0x0a;
const DEFAULT_POLL_MS = 250;

interface Cursor {
  /** Bytes up to and including the last newline consumed; the start of the next chunk. */
  completeOffset: number;
  ino: number | undefined;
}

const isMissingFile = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";

const reset = (cursor: Cursor): void => {
  cursor.completeOffset = 0;
  cursor.ino = undefined;
};

function parseLine(line: string): StoredItem | undefined {
  if (line.trim() === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "raw", reason: "invalid", text: line };
  }
  const envelope = EventEnvelope.safeParse(value);
  if (!envelope.success) return { kind: "raw", reason: "invalid-envelope", text: line };
  const event = RunEvent.safeParse(value);
  if (event.success) return { kind: "event", event: event.data, text: line };
  const unknownType = event.error.issues.some(
    (issue) => issue.code === "invalid_union" && issue.discriminator === "type",
  );
  return {
    kind: "raw",
    reason: unknownType ? "unknown-type" : "invalid",
    text: line,
    seq: envelope.data.seq,
  };
}

/**
 * Reads the lines finished since the last newline the cursor consumed. A smaller file or a different
 * inode means the log was rewritten, so the cursor restarts at byte 0. The unfinished tail is not
 * carried across polls: every read starts at the line the cursor is still inside, so a tail a
 * restart truncates and rewrites is parsed again instead of being glued to the bytes that follow it.
 * shortcut: a rewrite that leaves the file longer than `completeOffset` while changing bytes already
 * consumed is still read blindly, add a content or mtime check when writers can rewrite history.
 */
function readAppended(path: string, cursor: Cursor): StoredItem[] {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (err: unknown) {
    if (isMissingFile(err)) return [];
    throw err;
  }
  let chunk: Buffer;
  try {
    const stat = fstatSync(fd);
    if (cursor.ino !== undefined && cursor.ino !== stat.ino) reset(cursor);
    if (stat.size < cursor.completeOffset) reset(cursor);
    cursor.ino = stat.ino;
    const length = stat.size - cursor.completeOffset;
    if (length === 0) return [];
    chunk = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const bytes = readSync(fd, chunk, read, length - read, cursor.completeOffset + read);
      if (bytes === 0) break;
      read += bytes;
    }
    chunk = chunk.subarray(0, read);
  } finally {
    closeSync(fd);
  }

  const end = chunk.lastIndexOf(NEWLINE);
  if (end === -1) return [];
  cursor.completeOffset += end + 1;
  const items: StoredItem[] = [];
  for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
    const parsed = parseLine(line);
    if (parsed !== undefined) items.push(parsed);
  }
  return items;
}

/**
 * Follows a run's event log: yields the existing stream, then every appended event, inserting a
 * gap marker whenever a sequence number is absent. A stored line that is not an event (malformed,
 * a bad envelope or an unknown type) is yielded as `raw` instead of being dropped. A timer polls
 * alongside `fs.watch`, so a change the watch misses still arrives within `pollMs`. Reads only;
 * the watcher and timer are always closed, and aborting the signal completes the iterator
 * without error.
 */
export async function* tailEvents(
  root: string,
  runId: string,
  options: TailOptions = {},
): AsyncIterable<TailItem> {
  const fromSeq = options.fromSeq ?? 1;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const signal = options.signal;
  // Abort can arrive between yields; a helper keeps TS from narrowing the property to false.
  const aborted = (): boolean => signal?.aborted === true;
  const path = eventLogPath(root, runId);
  const cursor: Cursor = { completeOffset: 0, ino: undefined };
  let lastSeq = fromSeq - 1;

  let dirty = false;
  let resolveWait: (() => void) | undefined;
  const notify = (): void => {
    dirty = true;
    const resolve = resolveWait;
    resolveWait = undefined;
    resolve?.();
  };

  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  // The timer is a safety net, not only a fallback: `fs.watch` may coalesce or drop a change,
  // and a missed one would stall the tail until the next write.
  const startPolling = (): void => {
    timer ??= setInterval(notify, pollMs);
  };
  const onWatchError = (): void => {
    watcher?.close();
    watcher = undefined;
    notify();
  };
  const onAbort = (): void => notify();

  try {
    if (aborted()) return;
    signal?.addEventListener("abort", onAbort, { once: true });
    startPolling();
    if (options.useWatch !== false) {
      try {
        watcher = watch(factoryDir(root, "events"), () => notify());
      } catch {
        watcher = undefined;
      }
      watcher?.on("error", onWatchError);
    }

    for (;;) {
      if (aborted()) return;
      for (const item of readAppended(path, cursor)) {
        if (aborted()) return;
        if (item.kind === "raw") {
          // A stored line the reader would report as skipped; it still reaches the consumer.
          if (item.seq !== undefined && item.seq < fromSeq) continue;
          yield item;
          continue;
        }
        const { event, text } = item;
        if (event.seq <= lastSeq) continue;
        if (event.seq > lastSeq + 1) {
          const missing: number[] = [];
          for (let seq = lastSeq + 1; seq < event.seq; seq += 1) missing.push(seq);
          yield { kind: "gap", missing };
          if (aborted()) return;
        }
        lastSeq = event.seq;
        yield { kind: "event", event, text };
      }
      if (aborted()) return;
      if (dirty) {
        dirty = false;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
      dirty = false;
    }
  } finally {
    watcher?.close();
    if (timer !== undefined) clearInterval(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
