import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  compareSnapshots,
  compareUsage,
  type ParityCheckpoint,
  usageFromLedger,
} from "../src/events/parity.ts";
import { projectRunState } from "../src/events/project.ts";
import {
  type EventType,
  emptySnapshot,
  PROTOCOL_VERSION,
  RunEvent as RunEventSchema,
  type RunEventType,
  reduce,
} from "../src/events/protocol.ts";
import { newRun, RunState } from "../src/state/run.ts";

const RUN = "add-health";
const ISO = "2026-11-17T10:00:00.000Z";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "loom-reduce-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const event = (seq: number, type: EventType, data: unknown): RunEventType =>
  RunEventSchema.parse({ v: PROTOCOL_VERSION, runId: RUN, seq, ts: ISO, type, data });

const started = (seq = 1, phase = "design"): RunEventType => event(seq, "run.started", { phase });

const baseRun = (overrides: Record<string, unknown> = {}): RunState =>
  RunState.parse({
    version: 1,
    id: RUN,
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "design",
    ...overrides,
  });

/** Files and their mtimes under `dir`, recursively; used to prove `reduce` touched nothing. */
function treeSnapshot(dir: string): Record<string, number> {
  const files: Record<string, number> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, treeSnapshot(path));
    else files[path] = statSync(path).mtimeMs;
  }
  return files;
}

const usageA = {
  input: 2,
  output: 1,
  reasoning: 0,
  cacheRead: 1,
  cacheWrite: 0,
  cost: 0.25,
};
const usageB = {
  input: 3,
  output: 2,
  reasoning: 1,
  cacheRead: 1,
  cacheWrite: 0,
  cost: 0.25,
};
const usageTotal = {
  input: 5,
  output: 3,
  reasoning: 1,
  cacheRead: 2,
  cacheWrite: 0,
  cost: 0.5,
};

const usageEntry = (sessionId: string, usage: typeof usageA) => ({
  at: ISO,
  sessionId,
  agent: "implementer",
  model: "test/model",
  step: "implementing",
  kind: "step" as const,
  usage,
});

describe("RunSnapshot projection", () => {
  test("the initial snapshot is empty", () => {
    expect(emptySnapshot(RUN)).toEqual({
      v: PROTOCOL_VERSION,
      runId: RUN,
      lastSeq: 0,
      phase: null,
      pausedReason: null,
      abortRequested: false,
      branches: {},
      tasks: {},
      questions: [],
      approval: null,
      usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      gates: {},
    });
  });

  test("the projection of a fresh run matches the reduced run.started event", () => {
    const run = newRun(RUN, "Add health", "design");
    const checkpoints: ParityCheckpoint[] = [{ name: "fresh", run, uptoSeq: 1 }];
    expect(compareSnapshots([started()], checkpoints)).toEqual([]);

    const projected = projectRunState(run);
    expect(projected.runId).toBe(RUN);
    expect(projected.phase).toBe("design");
    expect(projected.lastSeq).toBe(0);
  });

  test("replaying the golden stream equals the persisted state at every checkpoint", () => {
    const approval = { hash: "a".repeat(64), specCommit: "b".repeat(40), approver: "Lars" };
    const run = baseRun({
      phase: "paused",
      pausedReason: "waiting for answers",
      branches: {
        backend: { branch: "change/add-health/backend", base: "main" },
        frontend: { branch: "change/add-health/frontend", base: "main" },
      },
      tasks: [
        {
          id: "1.1",
          title: "Events",
          repo: "backend",
          deps: [],
          touches: ["src/**"],
          status: "merged",
          failures: 0,
        },
        {
          id: "1.2",
          title: "Projection",
          repo: "backend",
          deps: ["1.1"],
          touches: ["src/**"],
          status: "failed",
          failures: 1,
        },
        {
          id: "2.1",
          title: "Tests",
          repo: "frontend",
          deps: ["1.2"],
          touches: ["test/**"],
          status: "running",
          failures: 2,
        },
      ],
      clarifications: [
        {
          step: "intake",
          question: "Which repos?",
          status: "answered",
          answer: "backend and frontend",
          at: ISO,
        },
        {
          step: "design",
          question: "Ship behind a flag?",
          status: "unanswered",
          at: ISO,
        },
      ],
    });

    const task11 = { id: "1.1", repo: "backend", title: "Events" };
    const task12 = { id: "1.2", repo: "backend", title: "Projection" };
    const task21 = { id: "2.1", repo: "frontend", title: "Tests" };
    const events: RunEventType[] = [
      started(1),
      event(2, "run.branches", { branches: run.branches }),
      event(3, "task.started", { task: task11, attempt: 1 }),
      event(4, "task.merged", { task: task11, commit: "abc123" }),
      event(5, "task.started", { task: task12, attempt: 1 }),
      event(6, "task.failed", { task: task12, reason: "gate", attempt: 2 }),
      event(7, "task.started", { task: task21, attempt: 3 }),
      event(8, "question.raised", {
        step: "intake",
        question: "Which repos?",
        status: "unanswered",
      }),
      event(9, "question.answered", {
        step: "intake",
        question: "Which repos?",
        status: "answered",
        answer: "backend and frontend",
      }),
      event(10, "question.raised", {
        step: "design",
        question: "Ship behind a flag?",
        status: "unanswered",
      }),
      event(11, "approval.granted", {
        approver: approval.approver,
        specHash: approval.hash,
        specCommit: approval.specCommit,
      }),
      event(12, "run.paused", { reason: "waiting for answers" }),
    ];

    const checkpoints: ParityCheckpoint[] = [
      { name: "after branches", run: baseRun({ branches: run.branches }), uptoSeq: 2 },
      { name: "final", run, uptoSeq: events.length },
    ];
    expect(
      compareSnapshots(events, checkpoints, {
        approvalOf: (candidate) => (candidate === run ? approval : undefined),
      }),
    ).toEqual([]);
  });

  test("it fails at the first divergence with the checkpoint name", () => {
    const run = baseRun({
      tasks: [
        {
          id: "1.1",
          title: "Events",
          repo: "backend",
          deps: [],
          touches: ["src/**"],
          status: "merged",
          failures: 0,
        },
      ],
    });
    const events = [
      started(),
      event(2, "task.started", { task: { id: "1.1", repo: "backend" }, attempt: 1 }),
    ];
    expect(compareSnapshots(events, [{ name: "after task 1.1", run, uptoSeq: 2 }])).toEqual([
      {
        checkpoint: "after task 1.1",
        field: "tasks.1.1.status",
        expected: "merged",
        actual: "running",
      },
    ]);
  });

  test("attempt mapping uses failures + 1", () => {
    const run = baseRun({
      tasks: [
        {
          id: "a",
          title: "A",
          repo: "backend",
          deps: [],
          touches: [],
          status: "running",
          failures: 0,
        },
        {
          id: "b",
          title: "B",
          repo: "backend",
          deps: [],
          touches: [],
          status: "failed",
          failures: 3,
        },
      ],
    });
    expect(projectRunState(run).tasks).toEqual({
      a: { status: "running", attempt: 1 },
      b: { status: "failed", attempt: 4 },
    });
  });
});

