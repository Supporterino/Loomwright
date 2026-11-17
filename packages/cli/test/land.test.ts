import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@loomwright/core/config/load";
import { ExitCode } from "@loomwright/core/exit-codes";
import { branchAiRepo, branchSubmodule } from "@loomwright/core/git/branching";
import { bumpPointers } from "@loomwright/core/git/pointers";
import { changeBranch } from "@loomwright/core/git/repo";
import { newRun, saveRun, TaskState } from "@loomwright/core/state/run";
import {
  createSingleRepoFixture,
  createSubmoduleFixture,
  type Fixture,
  fixtureGit,
  writeFiles,
} from "../../../test/fixtures/workspaces.ts";
import { cli, gitOut } from "../../../test/helpers.ts";

const ID = "add-land";

async function singleRepoChange(fx: Fixture): Promise<string> {
  expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
  const base = await gitOut(fx.root, "rev-parse", "HEAD");
  await fixtureGit(fx.root, "switch", "-q", "-c", changeBranch(ID));
  writeFileSync(join(fx.root, "src/landed.ts"), "export const landed = true;\n");
  await fixtureGit(fx.root, "add", "-A");
  await fixtureGit(fx.root, "commit", "-q", "-m", "feat: land the change");
  const tip = await gitOut(fx.root, "rev-parse", "HEAD");
  await fixtureGit(fx.root, "branch", `${changeBranch(ID)}--1.1`, tip);
  await fixtureGit(fx.root, "switch", "-q", "main");
  const run = newRun(ID, "Land the change", "done");
  run.tasks = [
    TaskState.parse({
      id: "1.1",
      title: "Land the change",
      repo: "app",
      deps: [],
      touches: ["**"],
      status: "merged",
    }),
  ];
  run.branches = { app: { branch: changeBranch(ID), base } };
  saveRun(fx.root, run);
  writeFiles(fx.root, {
    ".factory/context/add-land/1.1.md": "context",
    ".factory/approvals/add-land.json": "{}",
    ".factory/runs/add-land/snapshot/gates.json": "{}",
    ".factory/reports/add-land.md": "done report",
    ".factory/reports/add-land-paused.md": "old pause",
    ".factory/logs/add-land/2026.jsonl": '{"kind":"tool"}\n',
    ".factory/events/add-land.jsonl":
      '{"v":1,"runId":"add-land","seq":1,"ts":"2026-11-17T10:00:00.000Z","type":"run.started","data":{"phase":"done"}}\n',
    ".factory/usage/add-land.json": JSON.stringify({
      version: 1,
      changeId: ID,
      entries: [],
    }),
    ".factory/worktrees/add-land/app/1.1/leftover.txt": "leftover",
    ".factory/sessions/session-one.json": JSON.stringify({
      sessionId: "session-one",
      changeId: ID,
    }),
    ".factory/sessions/session-other.json": JSON.stringify({
      sessionId: "session-other",
      changeId: "other-change",
    }),
  });
  return base;
}

