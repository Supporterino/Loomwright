import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { EventEmitter } from "../src/events/emitter.ts";
import { eventLogPath, JsonlSink } from "../src/events/jsonl.ts";
import { MemorySink } from "../src/events/memory.ts";
import type { EventType, RunEvent } from "../src/events/protocol.ts";
import { RunEvent as RunEventSchema, reduce } from "../src/events/protocol.ts";
import { readEvents } from "../src/events/reader.ts";
import type { TailItem } from "../src/events/tailer.ts";
import { tailEvents } from "../src/events/tailer.ts";
import type { GateInfo, GateReport } from "../src/gates/run.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { emitGateEvent, emitGateReport } from "../src/pipeline/implement.ts";

const RUN = "add-health";
const ISO = "2026-11-17T10:00:00.000Z";
const CAP = 8 * 1024;

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "loomwright-robustness-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const line = (seq: number, type: EventType, data: unknown, runId = RUN): string =>
  JSON.stringify({ v: 1, runId, seq, ts: ISO, type, data });

const logPath = (root: string, runId = RUN): string => eventLogPath(root, runId);

const writeLog = (root: string, lines: readonly string[], runId = RUN): string => {
  const path = logPath(root, runId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((entry) => `${entry}\n`).join(""));
  return path;
};

const appendLine = (path: string, entry: string): void => appendFileSync(path, `${entry}\n`);

const storedEvents = (path: string): RunEvent[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((entry) => entry.trim() !== "")
    .map((entry): RunEvent => RunEventSchema.parse(JSON.parse(entry)));

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

const startTail = (
  root: string,
  options: Parameters<typeof tailEvents>[2] = {},
): { next: () => Promise<TailItem>; close: () => Promise<void> } => {
  const iterator = tailEvents(root, RUN, options)[Symbol.asyncIterator]();
  return {
    next: async () => {
      const next = await withTimeout(iterator.next());
      if (next.done === true) throw new Error("tail ended early");
      return next.value;
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

const usage = (input: number) => ({
  input,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
});

describe("JSONL robustness", () => {
  test("a partial last line is ignored and appears once when completed", () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
    ]);
    const third = line(3, "heartbeat", { text: "three" });
    appendFileSync(path, third.slice(0, -12));

    const partial = readEvents(root, RUN);
    expect(partial.events.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(partial.missing).toEqual([]);
    expect(partial.skipped).toEqual([]);

    appendFileSync(path, `${third.slice(-12)}\n`);

    const completed = readEvents(root, RUN);
    expect(completed.events.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(completed.events.filter((entry) => entry.seq === 3)).toHaveLength(1);
    expect(completed.skipped).toEqual([]);
  });

  test("a reader tailing during an append sees 1..5 in order, with no gap and no duplicate", async () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(3, "heartbeat", { text: "three" }),
    ]);
    const controller = new AbortController();
    // The polling fallback is the deterministic path; the reader suite already exercises fs.watch.
    const tail = startTail(root, { signal: controller.signal, useWatch: false, pollMs: 10 });

    try {
      const seen: number[] = [];
      for (let index = 0; index < 3; index += 1) seen.push(seqOf(await tail.next()));

      appendLine(path, line(4, "heartbeat", { text: "four" }));
      appendLine(path, line(5, "heartbeat", { text: "five" }));
      seen.push(seqOf(await tail.next()));
      seen.push(seqOf(await tail.next()));

      expect(seen).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(seen).size).toBe(5);
    } finally {
      controller.abort();
      await tail.close();
    }
  });

  test("a sequence gap is reported by readEvents and by the tailer", async () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
      line(4, "heartbeat", { text: "four" }),
    ]);

    const read = readEvents(root, RUN);
    expect(read.events.map((entry) => entry.seq)).toEqual([1, 2, 4]);
    expect(read.missing).toEqual([3]);

    const controller = new AbortController();
    const tail = startTail(root, { signal: controller.signal, useWatch: false, pollMs: 10 });
    try {
      expect(seqOf(await tail.next())).toBe(1);
      expect(seqOf(await tail.next())).toBe(2);
      const gap = await tail.next();
      expect(gap).toEqual({ kind: "gap", missing: [3] });
      expect(seqOf(await tail.next())).toBe(4);
    } finally {
      controller.abort();
      await tail.close();
    }
  });

  test("a crash leaves the complete prefix byte-identical and bind truncates only the partial tail", () => {
    const root = makeRoot();
    const first = line(1, "heartbeat", { text: "one" });
    const second = line(2, "heartbeat", { text: "two" });
    const path = writeLog(root, [first, second]);
    const prefix = readFileSync(path);
    appendFileSync(path, '{"v":1,"runId":"add-health","seq":3,"marker":"crash');

    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    const written = emitter.emit("heartbeat", { text: "three" });

    expect(written.seq).toBe(3);
    const content = readFileSync(path, "utf8");
    expect(content.startsWith(prefix.toString("utf8"))).toBe(true);
    expect(content).not.toContain('"marker":"crash"');
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(first);
    expect(lines[1]).toBe(second);
    const third = lines[2];
    if (third === undefined) throw new Error("missing third line");
    expect(RunEventSchema.parse(JSON.parse(third)).seq).toBe(3);
  });

  test("a malformed complete line is skipped with a reason and the rest still returns", () => {
    const root = makeRoot();
    writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      "{oops",
      line(3, "heartbeat", { text: "three" }),
    ]);

    const result = readEvents(root, RUN);

    expect(result.events.map((entry) => entry.seq)).toEqual([1, 3]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.line).toBe(2);
    expect(result.skipped[0]?.reason).toBe("invalid");
  });

  test("an empty file and a missing file are empty streams, not errors", () => {
    const root = makeRoot();

    const missing = readEvents(root, RUN);
    expect(missing).toEqual({ events: [], missing: [], skipped: [] });

    const path = writeLog(root, []);
    expect(statSync(path).size).toBe(0);
    expect(readEvents(root, RUN)).toEqual({ events: [], missing: [], skipped: [] });
  });

  test("readers never write to the log or leave lock/temp files", async () => {
    const root = makeRoot();
    const path = writeLog(root, [
      line(1, "heartbeat", { text: "one" }),
      line(2, "heartbeat", { text: "two" }),
    ]);
    const bytes = readFileSync(path);
    const mtime = statSync(path).mtimeMs;
    const listing = readdirSync(dirname(path)).sort();

    readEvents(root, RUN);

    const controller = new AbortController();
    const tail = startTail(root, { signal: controller.signal, useWatch: false, pollMs: 10 });
    try {
      expect(seqOf(await tail.next())).toBe(1);
      expect(seqOf(await tail.next())).toBe(2);
    } finally {
      controller.abort();
      await tail.close();
    }

    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(mtime);
    expect(readdirSync(dirname(path)).sort()).toEqual(listing);
    expect(listing.some((name) => name.endsWith(".lock"))).toBe(false);
  });

  test("fromSeq beyond the end returns no events, no missing and no error", () => {
    const root = makeRoot();
    writeLog(root, [line(1, "heartbeat", { text: "one" }), line(2, "heartbeat", { text: "two" })]);

    const result = readEvents(root, RUN, { fromSeq: 99 });

    expect(result).toEqual({ events: [], missing: [], skipped: [] });
  });
});