describe("usage parity", () => {
  test("usage is counted once", () => {
    const snapshot = reduce([
      started(),
      event(2, "usage.delta", { step: "implementing", usage: usageA }),
      event(3, "agent.finished", {
        step: "implementing",
        role: "implementer",
        outcome: "succeeded",
        durationMs: 1000,
        usage: usageA,
        sessionId: "session-1",
      }),
    ]);
    expect(snapshot.usage).toEqual(usageA);
    expect(compareUsage(snapshot, usageA)).toBeUndefined();
  });

  test("usage ledger parity", () => {
    const root = makeRoot();
    const file = join(root, ".factory", "usage", `${RUN}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const writeLedger = (entries: unknown[]): void => {
      writeFileSync(file, JSON.stringify({ version: 1, changeId: RUN, entries }));
    };

    const first = usageEntry("session-1", usageA);
    const second = usageEntry("session-2", usageB);
    writeLedger([first, second]);
    expect(usageFromLedger(root, RUN)).toEqual(usageTotal);

    const snapshot = reduce([
      started(),
      event(2, "usage.delta", { step: "implementing", usage: usageA }),
      event(3, "usage.delta", { step: "implementing", usage: usageB }),
    ]);
    expect(compareUsage(snapshot, usageFromLedger(root, RUN))).toBeUndefined();

    writeLedger([{ ...first, usage: { ...usageA, input: usageA.input + 1 } }, second]);
    const divergence = compareUsage(snapshot, usageFromLedger(root, RUN));
    expect(divergence).toEqual({
      checkpoint: "usage",
      field: "usage",
      expected: { ...usageTotal, input: usageTotal.input + 1 },
      actual: usageTotal,
    });
  });
});

describe("reducer guarantees", () => {
  test("run.pause-requested changes nothing", () => {
    const requestOnly = reduce([
      started(),
      event(2, "run.pause-requested", { reason: "pause requested" }),
    ]);
    expect(requestOnly.phase).toBe("design");
    expect(requestOnly.pausedReason).toBeNull();

    const paused = reduce([
      started(),
      event(2, "run.pause-requested", { reason: "pause requested" }),
      event(3, "run.paused", { reason: "pause requested" }),
      event(4, "run.pause-requested", {}),
    ]);
    expect(paused.phase).toBe("paused");
    expect(paused.pausedReason).toBe("pause requested");
  });

  test("the reducer is pure", () => {
    const root = makeRoot();
    const factory = join(root, ".factory");
    mkdirSync(join(factory, "runs"), { recursive: true });
    writeFileSync(join(factory, "runs", `${RUN}.json`), JSON.stringify({ id: RUN }));
    const before = treeSnapshot(factory);

    const events = [
      started(),
      event(2, "task.started", { task: { id: "1.1", repo: "backend" }, attempt: 1 }),
      event(3, "usage.delta", { step: "implementing", usage: usageA }),
    ];
    const unchanged = structuredClone(events);
    const first = reduce(events);
    const second = reduce(events);

    expect(first).toEqual(second);
    expect(events).toEqual(unchanged);
    expect(treeSnapshot(factory)).toEqual(before);
  });

  test("an unknown optional field is ignored", () => {
    const base = [
      started(),
      event(2, "task.started", { task: { id: "1.1", repo: "backend" }, attempt: 1 }),
    ];
    const withExtra = [
      started(),
      RunEventSchema.parse({
        v: PROTOCOL_VERSION,
        runId: RUN,
        seq: 2,
        ts: ISO,
        type: "task.started",
        data: {
          task: { id: "1.1", repo: "backend", futureField: "ignored" },
          attempt: 1,
          futureField: "ignored",
        },
      }),
    ];
    expect(reduce(withExtra)).toEqual(reduce(base));
  });
});