describe("land", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
  });
  afterEach(() => fx.cleanup());

  test("merges, deletes branches and removes ephemeral artifacts", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "land", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain(`landed ${ID}`);
    expect(run.out).toContain("fast-forward");
    expect(run.out).toContain("hint: records stay in .factory/");

    expect(await gitOut(fx.root, "branch", "--show-current")).toBe("main");
    expect(existsSync(join(fx.root, "src/landed.ts"))).toBe(true);
    expect(
      await gitOut(fx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${changeBranch(ID)}`),
    ).toBe("");
    expect(
      await gitOut(
        fx.root,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${changeBranch(ID)}--1.1`,
      ),
    ).toBe("");

    for (const path of [
      ".factory/worktrees/add-land",
      ".factory/context/add-land",
      ".factory/approvals/add-land.json",
      ".factory/runs/add-land.json",
      ".factory/runs/add-land",
      ".factory/reports/add-land-paused.md",
      ".factory/sessions/session-one.json",
    ])
      expect(existsSync(join(fx.root, path))).toBe(false);
    expect(existsSync(join(fx.root, ".factory/sessions/session-other.json"))).toBe(true);
    for (const path of [
      ".factory/reports/add-land.md",
      ".factory/logs/add-land/2026.jsonl",
      ".factory/usage/add-land.json",
    ])
      expect(existsSync(join(fx.root, path))).toBe(true);
  });

  test("keeps the event log and lists it under kept", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "land", ID, "--json");
    expect(run.code).toBe(ExitCode.Ok);
    const outcome = JSON.parse(run.out) as { kept: string[]; cleaned: string[] };
    expect(outcome.kept).toContain(`.factory/events/${ID}.jsonl`);
    expect(outcome.cleaned).not.toContain(`.factory/events/${ID}.jsonl`);
    expect(existsSync(join(fx.root, `.factory/events/${ID}.jsonl`))).toBe(true);
    expect(existsSync(join(fx.root, `.factory/runs/${ID}.json`))).toBe(false);
    expect(existsSync(join(fx.root, `.factory/approvals/${ID}.json`))).toBe(false);
  });

  test("dry-run lists the event log under kept, not cleaned", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "land", ID, "--dry-run", "--json");
    expect(run.code).toBe(ExitCode.Ok);
    const plan = JSON.parse(run.out) as { kept: string[]; cleaned: string[] };
    expect(plan.kept).toContain(`.factory/events/${ID}.jsonl`);
    expect(plan.cleaned).not.toContain(`.factory/events/${ID}.jsonl`);
    expect(existsSync(join(fx.root, `.factory/events/${ID}.jsonl`))).toBe(true);
  });

  test("a missing event log is not an error", async () => {
    await singleRepoChange(fx);
    rmSync(join(fx.root, ".factory/events"), { recursive: true, force: true });
    const run = await cli(fx.root, "land", ID, "--json");
    expect(run.code).toBe(ExitCode.Ok);
    const outcome = JSON.parse(run.out) as { kept: string[] };
    expect(outcome.kept).toContain(`.factory/events/${ID}.jsonl`);
  });

  test("records the change instead of the local-records hint when artifacts are tracked", async () => {
    await singleRepoChange(fx);
    const file = join(fx.root, "factory.config.jsonc");
    writeFileSync(file, readFileSync(file, "utf8").replace('"mode": "local"', '"mode": "git"'));
    await fixtureGit(fx.root, "commit", "-q", "-am", "chore: artifacts git");

    const run = await cli(fx.root, "land", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("recorded: factory-records/");
    expect(run.out).not.toContain("hint: records stay in");
    for (const rel of [
      `factory-records/reports/${ID}.md`,
      `factory-records/approvals/${ID}.json`,
      `factory-records/usage/${ID}.json`,
    ])
      expect(existsSync(join(fx.root, rel))).toBe(true);
  });

  test("--dry-run plans without merging or deleting", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "land", ID, "--dry-run");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("land plan");
    expect(run.out).toContain("dry run: nothing was merged or deleted");
    expect(run.out).not.toContain("hint: records stay in");
    expect(await gitOut(fx.root, "branch", "--show-current")).toBe("main");
    expect(existsSync(join(fx.root, "src/landed.ts"))).toBe(false);
    expect(
      await gitOut(fx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${changeBranch(ID)}`),
    ).not.toBe("");

    const json = await cli(fx.root, "land", ID, "--dry-run", "--json");
    const plan = JSON.parse(json.out) as {
      dryRun: boolean;
      repos: { repo: string; status: string }[];
      kept: string[];
    };
    expect(plan.dryRun).toBe(true);
    expect(plan.repos[0]?.status).toBe("fast-forward");
    expect(plan.kept).toContain(`.factory/reports/${ID}.md`);
  });

  test("a conflict aborts the merge and leaves the change branch", async () => {
    await singleRepoChange(fx);
    await fixtureGit(fx.root, "switch", "-q", "main");
    writeFileSync(join(fx.root, "src/landed.ts"), "main version\n");
    await fixtureGit(fx.root, "add", "-A");
    await fixtureGit(fx.root, "commit", "-q", "-m", "chore: conflicting main");
    const run = await cli(fx.root, "land", ID);
    expect(run.code).toBe(ExitCode.Precondition);
    expect(run.err).toContain("conflicted");
    expect(
      await gitOut(fx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${changeBranch(ID)}`),
    ).not.toBe("");
    expect(existsSync(join(fx.root, ".factory/runs/add-land.json"))).toBe(true);
  });

  test("refuses a change that is not done", async () => {
    expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
    saveRun(fx.root, newRun(ID, "Not done", "paused"));
    const run = await cli(fx.root, "land", ID);
    expect(run.code).toBe(ExitCode.Precondition);
    expect(run.err).toContain("not done");
  });
});

