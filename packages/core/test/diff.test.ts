import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createSingleRepoFixture,
  createSubmoduleFixture,
  type Fixture,
  fixtureGit,
  writeFiles,
} from "../../../test/fixtures/workspaces.ts";
import { cli, gitOut } from "../../../test/helpers.ts";
import { loadConfig } from "../src/config/load.ts";
import { PreconditionError } from "../src/errors.ts";
import { ExitCode } from "../src/exit-codes.ts";
import { changeBranch } from "../src/git/repo.ts";
import { type ChangeDiff, changeDiff, type DiffRepoResult } from "../src/pipeline/diff.ts";
import { newRun, saveRun, TaskState } from "../src/state/run.ts";

const ID = "add-health";

function result(diff: ChangeDiff, name: string): DiffRepoResult {
  const found = diff.repos.find((repo) => repo.repo === name);
  if (found === undefined) throw new Error(`no ${name} result in the diff`);
  return found;
}

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

/** A done run whose repos are the ones the change touched. */
function saveDoneRun(
  root: string,
  repos: Readonly<Record<string, { branch: string; base: string }>>,
): void {
  const run = newRun(ID, "Add health", "done");
  run.tasks = Object.keys(repos)
    .filter((name) => name !== "ai")
    .map((name, i) => task(`1.${i + 1}`, name));
  run.branches = repos;
  saveRun(root, run);
}

/** Adds one commit on `change/<id>` in `dir`, then returns to `main`. */
async function commitOnChange(
  dir: string,
  files: Readonly<Record<string, string>>,
  message: string,
): Promise<string> {
  await fixtureGit(dir, "switch", "-q", "-c", changeBranch(ID));
  writeFiles(dir, files);
  await fixtureGit(dir, "add", "-A");
  await fixtureGit(dir, "commit", "-q", "-m", message);
  const tip = await gitOut(dir, "rev-parse", "HEAD");
  await fixtureGit(dir, "switch", "-q", "main");
  return tip;
}

describe("change diff", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
    expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
  });
  afterEach(() => fx.cleanup());

  test("a single repo reports its committed change", async () => {
    const base = await gitOut(fx.root, "rev-parse", "HEAD");
    await commitOnChange(
      fx.root,
      { "src/health.ts": "export const health = true;\n" },
      "feat: add health",
    );
    saveDoneRun(fx.root, { app: { branch: changeBranch(ID), base } });

    const branchBefore = await gitOut(fx.root, "rev-parse", "--abbrev-ref", "HEAD");
    const refsBefore = await gitOut(fx.root, "for-each-ref", "--format=%(refname) %(objectname)");
    const diff = await changeDiff(fx.root, loadConfig(fx.root).config, ID);

    expect(diff.id).toBe(ID);
    expect(diff.repos).toHaveLength(1);
    const app = result(diff, "app");
    expect(app.status).toBe("diff");
    expect(app.target).toBe("main");
    expect(app.branch).toBe(changeBranch(ID));
    expect(app.patch).toContain("+++ b/src/health.ts");
    const health = app.files.find((file) => file.path === "src/health.ts");
    if (health === undefined) throw new Error("src/health.ts missing from the file rows");
    expect(health.added).toBe(1);
    expect(health.deleted).toBe(0);

    expect(await gitOut(fx.root, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branchBefore);
    expect(await gitOut(fx.root, "for-each-ref", "--format=%(refname) %(objectname)")).toBe(
      refsBefore,
    );
    expect(await gitOut(fx.root, "status", "--porcelain")).toBe("");
  });

  test("a change branch with no commits is empty", async () => {
    const base = await gitOut(fx.root, "rev-parse", "HEAD");
    await fixtureGit(fx.root, "switch", "-q", "-c", changeBranch(ID));
    await fixtureGit(fx.root, "switch", "-q", "main");
    // Not `done`: only `land` requires a finished change.
    const run = newRun(ID, "Add health", "implementing");
    run.tasks = [task("1.1", "app")];
    run.branches = { app: { branch: changeBranch(ID), base } };
    saveRun(fx.root, run);

    const app = result(await changeDiff(fx.root, loadConfig(fx.root).config, ID), "app");
    expect(app.status).toBe("empty");
    expect(app.files).toHaveLength(0);
    expect(app.patch).toBe("");
  });

  test("an unknown change is a precondition error", async () => {
    const config = loadConfig(fx.root).config;
    let caught: unknown;
    try {
      await changeDiff(fx.root, config, "no-such-change");
    } catch (err: unknown) {
      caught = err;
    }
    if (!(caught instanceof PreconditionError))
      throw new Error(`expected PreconditionError, got ${String(caught)}`);
    expect(caught.message).toContain("no-such-change");
    expect(caught.exitCode).toBe(ExitCode.Precondition);
  });

  test("the diff uses the merge base, not the base tip", async () => {
    const base = await gitOut(fx.root, "rev-parse", "HEAD");
    await commitOnChange(
      fx.root,
      { "src/health.ts": "export const health = true;\n" },
      "feat: add health",
    );
    writeFiles(fx.root, { "src/unrelated.ts": "export const unrelated = true;\n" });
    await fixtureGit(fx.root, "add", "-A");
    await fixtureGit(fx.root, "commit", "-q", "-m", "chore: move main");
    const baseTip = await gitOut(fx.root, "rev-parse", "HEAD");
    expect(baseTip).not.toBe(base);
    saveDoneRun(fx.root, { app: { branch: changeBranch(ID), base } });

    const app = result(await changeDiff(fx.root, loadConfig(fx.root).config, ID), "app");
    expect(app.status).toBe("diff");
    expect(app.patch).toContain("+++ b/src/health.ts");
    expect(app.patch).not.toContain("src/unrelated.ts");
    expect(app.files.map((file) => file.path)).not.toContain("src/unrelated.ts");
  });
});

