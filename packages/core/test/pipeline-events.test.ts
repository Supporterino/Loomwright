import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { factoryScript, type ScriptedTask } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli, cliWith } from "../../../test/helpers.ts";
import { readApproval } from "../src/approval/approval.ts";
import { loadConfig } from "../src/config/load.ts";
import { MemorySink } from "../src/events/memory.ts";
import type { RunEvent } from "../src/events/protocol.ts";
import { TerminalSink } from "../src/events/terminal.ts";
import { ExitCode } from "../src/exit-codes.ts";
import { approve } from "../src/pipeline/approve.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { design, intake } from "../src/pipeline/design.ts";
import { Progress } from "../src/pipeline/progress.ts";

const ID = "add-health";

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
