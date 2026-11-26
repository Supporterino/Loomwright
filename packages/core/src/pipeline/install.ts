import type { RepoConfig } from "../config/schema.ts";
import { type InstallStep, installDeps } from "../gates/install.ts";
import type { Pipeline } from "./context.ts";

export interface InstallOutcome {
  readonly steps: readonly InstallStep[];
  /** The first failed step, when the install failed. */
  readonly failure?: InstallStep;
}

/**
 * The one install-with-progress path: task worktrees call it with the task id, the full suite
 * with the repo name. Shared caches and frozen-lockfile commands live in `installDeps`.
 */
export async function installFor(
  p: Pipeline,
  step: string,
  repo: RepoConfig,
  dir: string,
): Promise<InstallOutcome> {
  const started = p.progress.now();
  if (p.bound) p.events.emit("install.started", { step, repo: repo.name });
  else p.progress.install(step, repo.name, "start");

  const steps = await (p.deps.install ?? installDeps)(p.root, dir, repo);
  const failure = steps.find((s) => s.status === "failed");
  const durationMs = p.progress.now() - started;

  if (failure !== undefined) {
    const detail = failure.detail ?? failure.dir;
    if (p.bound) p.events.emit("install.failed", { step, repo: repo.name, durationMs, detail });
    else p.progress.install(step, repo.name, "failed", durationMs, detail);
    return { steps, failure };
  }

  if (p.bound) p.events.emit("install.finished", { step, repo: repo.name, durationMs });
  else p.progress.install(step, repo.name, "done", durationMs);
  return { steps };
}
