import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readApproval } from "@loomwright/core/approval/approval";
import { eventLogPath } from "@loomwright/core/events/jsonl";
import { compareSnapshots } from "@loomwright/core/events/parity";
import { projectRunState } from "@loomwright/core/events/project";
import { type EventType, RunEvent, reduce } from "@loomwright/core/events/protocol";
import { ExitCode } from "@loomwright/core/exit-codes";
import { loadRun, newRun, saveRun, TaskState } from "@loomwright/core/state/run";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { completeWords } from "../src/completion/engine.ts";
import { runCli } from "../src/main.ts";

const ID = "add-x";
const ISO = "2026-11-17T10:00:00.000Z";

let fx: Fixture;

beforeEach(async () => {
  fx = await createSingleRepoFixture();
  expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
});

afterEach(() => fx.cleanup());

function event(seq: number, type: EventType, data: unknown): RunEvent {
  return RunEvent.parse({ v: 1, runId: ID, seq, ts: ISO, type, data });
}

function writeLog(lines: readonly string[]): string {
  const path = eventLogPath(fx.root, ID);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
  return path;
}

function seedFinished(): RunEvent[] {
  const run = newRun(ID, "Add a health endpoint", "done");
  run.branches = { ".": { branch: "change/add-x", base: "0".repeat(40) } };
  run.tasks = [
    TaskState.parse({
      id: "1.1",
      title: "Task 1.1",
      repo: "app",
      deps: [],
      touches: ["src/**"],
      status: "merged",
    }),
  ];
  saveRun(fx.root, run);
  const events = [
    event(1, "run.started", { phase: "implementing" }),
    event(2, "run.branches", {
      branches: { ".": { branch: "change/add-x", base: "0".repeat(40) } },
    }),
    event(3, "task.queued", { task: { id: "1.1", repo: "app" }, attempt: 1 }),
    event(4, "task.merged", { task: { id: "1.1", repo: "app" }, commit: "abcdef0123456789" }),
    event(5, "phase.changed", { from: "implementing", to: "done" }),
    event(6, "run.finished", { outcome: "done" }),
  ];
  writeLog(events.map((item) => JSON.stringify(item)));
  return events;
}

