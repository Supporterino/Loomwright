import { describe, expect, test } from "bun:test";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState } from "@loomwright/core/state/run";
import type { UsageSummary } from "@loomwright/core/usage/usage";
import { PROTOCOL_VERSION, type RunEvent } from "@loomwright/protocol";
import { watchSpawn } from "../src/intake/follow.ts";
import { ACTIVITY_LIMIT, appendFacts, collectFacts, type EventFacts } from "../src/model/facts.ts";
import { createStatusPoller } from "../src/model/poll.ts";
import { createFrameScheduler } from "../src/model/render-loop.ts";
import { buildViewModel } from "../src/model/view-model.ts";
import { renderFrame } from "../src/views/frame.tsx";

const ISO = "2026-11-17T10:00:00.000Z";
const RUN = "add-health";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

interface FakeClock {
  readonly now: number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  advance(ms: number): Promise<void>;
  readonly pending: number;
}

/** Deterministic timers: no real `setTimeout` in the burst or poll assertions. */
function fakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { readonly at: number; readonly fn: () => void }>();
  return {
    get now(): number {
      return now;
    },
    schedule(fn: () => void, ms: number): unknown {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel(handle: unknown): void {
      timers.delete(handle as number);
    },
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        let dueId: number | undefined;
        let dueAt = Number.POSITIVE_INFINITY;
        let dueFn: (() => void) | undefined;
        for (const [id, timer] of timers) {
          if (timer.at <= target && timer.at < dueAt) {
            dueId = id;
            dueAt = timer.at;
            dueFn = timer.fn;
          }
        }
        if (dueId === undefined || dueFn === undefined) break;
        timers.delete(dueId);
        now = dueAt;
        dueFn();
        await Promise.resolve();
      }
      now = target;
    },
    get pending(): number {
      return timers.size;
    },
  };
}

function activity(seq: number, step = "first", text = `line ${seq}`): RunEvent {
  return {
    v: PROTOCOL_VERSION,
    runId: RUN,
    seq,
    ts: ISO,
    type: "agent.activity",
    data: { step, detail: text, kind: "tool" },
  };
}

function gate(seq: number, step: string, status: "pass" | "fail" = "pass"): RunEvent {
  return {
    v: PROTOCOL_VERSION,
    runId: RUN,
    seq,
    ts: ISO,
    type: "gate.finished",
    data: { name: "lint", type: "lint", status, durationMs: 10, step },
  };
}

function retry(seq: number, step: string): RunEvent {
  return { v: PROTOCOL_VERSION, runId: RUN, seq, ts: ISO, type: "agent.retry", data: { step } };
}

function usage(): UsageSummary {
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

function statusDoc(): StatusDocument {
  const run = RunState.parse({
    version: 1,
    id: RUN,
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "implementing",
    summary: "Add health endpoints",
  });
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [{ ...run, usage: usage() }],
  };
}

function statusWith(ids: readonly string[]): StatusDocument {
  const template = statusDoc();
  const run = template.runs[0];
  if (run === undefined) throw new Error("statusDoc has no run");
  return { ...template, runs: ids.map((id) => ({ ...run, id })) };
}

function frameOf(facts: EventFacts): ReturnType<typeof buildViewModel> {
  const status = statusDoc();
  return buildViewModel({
    source: "live",
    screen: "run",
    columns: 80,
    rows: 24,
    now: Date.parse(ISO),
    snapshot: null,
    facts,
    status,
    runs: status.runs,
    selectedRunId: RUN,
    selectedTaskId: null,
    panel: null,
    notice: null,
  });
}

