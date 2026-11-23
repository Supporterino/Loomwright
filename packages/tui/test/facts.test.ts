import { describe, expect, test } from "bun:test";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import {
  EVENT_TYPES,
  type EventType,
  PROTOCOL_VERSION,
  type RunEvent,
  RunEvent as RunEventSchema,
} from "@loomwright/protocol";
import { collectFacts } from "../src/model/facts.ts";
import { buildViewModel } from "../src/model/view-model.ts";

const ISO = "2026-11-17T10:00:00.000Z";
const RUN = "add-health";
const TASK = { id: "1.1", repo: "loomwright" };
const REF_PATH = ".factory/logs/add-health/2026-11-19.jsonl";
const REF = { path: REF_PATH, offset: 0, bytes: 12 };
const USAGE = { input: 10, output: 5, reasoning: 0, cacheRead: 2, cacheWrite: 1, cost: 0.01 };

function event(seq: number, type: EventType, data: unknown): RunEvent {
  return RunEventSchema.parse({ v: PROTOCOL_VERSION, runId: RUN, seq, ts: ISO, type, data });
}

function heartbeat(seq: number, text: string): RunEvent {
  return event(seq, "heartbeat", { text });
}

/**
 * One valid payload per protocol event type. The annotation keeps the record exhaustive, so a new
 * `EVENT_TYPES` member fails the typecheck until it is given a payload.
 */
const PAYLOADS: Record<EventType, unknown> = {
  "run.started": { phase: "design" },
  "run.finished": { outcome: "done" },
  "run.paused": { reason: "operator paused" },
  "run.resumed": {},
  "run.aborted": {},
  "run.branches": { branches: { main: { branch: "main", base: "origin/main" } } },
  "run.pause-requested": { reason: "preparing the merge queue" },
  "phase.changed": { from: "design", to: "implementing", reason: "approved" },
  "task.queued": { task: TASK, attempt: 1 },
  "task.started": { task: TASK, attempt: 1 },
  "task.passed": { task: TASK, attempt: 1 },
  "task.failed": { task: TASK, reason: "gate failed", attempt: 1 },
  "task.retried": { task: TASK, attempt: 2, reason: "transient" },
  "task.blocked": { task: TASK, reason: "dependency failed" },
  "task.skipped": { task: TASK, reason: "not needed" },
  "task.merging": { task: TASK },
  "task.merged": { task: TASK, commit: "abc123" },
  "task.conflict": { task: TASK, files: ["src/a.ts", "src/b.ts"] },
  "task.requeued": { task: TASK, reason: "review fix routed to a new task" },
  "task.transient": { task: TASK, reason: "retry the same task" },
  "task.interrupted": { task: TASK },
  "task.waiting": { tasks: [{ id: "1.2", reason: "first" }] },
  "task.removed": { task: TASK, reason: "routed to spec findings" },
  "gate.planned": {
    gates: [
      { name: "lint", type: "lint" },
      { name: "test", type: "test" },
    ],
    step: "1.1",
    stage: "after rebase",
  },
  "gate.started": { name: "lint", type: "lint", command: "bun run lint", step: "1.1" },
  "gate.finished": {
    name: "lint",
    type: "lint",
    status: "pass",
    durationMs: 1_200,
    step: "1.1",
    outputRef: REF,
  },
  "gate.report": {
    passed: true,
    results: [{ name: "lint", type: "lint", status: "pass", durationMs: 1_200 }],
    durationMs: 1_200,
    step: "1.1",
    stage: "final",
  },
  "agent.started": { step: "1.1", agent: "implementer", model: "claude-5", label: "first task" },
  "agent.finished": {
    step: "1.1",
    role: "implementer",
    outcome: "succeeded",
    durationMs: 5_000,
    usage: USAGE,
    sessionId: "session",
  },
  "agent.activity": { step: "1.1", detail: "edited src/health.ts", kind: "tool" },
  "agent.retry": { step: "1.1", reason: "rate limited" },
  "install.started": { step: "deps", repo: "loomwright", detail: "bun install" },
  "install.finished": {
    step: "deps",
    repo: "loomwright",
    durationMs: 1_200,
    detail: "bun install",
    ref: REF,
  },
  "install.failed": { step: "deps", repo: "loomwright", detail: "bun install failed" },
  "question.raised": { step: "design", question: "Which endpoints?", status: "unanswered" },
  "question.answered": {
    step: "design",
    question: "Which endpoints?",
    status: "answered",
    answer: "public",
  },
  "approval.pending": { specHash: "sha256:abc", changeDir: "openspec/changes/add-health" },
  "approval.requested": { specHash: "sha256:abc", specCommit: "abc123" },
  "approval.granted": { approver: "dev@example.com", specHash: "sha256:abc", specCommit: "abc123" },
  "usage.delta": { step: "1.1", agent: "implementer", model: "claude-5", usage: USAGE },
  "progress.line": { level: "normal", text: "rendering progress", ref: REF },
  heartbeat: { text: "still running", ref: REF },
};