describe("payload cap", () => {
  test("a large payload is truncated with a reference and stays schema-valid", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    const reason = "x".repeat(9000);
    const written = emitter.emit("run.pause-requested", { reason });
    if (written.type !== "run.pause-requested") throw new Error("expected run.pause-requested");

    expect(written.data.truncated).toBe(true);
    const ref = written.data.ref;
    if (ref === undefined) throw new Error("missing truncation ref");
    expect(ref.path.startsWith(".factory/logs/")).toBe(true);
    expect(ref.offset).toBeGreaterThanOrEqual(0);
    expect(ref.bytes).toBeGreaterThan(CAP);

    const stored = JSON.parse(readFileSync(logPath(root), "utf8").trimEnd());
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(CAP + 512);
    expect(RunEventSchema.parse(stored).seq).toBe(1);

    const full = readFileSync(join(root, ref.path));
    const value = JSON.parse(full.subarray(ref.offset, ref.offset + ref.bytes).toString("utf8"));
    expect(value).toEqual({ reason });
  });

  test("a payload just under the cap is not truncated", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    // `{"text":""}` is 11 bytes, so 8180 characters serialise to 8191 bytes.
    const text = "x".repeat(CAP - 1 - 11);
    expect(Buffer.byteLength(JSON.stringify({ text }))).toBe(CAP - 1);
    const written = emitter.emit("heartbeat", { text });
    if (written.type !== "heartbeat") throw new Error("expected heartbeat");

    expect(Buffer.byteLength(JSON.stringify(written.data))).toBe(CAP - 1);
    expect(written.data).not.toHaveProperty("truncated");
    expect(written.data).not.toHaveProperty("ref");
    expect(storedEvents(logPath(root))[0]?.data).toEqual({ text });
  });

  test("the cap applies to data, not the envelope, so a long runId does not truncate a small payload", () => {
    const root = makeRoot();
    const runId = "a".repeat(4000);
    const sink = new MemorySink();
    const emitter = new EventEmitter({ root, sinks: [sink], now: () => new Date(ISO) });
    emitter.bind(runId);
    const written = emitter.emit("heartbeat", { text: "small" });
    if (written.type !== "heartbeat") throw new Error("expected heartbeat");

    expect(written.runId).toBe(runId);
    expect(written.data).toEqual({ text: "small" });
    expect(written.data).not.toHaveProperty("truncated");
    expect(written.data).not.toHaveProperty("ref");
  });
});

