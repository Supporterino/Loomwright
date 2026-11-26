import type { FactoryConfig, RepoConfig } from "../config/schema.ts";
import type { RunState } from "../state/run.ts";
import { trackedBranch } from "./branching.ts";
import { refExists } from "./repo.ts";

const refs = {
  local: (branch: string): string => `refs/heads/${branch}`,
  remote: (branch: string): string => `refs/remotes/origin/${branch}`,
};

/**
 * The repos a change touched: every repo named by a task or by `run.branches`, plus the AI
 * repo (`path === "."`) last.
 */
export function reposFor(config: FactoryConfig, run: RunState): RepoConfig[] {
  const names = new Set([...run.tasks.map((task) => task.repo), ...Object.keys(run.branches)]);
  const touched = config.repos.filter((repo) => repo.path !== "." && names.has(repo.name));
  const ai = config.repos.find((repo) => repo.path === ".");
  return [...touched, ...(ai === undefined ? [] : [ai])];
}

/** The branch a change is compared to and merged into: a submodule's tracked branch, else its default. */
export async function baseBranch(root: string, repo: RepoConfig): Promise<string> {
  const tracked = repo.path === "." ? undefined : await trackedBranch(root, repo.path);
  return tracked ?? repo.defaultBranch ?? "main";
}

/** The branch's local ref when it exists, else its origin ref, else undefined. */
export async function targetRef(dir: string, branch: string): Promise<string | undefined> {
  if (await refExists(dir, refs.local(branch))) return refs.local(branch);
  if (await refExists(dir, refs.remote(branch))) return refs.remote(branch);
  return undefined;
}