const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

function usageSummary(): UsageSummary {
  return {
    total: ZERO_USAGE,
    sessions: 0,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: ZERO_USAGE,
    top: [],
    wastedReads: 0,
  };
}

describe("every run event folds into the activity facts", () => {
  test("every event type is exercised: each non-heartbeat type has a line and no type is dropped", () => {
    const nonHeartbeats = EVENT_TYPES.filter((type) => type !== "heartbeat");
    const events = nonHeartbeats.map((type, index) => event(index + 1, type, PAYLOADS[type]));
    // A burst of consecutive heartbeats at the end coalesces into one line.
    events.push(heartbeat(events.length + 1, "tick 1"));
    events.push(heartbeat(events.length + 1, "tick 2"));
    events.push(heartbeat(events.length + 1, "tick 3"));

    const facts = collectFacts(events);
    const seqs = new Set(facts.activity.map((line) => line.seq));
    for (const folded of events.filter((item) => item.type !== "heartbeat"))
      expect(seqs.has(folded.seq)).toBe(true);

    expect(facts.activity).toHaveLength(EVENT_TYPES.length);
    expect(facts.activity.filter((line) => line.kind === "heartbeat")).toHaveLength(1);
    expect(facts.activity.at(-1)?.text).toBe("tick 3");
    for (const line of facts.activity) {
      expect(line.step).not.toBe("");
      expect(line.kind).not.toBe("");
      expect(line.text).not.toBe("");
      expect(line.text).not.toContain("\n");
    }
  });

  test("design and install activity is visible: run, phase, install and log lines without tasks", () => {
    const events = [
      event(1, "run.started", { phase: "design" }),
      event(2, "phase.changed", { from: "intake", to: "design" }),
      event(3, "install.started", { step: "deps", repo: "loomwright", detail: "bun install" }),
      event(4, "install.finished", {
        step: "deps",
        repo: "loomwright",
        durationMs: 1_200,
        detail: "bun install",
      }),
      event(5, "progress.line", { level: "normal", text: "writing the spec" }),
    ];

    const facts = collectFacts(events);
    expect(facts.activity).toHaveLength(events.length);
    expect(facts.activity.map((line) => line.step)).toEqual([
      "run",
      "run",
      "loomwright",
      "loomwright",
      "run",
    ]);
    expect(facts.activity.map((line) => line.kind)).toEqual([
      "run",
      "phase",
      "install",
      "install",
      "log",
    ]);
  });

  test("source labels name the task or step and default to run", () => {
    const labelled = [
      { event: event(1, "run.started", { phase: "design" }), step: "run" },
      { event: event(2, "run.branches", PAYLOADS["run.branches"]), step: "run" },
      { event: event(3, "task.waiting", PAYLOADS["task.waiting"]), step: "run" },
      { event: event(4, "task.started", PAYLOADS["task.started"]), step: "1.1" },
      { event: event(5, "gate.finished", PAYLOADS["gate.finished"]), step: "1.1" },
      { event: event(6, "agent.started", PAYLOADS["agent.started"]), step: "1.1" },
      { event: event(7, "install.started", PAYLOADS["install.started"]), step: "loomwright" },
      { event: event(8, "question.raised", PAYLOADS["question.raised"]), step: "design" },
      { event: event(9, "usage.delta", PAYLOADS["usage.delta"]), step: "1.1" },
    ];

    for (const { event: folded, step } of labelled) {
      expect(collectFacts([folded]).activity[0]?.step).toBe(step);
    }
  });

  test("a log reference is named: ref.path and outputRef.path become the line's logRef", () => {
    const events = [
      event(1, "progress.line", {
        level: "normal",
        text: "rendering progress",
        ref: REF,
      }),
      event(2, "install.finished", {
        step: "deps",
        repo: "loomwright",
        detail: "bun install",
        ref: REF,
      }),
      event(3, "gate.finished", {
        name: "lint",
        type: "lint",
        status: "pass",
        durationMs: 1_200,
        step: "1.1",
        outputRef: REF,
      }),
    ];

    const facts = collectFacts(events);
    expect(facts.activity.map((line) => line.logRef)).toEqual([REF_PATH, REF_PATH, REF_PATH]);
  });

  test("consecutive heartbeats coalesce: one line, the newest text, and a later burst appends", () => {
    const burst = collectFacts([
      heartbeat(1, "tick 1"),
      heartbeat(2, "tick 2"),
      heartbeat(3, "tick 3"),
    ]);
    expect(burst.activity).toHaveLength(1);
    expect(burst.activity[0]?.seq).toBe(3);
    expect(burst.activity[0]?.text).toBe("tick 3");

    const afterWork = collectFacts([
      heartbeat(1, "tick 1"),
      event(2, "agent.activity", { step: "1.1", detail: "edited src/health.ts", kind: "tool" }),
      heartbeat(3, "tick 3"),
      heartbeat(4, "tick 4"),
    ]);
    expect(afterWork.activity.map((line) => line.text)).toEqual([
      "tick 1",
      "edited src/health.ts",
      "tick 4",
    ]);
  });

  test("readable text stays single-line: a payload's newlines never split a row", () => {
    const facts = collectFacts([
      event(1, "progress.line", { level: "normal", text: "first line\nsecond line" }),
      event(2, "agent.activity", { step: "1.1", detail: "first line\nsecond line", kind: "tool" }),
    ]);
    expect(facts.activity[0]?.text).toBe("first line second line");
    expect(facts.activity[1]?.text).toBe("first line second line");
    for (const line of facts.activity) expect(line.text).not.toContain("\n");
  });

  test("control characters are stripped: a payload's escape sequences never reach the terminal", () => {
    const facts = collectFacts([
      event(1, "progress.line", { level: "normal", text: "\u001b[2Jcleared\u0007" }),
      event(2, "agent.activity", {
        step: "1.1",
        detail: "\u001b]52;c;SGVsbG8=\u0007clipboard",
        kind: "tool",
      }),
      event(3, "question.raised", {
        step: "design",
        question: "tab\tkept\u009b",
        status: "unanswered",
      }),
    ]);

    const isControl = (character: string): boolean =>
      /\p{Cc}/u.test(character) && character !== "\t" && character !== "\n";
    for (const line of facts.activity) expect([...line.text].some(isControl)).toBe(false);
    for (const line of facts.activity) expect(line.text).not.toContain("\n");
    expect(facts.activity[0]?.text).toBe("[2Jcleared");
    expect(facts.activity[1]?.text).toBe("]52;c;SGVsbG8=clipboard");
    expect(facts.activity[2]?.text).toBe("tab\tkept (unanswered)");
  });

  test("control characters are stripped from the step and the log reference too", () => {
    const ref = (path: string): unknown => ({ path, offset: 0, bytes: 1 });
    const facts = collectFacts([
      event(1, "progress.line", {
        level: "normal",
        text: "rendering progress",
        ref: ref("\u001b]52;c;SGVsbG8=\u0007clip"),
      }),
      event(2, "agent.activity", {
        step: "\u001b[2J1.1\u0007",
        detail: "edited src/health.ts",
        kind: "tool",
        ref: ref("\u001b[2Jlog\u0007"),
      }),
      event(3, "gate.finished", {
        name: "lint",
        type: "lint",
        status: "pass",
        durationMs: 10,
        step: "\u001b[2J1.1\u0007",
      }),
    ]);

    const isControl = (character: string): boolean =>
      /\p{Cc}/u.test(character) && character !== "\t" && character !== "\n";
    for (const line of facts.activity) {
      for (const value of [line.step, line.logRef ?? ""]) {
        expect([...value].some(isControl)).toBe(false);
      }
    }
    expect(facts.activity[0]?.logRef).toBe("]52;c;SGVsbG8=clip");
    expect(facts.activity[1]?.step).toBe("[2J1.1");
    expect(facts.activity[1]?.logRef).toBe("[2Jlog");
    expect(facts.gates["[2J1.1"]?.[0]?.step).toBe("[2J1.1");
  });

  test("control characters are stripped from the agent and gate facts too", () => {
    const facts = collectFacts([
      event(1, "agent.started", {
        step: "\u001b[2J1.1\u0007",
        agent: "\u001b[2Jimplementer\u0007",
        model: "claude\u001b]52;c;SGVsbG8=\u0007",
      }),
      event(2, "agent.finished", {
        step: "\u001b[2J1.1\u0007",
        role: "\u001b]52;c;role\u0007",
        outcome: "succeeded",
        durationMs: 5,
        usage: USAGE,
        sessionId: "session",
      }),
      event(3, "gate.finished", {
        name: "\u001b[2Jlint\u0007",
        type: "lint",
        status: "pass",
        durationMs: 10,
        step: "\u001b[2J1.1\u0007",
      }),
    ]);

    const agent = facts.agents["[2J1.1"];
    expect(agent?.role).toBe("]52;c;role");
    expect(agent?.model).toBe("claude]52;c;SGVsbG8=");
    const gate = facts.gates["[2J1.1"]?.[0];
    expect(gate?.name).toBe("[2Jlint");
  });

  test("the task detail stays task-scoped: only its source lines, while the run tail keeps both", () => {
    const run = RunState.parse({
      version: 1,
      id: RUN,
      factoryVersion: "0.0.0",
      request: "Add health endpoints",
      createdAt: ISO,
      updatedAt: ISO,
      phase: "implementing",
      summary: "Add health endpoints",
      tasks: [
        {
          id: "first",
          title: "Health endpoint",
          repo: "app",
          deps: [],
          touches: [],
          status: "running",
        },
        {
          id: "second",
          title: "Wire client",
          repo: "api",
          deps: ["first"],
          touches: [],
          status: "pending",
        },
      ],
    });
    const status: StatusDocument = {
      active: null,
      driverAlive: false,
      queue: [],
      corrupt: [],
      runs: [{ ...run, usage: usageSummary() }],
    };
    const events = [
      event(1, "run.started", { phase: "implementing" }),
      event(2, "task.started", { task: { id: "first", repo: "app" }, attempt: 1 }),
      event(3, "agent.activity", { step: "first", detail: "edited src/health.ts", kind: "tool" }),
      event(4, "task.started", { task: { id: "second", repo: "api" }, attempt: 1 }),
      event(5, "agent.activity", { step: "second", detail: "wired the client", kind: "tool" }),
      event(6, "progress.line", { level: "normal", text: "merge queue idle" }),
    ];
    const facts = collectFacts(events);
    const view = buildViewModel({
      source: "live",
      screen: "run",
      columns: 80,
      rows: 24,
      now: Date.parse(ISO),
      snapshot: null,
      facts,
      status,
      runs: [run],
      selectedRunId: RUN,
      selectedTaskId: "first",
      panel: null,
      notice: null,
    });

    const detail = view.run?.detail?.activity ?? [];
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.every((line) => line.step === "first")).toBe(true);
    expect(detail.map((line) => line.text)).toEqual([
      "started (attempt 1)",
      "edited src/health.ts",
    ]);

    const tail = view.run?.activity ?? [];
    expect(tail.some((line) => line.step === "run")).toBe(true);
    expect(tail.some((line) => line.step === "first")).toBe(true);
    expect(tail.some((line) => line.step === "second")).toBe(true);
  });
});