async function waitFor(predicate: () => boolean, ms = 20_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting for output");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("events", () => {
  test("a finished run replays completely", async () => {
    seedFinished();
    const result = await cli(fx.root, "events", ID, "--json");

    expect(result.code).toBe(ExitCode.Ok);
    const printed = result.out.split("\n").map((line) => RunEvent.parse(JSON.parse(line)));
    expect(printed.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);

    const run = loadRun(fx.root, ID);
    if (run === undefined) throw new Error("the seeded run is missing");
    const approval = readApproval(fx.root, ID);
    const expected = projectRunState(run, approval === undefined ? {} : { approval });
    expect({ ...reduce(printed), lastSeq: 0 }).toEqual(expected);
    expect(compareSnapshots(printed, [{ name: "final", run, uptoSeq: 6 }])).toEqual([]);
  });

  test("events resolves the workspace root from a subdirectory", async () => {
    const events = seedFinished();
    const nested = join(fx.root, "src", "deep");
    mkdirSync(nested, { recursive: true });

    const result = await cli(nested, "events", ID);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.out).toBe(events.map((item) => JSON.stringify(item)).join("\n"));
  });

  test("the default output is already JSONL", async () => {
    const events = seedFinished();
    const stored = events.map((item) => JSON.stringify(item));

    const plain = await cli(fx.root, "events", ID);
    const explicit = await cli(fx.root, "events", ID, "--json");

    expect(plain.code).toBe(ExitCode.Ok);
    expect(explicit.code).toBe(ExitCode.Ok);
    expect(plain.out).toBe(explicit.out);
    expect(plain.out).toBe(stored.join("\n"));
    expect(plain.out.endsWith("\n")).toBe(false);
  });

  test("--from selects a tail", async () => {
    seedFinished();
    const tail = await cli(fx.root, "events", ID, "--from", "3", "--json");
    expect(tail.code).toBe(ExitCode.Ok);
    const first = RunEvent.parse(JSON.parse(tail.out.split("\n")[0] ?? ""));
    expect(first.seq).toBe(3);

    for (const bad of ["0", "abc", "1.5"]) {
      const result = await cli(fx.root, "events", ID, "--from", bad);
      expect(result.code).toBe(ExitCode.Usage);
      expect(result.err).toContain("loomwright events --help");
    }

    const whole = await cli(fx.root, "events", ID, "--from", "1");
    expect(whole.out.split("\n")).toHaveLength(6);
  });

  test("--follow prints new events", async () => {
    const prefix = seedFinished();
    const stored = prefix.map((item) => JSON.stringify(item));
    const log = eventLogPath(fx.root, ID);
    const appended = JSON.stringify(event(7, "heartbeat", { text: "beat 7" }));
    const out: string[] = [];
    const controller = new AbortController();
    const pending = runCli(["events", ID, "--follow", "--json"], {
      cwd: fx.root,
      out: (line) => out.push(line),
      err: () => {},
      signal: controller.signal,
    });
    let mtimeAfterAppend = 0;
    try {
      await waitFor(() => out.length >= stored.length);
      appendFileSync(log, `${appended}\n`);
      await waitFor(() => out.length >= stored.length + 1);
      expect(out.slice(0, stored.length)).toEqual(stored);
      expect(out[stored.length]).toBe(appended);
      mtimeAfterAppend = statSync(log).mtimeMs;
    } finally {
      controller.abort();
    }
    expect(await pending).toBe(ExitCode.Ok);
    // The follower reads only: the file holds the prefix plus the line the test appended.
    expect(readFileSync(log, "utf8")).toBe(`${stored.join("\n")}\n${appended}\n`);
    expect(statSync(log).mtimeMs).toBe(mtimeAfterAppend);
    expect(readdirSync(dirname(log))).toEqual([`${ID}.jsonl`]);
  }, 30_000);

  test("--follow prints an appended corrupt line and warns instead of dropping it", async () => {
    const prefix = seedFinished();
    const stored = prefix.map((item) => JSON.stringify(item));
    const log = eventLogPath(fx.root, ID);
    const out: string[] = [];
    const err: string[] = [];
    const controller = new AbortController();
    const pending = runCli(["events", ID, "--follow"], {
      cwd: fx.root,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      signal: controller.signal,
    });
    let mtimeAfterAppend = 0;
    try {
      await waitFor(() => out.length >= stored.length);
      appendFileSync(log, "{not json\n");
      await waitFor(() => out.length >= stored.length + 1);
      expect(out.slice(0, stored.length)).toEqual(stored);
      expect(out[stored.length]).toBe("{not json");
      await waitFor(() => err.some((line) => line.includes("appended line skipped")));
      expect(err.join("\n")).toContain("(invalid)");
      mtimeAfterAppend = statSync(log).mtimeMs;
    } finally {
      controller.abort();
    }
    expect(await pending).toBe(ExitCode.Ok);
    expect(readFileSync(log, "utf8")).toBe(`${stored.join("\n")}\n{not json\n`);
    expect(statSync(log).mtimeMs).toBe(mtimeAfterAppend);
    expect(readdirSync(dirname(log))).toEqual([`${ID}.jsonl`]);
  }, 30_000);

  test("help and completion include the command", async () => {
    const help = await cli(fx.root, "--help");
    expect(help.out).toContain("events");

    const commandHelp = await cli(fx.root, "events", "--help");
    expect(commandHelp.out.split("\n")[0]).toStartWith("Usage: loomwright events");
    for (const flag of ["--follow", "--from", "--json"]) expect(commandHelp.out).toContain(flag);

    const completed = await completeWords(["ev"], fx.root);
    expect(completed.candidates?.map((candidate) => candidate.value)).toContain("events");
  });

  test("a corrupt line does not stop the stream", async () => {
    saveRun(fx.root, newRun(ID, "Add a health endpoint", "implementing"));
    const one = JSON.stringify(event(1, "run.started", { phase: "implementing" }));
    const three = JSON.stringify(event(3, "heartbeat", { text: "beat 3" }));
    writeLog([one, "{not json", three]);

    const result = await cli(fx.root, "events", ID);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.err).toContain("line 2");
    expect(result.out.split("\n")).toContain(one);
    expect(result.out.split("\n")).toContain(three);
  });

  test("a kept event log replays without run state", async () => {
    const events = seedFinished();
    rmSync(join(fx.root, `.factory/runs/${ID}.json`));

    const result = await cli(fx.root, "events", ID);

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.out).toBe(events.map((item) => JSON.stringify(item)).join("\n"));
  });

  test("an unknown run id exits 4", async () => {
    const result = await cli(fx.root, "events", "nope");

    expect(result.code).toBe(ExitCode.Precondition);
    expect(result.err).toContain("no change nope in this workspace");
  });

  test("an empty stream exits 0", async () => {
    saveRun(fx.root, newRun("empty-run", "nothing", "done"));

    const result = await cli(fx.root, "events", "empty-run");

    expect(result.code).toBe(ExitCode.Ok);
    expect(result.out).toBe("");
  });
});
