import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readEventLines } from "@loomwright/core/events/reader";
import { ExitCode } from "@loomwright/core/exit-codes";
import { readActive } from "@loomwright/core/state/active";
import { loadRun } from "@loomwright/core/state/run";
import { factoryScript } from "../../../test/fixtures/factory-script.ts";
import { ScriptedRuntime } from "../../../test/fixtures/scripted-runtime.ts";
import {
  createSingleRepoFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli, cliWith } from "../../../test/helpers.ts";

const ID = "add-lock";

const TASKS = [
  {
    id: "1.1",
    title: "Bump the lockfile",
    repo: "app",
    deps: [],
    touches: ["bun.lock", "src/sum.ts"],
    file: "bun.lock",
    content: "lock-v2\n",
  },
];

const passAll = { format: "true", lint: "true", types: "true", test: "true", testAffected: "true" };

/** Rewrites part of factory.config.jsonc and commits it (the AI repo must be clean to branch). */
async function configure(root: string, edit: (text: string) => string): Promise<void> {
  const file = join(root, "factory.config.jsonc");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
  await fixtureGit(root, "commit", "-q", "-am", "chore: configure the factory");
}

interface Harness {
  readonly fx: Fixture;
  /** Absolute path of the installs log the stub appends to. */
  readonly installs: string;
  /** Directory first on PATH, holding the `bun` stub. */
  readonly bin: string;
  /** Set when the stub should fail once this file exists. */
  readonly flag: string | undefined;
}

/**
 * A single-repo workspace whose checkout starts with a stale `node_modules` stamp: `bun.lock`
 * and `node_modules/.lock` are both `lock-v1` before the run. The `bun` stub emulates an install
 * by copying the checkout's lockfile over the stamp, so `cmp -s bun.lock node_modules/.lock`
 * passes only after an install ran in that directory.
 */
async function setupFixture(options: { readonly fail?: boolean } = {}): Promise<Harness> {
  const fx = await createSingleRepoFixture();
  expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);

  writeFileSync(join(fx.root, "bun.lock"), "lock-v1\n");
  writeFileSync(
    join(fx.root, ".gitignore"),
    `${readFileSync(join(fx.root, ".gitignore"), "utf8")}node_modules/\n`,
  );
  mkdirSync(join(fx.root, "node_modules"), { recursive: true });
  writeFileSync(join(fx.root, "node_modules/.lock"), "lock-v1\n");
  await fixtureGit(fx.root, "add", "bun.lock", ".gitignore");

  // Task gates install before the implementer writes the lockfile, so a task-mode
  // `testAffected` would compare the worktree stamp with the old lockfile. The stale checkout
  // this test targets is only visible to the full suite's `test` gate.
  const gates =
    options.fail !== true ? { ...passAll, test: "cmp -s bun.lock node_modules/.lock" } : passAll;
  await configure(fx.root, (t) =>
    t.replace('"overrides": {}', `"overrides": ${JSON.stringify({ app: gates })}`),
  );

  const bin = join(fx.base, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const installs = join(fx.base, "installs.log");
  writeFileSync(installs, "");
  const flag = options.fail === true ? join(fx.base, "registry-down") : undefined;
  const fail =
    flag === undefined
      ? ""
      : `  if [ -e '${flag}' ]; then echo 'ETIMEDOUT registry' >&2; exit 1; fi\n`;
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh
if [ "$1" = "install" ]; then
${fail}  mkdir -p node_modules
  cp bun.lock node_modules/.lock
  echo "$PWD" >> '${installs}'
  exit 0
fi
exit 0
`,
  );
  chmodSync(join(bin, "bun"), 0o755);

  return { fx, installs, bin, flag };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Puts the stub first on PATH; restores it when the test ends. */
function stubPath(bin: string): void {
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved ?? ""}`;
  cleanups.push(() => {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  });
}

