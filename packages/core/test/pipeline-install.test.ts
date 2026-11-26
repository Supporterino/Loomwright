import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import { FactoryConfig } from "../src/config/schema.ts";
import { MemorySink } from "../src/events/memory.ts";
import type { InstallStep } from "../src/gates/install.ts";
import { Pipeline } from "../src/pipeline/context.ts";
import { installFor } from "../src/pipeline/install.ts";

const RUN = "add-x";

const roots: string[] = [];

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "loomwright-install-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const configFor = (): FactoryConfig =>
  FactoryConfig.parse({
    schemaVersion: 2,
    layout: "single",
    repos: [{ name: "app", path: ".", languages: ["typescript"] }],
    models: {
      orchestrator: "anthropic/claude-sonnet-5-5",
      architect: "anthropic/claude-sonnet-5-5",
      reviewer: "anthropic/claude-sonnet-5-5",
      implementer: "anthropic/claude-sonnet-5-5",
      tester: "anthropic/claude-sonnet-5-5",
      explorer: "anthropic/claude-sonnet-5-5",
    },
  });

const okStep = (): InstallStep => ({
  dir: ".",
  command: "bun install --frozen-lockfile",
  status: "ok",
  durationMs: 5,
});

describe("installFor", () => {
  test("install progress is attributed to the repo on a bound successful install", async () => {
    const root = makeRoot();
    const sink = new MemorySink();
    const calls: { root: string; dir: string; repo: string }[] = [];
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
      install: async (installRoot, dir, repo) => {
        calls.push({ root: installRoot, dir, repo: repo.name });
        return [okStep()];
      },
    });
    p.bindRun(RUN);

    const outcome = await installFor(p, "1.1", p.repo("app"), root);

    expect(calls).toEqual([{ root, dir: root, repo: "app" }]);
    expect(outcome.failure).toBeUndefined();
    expect(outcome.steps).toEqual([okStep()]);
    expect(sink.types()).toContain("install.started");
    expect(sink.types()).toContain("install.finished");
    expect(sink.types().indexOf("install.started")).toBeLessThan(
      sink.types().indexOf("install.finished"),
    );
    const started = sink.ofType("install.started")[0];
    const finished = sink.ofType("install.finished")[0];
    if (started === undefined || finished === undefined) throw new Error("missing install events");
    expect(started.data).toMatchObject({ step: "1.1", repo: "app" });
    expect(finished.data).toMatchObject({ step: "1.1", repo: "app" });
    expect(finished.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a failed install emits install.failed with the step's detail and no install.finished", async () => {
    const root = makeRoot();
    const sink = new MemorySink();
    const failed: InstallStep = {
      dir: ".",
      command: "bun install --frozen-lockfile",
      status: "failed",
      detail: "ETIMEDOUT registry",
      durationMs: 7,
    };
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
      install: async () => [failed],
    });
    p.bindRun(RUN);

    const outcome = await installFor(p, "1.1", p.repo("app"), root);

    expect(outcome.failure).toBe(failed);
    expect(outcome.steps).toEqual([failed]);
    expect(sink.ofType("install.finished")).toHaveLength(0);
    const failedEvent = sink.ofType("install.failed")[0];
    if (failedEvent === undefined) throw new Error("missing install.failed");
    expect(failedEvent.data).toMatchObject({
      step: "1.1",
      repo: "app",
      detail: "ETIMEDOUT registry",
    });
    expect(failedEvent.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a failed step without detail reports its directory", async () => {
    const root = makeRoot();
    const sink = new MemorySink();
    const failed: InstallStep = {
      dir: "packages/app",
      status: "failed",
      durationMs: 3,
    };
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
      install: async () => [failed],
    });
    p.bindRun(RUN);

    const outcome = await installFor(p, "1.1", p.repo("app"), root);

    expect(outcome.failure).toBe(failed);
    const failedEvent = sink.ofType("install.failed")[0];
    if (failedEvent === undefined) throw new Error("missing install.failed");
    expect(failedEvent.data).toMatchObject({ step: "1.1", repo: "app", detail: "packages/app" });
  });

  test("an unbound install prints the install line", async () => {
    const root = makeRoot();
    const out: string[] = [];
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: (line) => out.push(line),
      signal: new AbortController().signal,
      heartbeatMs: 0,
      install: async () => [okStep()],
    });

    const outcome = await installFor(p, "1.1", p.repo("app"), root);

    expect(outcome.failure).toBeUndefined();
    expect(out.join("\n")).toContain("installing dependencies in app");
  });

  test("a repo without a lockfile keeps running its gates", async () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", private: true }));
    const sink = new MemorySink();
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
    });
    p.bindRun(RUN);

    const outcome = await installFor(p, "1.1", p.repo("app"), root);

    expect(outcome.failure).toBeUndefined();
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0]?.status).toBe("skipped");
    expect(sink.ofType("install.failed")).toHaveLength(0);
    expect(sink.ofType("install.finished")).toHaveLength(1);
  });

  test("install progress is attributed to the repo: the step is used verbatim", async () => {
    const root = makeRoot();
    const sink = new MemorySink();
    const p = new Pipeline(root, configFor(), {
      runtime: new ScriptedRuntime(() => ({})),
      out: () => {},
      signal: new AbortController().signal,
      events: { sink },
      heartbeatMs: 0,
      install: async () => [okStep()],
    });
    p.bindRun(RUN);

    await installFor(p, "1.1", p.repo("app"), root);
    await installFor(p, "app", p.repo("app"), root);

    const steps = sink.ofType("install.started").map((event) => event.data.step);
    expect(steps).toEqual(["1.1", "app"]);
    const finished = sink.ofType("install.finished").map((event) => event.data.step);
    expect(finished).toEqual(["1.1", "app"]);
    for (const event of sink.ofType("install.started")) expect(event.data.repo).toBe("app");
  });
});