describe("redaction", () => {
  const API_KEY = `sk-${"a".repeat(32)}`;
  const GITHUB = `ghp_${"b".repeat(30)}`;
  const GITLAB = `glpat-${"c".repeat(20)}`;
  const AWS = "AKIAIOSFODNN7EXAMPLE";
  const JWT =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const BEARER = "abcdefghijklmnop123456";
  const PASSWORD = "hunter2secret";
  const ENV_VALUE = "supersecretvalue123";
  const secrets = [API_KEY, GITHUB, GITLAB, AWS, JWT, BEARER, PASSWORD, ENV_VALUE];
  const all = [
    `key=${API_KEY}`,
    `github=${GITHUB}`,
    `gitlab=${GITLAB}`,
    `aws=${AWS}`,
    `jwt=${JWT}`,
    `Authorization: Bearer ${BEARER}`,
    `https://user:${PASSWORD}@host/`,
    ENV_VALUE,
  ].join(" ");

  test("a secret is redacted before it reaches the file in every string field", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      env: { MY_API_TOKEN: ENV_VALUE },
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    emitter.emit("progress.line", { level: "normal", text: all });
    emitter.emit("agent.activity", { step: "1.1", detail: all, kind: "tool" });
    emitter.emit("agent.finished", {
      step: "1.1",
      role: "implementer",
      outcome: "succeeded",
      durationMs: 5,
      usage: usage(0),
      sessionId: "ses_test",
      problem: all,
    });
    emitter.emit("question.answered", {
      step: "design",
      question: all,
      status: "answered",
      answer: all,
    });
    emitter.emit("install.finished", { step: "1.1", repo: "app", detail: all });
    emitter.emit("gate.finished", {
      name: `format ${API_KEY}`,
      type: "format",
      status: "pass",
      durationMs: 1,
    });

    const stored = readFileSync(logPath(root), "utf8");
    const events = storedEvents(logPath(root));
    expect(events).toHaveLength(6);

    for (const secret of secrets) {
      expect(stored).not.toContain(secret);
      for (const entry of events) expect(JSON.stringify(entry)).not.toContain(secret);
    }
    for (const placeholder of [
      "[REDACTED:api-key]",
      "[REDACTED:github-token]",
      "[REDACTED:gitlab-token]",
      "[REDACTED:aws-key]",
      "[REDACTED:jwt]",
      "[REDACTED:auth]",
      "[REDACTED:credentials]",
      "[REDACTED:env]",
    ]) {
      expect(stored).toContain(placeholder);
    }
    const progress = events.find((entry) => entry.type === "progress.line");
    if (progress?.type !== "progress.line") throw new Error("missing progress.line");
    expect(progress.data.text).toContain("[REDACTED:api-key]");
  });

  test("redaction happens before the cap, so neither the line nor the reference holds the secret", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    const secret = `sk-${"d".repeat(40)}`;
    const written = emitter.emit("run.pause-requested", {
      reason: `${secret} ${"x".repeat(9000)}`,
    });
    if (written.type !== "run.pause-requested") throw new Error("expected run.pause-requested");
    const ref = written.data.ref;
    if (ref === undefined) throw new Error("missing truncation ref");

    const stored = readFileSync(logPath(root), "utf8");
    expect(stored).not.toContain(secret);
    expect(stored).toContain('"truncated":true');

    const full = readFileSync(join(root, ref.path))
      .subarray(ref.offset, ref.offset + ref.bytes)
      .toString("utf8");
    expect(full).not.toContain(secret);
    expect(full).toContain("[REDACTED:api-key]");
  });
});

