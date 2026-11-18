import { expect, test } from "bun:test";
import { emptySnapshot, PROTOCOL_VERSION, RunEvent, reduce } from "@loomwright/protocol";

const at = (seq: number) => ({
  v: PROTOCOL_VERSION,
  runId: "add-health",
  seq,
  ts: "2026-11-17T10:00:00.000Z",
});

const parse = (event: unknown): RunEvent => RunEvent.parse(event);

const transition = (seq: number, type: string, data: unknown): RunEvent =>
  parse({ ...at(seq), type, data });

const started = (seq = 1) => transition(seq, "run.started", { phase: "design" });

test("the initial snapshot is empty", () => {
  expect(emptySnapshot("add-health")).toEqual({
    v: PROTOCOL_VERSION,
    runId: "add-health",
    lastSeq: 0,
    phase: null,
    pausedReason: null,
    abortRequested: false,
    branches: {},
    tasks: {},
    questions: [],
    approval: null,
    pendingApproval: null,
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    gates: {},
  });
});

test("run and phase events move the snapshot phase", () => {
  const snapshot = reduce([
    started(),
    transition(2, "phase.changed", { from: "design", to: "awaiting-approval" }),
  ]);
  expect(snapshot.phase).toBe("awaiting-approval");
  expect(snapshot.lastSeq).toBe(2);
});

test("run.pause-requested changes nothing", () => {
  const before = reduce([started()]);
  const after = reduce([
    started(),
    transition(2, "run.pause-requested", { reason: "pause requested" }),
  ]);
  expect(after.phase).toBe(before.phase);
  expect(after.pausedReason).toBe(before.pausedReason);
  expect(after.abortRequested).toBe(before.abortRequested);
});

test("run.paused sets the phase and pausedReason", () => {
  const snapshot = reduce([started(), transition(2, "run.paused", { reason: "pause requested" })]);
  expect(snapshot.phase).toBe("paused");
  expect(snapshot.pausedReason).toBe("pause requested");
});

test("run.resumed clears pausedReason and abortRequested", () => {
  const snapshot = reduce([
    started(),
    transition(2, "run.aborted", {}),
    transition(3, "run.paused", { reason: "pause requested" }),
    transition(4, "run.resumed", {}),
    transition(5, "phase.changed", { from: "paused", to: "implementing" }),
  ]);
  expect(snapshot.pausedReason).toBeNull();
  expect(snapshot.abortRequested).toBe(false);
  expect(snapshot.phase).toBe("implementing");
});

test("run.aborted sets the phase and abortRequested", () => {
  const snapshot = reduce([started(), transition(2, "run.aborted", {})]);
  expect(snapshot.phase).toBe("aborted");
  expect(snapshot.abortRequested).toBe(true);
});

test("run.branches replaces the branch map", () => {
  const first = transition(1, "run.branches", {
    branches: { backend: { branch: "change/add-health/backend", base: "main" } },
  });
  const second = transition(2, "run.branches", {
    branches: { frontend: { branch: "change/add-health/frontend", base: "main" } },
  });
  const snapshot = reduce([first, second]);
  expect(snapshot.branches).toEqual({
    frontend: { branch: "change/add-health/frontend", base: "main" },
  });
  // The snapshot owns its map; a later mutation of the event must not reach it.
  if (second.type !== "run.branches") throw new Error("expected run.branches");
  second.data.branches.loomwright = { branch: "x", base: "main" };
  expect(snapshot.branches).not.toHaveProperty("loomwright");
});

test("task events upsert status and attempt", () => {
  const task = { id: "2.1", repo: "loomwright", title: "events" };
  const snapshot = reduce([
    transition(1, "task.queued", { task }),
    transition(2, "task.started", { task, attempt: 1 }),
    transition(3, "task.retried", { task, attempt: 2 }),
    transition(4, "task.merged", { task, commit: "abc123" }),
  ]);
  expect(snapshot.tasks["2.1"]).toEqual({ status: "merged", attempt: 2 });
});

