import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventEmitter } from "../src/events/emitter.ts";
import { eventLogPath, JsonlSink } from "../src/events/jsonl.ts";
import { MemorySink } from "../src/events/memory.ts";
import { RunEvent } from "../src/events/protocol.ts";
import { TerminalSink } from "../src/events/terminal.ts";
import type { GateInfo, GateReport } from "../src/gates/run.ts";
import { pruneLogs } from "../src/logs/log.ts";
import type { Verbosity } from "../src/pipeline/progress.ts";
import { Progress } from "../src/pipeline/progress.ts";
import type { Usage } from "../src/runtime/types.ts";
import { TaskState } from "../src/state/run.ts";

const ISO = "2026-11-17T10:00:00.000Z";
const RUN = "add-health";

const usage = (tokens = 1200): Usage => ({
  input: tokens / 2,
  output: tokens / 4,
  reasoning: 0,
  cacheRead: tokens / 8,
  cacheWrite: tokens / 8,
  cost: 0.01,
});

const task = (id = "1.1"): TaskState =>
  TaskState.parse({
    id,
    title: `Task ${id}`,
    repo: "app",
    deps: [],
    touches: ["src/**"],
    status: "running",
  });

const gate = (type: "format" | "test", command: string, name = type): GateInfo => ({
  type,
  name,
  command,
  cwd: ".",
});

const report = (passed: boolean): GateReport => ({
  repo: "app",
  mode: "task",
  base: "HEAD",
  passed,
  changed: [],
  results: [
    { type: "format", status: "pass", cwd: ".", command: "fmt", durationMs: 1200, output: "" },
    {
      type: "test",
      status: passed ? "pass" : "fail",
      cwd: ".",
      command: "test",
      durationMs: 12_400,
      output: "",
    },
  ],
});

const event = (type: RunEvent["type"], data: unknown): RunEvent =>
  RunEvent.parse({ v: 1, runId: RUN, seq: 1, ts: ISO, type, data });

const line = (seq: number, type: RunEvent["type"], data: unknown, runId = RUN): string =>
  JSON.stringify({ v: 1, runId, seq, ts: ISO, type, data });

const readLines = (path: string): string[] => readFileSync(path, "utf8").trimEnd().split("\n");

const collect = () => {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
};

const compare = (
  ev: RunEvent,
  direct: (progress: Progress) => void,
  options: { verbosity?: Verbosity; step?: string } = {},
): void => {
  const verbosity = options.verbosity ?? "normal";
  const sink = collect();
  const sinkProgress = new Progress({
    out: sink.out,
    verbosity,
    heartbeatMs: 0,
    now: () => 1000,
  });
  const terminal = new TerminalSink(sinkProgress, options.step ?? "");
  const expected = collect();
  const expectedProgress = new Progress({
    out: expected.out,
    verbosity,
    heartbeatMs: 0,
    now: () => 1000,
  });
  direct(expectedProgress);
  terminal.write(ev);
  expect(sink.lines).toEqual(expected.lines);
};

