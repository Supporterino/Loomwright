import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  createSingleRepoFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli, cliWith } from "../../../test/helpers.ts";
import { readApproval } from "../src/approval/approval.ts";
import { loadConfig } from "../src/config/load.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { eventLogPath } from "../src/events/jsonl.ts";
import { MemorySink } from "../src/events/memory.ts";
import { compareSnapshots } from "../src/events/parity.ts";
import { RunEvent, reduce } from "../src/events/protocol.ts";
import { readEventLines } from "../src/events/reader.ts";
import { TerminalSink } from "../src/events/terminal.ts";
import { ExitCode } from "../src/exit-codes.ts";
import { approve } from "../src/pipeline/approve.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { design, intake } from "../src/pipeline/design.ts";
import { drive } from "../src/pipeline/drive.ts";
import { Progress } from "../src/pipeline/progress.ts";
import type { AgentRuntime, Usage } from "../src/runtime/types.ts";
import { loadRun, newRun, saveRun } from "../src/state/run.ts";

const ID = "add-health";

const PASS_ALL = {
  format: "true",
  lint: "true",
  types: "true",
  test: "true",
  testAffected: "true",
} as const;

const TASKS: ScriptedTask[] = [
  {
    id: "1.1",
    title: "Add a multiply helper",
    repo: "app",
    deps: [],
    touches: ["src/mul.ts"],
    file: "src/mul.ts",
    content: "export const mul = (a: number, b: number): number => a * b;\n",
  },
];

const script = () =>
  factoryScript({ changeId: ID, summary: "Math helpers", repos: ["app"], tasks: TASKS });

const collect = () => {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
};

/** Replays events through a fresh sink: the post-bind output a reader can reconstruct. */
const replay = (events: readonly RunEvent[]): string[] => {
  const { lines, out } = collect();
  const progress = new Progress({ out, heartbeatMs: 0 });
  const sink = new TerminalSink(progress);
  for (const event of events) sink.write(event);
  progress.stop();
  return lines;
};

describe("pipeline event wiring", () => {
  let fx: Fixture;
  const sink = new MemorySink();
  const out: string[] = [];

  beforeAll(async () => {
    fx = await createSingleRepoFixture();
    expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
    const p = new Pipeline(fx.root, loadConfig(fx.root).config, {
      runtime: new ScriptedRuntime(script()),
      out: (line) => out.push(line),
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
    });
    const id = await intake(p, "Add math helpers");
    expect(id).toBe(ID);
    await design(p, id);
    p.progress.stop();
  });

  afterAll(() => fx.cleanup());

  test("intake lines before the run exist are terminal-only", () => {
    const first = sink.events[0];
    expect(first?.type).toBe("run.started");
    expect(first?.seq).toBe(1);
    expect(first?.runId).toBe(ID);
    expect(sink.ofType("run.started")[0]?.data.phase).toBe("design");
    expect(out).toContain("▶ intake");
    const streamed = sink.ofType("progress.line").map((event) => event.data.text);
    expect(streamed.some((text) => text.includes("▶ intake"))).toBe(false);
  });

  test("free-form progress uses the note channel", () => {
    const lines = sink.ofType("progress.line").map((event) => event.data);
    for (const prefix of ["▶ explore:", "▶ design:"]) {
      const banner = lines.find((line) => line.text.startsWith(prefix));
      expect(banner?.level).toBe("always");
    }
  });

  test("the terminal sink is byte-identical: the run replays exactly", () => {
    const expected = replay(sink.events);
    expect(expected.length).toBeGreaterThan(0);
    const start = out.indexOf(expected[0] ?? "");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(out.slice(start)).toEqual(expected);
  });
});

