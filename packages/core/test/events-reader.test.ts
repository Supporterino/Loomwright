import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eventLogPath } from "../src/events/jsonl.ts";
import type { EventType, RunEvent } from "../src/events/protocol.ts";
import { RunEvent as RunEventSchema, reduce } from "../src/events/protocol.ts";
import { readEvents } from "../src/events/reader.ts";
import { type TailItem, tailEvents } from "../src/events/tailer.ts";

const RUN = "add-health";
const ISO = "2026-11-17T10:00:00.000Z";

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "loom-events-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const event = (seq: number, type: EventType, data: unknown): RunEvent =>
  RunEventSchema.parse({ v: 1, runId: RUN, seq, ts: ISO, type, data });

const line = (seq: number, type: EventType, data: unknown): string =>
  JSON.stringify(event(seq, type, data));

const envelope = (seq: number, type: string, data: unknown = {}): string =>
  JSON.stringify({ v: 1, runId: RUN, seq, ts: ISO, type, data });

const logPath = (root: string): string => eventLogPath(root, RUN);

const writeLog = (root: string, lines: readonly string[]): string => {
  const path = logPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((entry) => `${entry}\n`).join(""));
  return path;
};

const appendLine = (path: string, entry: string): void => appendFileSync(path, `${entry}\n`);

async function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface TailCursor {
  readonly next: () => Promise<TailItem>;
}

const startTail = (
  root: string,
  options: Parameters<typeof tailEvents>[2] = {},
): { cursor: TailCursor; close: () => Promise<void> } => {
  const iterator = tailEvents(root, RUN, options)[Symbol.asyncIterator]();
  return {
    cursor: {
      next: async () => {
        const next = await withTimeout(iterator.next());
        if (next.done === true) throw new Error("tail ended early");
        return next.value;
      },
    },
    close: async () => {
      await iterator.return?.(undefined);
    },
  };
};

const seqOf = (item: TailItem): number => {
  if (item.kind !== "event") throw new Error(`expected an event, got a gap: ${item.missing}`);
  return item.event.seq;
};

const seqsOf = (items: readonly TailItem[]): number[] =>
  items.flatMap((item) => (item.kind === "event" ? [item.event.seq] : []));

describe("events reader", () => {
  test("a partial last line is ignored", () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "run.started", { phase: "intake" }),
      line(2, "run.started", { phase: "design" }),
    ]);
    appendFileSync(logPath(root), '{"v":1,"runId":"add-health","seq":3');

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(result.missing).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test("fromSeq is inclusive", () => {
    const root = makeRoot();
    writeLog(
      root,
      [1, 2, 3, 4, 5].map((seq) => line(seq, "heartbeat", { text: `beat ${seq}` })),
    );

    expect(readEvents(root, RUN).events.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(readEvents(root, RUN, { fromSeq: 1 }).events.map((entry) => entry.seq)).toEqual([
      1, 2, 3, 4, 5,
    ]);

    const fromTwo = readEvents(root, RUN, { fromSeq: 2 });
    expect(fromTwo.events.map((entry) => entry.seq)).toEqual([2, 3, 4, 5]);
    expect(fromTwo.events[0]?.seq).toBe(2);

    expect(readEvents(root, RUN, { fromSeq: 5 }).events.map((entry) => entry.seq)).toEqual([5]);

    const beyond = readEvents(root, RUN, { fromSeq: 99 });
    expect(beyond.events).toEqual([]);
    expect(beyond.missing).toEqual([]);
  });

  test("a sequence gap is reported", () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(4, "heartbeat", { text: "four" }),
    ]);

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 2, 4]);
    expect(result.missing).toEqual([3]);
  });

  test("an unknown event type is skipped, not fatal", () => {
    const root = makeRoot();
    const first = line(1, "heartbeat", { text: "one" });
    const third = line(3, "heartbeat", { text: "three" });
    writeLog(root, [first, envelope(2, "future.thing", { value: true }), third]);

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 3]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("unknown-type");
    expect(result.skipped[0]?.line).toBe(2);

    const known = [
      event(1, "heartbeat", { text: "one" }),
      event(3, "heartbeat", { text: "three" }),
    ];
    expect(reduce(result.events)).toEqual(reduce(known));
  });

  test("an invalid payload is skipped", () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "run.started", { phase: "intake" }),
      envelope(2, "run.started", { phase: "not-a-phase" }),
      line(3, "run.started", { phase: "design" }),
    ]);

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 3]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("invalid");
    expect(result.skipped[0]?.line).toBe(2);
  });

  test("a malformed complete line is skipped", () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      "{oops",
      line(3, "heartbeat", { text: "three" }),
    ]);

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 3]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("invalid");
    expect(result.skipped[0]?.line).toBe(2);
  });

  test("a malformed line without an envelope is reported as invalid-envelope", () => {
    const root = makeRoot();
    writeLog(root, [JSON.stringify({ hello: "world" })]);

    const result = readEvents(root, RUN);

    expect(result.events).toEqual([]);
    expect(result.skipped[0]?.reason).toBe("invalid-envelope");
  });

  test("a missing event log is not an error", () => {
    const root = makeRoot();

    const result = readEvents(root, RUN);

    expect(result).toEqual({ events: [], missing: [], skipped: [] });
  });
});