test("terminal task transitions map to task statuses", () => {
  const task = { id: "2.1", repo: "loomwright" };
  const statuses = (events: RunEvent[]): string | undefined => reduce(events).tasks["2.1"]?.status;
  expect(
    statuses([
      transition(1, "task.started", { task, attempt: 1 }),
      transition(2, "task.failed", { task, reason: "gate" }),
    ]),
  ).toBe("failed");
  expect(statuses([transition(1, "task.skipped", { task })])).toBe("cancelled");
  expect(statuses([transition(1, "task.merging", { task })])).toBe("merging");
  expect(statuses([transition(1, "task.conflict", { task, files: ["a.ts"] })])).toBe("merging");
  expect(statuses([transition(1, "task.requeued", { task, reason: "conflict" })])).toBe("pending");
  expect(statuses([transition(1, "task.transient", { task, reason: "down" })])).toBe("pending");
  expect(statuses([transition(1, "task.interrupted", { task })])).toBe("pending");
});

test("task.removed drops the task from the snapshot", () => {
  const task = { id: "fix-app-1-1", repo: "app" };
  const snapshot = reduce([
    transition(1, "task.started", { task, attempt: 1 }),
    transition(2, "task.failed", { task, reason: "openspec needs a reword" }),
    transition(3, "task.removed", { task, reason: "routed to spec findings" }),
  ]);
  expect(snapshot.tasks["fix-app-1-1"]).toBeUndefined();
  expect(snapshot.lastSeq).toBe(3);
});

test("task.removed for an unknown task changes nothing", () => {
  const before = reduce([
    transition(1, "task.merged", { task: { id: "1.1", repo: "app" }, commit: "abcdef" }),
  ]);
  const after = reduce([
    transition(1, "task.merged", { task: { id: "1.1", repo: "app" }, commit: "abcdef" }),
    transition(2, "task.removed", { task: { id: "nope", repo: "app" } }),
  ]);
  expect(after.tasks).toEqual(before.tasks);
});

test("question events append and answer by step and question", () => {
  const snapshot = reduce([
    transition(1, "question.raised", {
      step: "design",
      question: "Which repo?",
      status: "unanswered",
    }),
    transition(2, "question.answered", {
      step: "design",
      question: "Which repo?",
      status: "answered",
      answer: "loomwright",
    }),
    transition(3, "question.answered", {
      step: "intake",
      question: "Another?",
      status: "skipped",
    }),
  ]);
  expect(snapshot.questions).toEqual([
    { step: "design", question: "Which repo?", status: "answered", answer: "loomwright" },
    { step: "intake", question: "Another?", status: "skipped" },
  ]);
});

test("approval events record hash, commit and approver", () => {
  const requested = reduce([
    transition(1, "approval.requested", { specHash: "hash", specCommit: "commit" }),
  ]);
  expect(requested.approval).toEqual({ specHash: "hash", specCommit: "commit", approver: "" });
  const granted = reduce([
    transition(1, "approval.requested", { specHash: "hash", specCommit: "commit" }),
    transition(2, "approval.granted", {
      approver: "lars",
      specHash: "hash",
      specCommit: "commit",
    }),
  ]);
  expect(granted.approval).toEqual({ specHash: "hash", specCommit: "commit", approver: "lars" });
});

test("reduce exposes the pending gate: approval.pending sets it and approval.granted clears it", () => {
  const pending = reduce([
    started(),
    transition(2, "approval.pending", {
      specHash: "hash",
      changeDir: "openspec/changes/add-health",
    }),
  ]);
  expect(pending.pendingApproval).toEqual({
    specHash: "hash",
    changeDir: "openspec/changes/add-health",
  });
  expect(pending.approval).toBeNull();
  const granted = reduce([
    started(),
    transition(2, "approval.pending", {
      specHash: "hash",
      changeDir: "openspec/changes/add-health",
    }),
    transition(3, "approval.granted", {
      approver: "lars",
      specHash: "hash",
      specCommit: "commit",
    }),
  ]);
  expect(granted.pendingApproval).toBeNull();
  expect(granted.approval).toEqual({ specHash: "hash", specCommit: "commit", approver: "lars" });
});

