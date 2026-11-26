import type { ActivityLine } from "./view-model.ts";

/** A task as the scope table needs it: its id and the repo run state gave it. */
export interface ScopeTask {
  readonly id: string;
  readonly repo: string;
}

export type ActivityScope =
  | { readonly kind: "run" }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "repo"; readonly repo: string };

const REVIEW_PREFIX = "review:";
const EXPLORE_PREFIX = "explore:";

function scopeKey(scope: ActivityScope): string {
  switch (scope.kind) {
    case "run":
      return "run";
    case "task":
      return `task:${scope.taskId}`;
    case "repo":
      return `repo:${scope.repo}`;
    default: {
      const unhandled: never = scope;
      throw new Error(`unknown activity scope: ${String(unhandled)}`);
    }
  }
}

/**
 * Every scope a line belongs to: a task id to its task and its repo, `review:`/`explore:` and a
 * repo-named step to that repo, every other step to the run.
 */
export function scopesOfLine(
  tasks: readonly ScopeTask[],
  line: ActivityLine,
): readonly ActivityScope[] {
  const step = line.step;
  const task = tasks.find((candidate) => candidate.id === step);
  if (task !== undefined) {
    const scopes: ActivityScope[] = [{ kind: "task", taskId: task.id }];
    // A task whose repo is empty has only its own scope, never a shared empty one.
    if (task.repo !== "") scopes.push({ kind: "repo", repo: task.repo });
    return scopes;
  }
  for (const prefix of [REVIEW_PREFIX, EXPLORE_PREFIX]) {
    if (!step.startsWith(prefix)) continue;
    const repo = step.slice(prefix.length);
    if (repo !== "") return [{ kind: "repo", repo }];
  }
  if (step !== "" && tasks.some((candidate) => candidate.repo === step))
    return [{ kind: "repo", repo: step }];
  return [{ kind: "run" }];
}

/** The task's own scope: its id, and nothing its repo also owns. */
export function taskScopeFor(task: ScopeTask): readonly ActivityScope[] {
  return [{ kind: "task", taskId: task.id }];
}

/** The lines of one scope, oldest first, keeping every line's own `step` label. */
export function linesInScope(
  tasks: readonly ScopeTask[],
  lines: readonly ActivityLine[],
  scope: ActivityScope,
): readonly ActivityLine[] {
  switch (scope.kind) {
    case "run":
      return lines;
    case "task": {
      const task = tasks.find((candidate) => candidate.id === scope.taskId);
      const wanted: readonly ActivityScope[] =
        task === undefined ? [{ kind: "task", taskId: scope.taskId }] : taskScopeFor(task);
      const keys = new Set(wanted.map(scopeKey));
      return lines.filter((line) =>
        scopesOfLine(tasks, line).some((lineScope) => keys.has(scopeKey(lineScope))),
      );
    }
    case "repo":
      return lines.filter((line) =>
        scopesOfLine(tasks, line).some(
          (lineScope) => lineScope.kind === "repo" && lineScope.repo === scope.repo,
        ),
      );
    default: {
      const unhandled: never = scope;
      throw new Error(`unknown activity scope: ${String(unhandled)}`);
    }
  }
}

/** The scopes the run can name, in Tab order: run, then the given task, then its repo. */
export function scopesFor(tasks: readonly ScopeTask[]): readonly ActivityScope[] {
  const scopes: ActivityScope[] = [{ kind: "run" }];
  const repos = new Set<string>();
  for (const task of tasks) {
    scopes.push({ kind: "task", taskId: task.id });
    if (task.repo === "" || repos.has(task.repo)) continue;
    repos.add(task.repo);
    scopes.push({ kind: "repo", repo: task.repo });
  }
  return scopes;
}