describe("change diff with submodules", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSubmoduleFixture();
    expect((await cli(fx.root, "init", "--no-graph")).code).toBe(ExitCode.Ok);
  });
  afterEach(() => fx.cleanup());

  test("a missing change branch is reported, not thrown", async () => {
    const backend = join(fx.root, "repos/backend");
    const backendBase = await gitOut(backend, "rev-parse", "HEAD");
    await commitOnChange(backend, { "landed.go": "package main\n" }, "feat: backend change");
    const run = newRun(ID, "Add health", "done");
    run.tasks = [task("1.1", "backend"), task("1.2", "frontend")];
    run.branches = { backend: { branch: changeBranch(ID), base: backendBase } };
    saveRun(fx.root, run);

    // The missing frontend branch must not stop the other repos from being read.
    const diff = await changeDiff(fx.root, loadConfig(fx.root).config, ID);
    expect(diff.repos.map((repo) => repo.repo)).toEqual(["backend", "frontend", "ai"]);
    expect(result(diff, "backend").status).toBe("diff");
    const frontend = result(diff, "frontend");
    expect(frontend.status).toBe("missing");
    expect(frontend.files).toHaveLength(0);
    expect(frontend.patch).toBe("");
  });

  test("a submodule layout diffs every touched repo", async () => {
    const backend = join(fx.root, "repos/backend");
    const frontend = join(fx.root, "repos/frontend");
    const aiBase = await gitOut(fx.root, "rev-parse", "HEAD");
    const backendBase = await gitOut(backend, "rev-parse", "HEAD");
    const frontendBase = await gitOut(frontend, "rev-parse", "HEAD");

    await fixtureGit(backend, "switch", "-q", "-c", changeBranch(ID));
    writeFiles(backend, { "landed.go": "package main\n" });
    await fixtureGit(backend, "add", "-A");
    await fixtureGit(backend, "commit", "-q", "-m", "feat: backend change");
    const backendTip = await gitOut(backend, "rev-parse", "HEAD");

    await fixtureGit(frontend, "switch", "-q", "-c", changeBranch(ID));
    writeFiles(frontend, { "src/health.ts": "export const health = true;\n" });
    await fixtureGit(frontend, "add", "-A");
    await fixtureGit(frontend, "commit", "-q", "-m", "feat: frontend change");
    const frontendTip = await gitOut(frontend, "rev-parse", "HEAD");

    // The AI repo's change picks up the moved backend gitlink.
    await fixtureGit(fx.root, "switch", "-q", "-c", changeBranch(ID));
    await fixtureGit(fx.root, "add", "repos/backend");
    await fixtureGit(fx.root, "commit", "-q", "-m", "chore: bump backend");
    const aiTip = await gitOut(fx.root, "rev-parse", "HEAD");
    await fixtureGit(fx.root, "switch", "-q", "main");
    await fixtureGit(backend, "switch", "-q", "main");
    await fixtureGit(frontend, "switch", "-q", "main");

    saveDoneRun(fx.root, {
      backend: { branch: changeBranch(ID), base: backendBase },
      frontend: { branch: changeBranch(ID), base: frontendBase },
      ai: { branch: changeBranch(ID), base: aiBase },
    });

    const diff = await changeDiff(fx.root, loadConfig(fx.root).config, ID);
    expect(diff.repos).toHaveLength(3);
    expect(result(diff, "backend").patch).toContain("+++ b/landed.go");
    expect(result(diff, "frontend").patch).toContain("+++ b/src/health.ts");
    const ai = result(diff, "ai");
    expect(ai.status).toBe("diff");
    expect(ai.patch).toContain("repos/backend");

    // Nothing was merged or moved: every base is where it was and every change branch stays.
    expect(await gitOut(fx.root, "rev-parse", "main")).toBe(aiBase);
    expect(await gitOut(backend, "rev-parse", "main")).toBe(backendBase);
    expect(await gitOut(frontend, "rev-parse", "main")).toBe(frontendBase);
    expect(await gitOut(fx.root, "rev-parse", changeBranch(ID))).toBe(aiTip);
    expect(await gitOut(backend, "rev-parse", changeBranch(ID))).toBe(backendTip);
    expect(await gitOut(frontend, "rev-parse", changeBranch(ID))).toBe(frontendTip);
    expect(await gitOut(fx.root, "branch", "--show-current")).toBe("main");
  });
});