describe("land with submodules", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSubmoduleFixture();
    expect((await cli(fx.root, "init")).code).toBe(ExitCode.Ok);
  });
  afterEach(() => fx.cleanup());

  test("a submodule merge commit becomes the land pointer", async () => {
    const config = loadConfig(fx.root).config;
    const backend = config.repos.find((repo) => repo.name === "backend");
    if (backend === undefined) throw new Error("backend repo missing");
    const aiBase = await gitOut(fx.root, "rev-parse", "HEAD");
    await branchAiRepo(fx.root, ID);
    const sub = await branchSubmodule(fx.root, backend, ID);
    const dir = join(fx.root, "repos/backend");
    await fixtureGit(dir, "switch", "-q", "main");
    writeFileSync(join(dir, "base.txt"), "main moved\n");
    await fixtureGit(dir, "add", "-A");
    await fixtureGit(dir, "commit", "-q", "-m", "chore: move backend main");
    await fixtureGit(dir, "switch", "-q", changeBranch(ID));
    writeFileSync(join(dir, "landed.txt"), "landed\n");
    await fixtureGit(dir, "add", "-A");
    await fixtureGit(dir, "commit", "-q", "-m", "feat: land backend");
    await bumpPointers(fx.root, ID, [backend]);

    const run = newRun(ID, "Land backend", "done");
    run.tasks = [
      TaskState.parse({
        id: "1.1",
        title: "Land backend",
        repo: "backend",
        deps: [],
        touches: ["**"],
        status: "merged",
      }),
    ];
    run.branches = {
      backend: { branch: changeBranch(ID), base: sub.base },
      ".": { branch: changeBranch(ID), base: aiBase },
    };
    saveRun(fx.root, run);

    const out = await cli(fx.root, "land", ID);
    expect(out.code).toBe(ExitCode.Ok);
    expect(out.out).toContain("submodule pointers");
    const merged = await gitOut(dir, "rev-parse", "HEAD");
    expect(await gitOut(fx.root, "rev-parse", `HEAD:repos/backend`)).toBe(merged);
    expect(await gitOut(fx.root, "log", "-1", "--format=%s")).toBe(
      `chore(submodules): point to landed ${ID}`,
    );
  });

  test("merges submodules first, points the AI repo at them and deletes both branches", async () => {
    const config = loadConfig(fx.root).config;
    const backend = config.repos.find((repo) => repo.name === "backend");
    if (backend === undefined) throw new Error("backend repo missing");
    const aiBase = await gitOut(fx.root, "rev-parse", "HEAD");
    await branchAiRepo(fx.root, ID);
    const sub = await branchSubmodule(fx.root, backend, ID);
    const dir = join(fx.root, "repos/backend");
    writeFileSync(join(dir, "landed.txt"), "landed\n");
    await fixtureGit(dir, "add", "-A");
    await fixtureGit(dir, "commit", "-q", "-m", "feat: land backend");
    const tip = await gitOut(dir, "rev-parse", "HEAD");
    await bumpPointers(fx.root, ID, [backend]);

    const run = newRun(ID, "Land backend", "done");
    run.tasks = [
      TaskState.parse({
        id: "1.1",
        title: "Land backend",
        repo: "backend",
        deps: [],
        touches: ["**"],
        status: "merged",
      }),
    ];
    run.branches = {
      backend: { branch: changeBranch(ID), base: sub.base },
      ".": { branch: changeBranch(ID), base: aiBase },
    };
    saveRun(fx.root, run);

    const out = await cli(fx.root, "land", ID);
    expect(out.code).toBe(ExitCode.Ok);
    expect(await gitOut(dir, "rev-parse", "HEAD")).toBe(tip);
    expect(await gitOut(dir, "branch", "--show-current")).toBe("main");
    expect(await gitOut(fx.root, "rev-parse", `HEAD:repos/backend`)).toBe(tip);
    expect(await gitOut(fx.root, "branch", "--show-current")).toBe("main");
    expect(
      await gitOut(dir, "rev-parse", "--verify", "--quiet", `refs/heads/${changeBranch(ID)}`),
    ).toBe("");
    expect(
      await gitOut(fx.root, "rev-parse", "--verify", "--quiet", `refs/heads/${changeBranch(ID)}`),
    ).toBe("");
  });
});