describe("events", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loomwright-events-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("seq allocation: three emits get seq 1, 2, 3", () => {
    const sink = new MemorySink();
    const emitter = new EventEmitter({ root, sinks: [sink], now: () => new Date(ISO) });
    emitter.bind(RUN);
    for (const text of ["one", "two", "three"])
      emitter.emit("progress.line", { level: "normal", text });
    expect(sink.events.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(emitter.lastSeq).toBe(3);
  });

  test("the JSONL sink writes one event per line", () => {
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind(RUN);
    emitter.emit("run.started", { phase: "design" });
    emitter.emit("progress.line", { level: "normal", text: "hello" });
    emitter.emit("run.finished", { outcome: "done" });
    const lines = readLines(eventLogPath(root, RUN));
    expect(lines).toHaveLength(3);
    expect(lines.map((stored) => RunEvent.parse(JSON.parse(stored)).seq)).toEqual([1, 2, 3]);
  });

  test("resume seeding continues the sequence and emits no second run.started", () => {
    const path = eventLogPath(root, "resume-run");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${line(7, "progress.line", { level: "normal", text: "old" }, "resume-run")}\n`,
    );
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind("resume-run", { resumed: true });
    const written = emitter.emit("progress.line", { level: "normal", text: "new" });
    expect(written.seq).toBe(8);
    expect(() => emitter.emit("run.started", { phase: "design" })).toThrow();
    const lines = readLines(path);
    expect(lines).toHaveLength(2);
    expect(lines.some((stored) => RunEvent.parse(JSON.parse(stored)).type === "run.started")).toBe(
      false,
    );
  });

  test("a crash leaves the complete prefix intact and bind truncates the partial tail", () => {
    const path = eventLogPath(root, "crash-run");
    mkdirSync(dirname(path), { recursive: true });
    const first = line(1, "progress.line", { level: "normal", text: "one" }, "crash-run");
    const second = line(2, "progress.line", { level: "normal", text: "two" }, "crash-run");
    writeFileSync(path, `${first}\n${second}\n{"v":1,"runId":"crash-run","seq":3`);
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind("crash-run");
    const written = emitter.emit("progress.line", { level: "normal", text: "three" });
    expect(written.seq).toBe(3);
    const content = readFileSync(path, "utf8");
    const lines = readLines(path);
    expect(lines[0]).toBe(first);
    expect(lines[1]).toBe(second);
    expect(lines).toHaveLength(3);
    const third = lines[2];
    if (third === undefined) throw new Error("missing third line");
    expect(RunEvent.parse(JSON.parse(third)).seq).toBe(3);
    expect(content.endsWith("\n")).toBe(true);
  });

  test("a payload over the cap is truncated with a reference", () => {
    const emitter = new EventEmitter({
      root,
      sinks: [new JsonlSink(root)],
      now: () => new Date(ISO),
    });
    emitter.bind("cap-run");
    const reason = "x".repeat(9000);
    const written = emitter.emit("run.pause-requested", { reason });
    if (written.type !== "run.pause-requested") throw new Error("expected run.pause-requested");
    expect(written.data.truncated).toBe(true);
    const ref = written.data.ref;
    if (ref === undefined) throw new Error("missing truncation ref");
    expect(ref.path.startsWith(".factory/logs/")).toBe(true);
    const full = readFileSync(join(root, ref.path), "utf8").slice(
      ref.offset,
      ref.offset + ref.bytes,
    );
    expect(JSON.parse(full)).toEqual({ reason });
    const stored = readFileSync(eventLogPath(root, "cap-run"), "utf8").trimEnd();
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(8 * 1024 + 512);
    expect(RunEvent.parse(JSON.parse(stored)).type).toBe("run.pause-requested");
  });

  test("a secret is redacted before it reaches the file", () => {
    const sink = new MemorySink();
    const token = "env-token-value-1234567890";
    const apiKey = `sk-${"a".repeat(30)}`;
    const github = `ghp_${"b".repeat(30)}`;
    const emitter = new EventEmitter({
      root,
      sinks: [sink],
      env: { SOME_TOKEN: token },
      now: () => new Date(ISO),
    });
    emitter.bind("redact-run");
    emitter.emit("progress.line", {
      level: "normal",
      text: `token=${token} key=${apiKey} git=${github}`,
    });
    const text = sink.ofType("progress.line")[0]?.data.text ?? "";
    expect(text).toContain("[REDACTED:");
    expect(text).not.toContain(token);
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain(github);
  });

  test("the memory sink keeps order and projects the snapshot", () => {
    const sink = new MemorySink();
    const emitter = new EventEmitter({ root, sinks: [sink], now: () => new Date(ISO) });
    emitter.bind("memory-run");
    emitter.emit("run.started", { phase: "design" });
    emitter.emit("task.merged", {
      task: { id: "1.1", repo: "app", title: "Task" },
      commit: "abc",
    });
    emitter.emit("progress.line", { level: "normal", text: "note" });
    expect(sink.types()).toEqual(["run.started", "task.merged", "progress.line"]);
    const snapshot = sink.snapshot();
    expect(snapshot.phase).toBe("design");
    expect(snapshot.tasks["1.1"]?.status).toBe("merged");
    expect(snapshot.lastSeq).toBe(3);
  });

  test("the terminal sink is byte-identical to the Progress methods", () => {
    compare(event("progress.line", { level: "always", text: "always" }), (p) => p.line("always"));
    compare(event("progress.line", { level: "normal", text: "normal" }), (p) => p.note("normal"));
    compare(
      event("progress.line", { level: "verbose", text: "verbose" }),
      (p) => p.line("verbose"),
      { verbosity: "verbose" },
    );
    compare(event("progress.line", { level: "verbose", text: "hidden" }), () => {});
    compare(
      event("agent.started", {
        step: "1.1",
        agent: "implementer-app",
        model: "stub/model",
        label: "Add the multiply helper",
        attempt: 1,
      }),
      (p) =>
        p.agentStarted({
          step: "1.1",
          agent: "implementer-app",
          model: "stub/model",
          label: "Add the multiply helper",
          attempt: 1,
        }),
    );
    compare(
      event("agent.finished", {
        step: "1.1",
        role: "implementer-app",
        outcome: "succeeded",
        durationMs: 1200,
        usage: usage(),
        sessionId: "session-one",
      }),
      (p) =>
        p.agentFinished({
          step: "1.1",
          outcome: "succeeded",
          durationMs: 1200,
          usage: usage(),
        }),
    );
    compare(
      event("agent.activity", {
        step: "1.1",
        detail: "bash: bun test",
        kind: "tool",
      }),
      (p) => p.activity("1.1", { kind: "tool", tool: "bash: bun test" }),
      { verbosity: "verbose" },
    );
    compare(
      event("agent.activity", {
        step: "1.1",
        detail: "bash: bun test",
        kind: "tool-done",
        status: "failed",
      }),
      (p) => p.activity("1.1", { kind: "tool-done", tool: "bash: bun test", status: "failed" }),
    );
    compare(event("agent.retry", { step: "1.1", reason: "rate limited" }), (p) =>
      p.activity("1.1", { kind: "retry", reason: "rate limited" }),
    );
    compare(
      event("gate.planned", { gates: [gate("format", "fmt"), gate("test", "test")] }),
      (p) => p.gate("1.1", { phase: "plan", gates: [gate("format", "fmt"), gate("test", "test")] }),
      { step: "1.1" },
    );
    compare(
      event("gate.started", gate("test", "bun test")),
      (p) => p.gate("1.1", { phase: "start", gate: gate("test", "bun test") }),
      { step: "1.1", verbosity: "verbose" },
    );
    compare(
      event("gate.finished", {
        name: "test",
        type: "test",
        status: "fail",
        durationMs: 12_400,
      }),
      (p) =>
        p.gate("1.1", {
          phase: "end",
          gate: gate("test", "test", "test"),
          status: "fail",
          durationMs: 12_400,
        }),
      { step: "1.1" },
    );
    compare(
      event("gate.report", {
        passed: false,
        results: [
          { name: "format", type: "format", status: "pass", durationMs: 1200 },
          { name: "test", type: "test", status: "fail", durationMs: 12_400 },
        ],
        durationMs: 13_600,
      }),
      (p) => p.gatesDone("1.1", report(false), 13_600),
      { step: "1.1" },
    );
    compare(event("install.started", { step: "1.1", repo: "app" }), (p) =>
      p.install("1.1", "app", "start"),
    );
    compare(
      event("install.finished", { step: "1.1", repo: "app", durationMs: 12_000 }),
      (p) => p.install("1.1", "app", "done", 12_000),
      { verbosity: "verbose" },
    );
    compare(
      event("install.failed", {
        step: "1.1",
        repo: "app",
        durationMs: 12_000,
        detail: "boom",
      }),
      (p) => p.install("1.1", "app", "failed", 12_000, "boom"),
    );
    compare(event("task.merged", { task: { id: "1.1", repo: "app" }, commit: "abc" }), (p) =>
      p.task({ type: "merged", task: task(), commit: "abc" }),
    );
    compare(
      event("task.retried", {
        task: { id: "1.1", repo: "app" },
        attempt: 2,
        reason: "gates failed",
      }),
      (p) => p.task({ type: "retry", task: task(), attempt: 2, reason: "gates failed" }),
    );
    compare(event("task.failed", { task: { id: "1.1", repo: "app" }, reason: "boom" }), (p) =>
      p.task({ type: "failed", task: task(), reason: "boom" }),
    );
    compare(event("task.merging", { task: { id: "1.1", repo: "app" } }), (p) =>
      p.task({ type: "merging", task: task() }),
    );
    compare(
      event("task.conflict", { task: { id: "1.1", repo: "app" }, files: ["src/x.ts"] }),
      (p) => p.task({ type: "conflict", task: task(), files: ["src/x.ts"] }),
    );
    compare(event("task.requeued", { task: { id: "1.1", repo: "app" }, reason: "conflict" }), (p) =>
      p.task({ type: "requeued", task: task(), reason: "conflict" }),
    );
    compare(event("task.transient", { task: { id: "1.1", repo: "app" }, reason: "infra" }), (p) =>
      p.task({ type: "transient", task: task(), reason: "infra" }),
    );
    compare(event("task.interrupted", { task: { id: "1.1", repo: "app" } }), (p) =>
      p.task({ type: "interrupted", task: task() }),
    );
    compare(event("task.waiting", { tasks: [{ id: "1.2", reason: "waiting on 1.1" }] }), (p) =>
      p.task({ type: "waiting", tasks: [{ id: "1.2", reason: "waiting on 1.1" }] }),
    );
    compare(event("heartbeat", { text: "running 1: 1.1 12.0s" }), (p) =>
      p.line("running 1: 1.1 12.0s"),
    );
    compare(event("run.started", { phase: "design" }), () => {});
    compare(event("phase.changed", { from: null, to: "design" }), () => {});
    compare(event("approval.requested", { specHash: "hash", specCommit: "commit" }), () => {});
    compare(
      event("question.raised", { step: "intake", question: "Why?", status: "unanswered" }),
      () => {},
    );
    compare(event("usage.delta", { step: "1.1", usage: usage() }), () => {});
  });

  test("gate.report renders the elapsed duration, not the sum of the gate runtimes", () => {
    const ev = event("gate.report", {
      passed: true,
      results: [
        { name: "format", type: "format", status: "pass", durationMs: 1200 },
        { name: "test", type: "test", status: "pass", durationMs: 12_400 },
      ],
      // Queued gates: the wall clock is much larger than the per-gate sum.
      durationMs: 60_000,
    });
    compare(ev, (p) => p.gatesDone("1.1", report(true), 60_000), { step: "1.1" });

    const sink = collect();
    const sinkProgress = new Progress({ out: sink.out, heartbeatMs: 0, now: () => 1000 });
    new TerminalSink(sinkProgress, "1.1").write(ev);
    expect(sink.lines).toEqual(["  ✓ [1.1] gates passed in 1m00s"]);

    // Streams written before `durationMs` existed fall back to the per-gate sum.
    const legacy = event("gate.report", {
      passed: true,
      results: [
        { name: "format", type: "format", status: "pass", durationMs: 1200 },
        { name: "test", type: "test", status: "pass", durationMs: 12_400 },
      ],
    });
    compare(legacy, (p) => p.gatesDone("1.1", report(true), 13_600), { step: "1.1" });
  });

  test("the re-gate stage replays from gate.planned and gate.report", () => {
    const gates = [gate("format", "fmt"), gate("test", "test")];
    compare(
      event("gate.planned", { gates, stage: "gates after rebase" }),
      (p) => p.gate("1.1", { phase: "plan", gates }, "gates after rebase"),
      { step: "1.1" },
    );
    compare(
      event("gate.report", {
        passed: true,
        results: [{ name: "test", type: "test", status: "pass", durationMs: 1200 }],
        durationMs: 1200,
        stage: "gates after rebase",
      }),
      (p) => p.gatesDone("1.1", report(true), 1200, "gates after rebase"),
      { step: "1.1" },
    );
  });

  test("quiet and verbose remain unchanged", () => {
    compare(event("progress.line", { level: "normal", text: "hidden" }), () => {}, {
      verbosity: "quiet",
    });
    compare(
      event("agent.started", {
        step: "1.1",
        agent: "implementer-app",
        model: "stub/model",
      }),
      () => {},
      { verbosity: "quiet" },
    );
    compare(event("task.merging", { task: { id: "1.1", repo: "app" } }), () => {}, {
      verbosity: "quiet",
    });
    compare(event("task.waiting", { tasks: [{ id: "1.2", reason: "waiting on 1.1" }] }), () => {}, {
      verbosity: "quiet",
    });
    compare(
      event("gate.finished", {
        name: "format",
        type: "format",
        status: "pass",
        durationMs: 1000,
      }),
      (p) =>
        p.gate("1.1", {
          phase: "end",
          gate: gate("format", "fmt"),
          status: "pass",
          durationMs: 1000,
        }),
      { step: "1.1", verbosity: "quiet" },
    );
    compare(event("install.finished", { step: "1.1", repo: "app", durationMs: 1000 }), () => {}, {
      verbosity: "quiet",
    });
    compare(
      event("agent.activity", { step: "1.1", detail: "bash: bun test", kind: "tool" }),
      (p) => p.activity("1.1", { kind: "tool", tool: "bash: bun test" }),
      { verbosity: "verbose" },
    );
    compare(
      event("gate.started", gate("test", "bun test")),
      (p) => p.gate("1.1", { phase: "start", gate: gate("test", "bun test") }),
      { step: "1.1", verbosity: "verbose" },
    );
    compare(
      event("install.finished", { step: "1.1", repo: "app", durationMs: 1000 }),
      (p) => p.install("1.1", "app", "done", 1000),
      { verbosity: "verbose" },
    );
  });

  test("intake lines before the run exist are terminal-only", () => {
    const emitter = new EventEmitter({ root, sinks: [new JsonlSink(root)] });
    expect(() => emitter.emit("progress.line", { level: "always", text: "intake" })).toThrow();
    expect(existsSync(eventLogPath(root, "intake-run"))).toBe(false);
  });

  test("bind on a fresh run creates the event log", () => {
    const emitter = new EventEmitter({ root, sinks: [new JsonlSink(root)] });
    emitter.bind("fresh-run");
    expect(existsSync(eventLogPath(root, "fresh-run"))).toBe(true);
  });

  test("bind rejects an id that is not a change id", () => {
    const emitter = new EventEmitter({ root, sinks: [new JsonlSink(root)] });
    expect(() => emitter.bind("../../x")).toThrow(/expected a change id/);
    expect(existsSync(join(root, "x.jsonl"))).toBe(false);
  });

  test("the emitter close is idempotent", () => {
    const emitter = new EventEmitter({ root, sinks: [new MemorySink()] });
    emitter.bind("close-run");
    emitter.close();
    emitter.close();
    expect(emitter.lastSeq).toBe(0);
  });

  test("only the JSONL sink writes the event log", () => {
    const dir = join(import.meta.dir, "../src/events");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file === "jsonl.ts") continue;
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/\b(?:appendFileSync|writeFileSync|truncateSync)\s*\(/);
    }
  });

  test("the plugin does not import the event writer", () => {
    const source = readFileSync(join(import.meta.dir, "../src/plugin/entry.ts"), "utf8");
    expect(source).not.toMatch(/["'][^"']*events\//);
  });

  test("no new retention knob is added: pruneLogs removes the old log and keeps the event file", () => {
    const log = join(root, ".factory/logs/old/2020-01-01.jsonl");
    const eventFile = join(root, ".factory/events/old.jsonl");
    mkdirSync(dirname(log), { recursive: true });
    mkdirSync(dirname(eventFile), { recursive: true });
    writeFileSync(log, "{}\n");
    writeFileSync(eventFile, "{}\n");
    const old = new Date(0);
    utimesSync(log, old, old);
    utimesSync(eventFile, old, old);
    const removed = pruneLogs(root, 1);
    expect(removed).toContain(log);
    expect(removed).not.toContain(eventFile);
    expect(existsSync(log)).toBe(false);
    expect(existsSync(eventFile)).toBe(true);
    expect(readdirSync(dirname(eventFile))).toEqual(["old.jsonl"]);
  });
});
