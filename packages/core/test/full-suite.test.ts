import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { MemorySink } from "../src/events/memory.ts";
import type { InstallStep } from "../src/gates/install.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { fullSuite } from "../src/pipeline/finish.ts";
import { loadRun, newRun, saveRun, TaskState } from "../src/state/run.ts";

const RUN = "add-x";
const M = "a/b";

let fx: Fixture | undefined;
afterEach(() => {
  fx?.cleanup();
  fx = undefined;
});

const config = (): FactoryConfig =>
  FactoryConfig.parse({
    schemaVersion: 3,
    layout: "single",
    repos: [{ name: "app", path: ".", languages: ["typescript"] }],
    models: { orchestrator: M, architect: M, reviewer: M, implementer: M, tester: M, explorer: M },
    // Every base gate is a literal no-op command: these tests exercise the full-suite wiring,
    // not the toolchain (the fixture has no node_modules).
    gates: {
      overrides: {
        app: { format: "true", lint: "true", types: "true", test: "true", testAffected: "true" },
      },
    },
  });

/** One merged task in `app`, so `touchedRepos` sees the fixture repo. */
const seed = (root: string): void => {
  const state = newRun(RUN, "Add a helper", "full-suite");
  state.tasks = [
    TaskState.parse({
      id: "1.1",
      title: "Add the helper",
      repo: "app",
      deps: [],
      touches: ["src/**"],
      status: "merged",
    }),
  ];
  saveRun(root, state);
};

interface InstallCall {
  readonly root: string;
  readonly dir: string;
  readonly repo: string;
}

const okStep = (): InstallStep => ({
  dir: ".",
  command: "bun install --frozen-lockfile",
  status: "ok",
  durationMs: 3,
});

function pipeline(
  root: string,
  sink: MemorySink,
  calls: InstallCall[],
  install?: (dir: string, repo: string) => Promise<InstallStep[]>,
): Pipeline {
  const p = new Pipeline(root, config(), {
    runtime: new ScriptedRuntime(() => ({})),
    out: () => {},
    signal: new AbortController().signal,
    events: { sink },
    heartbeatMs: 0,
    ...(install === undefined
      ? {}
      : {
          install: async (installRoot: string, dir: string, repo: { name: string }) => {
            calls.push({ root: installRoot, dir, repo: repo.name });
            return install(dir, repo.name);
          },
        }),
  });
  p.bindRun(RUN);
  return p;
}

describe("full suite installs in the gated checkout", () => {
  test("install progress is attributed to the repo", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    const sink = new MemorySink();
    const calls: InstallCall[] = [];
    const p = pipeline(fx.root, sink, calls, async () => [okStep()]);

    const result = await fullSuite(p, RUN);

    expect(calls).toEqual([{ root: fx.root, dir: p.repoDir(p.repo("app")), repo: "app" }]);
    expect(calls[0]?.dir).toBe(fx.root);
    const types = sink.types();
    const started = types.indexOf("install.started");
    const finished = types.indexOf("install.finished");
    const gate = types.indexOf("gate.started");
    expect(started).toBeGreaterThanOrEqual(0);
    expect(started).toBeLessThan(finished);
    expect(finished).toBeLessThan(gate);
    expect(sink.ofType("install.started")[0]?.data).toMatchObject({ step: "app", repo: "app" });
    expect(result.failing).toEqual([]);
    expect(result.installFailures).toEqual([]);
    expect(loadRun(fx.root, RUN)?.fullSuite.app?.passed).toBe(true);
  });

  test("a merged lockfile change is installed before the gates run", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    writeFileSync(join(fx.root, "bun.lock"), "");
    const sink = new MemorySink();
    const calls: InstallCall[] = [];
    const p = pipeline(fx.root, sink, calls, async () => [okStep()]);

    const result = await fullSuite(p, RUN);

    expect(calls).toHaveLength(1);
    const types = sink.types();
    expect(types.indexOf("install.finished")).toBeLessThan(types.indexOf("gate.started"));
    expect(result.failing).toEqual([]);
    expect(result.installFailures).toEqual([]);
    expect(loadRun(fx.root, RUN)?.fullSuite.app?.passed).toBe(true);
  });

  test("an install failure pauses without spending a suite round", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    const sink = new MemorySink();
    const calls: InstallCall[] = [];
    const p = pipeline(fx.root, sink, calls, async () => [
      { dir: ".", status: "failed", detail: "ETIMEDOUT registry", durationMs: 3 },
    ]);

    const result = await fullSuite(p, RUN);

    expect(result.installFailures).toEqual([{ repo: "app", detail: "ETIMEDOUT registry" }]);
    expect(result.failing).toEqual([]);
    expect(sink.ofType("gate.started")).toHaveLength(0);
    const run = loadRun(fx.root, RUN);
    expect(run?.fullSuite.app).toBeUndefined();
    expect(run?.tasks.some((t) => t.id.startsWith("suite-"))).toBe(false);
    expect(run?.suiteRounds).toBe(0);
  });

  test("every full-suite pass installs again", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    const sink = new MemorySink();
    const calls: InstallCall[] = [];
    const p = pipeline(fx.root, sink, calls, async () => [okStep()]);

    await fullSuite(p, RUN);
    await fullSuite(p, RUN);

    expect(calls).toHaveLength(2);
  });

  test("failure detail falls back to the directory", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    const sink = new MemorySink();
    const calls: InstallCall[] = [];
    const p = pipeline(fx.root, sink, calls, async () => [
      { dir: ".", status: "failed", durationMs: 3 },
    ]);

    const result = await fullSuite(p, RUN);

    expect(result.installFailures[0]?.detail).toBe(".");
  });

  test("a repo without a lockfile keeps running its gates", async () => {
    fx = await createSingleRepoFixture();
    seed(fx.root);
    const sink = new MemorySink();
    const p = pipeline(fx.root, sink, [], undefined);

    const result = await fullSuite(p, RUN);

    expect(sink.ofType("gate.started").length).toBeGreaterThan(0);
    expect(result.installFailures).toEqual([]);
    expect(result.failing).toEqual([]);
    expect(loadRun(fx.root, RUN)?.fullSuite.app?.passed).toBe(true);
  });
});