describe("rendering and polling stay bounded", () => {
  test("a burst is coalesced: 500 requests in one interval render one frame with all 500", async () => {
    const clock = fakeClock();
    const events: RunEvent[] = [];
    const rendered: EventFacts[] = [];
    const scheduler = createFrameScheduler({
      now: () => clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      render: () => rendered.push(collectFacts(events)),
    });

    for (let index = 1; index <= 500; index += 1) {
      events.push(activity(index));
      scheduler.request();
    }
    expect(clock.pending).toBe(1);
    expect(scheduler.frames).toBe(0);

    await clock.advance(100);
    expect(scheduler.frames).toBe(1);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.activity).toHaveLength(500);
    expect(rendered[0]?.activity.at(-1)?.text).toBe("line 500");

    await clock.advance(100);
    expect(scheduler.frames).toBe(1);
    scheduler.stop();
    expect(clock.pending).toBe(0);
  });

  test("the tail is capped: 100,000 events keep exactly the last 2,000 lines", async () => {
    const events: RunEvent[] = [];
    const started = performance.now();
    for (let index = 1; index <= 100_000; index += 1) events.push(activity(index));
    const facts = collectFacts(events);
    const elapsed = performance.now() - started;

    expect(facts.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(facts.activity[0]?.seq).toBe(100_000 - 1_999);
    expect(facts.activity.at(-1)?.seq).toBe(100_000);

    const text = await renderFrame(frameOf(facts), { columns: 80, rows: 24 }, { ascii: true });
    expect(text.length).toBeGreaterThan(0);
    expect(text.split("\n").length).toBeLessThanOrEqual(24);

    // A generous margin: the soak must not approach the 60 s bun timeout.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("retained state stays bounded: maps are keyed by task id, not by event count", () => {
    const steps = ["first", "second", "third", "fourth"] as const;
    const events: RunEvent[] = [];
    for (let index = 0; index < 100_000; index += 1) {
      const step = steps[index % steps.length] ?? "first";
      events.push(activity(index + 1, step));
    }
    steps.forEach((step, index) => {
      events.push(gate(100_001 + index, step));
      events.push(retry(100_101 + index, step));
    });

    const facts = collectFacts(events);
    expect(Object.keys(facts.gates)).toHaveLength(steps.length);
    expect(Object.keys(facts.agents)).toHaveLength(0);
    expect(Object.keys(facts.retries)).toHaveLength(steps.length);
    expect(facts.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(facts.activity.length).toBeLessThan(events.length);
  });

  test("gate retries replace in place: retained gates stay one row per gate name", () => {
    let facts = collectFacts([]);
    for (let round = 1; round <= 5_000; round += 1) {
      facts = appendFacts(facts, [gate(round, "first", round % 2 === 0 ? "pass" : "fail")]);
    }

    expect(facts.gates.first).toHaveLength(1);
    expect(facts.gates.first?.[0]?.status).toBe("pass");
  });

  test("status is polled once a second: ten seconds give at most ten calls and a kick adds one", async () => {
    const clock = fakeClock();
    let calls = 0;
    const poller = createStatusPoller({
      poll: async () => {
        calls += 1;
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    poller.start();
    await clock.advance(10_000);
    expect(calls).toBeLessThanOrEqual(10);
    expect(poller.calls).toBe(calls);

    poller.kick();
    await Promise.resolve();
    expect(calls).toBe(11);
    await clock.advance(999);
    expect(calls).toBe(11);
    await clock.advance(1);
    expect(calls).toBe(12);

    poller.stop();
    expect(clock.pending).toBe(0);
  });

  test("status is polled once a second: the intake spawn watch adds no poll or timer of its own", async () => {
    const clock = fakeClock();
    let polls = 0;
    let started: string | null = null;
    let status = statusWith([RUN]);
    const baseline = new Set(status.runs.map((run) => run.id));
    const poller = createStatusPoller({
      poll: async () => {
        polls += 1;
        started = watchSpawn(baseline, status, "/spawn.log", (path) => {
          expect(path).toBe("/spawn.log");
          return ["spawn line"];
        }).started;
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    poller.start();
    await clock.advance(10_000);
    expect(polls).toBeLessThanOrEqual(10);
    // Only the poller's own timer is pending; the spawn watch schedules nothing.
    expect(clock.pending).toBe(1);

    // A spawn kicks one poll and keeps the same single cadence.
    poller.kick();
    await Promise.resolve();
    expect(polls).toBeLessThanOrEqual(11);
    expect(clock.pending).toBe(1);

    status = statusWith([RUN, "add-health-2"]);
    await clock.advance(1_000);
    expect<string | null>(started).toBe("add-health-2");

    poller.stop();
    expect(clock.pending).toBe(0);
  });

  test("a slow poll drops ticks instead of queueing a second call", async () => {
    const clock = fakeClock();
    const gate: { release: (() => void) | null } = { release: null };
    const poller = createStatusPoller({
      poll: () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
        }),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    poller.start();
    await clock.advance(1_000);
    expect(poller.calls).toBe(1);
    await clock.advance(5_000);
    expect(poller.calls).toBe(1);

    gate.release?.();
    await Promise.resolve();
    poller.stop();
    expect(clock.pending).toBe(0);
  });
});
