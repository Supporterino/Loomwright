import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  createSingleRepoFixture,
  type Fixture,
  fixtureGit,
  writeFiles,
} from "../../../test/fixtures/workspaces.ts";
import { gitOut } from "../../../test/helpers.ts";
import { specHash, writeApproval } from "../src/approval/approval.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { MemorySink } from "../src/events/memory.ts";
import type { InstallStep } from "../src/gates/install.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { drive } from "../src/pipeline/drive.ts";
import { writePauseReport } from "../src/pipeline/finish.ts";
import { loadRun, newRun, saveRun, TaskState, updateRun } from "../src/state/run.ts";

const ID = "add-suite";
const M = "a/b";

const config = (): FactoryConfig =>
  FactoryConfig.parse({
    schemaVersion: 3,
    layout: "single",
    repos: [{ name: "app", path: ".", languages: ["typescript"] }],
    models: { orchestrator: M, architect: M, reviewer: M, implementer: M, tester: M, explorer: M },
    gates: {
      overrides: {
        // `test` fails and produces output; the rest pass. Every base gate is overridden, so an
        // unresolved command cannot fail as "missing" instead.
        app: {
          format: "true",
          lint: "true",
          types: "true",
          test: "echo suite-boom; false",
          testAffected: "true",
        },
      },
    },
  });

const task = (
  id: string,
  status: "pending" | "merged" | "failed" | "cancelled",
  extra: Partial<TaskState> = {},
): TaskState =>
  TaskState.parse({
    id,
    title: `Task ${id}`,
    repo: "app",
    deps: [],
    touches: ["**"],
    status,
    ...extra,
  });

function pipeline(root: string, install?: () => Promise<InstallStep[]>): Pipeline {
  return new Pipeline(root, config(), {
    runtime: new ScriptedRuntime(() => ({})),
    out: () => {},
    signal: new AbortController().signal,
    events: { sink: new MemorySink() },
    heartbeatMs: 0,
    ...(install === undefined ? {} : { install: async () => install() }),
  });
}

const pausedFile = (root: string, id = ID): string =>
  join(root, ".factory", "reports", `${id}-paused.md`);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRun(): string {
  const root = mkdtempSync(join(tmpdir(), "pause-report-"));
  temps.push(root);
  return root;
}

function seedRun(
  root: string,
  options: {
    readonly tasks?: readonly TaskState[];
    readonly fullSuite?: Record<string, { passed: boolean; output: string }>;
    readonly reason?: string;
  } = {},
): void {
  const state = newRun(ID, "Add the suite", "full-suite");
  state.tasks = [...(options.tasks ?? [])];
  state.fullSuite = options.fullSuite ?? {};
  if (options.reason !== undefined) state.pausedReason = options.reason;
  saveRun(root, state);
}

describe("pause report content", () => {
  test("only failing repos get a full-suite section", () => {
    const root = tempRun();
    seedRun(root, {
      reason: "full suite still failing in app after fix rounds",
      tasks: [
        task("1.1", "merged"),
        task("1.2", "failed"),
        task("1.3", "cancelled"),
        task("2.1", "pending"),
      ],
      fullSuite: {
        app: { passed: false, output: "[test] bun test\nboom" },
        web: { passed: true, output: "ok" },
      },
    });
    const p = pipeline(root);

    const file = writePauseReport(p, ID);
    const report = readFileSync(file, "utf8");

    expect(file).toBe(pausedFile(root));
    expect(report).toContain("- Completed: 1.1");
    expect(report).toContain("- Failed: 1.2");
    expect(report).toContain("- Cancelled (depend on a failed task): 1.3");
    expect(report).toContain("- Not started: 2.1");
    expect(report).toContain("## Task 1.2");
    expect(report).toContain("## Full suite: app");
    expect(report).toContain("[test] bun test");
    expect(report).not.toContain("## Full suite: web");
    expect(report).toContain(`loomwright retry ${ID} --task <task>`);
  });

  test("a task-failure pause keeps its task sections", () => {
    const root = tempRun();
    seedRun(root, {
      tasks: [
        task("1.1", "failed", { lastError: "gates failed", lastGateOutput: "task-gate-boom" }),
      ],
    });
    const p = pipeline(root);

    const report = readFileSync(writePauseReport(p, ID), "utf8");

    expect(report).toContain("- Failed: 1.1");
    expect(report).toContain("## Task 1.1");
    expect(report).toContain("task-gate-boom");
    expect(report).toContain(`loomwright retry ${ID} --task <task>`);
  });

  test("a full-suite pause without a failed task offers no retry --task step", () => {
    const root = tempRun();
    seedRun(root, {
      reason: "full suite still failing in app after fix rounds",
      tasks: [task("1.1", "merged")],
      fullSuite: { app: { passed: false, output: "suite-boom" } },
    });
    const p = pipeline(root);

    const report = readFileSync(writePauseReport(p, ID), "utf8");

    expect(report).not.toContain(`retry ${ID} --task`);
    expect(report).toContain(`loomwright resume ${ID}`);
  });

  test("a stale failure that later passed is not shown", () => {
    const root = tempRun();
    seedRun(root, {
      tasks: [task("1.1", "merged")],
      fullSuite: { app: { passed: true, output: "old" } },
    });
    const p = pipeline(root);

    const report = readFileSync(writePauseReport(p, ID), "utf8");

    expect(report).not.toContain("## Full suite: app");
  });

  test("an explicit scheduler summary wins over the run state tallies", () => {
    const root = tempRun();
    seedRun(root, { tasks: [task("1.1", "merged")] });
    const p = pipeline(root);

    const report = readFileSync(
      writePauseReport(p, ID, {
        status: "paused",
        merged: ["2.2"],
        failed: ["2.3"],
        cancelled: ["2.4"],
        pending: ["2.5"],
      }),
      "utf8",
    );

    expect(report).toContain("- Completed: 2.2");
    expect(report).toContain("- Failed: 2.3");
    expect(report).toContain("- Cancelled (depend on a failed task): 2.4");
    expect(report).toContain("- Not started: 2.5");
    expect(report).not.toContain("Completed: 1.1");
  });

  test("an empty run still writes the report with none on every tally line", () => {
    const root = tempRun();
    seedRun(root);
    const p = pipeline(root);

    const file = writePauseReport(p, ID);
    const report = readFileSync(file, "utf8");

    expect(existsSync(file)).toBe(true);
    expect(report).toContain("- Completed: none");
    expect(report).toContain("- Failed: none");
    expect(report).toContain("- Cancelled (depend on a failed task): none");
    expect(report).toContain("- Not started: none");
    expect(report).not.toContain("## Full suite:");
  });
});

