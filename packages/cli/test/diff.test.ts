import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode } from "@loomwright/core/exit-codes";
import { changeBranch } from "@loomwright/core/git/repo";
import { newRun, saveRun, TaskState } from "@loomwright/core/state/run";
import {
  createSingleRepoFixture,
  createSubmoduleFixture,
  type Fixture,
  fixtureGit,
} from "../../../test/fixtures/workspaces.ts";
import { cli, gitOut } from "../../../test/helpers.ts";

const ID = "add-health";

/** File content that would clear the screen and write the clipboard if printed raw. */
const HOSTILE =
  'export const clear = "\u001b[2J";\nexport const clip = "\u001b]52;c;SGVsbG8=\u0007";\n';

function task(id: string, repo: string): TaskState {
  return TaskState.parse({
    id,
    title: `Change ${repo}`,
    repo,
    deps: [],
    touches: ["**"],
    status: "merged",
  });
}

async function singleRepoChange(
  fx: Fixture,
  content = "export const landed = true;\n",
): Promise<string> {
  expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
  const base = await gitOut(fx.root, "rev-parse", "HEAD");
  await fixtureGit(fx.root, "switch", "-q", "-c", changeBranch(ID));
  writeFileSync(join(fx.root, "src/landed.ts"), content);
  await fixtureGit(fx.root, "add", "-A");
  await fixtureGit(fx.root, "commit", "-q", "-m", "feat: land the change");
  await fixtureGit(fx.root, "switch", "-q", "main");
  const run = newRun(ID, "Land the change", "done");
  run.tasks = [task("1.1", "app")];
  run.branches = { app: { branch: changeBranch(ID), base } };
  saveRun(fx.root, run);
  return base;
}

async function submoduleChange(fx: Fixture): Promise<void> {
  expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
  const backend = join(fx.root, "repos/backend");
  const base = await gitOut(backend, "rev-parse", "HEAD");
  await fixtureGit(backend, "switch", "-q", "-c", changeBranch(ID));
  writeFileSync(join(backend, "landed.go"), "package main\n");
  await fixtureGit(backend, "add", "-A");
  await fixtureGit(backend, "commit", "-q", "-m", "feat: backend change");
  await fixtureGit(backend, "switch", "-q", "main");
  const run = newRun(ID, "Add health", "done");
  run.tasks = [task("1.1", "backend"), task("1.2", "frontend")];
  run.branches = { backend: { branch: changeBranch(ID), base } };
  saveRun(fx.root, run);
}

describe("diff", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
  });
  afterEach(() => fx.cleanup());

  test("the default prints a patch", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "diff", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain(`diff ${ID}`);
    expect(run.out).toContain("app:");
    expect(run.out).toContain("main");
    expect(run.out).toContain(changeBranch(ID));
    expect(run.out).toContain("+++ b/src/landed.ts");
  });

  test("text mode strips terminal controls from the patch", async () => {
    await singleRepoChange(fx, HOSTILE);
    const run = await cli(fx.root, "diff", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).not.toContain("\u001b");
    expect(run.out).not.toContain("\u0007");
    expect(run.out).toContain("[2J");
    expect(run.out).toContain("]52;c;SGVsbG8=");
  });

  test("--json keeps the patch raw for machines", async () => {
    await singleRepoChange(fx, HOSTILE);
    const run = await cli(fx.root, "diff", ID, "--json");
    expect(run.code).toBe(ExitCode.Ok);
    const result = JSON.parse(run.out) as { repos: { patch: string }[] };
    const patch = result.repos[0]?.patch ?? "";
    expect(patch).toContain("\u001b[2J");
    expect(patch).toContain("\u001b]52;c;SGVsbG8=");
  });

  test("--stat prints counts", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "diff", ID, "--stat");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("src/landed.ts +1 -0");
    expect(run.out).not.toContain("+++ b/");
  });

  test("--json prints the result", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "diff", ID, "--json");
    expect(run.code).toBe(ExitCode.Ok);
    const result = JSON.parse(run.out) as {
      id: string;
      repos: Record<string, unknown>[];
    };
    expect(result.id).toBe(ID);
    expect(result.repos).toHaveLength(1);
    const row = result.repos[0];
    if (row === undefined) throw new Error("no repo row in the diff");
    for (const key of ["repo", "target", "branch", "status", "files", "patch"])
      expect(row).toHaveProperty(key);
  });

  test("an unknown repo is a usage error", async () => {
    await singleRepoChange(fx);
    const run = await cli(fx.root, "diff", ID, "--repo", "nope");
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.err).toContain("unknown repo");
    expect(run.err).toContain("app");
  });

  test("an unknown change is a precondition error", async () => {
    expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
    const run = await cli(fx.root, "diff", "no-such-change");
    expect(run.code).toBe(ExitCode.Precondition);
    expect(run.err).toContain("no change");
  });

  test("a missing branch does not fail the command", async () => {
    await singleRepoChange(fx);
    await fixtureGit(fx.root, "branch", "-D", changeBranch(ID));
    const run = await cli(fx.root, "diff", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("no change branch");
  });

  test("the read is read-only", async () => {
    await singleRepoChange(fx);
    const branch = await gitOut(fx.root, "rev-parse", "--abbrev-ref", "HEAD");
    const status = await gitOut(fx.root, "status", "--porcelain");
    const refs = await gitOut(fx.root, "for-each-ref", "--format=%(refname) %(objectname)");

    expect((await cli(fx.root, "diff", ID)).code).toBe(ExitCode.Ok);

    expect(await gitOut(fx.root, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    expect(await gitOut(fx.root, "status", "--porcelain")).toBe(status);
    expect(await gitOut(fx.root, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(refs);
  });
});

describe("diff with submodules", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSubmoduleFixture();
  });
  afterEach(() => fx.cleanup());

  test("--repo restricts the output", async () => {
    await submoduleChange(fx);
    const run = await cli(fx.root, "diff", ID, "--repo", "backend");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("backend:");
    expect(run.out).not.toContain("frontend");
  });

  test("a missing change branch is reported, not thrown, when the base is gone too", async () => {
    await submoduleChange(fx);
    const frontend = join(fx.root, "repos/frontend");
    await fixtureGit(frontend, "switch", "-q", "--detach");
    await fixtureGit(frontend, "branch", "-D", "main");
    await fixtureGit(frontend, "update-ref", "-d", "refs/remotes/origin/main");

    const run = await cli(fx.root, "diff", ID);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("no change branch");
    expect(run.out).toContain("(missing)");
    expect(run.out).toContain("backend:");
    expect(run.out).toContain("+++ b/landed.go");
  });

  test("--repo does not resolve the other repos' base branches", async () => {
    await submoduleChange(fx);
    // Break the frontend's base: the filtered read must not resolve it.
    const frontend = join(fx.root, "repos/frontend");
    await fixtureGit(frontend, "switch", "-q", "--detach");
    await fixtureGit(frontend, "branch", "-D", "main");
    await fixtureGit(frontend, "update-ref", "-d", "refs/remotes/origin/main");

    const run = await cli(fx.root, "diff", ID, "--repo", "backend");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("backend:");
    expect(run.out).not.toContain("frontend");
  });
});
