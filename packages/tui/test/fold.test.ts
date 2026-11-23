import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type RunEvent, reduce } from "@loomwright/protocol";
import { ACTIVITY_LIMIT, collectFacts } from "../src/model/facts.ts";
import { type FoldedRun, foldRun } from "../src/model/fold.ts";

const ISO = "2026-11-17T10:00:00.000Z";
const RUN = "add-health";

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

function gate(seq: number, step: string): RunEvent {
  return {
    v: PROTOCOL_VERSION,
    runId: RUN,
    seq,
    ts: ISO,
    type: "gate.finished",
    data: { step, name: "lint", type: "lint", status: "pass", durationMs: 10 },
  };
}

function heartbeat(seq: number, text = `tick ${seq}`): RunEvent {
  return {
    v: PROTOCOL_VERSION,
    runId: RUN,
    seq,
    ts: ISO,
    type: "heartbeat",
    data: { text },
  };
}

function usageDelta(seq: number, step: string): RunEvent {
  return {
    v: PROTOCOL_VERSION,
    runId: RUN,
    seq,
    ts: ISO,
    type: "usage.delta",
    data: {
      step,
      usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    },
  };
}

/** One mixed stream: everything the live tail folds, not just activity lines. */
function stream(count: number): RunEvent[] {
  const events: RunEvent[] = [
    {
      v: PROTOCOL_VERSION,
      runId: RUN,
      seq: 1,
      ts: ISO,
      type: "run.started",
      data: { phase: "implementing" },
    },
    {
      v: PROTOCOL_VERSION,
      runId: RUN,
      seq: 2,
      ts: ISO,
      type: "task.started",
      data: { task: { id: "1.1", repo: "loomwright" }, attempt: 1 },
    },
  ];
  for (let index = 0; index < count; index += 1) {
    const seq = index + 3;
    const phase = index % 500;
    if (phase >= 13 && phase <= 17) events.push(heartbeat(seq));
    else if (phase === 7) events.push(gate(seq, "1.1"));
    else if (phase === 11) events.push(usageDelta(seq, "1.1"));
    else events.push(activity(seq, "1.1"));
  }
  return events;
}

function frames(events: readonly RunEvent[], perFrame: number): FoldedRun {
  let folded: FoldedRun | null = null;
  for (let start = 0; start < events.length; start += perFrame) {
    folded = foldRun(folded, events.slice(start, start + perFrame));
  }
  return folded ?? foldRun(null, []);
}

describe("the live tail folds only new events", () => {
  test("a burst is coalesced: folding in frames equals one pass over the whole stream", () => {
    const events = stream(10_000);
    const onePass = foldRun(null, events);
    const batched = frames(events, 37);

    expect(batched.snapshot).toEqual(onePass.snapshot);
    expect(batched.facts).toEqual(onePass.facts);
    expect(batched.snapshot.lastSeq).toBe(events.length);
    expect(batched.facts.activity.at(-1)?.seq).toBe(events.length);
    // Every five-heartbeat burst (phases 13–17) leaves one line, not one per event.
    const heartbeatLines = batched.facts.activity.filter((line) => line.kind === "heartbeat");
    const heartbeatEvents = events.filter((folded) => folded.type === "heartbeat");
    expect(heartbeatEvents.length).toBe(100);
    expect(heartbeatLines.length).toBeGreaterThan(0);
    expect(heartbeatLines.length).toBeLessThan(heartbeatEvents.length);
    for (let index = 1; index < batched.facts.activity.length; index += 1) {
      const previous = batched.facts.activity[index - 1];
      const current = batched.facts.activity[index];
      expect(previous?.kind === "heartbeat" && current?.kind === "heartbeat").toBe(false);
    }
  });

  test("the tail is capped: the retained state stays bounded at the 2,000-line ring", () => {
    const events = Array.from({ length: 100_000 }, (_, index) => activity(index + 1));
    for (let tick = 1; tick <= 10; tick += 1) events.push(heartbeat(100_000 + tick));
    const folded = frames(events, 100);

    expect(folded.facts.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(folded.facts.activity[0]?.seq).toBe(100_000 - 1_998);
    expect(folded.facts.activity.at(-1)?.seq).toBe(100_010);
    // The ten-heartbeat burst is one line whose text is the newest heartbeat.
    expect(folded.facts.activity.filter((line) => line.kind === "heartbeat")).toHaveLength(1);
    expect(folded.facts.activity.at(-1)?.text).toBe("tick 100010");
    // The projection is the only thing a frame keeps: a snapshot and facts, no event list.
    expect(Object.keys(folded).sort()).toEqual(["facts", "snapshot"]);
    expect(folded.facts.activity.length).toBeLessThan(events.length);
  });

  test("a heartbeat burst is coalesced across frames: one line with the newest text", () => {
    const events = Array.from({ length: 50 }, (_, index) => heartbeat(index + 1));
    const folded = frames(events, 7);

    expect(folded.facts.activity).toHaveLength(1);
    expect(folded.facts.activity[0]?.seq).toBe(50);
    expect(folded.facts.activity[0]?.text).toBe("tick 50");
  });

  test("foldRun leaves the previous projection and the events untouched", () => {
    const first = stream(20);
    const folded = foldRun(null, first);
    const before = structuredClone(folded);
    const second = stream(20).map((item) => ({ ...item, seq: item.seq + 20 }));
    const next = foldRun(folded, second);

    expect(folded).toEqual(before);
    expect(next.snapshot.lastSeq).toBe(42);
    expect(next.snapshot.usage).toEqual(reduce([...first, ...second]).usage);
  });

  test("collectFacts is the same fold starting from an empty projection", () => {
    const events = stream(200);
    expect(collectFacts(events)).toEqual(foldRun(null, events).facts);
  });
});