interface Seeded {
  readonly fx: Fixture;
  readonly p: Pipeline;
}

async function seedDriveFixture(options: {
  readonly suiteRounds: number;
  readonly mode: "suite" | "install";
}): Promise<Seeded> {
  const fx = await createSingleRepoFixture();
  writeFiles(fx.root, {
    "openspec/changes/add-suite/spec.md":
      "# add-suite\n\n## ADDED Requirements\n\n### Requirement: A suite\n\nThe suite works.\n",
  });
  await fixtureGit(fx.root, "add", "-A");
  await fixtureGit(fx.root, "commit", "-q", "-m", "docs(spec): add-suite");
  const specCommit = await gitOut(fx.root, "rev-parse", "HEAD");

  saveRun(fx.root, newRun(ID, "Add the suite", "full-suite"));
  await updateRun(fx.root, ID, (d) => {
    d.tasks = [task("1.1", "merged")];
    d.suiteRounds = options.suiteRounds;
    d.branches = { app: { branch: "change/add-suite", base: "HEAD" } };
  });
  writeApproval(fx.root, {
    changeId: ID,
    approver: "t@example.com",
    specCommit,
    hash: specHash(fx.root, ID),
    approvedAt: new Date().toISOString(),
  });

  const p = pipeline(
    fx.root,
    options.mode === "suite"
      ? undefined
      : async () => [{ dir: ".", status: "failed", detail: "ETIMEDOUT registry", durationMs: 1 }],
  );
  return { fx, p };
}

describe("full-suite pauses write the report", () => {
  test("the suite round cap still writes the report", async () => {
    const { fx, p } = await seedDriveFixture({ suiteRounds: 2, mode: "suite" });
    try {
      const outcome = await drive(p, ID);
      p.progress.stop();

      expect(outcome.phase).toBe("paused");
      expect(outcome.detail).toContain("full suite still failing in app after fix rounds");
      const report = pausedFile(fx.root);
      expect(outcome.detail).toContain(`report: ${report}`);
      expect(existsSync(report)).toBe(true);
      const text = readFileSync(report, "utf8");
      expect(text).toContain("## Full suite: app");
      expect(text).toContain("suite-boom");
      expect(loadRun(fx.root, ID)?.suiteRounds).toBe(2);
    } finally {
      fx.cleanup();
    }
  }, 120_000);

  test("an install-failure pause writes the report", async () => {
    const { fx, p } = await seedDriveFixture({ suiteRounds: 0, mode: "install" });
    try {
      const outcome = await drive(p, ID);
      p.progress.stop();

      const run = loadRun(fx.root, ID);
      expect(outcome.phase).toBe("paused");
      expect(run?.pausedReason).toContain("app");
      expect(run?.pausedReason).toContain("ETIMEDOUT registry");
      const report = pausedFile(fx.root);
      expect(existsSync(report)).toBe(true);
      expect(outcome.detail).toContain(`report: ${report}`);
      const text = readFileSync(report, "utf8");
      expect(text).toContain(`loomwright resume ${ID}`);
      expect(text).not.toContain(`retry ${ID} --task`);
      expect(run?.suiteRounds).toBe(0);
      expect(run?.tasks.some((t) => t.id.startsWith("suite-"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  }, 120_000);
});