describe("gate output is never inlined", () => {
  test("gate.finished carries an output reference and gate.report carries names/statuses/durations", () => {
    const root = makeRoot();
    const config = FactoryConfig.parse({
      schemaVersion: 2,
      layout: "single",
      repos: [{ name: "app", path: ".", languages: [] }],
      models: {
        orchestrator: "anthropic/claude-sonnet-5-5",
        architect: "anthropic/claude-sonnet-5-5",
        reviewer: "anthropic/claude-sonnet-5-5",
        implementer: "anthropic/claude-sonnet-5-5",
        tester: "anthropic/claude-sonnet-5-5",
        explorer: "anthropic/claude-sonnet-5-5",
      },
    });
    const sink = new MemorySink();
    const p = new Pipeline(root, config, {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
    });
    p.bindRun(RUN);

    const gate: GateInfo = { type: "test", name: "tests", command: "bun test", cwd: "." };
    const output = "trace line\n".repeat(2000);
    emitGateEvent(
      p,
      RUN,
      "1.1",
      { phase: "end", gate, status: "pass", durationMs: 42, output },
      { task: "1.1", repo: "app" },
    );

    const finished = sink.ofType("gate.finished")[0];
    if (finished === undefined) throw new Error("missing gate.finished");
    expect(finished.data).toMatchObject({ name: "tests", status: "pass", durationMs: 42 });
    expect(finished.data).not.toHaveProperty("output");
    const ref = finished.data.outputRef;
    if (ref === undefined) throw new Error("missing outputRef");
    expect(ref.path.startsWith(".factory/logs/")).toBe(true);
    const stored = readFileSync(join(root, ref.path)).subarray(ref.offset, ref.offset + ref.bytes);
    const entry: unknown = JSON.parse(stored.toString("utf8"));
    expect(entry).toMatchObject({ kind: "gate", status: "pass", output });

    const report: GateReport = {
      repo: "app",
      mode: "task",
      base: "HEAD",
      passed: true,
      changed: [],
      results: [
        {
          type: "test",
          name: "tests",
          status: "pass",
          cwd: ".",
          command: "bun test",
          durationMs: 42,
          output,
        },
      ],
    };
    emitGateReport(p, "1.1", report);

    const summary = sink.ofType("gate.report")[0];
    if (summary === undefined) throw new Error("missing gate.report");
    expect(summary.data).not.toHaveProperty("output");
    expect(summary.data.results).toEqual([
      { name: "tests", type: "test", status: "pass", durationMs: 42 },
    ]);
  });

  test("agent.finished.usage is display only and does not double count usage.delta", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    emitter.emit("usage.delta", { step: "1.1", usage: usage(100) });
    emitter.emit("agent.finished", {
      step: "1.1",
      role: "implementer",
      outcome: "succeeded",
      durationMs: 5,
      usage: usage(100),
      sessionId: "ses_test",
    });

    const events = storedEvents(logPath(root));
    expect(events).toHaveLength(2);
    expect(reduce(events).usage).toEqual(usage(100));
  });
});

describe("emission invariants", () => {
  test("two sinks in one emitter produce one line per event, not two files", () => {
    const root = makeRoot();
    const memory = new MemorySink();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root), memory],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    emitter.emit("heartbeat", { text: "one" });
    emitter.emit("heartbeat", { text: "two" });
    emitter.emit("heartbeat", { text: "three" });

    expect(memory.events).toHaveLength(3);
    expect(readFileSync(logPath(root), "utf8").trimEnd().split("\n")).toHaveLength(3);
    expect(readdirSync(join(root, ".factory/events"))).toEqual([`${RUN}.jsonl`]);
  });

  test("only events/jsonl.ts appends to the events directory", () => {
    const dir = join(import.meta.dir, "../src/events");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file === "jsonl.ts") continue;
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/\b(?:appendFileSync|writeFileSync|truncateSync)\s*\(/);
    }
    expect(existsSync(join(dir, "jsonl.ts"))).toBe(true);
  });

  test("seq continuity across bind: 1..4 with no duplicate and one run.started", () => {
    const root = makeRoot();
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    emitter.emit("run.started", { phase: "design" });
    emitter.emit("heartbeat", { text: "one" });
    emitter.emit("heartbeat", { text: "two" });
    emitter.close();

    const resumed = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    resumed.bind(RUN, { resumed: true });
    const fourth = resumed.emit("heartbeat", { text: "three" });
    expect(fourth.seq).toBe(4);
    expect(() => resumed.emit("run.started", { phase: "design" })).toThrow();

    const stored = storedEvents(logPath(root));
    expect(stored.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(new Set(stored.map((entry) => entry.seq)).size).toBe(4);
    expect(stored.filter((entry) => entry.type === "run.started")).toHaveLength(1);
    expect(readEvents(root, RUN)).toMatchObject({ missing: [], skipped: [] });
  });
});
