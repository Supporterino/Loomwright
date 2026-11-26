import { join } from "node:path";
import type { FactoryConfig } from "../config/schema.ts";
import { PreconditionError } from "../errors.ts";
import { gitOk } from "../exec.ts";
import { baseBranch, reposFor, targetRef } from "../git/change-repos.ts";
import { changeBranch, refExists } from "../git/repo.ts";
import { loadRun } from "../state/run.ts";

export type DiffStatus = "diff" | "empty" | "missing";

export interface DiffFile {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
}

export interface DiffRepoResult {
  readonly repo: string;
  readonly path: string;
  readonly target: string;
  readonly branch: string;
  readonly status: DiffStatus;
  readonly files: readonly DiffFile[];
  readonly patch: string;
}

export interface ChangeDiff {
  readonly id: string;
  readonly repos: readonly DiffRepoResult[];
}

/** How much of each repo to read. */
export interface ChangeDiffOptions {
  /** Only this repo; a repo the change did not touch yields no row. */
  readonly repo?: string;
  /** Read only the per-file counts and skip the patch. */
  readonly stat?: boolean;
}

const refs = {
  local: (branch: string): string => `refs/heads/${branch}`,
};

/** `-` is git's binary marker; a binary file has no line counts. */
const count = (value: string): number => (value === "-" ? 0 : Number(value));

/** `added<TAB>deleted<TAB>path` per line; the path stays exactly as git prints it. */
function parseNumstat(out: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [added, deleted, ...path] = line.split("\t");
    if (added === undefined || deleted === undefined || path.length === 0) continue;
    files.push({ path: path.join("\t"), added: count(added), deleted: count(deleted) });
  }
  return files;
}

/**
 * Read a change's committed diff per touched repo, from each repo's land base. Read-only: only
 * `git diff`/`rev-parse` reads, so the checkout's branch and refs are unchanged. Works while the
 * change is still in progress; only `land` needs the `done` phase. `options.repo` skips every
 * other repo (its base is never resolved); `options.stat` skips the patch read.
 */
export async function changeDiff(
  root: string,
  config: FactoryConfig,
  id: string,
  options: ChangeDiffOptions = {},
): Promise<ChangeDiff> {
  const run = loadRun(root, id);
  if (run === undefined) throw new PreconditionError(`no change ${id} in this workspace`);

  const branch = changeBranch(id);
  const repos: DiffRepoResult[] = [];
  for (const repo of reposFor(config, run)) {
    if (options.repo !== undefined && repo.name !== options.repo) continue;
    const dir = join(root, repo.path);
    const target = await baseBranch(root, repo);
    const base = await targetRef(dir, target);
    if (base === undefined)
      throw new PreconditionError(`base branch ${target} not found in ${dir}`, [
        "fetch it, or set defaultBranch on the repo in factory.config.jsonc",
      ]);
    const result = { repo: repo.name, path: repo.path, target, branch };
    if (!(await refExists(dir, refs.local(branch)))) {
      repos.push({ ...result, status: "missing", files: [], patch: "" });
      continue;
    }
    // Three dots: against the merge base, so commits that landed on the base after branching
    // do not show up as part of the change.
    const range = `${base}...${branch}`;
    const patch =
      options.stat === true
        ? ""
        : await gitOk(["diff", "--no-ext-diff", "--no-color", "--unified=3", range], { cwd: dir });
    const files = parseNumstat(await gitOk(["diff", "--numstat", range], { cwd: dir }));
    repos.push({
      ...result,
      status: files.length === 0 && patch === "" ? "empty" : "diff",
      files,
      patch,
    });
  }
  return { id, repos };
}