test("the event is additive: a stream without approval.pending leaves pendingApproval null", () => {
  const snapshot = reduce([
    started(),
    transition(2, "phase.changed", { from: "design", to: "awaiting-approval" }),
    transition(3, "approval.granted", {
      approver: "lars",
      specHash: "hash",
      specCommit: "commit",
    }),
  ]);
  expect(snapshot.pendingApproval).toBeNull();
});

test("gate.finished upserts the last gate result", () => {
  const snapshot = reduce([
    transition(1, "gate.finished", {
      name: "lint",
      type: "lint",
      status: "fail",
      durationMs: 5,
    }),
    transition(2, "gate.finished", {
      name: "lint",
      type: "lint",
      status: "pass",
      durationMs: 7,
    }),
    transition(3, "gate.finished", {
      name: "test",
      type: "test",
      status: "pass",
      durationMs: 9,
    }),
  ]);
  expect(snapshot.gates).toEqual({
    lint: { status: "pass", durationMs: 7 },
    test: { status: "pass", durationMs: 9 },
  });
});

test("usage.delta is the only usage source", () => {
  const snapshot = reduce([
    transition(1, "usage.delta", {
      step: "implement",
      usage: { input: 10, output: 5, reasoning: 1, cacheRead: 2, cacheWrite: 3, cost: 0.5 },
    }),
    transition(2, "agent.finished", {
      step: "implement",
      role: "implementer",
      outcome: "succeeded",
      durationMs: 100,
      usage: {
        input: 1000,
        output: 1000,
        reasoning: 1000,
        cacheRead: 1000,
        cacheWrite: 1000,
        cost: 100,
      },
      sessionId: "session-1",
    }),
    transition(3, "usage.delta", {
      step: "review",
      usage: { input: 1, output: 1, reasoning: 1, cacheRead: 1, cacheWrite: 1, cost: 0.25 },
    }),
  ]);
  expect(snapshot.usage).toEqual({
    input: 11,
    output: 6,
    reasoning: 2,
    cacheRead: 3,
    cacheWrite: 4,
    cost: 0.75,
  });
});

test("the reducer is pure", () => {
  const events = [
    started(),
    transition(2, "task.started", { task: { id: "2.1", repo: "loomwright" }, attempt: 1 }),
    transition(3, "usage.delta", {
      step: "implement",
      usage: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, cost: 6 },
    }),
  ];
  const before = structuredClone(events);
  const first = reduce(events);
  const second = reduce(events);
  expect(second).toEqual(first);
  expect(events).toEqual(before);
});

test("an unknown event type is skipped by reduce", () => {
  // A reader hands reduce only known events; the test casts to prove the runtime guard.
  const unknown = {
    ...at(2),
    type: "future.thing",
    data: { phase: "done" },
  } as unknown as RunEvent;
  const snapshot = reduce([started(), unknown]);
  expect(snapshot.phase).toBe("design");
  expect(snapshot.lastSeq).toBe(1);
});

test("an added optional field is accepted and the reducer ignores it", () => {
  const parsed = RunEvent.safeParse({
    ...at(1),
    type: "run.started",
    data: { phase: "design", futureField: 1 },
  });
  expect(parsed.success).toBe(true);
  const snapshot = reduce([
    parse({ ...at(1), type: "run.started", data: { phase: "design", futureField: 1 } }),
  ]);
  expect(snapshot.phase).toBe("design");
  expect(JSON.stringify(snapshot)).not.toContain("futureField");
});