describe("events tailer", () => {
  test("a concurrent tail sees appended events", async () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(3, "heartbeat", { text: "three" }),
    ]);
    const controller = new AbortController();
    const { cursor, close } = startTail(root, { signal: controller.signal });

    try {
      const seen: number[] = [];
      for (let index = 0; index < 3; index += 1) seen.push(seqOf(await cursor.next()));
      expect(seen).toEqual([1, 2, 3]);

      appendLine(path, line(4, "heartbeat", { text: "four" }));
      expect(seqOf(await cursor.next())).toBe(4);

      appendLine(path, line(5, "heartbeat", { text: "five" }));
      expect(seqOf(await cursor.next())).toBe(5);
    } finally {
      controller.abort();
      await close();
    }
  });

  test("tail yields a gap marker before a gapped event", async () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(4, "heartbeat", { text: "four" }),
    ]);
    const controller = new AbortController();
    const { cursor, close } = startTail(root, { signal: controller.signal });

    try {
      const items = [
        await cursor.next(),
        await cursor.next(),
        await cursor.next(),
        await cursor.next(),
      ];

      expect(seqsOf(items)).toEqual([1, 2, 4]);
      const gap = items[2];
      expect(gap).toEqual({ kind: "gap", missing: [3] });
    } finally {
      controller.abort();
      await close();
    }
  });

  test("an abort ends the tail", async () => {
    const root = makeRoot();
    writeLog(root, [line(1, "heartbeat", { text: "one" }), line(2, "heartbeat", { text: "two" })]);
    const controller = new AbortController();
    const iterator = tailEvents(root, RUN, { signal: controller.signal })[Symbol.asyncIterator]();

    const first = await withTimeout(iterator.next());
    expect(first.done).toBe(false);

    controller.abort();
    const afterAbort = await withTimeout(iterator.next());
    expect(afterAbort.done).toBe(true);
    await iterator.return?.(undefined);
  });

  test("polling fallback delivers appended events", async () => {
    const root = makeRoot();
    const path = writeLog(root, [line(1, "heartbeat", { text: "one" })]);
    const controller = new AbortController();
    const { cursor, close } = startTail(root, {
      signal: controller.signal,
      useWatch: false,
      pollMs: 10,
    });

    try {
      expect(seqOf(await cursor.next())).toBe(1);
      await Bun.sleep(20);
      appendLine(path, line(2, "heartbeat", { text: "two" }));
      expect(seqOf(await cursor.next())).toBe(2);
    } finally {
      controller.abort();
      await close();
    }
  });

  test("a partial line then completion yields the event once", async () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(3, "heartbeat", { text: "three" }),
    ]);
    const controller = new AbortController();
    const { cursor, close } = startTail(root, { signal: controller.signal });

    try {
      const seen: number[] = [];
      for (let index = 0; index < 3; index += 1) seen.push(seqOf(await cursor.next()));
      expect(seen).toEqual([1, 2, 3]);

      const fourth = line(4, "heartbeat", { text: "four" });
      appendFileSync(path, fourth.slice(0, -1));
      await Bun.sleep(50);
      appendFileSync(path, `${fourth.slice(-1)}\n`);

      expect(seqOf(await cursor.next())).toBe(4);
    } finally {
      controller.abort();
      await close();
    }
  });

  test("a tailed event carries the stored line byte-exact, unknown fields included", async () => {
    const root = makeRoot();
    const path = writeLog(root, [line(1, "heartbeat", { text: "one" })]);
    const controller = new AbortController();
    const { cursor, close } = startTail(root, { signal: controller.signal });

    try {
      expect(seqOf(await cursor.next())).toBe(1);

      // A newer writer's extra field and key order must survive: the tail carries the bytes.
      const appended = JSON.stringify({
        writer: "a-newer-loomwright",
        data: { text: "two" },
        type: "heartbeat",
        ts: ISO,
        seq: 2,
        runId: RUN,
        v: 1,
      });
      appendLine(path, appended);

      const item = await cursor.next();
      if (item.kind !== "event") throw new Error("expected an event");
      expect(item.text).toBe(appended);
      expect(item.event).toEqual(event(2, "heartbeat", { text: "two" }));
    } finally {
      controller.abort();
      await close();
    }
  });

  test("the reader and tailer never write to the log", async () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
    ]);
    const before = readFileSync(path);
    const mtimeBefore = statSync(path).mtimeMs;

    readEvents(root, RUN);

    const controller = new AbortController();
    const { cursor, close } = startTail(root, {
      signal: controller.signal,
      useWatch: false,
      pollMs: 5,
    });
    try {
      expect(seqOf(await cursor.next())).toBe(1);
      expect(seqOf(await cursor.next())).toBe(2);
    } finally {
      controller.abort();
      await close();
    }

    expect(readFileSync(path).equals(before)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(mtimeBefore);
  });
});
