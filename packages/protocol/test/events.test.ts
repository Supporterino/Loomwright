import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES, EventEnvelope, PROTOCOL_VERSION, RunEvent } from "@loomwright/protocol";

const base = (seq: number) =>
  ({
    v: PROTOCOL_VERSION,
    runId: "add-health",
    seq,
    ts: "2026-11-17T10:00:00.000Z",
  }) as const;

const valid = {
  ...base(1),
  type: "run.started",
  data: { phase: "design" },
} as const;

describe("event envelope", () => {
  test("a valid event parses unchanged", () => {
    expect(RunEvent.parse(valid)).toEqual(valid);
  });

  test("the envelope is validated", () => {
    const { ts: _ts, ...missingTs } = valid;
    const bad = [
      { ...valid, v: 0 },
      { ...valid, seq: 0 },
      missingTs,
      { ...valid, ts: "2026-11-17T10:00:00+02:00" },
      { ...valid, ts: "2026-11-17T10:00:00" },
      { ...valid, runId: "" },
      { ...valid, seq: 1.5 },
    ];
    for (const event of bad) expect(RunEvent.safeParse(event).success).toBe(false);
  });

  test("seq is monotonic per run: the schema rejects 0 and non-integers", () => {
    expect(RunEvent.safeParse(valid).success).toBe(true);
    expect(RunEvent.safeParse({ ...valid, seq: 0 }).success).toBe(false);
    expect(RunEvent.safeParse({ ...valid, seq: 1.5 }).success).toBe(false);
  });

  test("resume continues the sequence: a stream starting at seq 8 parses", () => {
    const resumed = { ...base(8), type: "run.paused", data: { reason: "resume" } };
    expect(RunEvent.parse(resumed).seq).toBe(8);
  });

  test("an added optional field is accepted", () => {
    const parsed = RunEvent.safeParse({
      ...valid,
      data: { phase: "design", futureField: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  test("a removed field is a version change: the envelope v is a literal", () => {
    expect(EventEnvelope.safeParse({ ...valid, type: "run.started" }).success).toBe(true);
    expect(RunEvent.safeParse({ ...valid, v: PROTOCOL_VERSION + 1 }).success).toBe(false);
  });

  test("an unknown event type validates as an envelope", () => {
    expect(EventEnvelope.safeParse({ ...base(2), type: "future.thing" }).success).toBe(true);
  });
});

describe("event families", () => {
  test("the event families match the committed EVENT_TYPES list", () => {
    const unionTypes = RunEvent.options.map((option) => option.shape.type.value);
    expect(unionTypes).toEqual([...EVENT_TYPES]);
    expect(EVENT_TYPES).toEqual([
      "run.started",
      "run.finished",
      "run.paused",
      "run.resumed",
      "run.aborted",
      "run.branches",
      "run.pause-requested",
      "phase.changed",
      "task.queued",
      "task.started",
      "task.passed",
      "task.failed",
      "task.retried",
      "task.blocked",
      "task.skipped",
      "task.merging",
      "task.merged",
      "task.conflict",
      "task.requeued",
      "task.transient",
      "task.interrupted",
      "task.waiting",
      "task.removed",
      "gate.planned",
      "gate.started",
      "gate.finished",
      "gate.report",
      "agent.started",
      "agent.finished",
      "agent.activity",
      "agent.retry",
      "install.started",
      "install.finished",
      "install.failed",
      "question.raised",
      "question.answered",
      "approval.requested",
      "approval.granted",
      "usage.delta",
      "progress.line",
      "heartbeat",
    ]);
  });

  test("payloads are bounded: a truncation reference is accepted", () => {
    const event = {
      ...base(1),
      type: "progress.line",
      data: {
        level: "normal",
        text: "a long line",
        truncated: true,
        ref: { path: ".factory/logs/add-health", offset: 0, bytes: 12 },
      },
    };
    expect(RunEvent.safeParse(event).success).toBe(true);
  });

  test("progress.line accepts the three levels", () => {
    for (const level of ["always", "normal", "verbose"]) {
      const event = { ...base(1), type: "progress.line", data: { level, text: "note" } };
      expect(RunEvent.safeParse(event).success).toBe(true);
    }
  });
});

const MODULE_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;

function moduleSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("protocol stays a leaf package: no engine or escaping imports", () => {
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
  const files = sourceFiles(srcDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const resolved = resolve(dirname(file), specifier);
        expect(relative(srcDir, resolved).startsWith("..")).toBe(false);
      } else {
        // The only allowed dependency of the protocol leaf is zod.
        expect(specifier).toBe("zod");
      }
    }
  }
});
