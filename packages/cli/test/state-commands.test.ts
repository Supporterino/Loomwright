import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { eventLogPath } from "@loomwright/core/events/jsonl";
import { RunEvent } from "@loomwright/core/events/protocol";
import { ExitCode } from "@loomwright/core/exit-codes";
import { open } from "@loomwright/core/factory";
import { claimActive, enqueue, readActive, readQueue } from "@loomwright/core/state/active";
import { loadRun, newRun, saveRun, TaskState } from "@loomwright/core/state/run";
import { FACTORY_VERSION } from "@loomwright/core/version";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { runCli } from "../src/main.ts";

const ISO = "2026-11-17T10:00:00.000Z";

async function waitFor(predicate: () => boolean, ms = 20_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting for output");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function heartbeat(seq: number): string {
  return JSON.stringify(
    RunEvent.parse({
      v: 1,
      runId: "add-x",
      seq,
      ts: ISO,
      type: "heartbeat",
      data: { text: "beat" },
    }),
  );
}

describe("status, retry and abort", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
    expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
    const run = newRun("add-x", "Add a health endpoint", "paused");
    run.pausedReason = "failed: 1.1; cancelled: 1.2";
    run.branches = { ".": { branch: "change/add-x", base: "0123456789abcdef" } };
    const t = (id: string, status: TaskState["status"], extra: Partial<TaskState> = {}) =>
      TaskState.parse({
        id,
        title: `Task ${id}`,
        repo: "app",
        deps: [],
        touches: ["src/**"],
        status,
        ...extra,
      });
    run.tasks = [
      t("1.1", "failed", {
        failures: 4,
        lastError: "lint; retry budget (3) exhausted",
        lastGateOutput: "src/sum.ts:1 error",
      }),
      t("1.2", "cancelled", { deps: ["1.1"] }),
      t("1.3", "merged", { commit: "abcdef0123456789" }),
    ];
    saveRun(fx.root, run);
    saveRun(fx.root, newRun("next-thing", "later", "queued"));
    await claimActive(fx.root, "add-x");
    await enqueue(fx.root, "next-thing");
  });
  afterEach(() => fx.cleanup());

  test("status shows the active change, the queue and the task DAG", async () => {
    const run = await cli(fx.root, "status", "add-x");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out.split("\n")).toEqual([
      `change add-x — paused (active, driven by pid ${process.pid}; factory ${FACTORY_VERSION})`,
      "  paused: failed: 1.1; cancelled: 1.2",
      "  branches: . change/add-x @0123456789ab",
      "  tasks: 1/3 merged (merge seq 0)",
      "    ✗ 1.1 app Task 1.1 — failed: lint; retry budget (3) exhausted",
      "        src/sum.ts:1 error",
      "    ⊘ 1.2 app Task 1.2 — cancelled (a dependency failed)",
      "    ✓ 1.3 app Task 1.3 — merged abcdef012345",
    ]);
    const all = await cli(fx.root, "status", "--json");
    const json = JSON.parse(all.out) as {
      active: { changeId: string };
      queue: string[];
      runs: { id: string }[];
    };
    expect(json.active.changeId).toBe("add-x");
    expect(json.queue).toEqual(["next-thing"]);
    expect(json.runs.map((r) => r.id).sort()).toEqual(["add-x", "next-thing"]);
  });

  test("status --json deep-equals the document Factory.status() returns", async () => {
    const factory = await open(fx.root);
    const all = JSON.parse((await cli(fx.root, "status", "--json")).out) as unknown;
    expect(all).toEqual(await factory.status());
    const one = JSON.parse((await cli(fx.root, "status", "add-x", "--json")).out) as {
      workspaceUsage?: unknown;
    };
    expect(one).toEqual(await factory.status("add-x"));
    expect("workspaceUsage" in one).toBe(false);
    expect((await cli(fx.root, "status", "nope", "--json")).code).toBe(ExitCode.Precondition);
  });

  test("status --watch reprints frames until interrupted", async () => {
    const out: string[] = [];
    const code = await runCli(["status", "add-x", "--watch", "--interval", "0.01"], {
      cwd: fx.root,
      out: (line) => out.push(line),
      err: () => {},
      signal: AbortSignal.timeout(80),
    });
    expect(code).toBe(ExitCode.Ok);
    expect(out.filter((line) => line.startsWith("updated ")).length).toBeGreaterThanOrEqual(2);
    expect(out.join("\n")).toContain("change add-x — paused");
    expect((await cli(fx.root, "status", "add-x", "--watch", "--json")).code).toBe(ExitCode.Usage);
  });

  test("a new event produces a frame", async () => {
    const log = eventLogPath(fx.root, "add-x");
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, `${heartbeat(1)}\n`);
    const out: string[] = [];
    const controller = new AbortController();
    const pending = runCli(["status", "add-x", "--watch", "--interval", "0.05"], {
      cwd: fx.root,
      out: (line) => out.push(line),
      err: () => {},
      signal: controller.signal,
    });
    try {
      await waitFor(() => out.some((line) => line.startsWith("updated ")));
      const run = loadRun(fx.root, "add-x");
      if (run === undefined) throw new Error("the seeded run is missing");
      const task = run.tasks.find((candidate) => candidate.id === "1.1");
      if (task === undefined) throw new Error("the seeded task is missing");
      task.status = "merged";
      task.commit = "1234567890abcdef";
      saveRun(fx.root, run);
      const merged = JSON.stringify(
        RunEvent.parse({
          v: 1,
          runId: "add-x",
          seq: 2,
          ts: ISO,
          type: "task.merged",
          data: { task: { id: "1.1", repo: "app" }, commit: "1234567890abcdef" },
        }),
      );
      appendFileSync(log, `${merged}\n`);
      await waitFor(() => out.some((line) => line.includes("✓ 1.1")));
    } finally {
      controller.abort();
    }
    expect(await pending).toBe(ExitCode.Ok);
  }, 30_000);

  test("the frame format is unchanged", async () => {
    const body = (await cli(fx.root, "status", "add-x")).out.split("\n");
    const tty: string[] = [];
    await runCli(["status", "add-x", "--watch", "--interval", "10"], {
      cwd: fx.root,
      out: (line) => tty.push(line),
      err: () => {},
      tty: true,
      signal: AbortSignal.timeout(50),
    });
    expect(tty[0]).toBe("\x1b[2J\x1b[H");
    expect(tty[1]).toStartWith("updated ");
    expect(tty[1]).toEndWith(" · Ctrl-C to stop");
    expect(tty.slice(2, 2 + body.length)).toEqual(body);

    const piped: string[] = [];
    await runCli(["status", "add-x", "--watch", "--interval", "0.01"], {
      cwd: fx.root,
      out: (line) => piped.push(line),
      err: () => {},
      signal: AbortSignal.timeout(80),
    });
    expect(piped[0]).toStartWith("updated ");
    expect(piped.includes("")).toBe(true);
    expect(piped.join("\n")).toContain(body.join("\n"));
  });

  test("a missing event log falls back to polling", async () => {
    const out: string[] = [];
    const code = await runCli(["status", "add-x", "--watch", "--interval", "0.01"], {
      cwd: fx.root,
      out: (line) => out.push(line),
      err: () => {},
      signal: AbortSignal.timeout(80),
    });
    expect(code).toBe(ExitCode.Ok);
    expect(out.filter((line) => line.startsWith("updated ")).length).toBeGreaterThanOrEqual(2);
  });

  test("the existing watch guards still apply", async () => {
    const conflict = await cli(fx.root, "status", "add-x", "--watch", "--json");
    expect(conflict.code).toBe(ExitCode.Usage);
    expect(conflict.err).toContain("status: --watch and --json exclude each other");
    const interval = await cli(fx.root, "status", "add-x", "--watch", "--interval", "0");
    expect(interval.code).toBe(ExitCode.Usage);
    expect(interval.err).toContain("status: --interval must be a positive number of seconds");
  });

  test("status shows the full suite, contract results and provisional pointers (audit G4)", async () => {
    const run = newRun("closed-x", "Close it", "done");
    run.fullSuite = { app: { passed: true, output: "" }, web: { passed: false, output: "x" } };
    run.contractResults = {
      "openapi backend:api/openapi.yaml": { passed: false, summary: "breaking: GET /x removed" },
    };
    run.pointerCommit = "fedcba9876543210";
    run.pointers = ["repos/backend: 111111111111 → 222222222222"];
    saveRun(fx.root, run);
    const out = (await cli(fx.root, "status", "closed-x")).out.split("\n");
    expect(out).toContain("  full suite: app ✓, web ✗");
    expect(out).toContain(
      "  contracts: openapi backend:api/openapi.yaml ✗ (breaking: GET /x removed)",
    );
    expect(out).toContain(
      "  pointers: fedcba987654 (provisional; repos/backend: 111111111111 → 222222222222)",
    );
  });

  test("retry requeues a failed task and its cancelled dependents", async () => {
    expect((await cli(fx.root, "retry", "add-x", "--task", "1.3")).code).toBe(
      ExitCode.Precondition,
    );
    const run = await cli(fx.root, "retry", "add-x", "--task", "1.1");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("requeued 1.1 with a fresh retry budget (pending: 1.1, 1.2)");
    const state = loadRun(fx.root, "add-x");
    expect(state?.tasks.map((t) => [t.id, t.status, t.failures])).toEqual([
      ["1.1", "pending", 0],
      ["1.2", "pending", 0],
      ["1.3", "merged", 0],
    ]);
  });

  test("retry keeps its usage and precondition errors", async () => {
    const missing = await cli(fx.root, "retry", "add-x");
    expect(missing.code).toBe(ExitCode.Usage);
    expect(missing.err).toContain("retry: --task <id> is required");
    const unknownChange = await cli(fx.root, "retry", "nope", "--task", "1.1");
    expect(unknownChange.code).toBe(ExitCode.Precondition);
    expect(unknownChange.err).toContain("no change nope in this workspace");
    const unknownTask = await cli(fx.root, "retry", "add-x", "--task", "nope");
    expect(unknownTask.code).toBe(ExitCode.Usage);
    expect(unknownTask.err).toContain("retry: add-x has no task nope");
    const notFailed = await cli(fx.root, "retry", "add-x", "--task", "1.3");
    expect(notFailed.code).toBe(ExitCode.Precondition);
    expect(notFailed.err).toContain("task 1.3 is merged, not failed");
  });

  test("a corrupt run file or lock is reported, not a crash (audit P15)", async () => {
    writeFileSync(join(fx.root, ".factory/runs/broken.json"), "{not json");
    const all = await cli(fx.root, "status");
    expect(all.err).toBe("");
    expect(all.code).toBe(ExitCode.Ok);
    expect(all.out).toContain("change add-x — paused");
    expect(all.out).toContain("change broken — unreadable: .factory/runs/broken.json is corrupt");
    const json = JSON.parse((await cli(fx.root, "status", "--json")).out) as {
      runs: { id: string }[];
      corrupt: { id: string; error: string }[];
    };
    expect(json.runs.map((r) => r.id).sort()).toEqual(["add-x", "next-thing"]);
    expect(json.corrupt.map((c) => c.id)).toEqual(["broken"]);
    const one = await cli(fx.root, "status", "broken");
    expect(one.code).toBe(ExitCode.Precondition);
    expect(one.err).toContain(".factory/runs/broken.json is corrupt");

    writeFileSync(join(fx.root, ".factory/active.lock"), "");
    const locked = await cli(fx.root, "status");
    expect(locked.code).toBe(ExitCode.Ok);
    expect(locked.out).toContain("active: unreadable: .factory/active.lock is corrupt");
    const abort = await cli(fx.root, "abort", "add-x");
    expect(abort.code).toBe(ExitCode.Precondition);
    expect(abort.err).toContain(".factory/active.lock is corrupt");
    expect(abort.err).toContain("rm .factory/active.lock");
    // Refused before anything changed.
    expect(loadRun(fx.root, "add-x")?.phase).toBe("paused");
  });

  test("abort marks the change, releases the lock and leaves the queue to the user", async () => {
    const run = await cli(fx.root, "abort", "add-x");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out.split("\n")[0]).toBe("aborted add-x");
    expect(run.out).toContain("kept branches: .: change/add-x");
    expect(loadRun(fx.root, "add-x")).toMatchObject({ phase: "aborted", abortRequested: true });
    expect(readActive(fx.root)).toBeUndefined();
    expect(readQueue(fx.root).entries.map((e) => e.changeId)).toEqual(["next-thing"]);
    expect((await cli(fx.root, "abort", "nope")).code).toBe(ExitCode.Precondition);
  });

  test("abort reports the live driver that stops at its next safe point", async () => {
    const driver = Bun.spawn(["sleep", "60"]);
    try {
      writeFileSync(
        join(fx.root, ".factory/active.lock"),
        JSON.stringify({ changeId: "add-x", pid: driver.pid, host: hostname(), since: "now" }),
      );
      const run = await cli(fx.root, "abort", "add-x");
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.out.split("\n")[0]).toBe(
        `aborted add-x; pid ${driver.pid} stops at its next safe point and frees the workspace`,
      );
      expect(readActive(fx.root)?.changeId).toBe("add-x");
    } finally {
      driver.kill();
    }
  });
});