describe("intake clarifications", () => {
  test("intake questions are replayed as question.raised so the reduced snapshot matches", async () => {
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
      const runtime = new ScriptedRuntime(async (call) =>
        call.agent === "orchestrator"
          ? {
              handoff: {
                task: "intake",
                decisions: [`change-id: ${ID}`, "summary: Math helpers", "repos: app"],
                openQuestions: ["Which repos?"],
              },
            }
          : { handoff: {} },
      );
      const sink = new MemorySink();
      const p = new Pipeline(fx.root, loadConfig(fx.root).config, {
        runtime,
        out: () => {},
        signal: new AbortController().signal,
        events: { sink },
        ask: async () => "app",
        heartbeatMs: 0,
      });
      const id = await intake(p, "Add math helpers");
      p.progress.stop();

      const run = loadRun(fx.root, id);
      if (run === undefined) throw new Error("intake did not save the run");
      expect(sink.ofType("question.raised").map((event) => event.data)).toEqual([
        { step: "intake", question: "Which repos?", status: "answered", answer: "app" },
      ]);
      const uptoSeq = sink.events.at(-1)?.seq ?? 0;
      expect(compareSnapshots(sink.events, [{ name: "after intake", run, uptoSeq }])).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("logless runs", () => {
  test("a run with no event log resumes at seq 1 with run.started carrying its phase", async () => {
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
      // A run created before the event stream existed (or killed before `run.started`).
      saveRun(fx.root, newRun(ID, "Add math helpers", "awaiting-approval"));
      const sink = new MemorySink();
      const p = new Pipeline(fx.root, loadConfig(fx.root).config, {
        runtime: new ScriptedRuntime(() => ({})),
        out: () => {},
        signal: new AbortController().signal,
        events: { sink },
        heartbeatMs: 0,
      });
      const outcome = await drive(p, ID);
      p.progress.stop();

      expect(outcome).toMatchObject({ id: ID, phase: "awaiting-approval" });
      expect(sink.events[0]?.type).toBe("run.started");
      expect(sink.events[0]?.seq).toBe(1);
      expect(sink.events[0]?.data).toMatchObject({ phase: "awaiting-approval" });
      expect(reduce(sink.events).phase).toBe("awaiting-approval");
      expect(readEventLines(fx.root, ID).lines[0]?.event?.type).toBe("run.started");
    } finally {
      fx.cleanup();
    }
  });
});

describe("landed change ids", () => {
  test("a landed change's kept event log does not absorb a later change's stream", async () => {
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
      // `land` removes the run state and the spec but keeps the stream for replay.
      const landedLog = eventLogPath(fx.root, ID);
      mkdirSync(dirname(landedLog), { recursive: true });
      const landedLine = `${JSON.stringify({
        v: 1,
        runId: ID,
        seq: 9,
        ts: "2026-01-01T00:00:00.000Z",
        type: "run.started",
        data: { phase: "design" },
      })}\n`;
      writeFileSync(landedLog, landedLine);

      const sink = new MemorySink();
      const p = new Pipeline(fx.root, loadConfig(fx.root).config, {
        runtime: new ScriptedRuntime(script()),
        out: () => {},
        signal: new AbortController().signal,
        events: { sink },
        heartbeatMs: 0,
      });
      const id = await intake(p, "Add math helpers");
      p.progress.stop();

      expect(id).toBe(`${ID}-2`);
      expect(sink.events[0]?.type).toBe("run.started");
      expect(sink.events[0]?.seq).toBe(1);
      expect(sink.events[0]?.runId).toBe(`${ID}-2`);
      expect(readFileSync(landedLog, "utf8")).toBe(landedLine);
      expect(readEventLines(fx.root, id).lines[0]?.seq).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe("heartbeats in the event stream", () => {
  const usage: Usage = {
    input: 1000,
    output: 100,
    reasoning: 0,
    cacheRead: 600,
    cacheWrite: 200,
    cost: 0.01,
  };

  /** A pipeline whose one session reports a completed step, then ticks the heartbeat. */
  const runSession = async (
    pulses: (pipeline: Pipeline) => void,
  ): Promise<{ root: string; sink: MemorySink; lines: string[]; atPulse: string[] }> => {
    const root = mkdtempSync(join(tmpdir(), "loomwright-heartbeat-"));
    const sink = new MemorySink();
    const lines: string[] = [];
    const atPulse: string[] = [];
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
    let pipeline: Pipeline | undefined;
    const runtime: AgentRuntime = {
      async open(spec) {
        return {
          id: "ses_test",
          prompt: async () => {
            spec.onActivity?.({ kind: "step-started", model: "stub/model" });
            spec.onActivity?.({ kind: "step-done", usage });
            if (pipeline !== undefined) {
              pulses(pipeline);
              const last = lines.at(-1);
              if (last !== undefined) atPulse.push(last);
            }
            const handoff = {
              status: "done",
              task: "x",
              filesChanged: [],
              decisions: [],
              risks: [],
              openQuestions: [],
            };
            return {
              text: `Done.\n\`\`\`json\n${JSON.stringify(handoff)}\n\`\`\``,
              outcome: "succeeded",
              usage,
            };
          },
        };
      },
      async close() {},
    };
    pipeline = new Pipeline(root, config, {
      runtime,
      out: (line) => lines.push(line),
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
      now: () => 1000,
    });
    pipeline.bindRun(ID);
    await pipeline.call({
      changeId: ID,
      agent: "implementer-app",
      role: "implementer",
      modelRole: "implementer",
      context: { directory: root, workspace: root },
      title: "Heartbeat",
      prompt: "Do the thing.",
      step: "1.1",
    });
    pipeline.progress.stop();
    pipeline.events.close();
    return { root, sink, lines, atPulse };
  };

  test("a step-done activity streams its usage so the heartbeat keeps the token count", async () => {
    const { root, sink } = await runSession((pipeline) => pipeline.progress.tick());
    try {
      const stepDone = sink
        .ofType("agent.activity")
        .find((event) => event.data.kind === "step-done");
      expect(stepDone?.data.usage).toEqual(usage);
      const beat = sink.ofType("heartbeat")[0];
      expect(beat?.data.text).toContain("1.1 0ms");
      expect(beat?.data.text).toContain("1.9k tok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the heartbeat line is emitted as a heartbeat event and rendered by the sink", async () => {
    const { root, sink, lines, atPulse } = await runSession((pipeline) => pipeline.progress.tick());
    try {
      const beat = sink.ofType("heartbeat")[0];
      if (beat === undefined) throw new Error("no heartbeat event was written");
      expect(beat.data.text).toContain("running 1");
      // With the hook set the renderer prints nothing itself; the sink replays the event text.
      expect(atPulse).toEqual([beat.data.text]);
      expect(lines.filter((line) => line.includes("running 1"))).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("agent.finished carries the role, outcome, duration, usage and session id", async () => {
    const { root, sink } = await runSession(() => {});
    try {
      const finished = sink.ofType("agent.finished")[0];
      if (finished === undefined) throw new Error("the agent session was not finished");
      expect(finished.data).toMatchObject({
        step: "1.1",
        role: "implementer",
        outcome: "succeeded",
        durationMs: 0,
        usage,
        sessionId: "ses_test",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("approval events", () => {
  test("approval events carry the hash and the approver", async () => {
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
      const runtime = new ScriptedRuntime(script());
      expect((await cliWith(runtime, fx.root, "run", "Add math helpers")).code).toBe(ExitCode.Ok);

      const sink = new MemorySink();
      const p = new Pipeline(fx.root, loadConfig(fx.root).config, {
        runtime,
        out: () => {},
        signal: new AbortController().signal,
        events: { sink },
        heartbeatMs: 0,
      });
      await approve(p, ID);

      const approval = readApproval(fx.root, ID);
      if (approval === undefined) throw new Error("approve did not record an approval");
      const requested = sink.ofType("approval.requested");
      expect(requested).toHaveLength(1);
      expect(requested[0]?.data).toEqual({
        specHash: approval.hash,
        specCommit: approval.specCommit,
      });
      const granted = sink.ofType("approval.granted");
      expect(granted).toHaveLength(1);
      expect(granted[0]?.data).toEqual({
        approver: approval.approver,
        specHash: approval.hash,
        specCommit: approval.specCommit,
      });
    } finally {
      fx.cleanup();
    }
  });
});

describe("gate events", () => {
  test("gate.finished carries an output reference, never the output text", async () => {
    const fx = await createSingleRepoFixture();
    try {
      expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
      const configFile = join(fx.root, "factory.config.jsonc");
      writeFileSync(
        configFile,
        readFileSync(configFile, "utf8").replace(
          '"overrides": {}',
          `"overrides": ${JSON.stringify({ app: PASS_ALL })}`,
        ),
      );
      await fixtureGit(fx.root, "commit", "-q", "-am", "chore: configure the factory");
      const runtime = new ScriptedRuntime(script());
      expect((await cliWith(runtime, fx.root, "run", "Add math helpers")).code).toBe(ExitCode.Ok);
      const approved = await cliWith(runtime, fx.root, "approve", ID);
      expect({ code: approved.code, err: approved.err }).toEqual({ code: ExitCode.Ok, err: "" });

      const events = readFileSync(eventLogPath(fx.root, ID), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line): RunEvent => RunEvent.parse(JSON.parse(line)));
      const finished = events.filter((event) => event.type === "gate.finished");
      expect(finished.length).toBeGreaterThan(0);
      for (const event of finished) {
        expect(event.data).not.toHaveProperty("output");
        const ref = event.data.outputRef;
        expect(ref?.path.startsWith(".factory/logs/")).toBe(true);
        if (ref === undefined) continue;
        const log = readFileSync(join(fx.root, ref.path));
        const line = log.subarray(ref.offset, ref.offset + ref.bytes).toString();
        const entry: unknown = JSON.parse(line);
        expect(entry).toMatchObject({ kind: "gate", status: event.data.status });
        expect(entry).toHaveProperty("output");
      }
      const reports = events.filter((event) => event.type === "gate.report");
      expect(reports.length).toBeGreaterThan(0);
      for (const event of reports) expect(event.data.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      fx.cleanup();
    }
  }, 120_000);
});

describe("only the orchestrator writes events", () => {
  test("only the orchestrator constructs the emitter", () => {
    const dir = join(import.meta.dir, "../src/pipeline");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file === "context.ts") continue;
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toMatch(/from "\.\.\/events\/(?:emitter|jsonl)\.ts"/);
    }
  });
});