describe("full suite dependency installs end to end", () => {
  test("a merged lockfile change is installed before the gates run, with install progress attributed to the repo", async () => {
    const { fx, installs, bin } = await setupFixture();
    cleanups.push(() => fx.cleanup());
    stubPath(bin);

    const runtime = new ScriptedRuntime(
      factoryScript({
        changeId: ID,
        summary: "Bump the lockfile",
        repos: ["app"],
        tasks: TASKS,
      }),
    );
    await cliWith(runtime, fx.root, "run", "Bump the lockfile");
    const approve = await cliWith(runtime, fx.root, "approve", ID);

    expect(approve.code).toBe(ExitCode.Ok);
    expect(approve.out).toContain(`${ID}: done`);

    const done = loadRun(fx.root, ID);
    expect(done?.phase).toBe("done");
    expect(done?.suiteRounds).toBe(0);
    expect(done?.fullSuite.app?.passed).toBe(true);
    expect(done?.tasks.some((t) => t.id.startsWith("suite-"))).toBe(false);

    // Only the full-suite pass installs the checkout itself; task installs log their worktree.
    const rootReal = realpathSync(fx.root);
    const rootInstalls = readFileSync(installs, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => (existsSync(line) ? realpathSync(line) : line))
      .filter((dir) => dir === rootReal);
    expect(rootInstalls).toHaveLength(1);
    expect(readFileSync(join(fx.root, "node_modules/.lock"), "utf8")).toBe("lock-v2\n");

    const events = readEventLines(fx.root, ID)
      .lines.map((line) => line.event)
      .filter((event) => event !== undefined);
    const installStarted = events.findIndex(
      (event) =>
        event.type === "install.started" && event.data.step === "app" && event.data.repo === "app",
    );
    const installFinished = events.findIndex(
      (event, index) =>
        index > installStarted &&
        event.type === "install.finished" &&
        event.data.step === "app" &&
        event.data.repo === "app",
    );
    const firstGate = events.findIndex(
      (event) => event.type === "gate.started" && event.data.step === "app",
    );
    expect(installStarted).toBeGreaterThanOrEqual(0);
    expect(installFinished).toBeGreaterThan(installStarted);
    expect(firstGate).toBeGreaterThan(installFinished);

    expect(readActive(fx.root)).toBeUndefined();
  }, 120_000);

  test("an install-failure pause writes the report, spends no round, and names it", async () => {
    const { fx, bin, flag } = await setupFixture({ fail: true });
    if (flag === undefined) throw new Error("missing install-failure flag");
    cleanups.push(() => fx.cleanup());
    stubPath(bin);

    const team = factoryScript({
      changeId: ID,
      summary: "Bump the lockfile",
      repos: ["app"],
      tasks: TASKS,
    });
    let failed = false;
    const runtime = new ScriptedRuntime(async (call) => {
      const step = await team(call);
      // The flag is written after the tester's worktree install; only the checkout install
      // that the full suite runs can then fail.
      if (call.agent === "tester" && !failed) {
        writeFileSync(flag, "");
        failed = true;
      }
      return step;
    });
    await cliWith(runtime, fx.root, "run", "Bump the lockfile");
    const approve = await cliWith(runtime, fx.root, "approve", ID);

    expect(approve.code).toBe(ExitCode.Paused);
    const paused = loadRun(fx.root, ID);
    expect(paused?.phase).toBe("paused");
    expect(paused?.pausedReason).toContain("dependency install failed in app");
    expect(paused?.pausedReason).toContain("ETIMEDOUT registry");
    expect(paused?.suiteRounds).toBe(0);
    expect(paused?.fullSuite.app).toBeUndefined();
    expect(paused?.tasks.some((t) => t.id.startsWith("suite-"))).toBe(false);

    expect(approve.out).toContain("report:");
    expect(approve.out).toContain("paused.md");
    const report = join(fx.root, ".factory/reports", `${ID}-paused.md`);
    expect(existsSync(report)).toBe(true);
    const text = readFileSync(report, "utf8");
    const reasonLine = text.split("\n").find((line) => line.startsWith("Reason:"));
    expect(reasonLine).toContain("app");
    expect(reasonLine).toContain("ETIMEDOUT registry");
    expect(text).toContain(`loomwright resume ${ID}`);
    expect(text).not.toContain(`retry ${ID} --task`);
  }, 120_000);
});
