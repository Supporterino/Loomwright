/**
 * The TUI's control orchestration: one place for the in-process effects, the per-run resume and
 * one-at-a-time land guards, and the resume, land and reword state transitions. No Ink or React,
 * so the controls suites drive it with a fake launcher and factory.
 */
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import type { RunState } from "@loomwright/core/state/run";
import { approvalExited } from "../approval/overlay.ts";
import { type ControlAction, landFor } from "../controls/actions.ts";
import { type Launcher, type LaunchResult, tailLog } from "../launch/launcher.ts";
import type { TerminalSession } from "../session.ts";
import { landedNotice } from "../strings.ts";
import { collectFacts } from "./facts.ts";
import type { UiData } from "./ui-data.ts";
import type { ViewModel } from "./view-model.ts";

export interface ControlDeps {
  readonly factory: Pick<Factory, "abort" | "retry">;
  readonly launcher: Pick<Launcher, "launch">;
}

type LaunchedAction = Extract<ControlAction, { readonly kind: "resume" | "land" }>;

/**
 * The only in-process control effects: abort and retry return after writing run state, and
 * resume and land are detached children. Nothing here waits for a pipeline phase; a child is
 * handed back so the caller can watch its exit.
 */
export function performControl(deps: ControlDeps, action: LaunchedAction): Promise<LaunchResult>;
export function performControl(
  deps: ControlDeps,
  action: ControlAction,
): Promise<LaunchResult | null>;
export async function performControl(
  deps: ControlDeps,
  action: ControlAction,
): Promise<LaunchResult | null> {
  switch (action.kind) {
    case "abort":
      await deps.factory.abort(action.id);
      return null;
    case "retry":
      await deps.factory.retry(action.id, action.taskId);
      return null;
    case "resume":
      return deps.launcher.launch({ kind: "resume", id: action.id });
    case "land":
      return deps.launcher.launch({ kind: "land", id: action.id });
    default: {
      const unhandled: never = action;
      throw new Error(`unknown control action: ${String(unhandled)}`);
    }
  }
}

/** One detached resume per run at a time: `r` is easy to double-tap. */
export interface ResumeGuard {
  /** True when the id may launch; false while its child is still in flight. */
  begin(id: string): boolean;
  /** True while that id's child is still in flight. */
  has(id: string): boolean;
  end(id: string): void;
}

export function createResumeGuard(): ResumeGuard {
  const inFlight = new Set<string>();
  return {
    begin(id: string): boolean {
      if (inFlight.has(id)) return false;
      inFlight.add(id);
      return true;
    },
    has(id: string): boolean {
      return inFlight.has(id);
    },
    end(id: string): void {
      inFlight.delete(id);
    },
  };
}

/**
 * One land for the whole UI: every land merges in the same checkout, so a child landing one run
 * must block a start for another.
 */
export interface LandGuard {
  /** True when no land child is in flight. */
  begin(): boolean;
  /** True while a land child is in flight. */
  has(): boolean;
  end(): void;
}

export function createLandGuard(): LandGuard {
  let inFlight = false;
  return {
    begin(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    has(): boolean {
      return inFlight;
    },
    end(): void {
      inFlight = false;
    },
  };
}

/** The launcher's half a control keeps while its child runs: the log to tail and how to show it. */
type SpawnLog = Pick<LaunchResult, "logPath" | "displayPath">;

/** Every long action names its child's log, so a hung or failed child can be found from the UI. */
function spawnLogLine(displayPath: string): string {
  return `spawn log: ${displayPath}`;
}

/**
 * The launch is in flight: the log path is visible at once. A resume started from the approve-only
 * wait keeps that overlay read-only but points its log line at the resume child's own log.
 */
export function resumeStarted(data: UiData, id: string, displayPath: string): UiData {
  const notice = `resume ${id} — ${spawnLogLine(displayPath)}`;
  const approval = data.approval;
  if (approval?.kind === "waiting") {
    return { ...data, notice, approval: { ...approval, logPath: displayPath } };
  }
  return { ...data, notice };
}

/** A non-zero resume exit: the approval overlay shows it when open, a notice otherwise. */
export function resumeFailed(data: UiData, id: string, spawn: SpawnLog, code: number): UiData {
  const tail = tailLog(spawn.logPath, 10);
  const failed = data.approval === null ? null : approvalExited(data.approval, code, tail);
  if (failed !== null && failed !== data.approval) return { ...data, approval: failed };
  return {
    ...data,
    notice: [
      `resume ${id} exited with code ${code}`,
      spawnLogLine(spawn.displayPath),
      ...tail,
    ].join("\n"),
  };
}

/** The launch is in flight: a notice keeps the land child's log path on screen until it settles. */
export function landStarted(data: UiData, id: string, displayPath: string): UiData {
  return { ...data, notice: `land ${id} — ${spawnLogLine(displayPath)}`, pendingLand: null };
}

/** The reword child is in flight: the open panel shows its log path; without one, a notice. */
export function rewordStarted(data: UiData, id: string, displayPath: string): UiData {
  const log = spawnLogLine(displayPath);
  const reword = data.reword ?? null;
  return reword === null
    ? { ...data, notice: `reword ${id} — ${log}` }
    : { ...data, reword: { ...reword, notice: log, failure: null } };
}

/** A non-zero reword exit: the panel shows the code and tail and becomes actionable again. */
export function rewordFailed(data: UiData, id: string, spawn: SpawnLog, code: number): UiData {
  const tail = tailLog(spawn.logPath, 10);
  const reword = data.reword ?? null;
  if (reword !== null) {
    return {
      ...data,
      reword: {
        ...reword,
        notice: null,
        failure: { code, lines: tail, logPath: spawn.displayPath },
      },
    };
  }
  return {
    ...data,
    notice: [
      `reword ${id} exited with code ${code}`,
      spawnLogLine(spawn.displayPath),
      ...tail,
    ].join("\n"),
  };
}

/** A zero-exit reword: the panel closes and the child's log path stays as the run notice. */
export function rewordSucceeded(data: UiData, id: string, displayPath: string): UiData {
  return {
    ...data,
    reword: null,
    notice: `reword ${id} — ${spawnLogLine(displayPath)}`,
  };
}

export interface RewordRun {
  readonly launcher: Pick<Launcher, "launch">;
  /** One detached reword per run at a time; the panel's confirm is inert while it runs. */
  readonly guard: ResumeGuard;
  /** The UI's `setData`. */
  readonly update: (change: (data: UiData) => UiData) => void;
}

/**
 * Starts one detached `reword` and watches its exit: the panel is read-only while the child
 * runs, a zero exit closes it and a non-zero exit shows the code and log tail in the panel.
 */
export function startReword(deps: RewordRun, id: string, prompt?: string): void {
  if (!deps.guard.begin(id)) return;
  const text = prompt?.trim() ?? "";
  void (async () => {
    let result: LaunchResult;
    try {
      result = await deps.launcher.launch({
        kind: "reword",
        id,
        ...(text === "" ? {} : { prompt: text }),
      });
    } catch (err: unknown) {
      deps.guard.end(id);
      const message = err instanceof Error ? err.message : String(err);
      deps.update((current) => {
        const reword = current.reword ?? null;
        return reword === null
          ? { ...current, notice: message }
          : { ...current, reword: { ...reword, notice: message } };
      });
      return;
    }
    deps.update((current) => rewordStarted(current, id, result.displayPath));
    void result.exited.then(({ code }) => {
      deps.guard.end(id);
      if (code === 0) {
        deps.update((current) => rewordSucceeded(current, id, result.displayPath));
        return;
      }
      if (code === null) return;
      deps.update((current) => rewordFailed(current, id, result, code));
    });
  })();
}

export interface ResumeRun extends ControlDeps {
  readonly guard: ResumeGuard;
  /** The UI's `setData`. */
  readonly update: (change: (data: UiData) => UiData) => void;
  readonly refresh: () => Promise<void>;
}

/**
 * Starts one detached `resume` and watches its exit: a repeat while the child runs is ignored,
 * and a non-zero exit is shown with the log tail instead of looking successful.
 */
export function startResume(deps: ResumeRun, id: string): void {
  if (!deps.guard.begin(id)) return;
  void (async () => {
    let result: LaunchResult;
    try {
      result = await performControl(deps, { kind: "resume", id });
    } catch (err: unknown) {
      deps.guard.end(id);
      const message = err instanceof Error ? err.message : String(err);
      deps.update((current) => ({ ...current, notice: message }));
      return;
    }
    deps.update((current) => resumeStarted(current, id, result.displayPath));
    void result.exited.then(({ code }) => {
      deps.guard.end(id);
      if (code === null || code === 0) return;
      deps.update((current) => resumeFailed(current, id, result, code));
    });
    try {
      await deps.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      deps.update((current) => ({ ...current, notice: message }));
    }
  })();
}

/** A non-zero land exit: the code, the child's log path and the last ten lines, never a success claim. */
export function landFailed(data: UiData, id: string, spawn: SpawnLog, code: number): UiData {
  const tail = tailLog(spawn.logPath, 10);
  return {
    ...data,
    notice: [`land ${id} exited with code ${code}`, spawnLogLine(spawn.displayPath), ...tail].join(
      "\n",
    ),
    pendingLand: null,
  };
}

/** The refreshed status and run list a finished land reports against. */
export interface LandRefresh {
  readonly status: StatusDocument;
  readonly runs: readonly RunState[];
}

/**
 * A zero-exit land: the refreshed status decides. A run still listed means the child left it
 * unfinished, so it stays selected with its branches; only an absent run returns to the list.
 */
export function landSettled(data: UiData, id: string, refreshed: LandRefresh): UiData {
  const next: UiData = {
    ...data,
    status: refreshed.status,
    runs: refreshed.runs,
    pendingLand: null,
    activity: null,
    approvalCollapsed: false,
  };
  if (refreshed.status.runs.some((run) => run.id === id)) return next;
  return {
    ...next,
    screen: "list",
    selectedRunId: null,
    selectedTaskId: null,
    snapshot: null,
    facts: collectFacts([]),
    notice: landedNotice(id),
    intake: null,
    approval: null,
    approvalCollapsed: false,
    questions: null,
    activity: null,
    reword: null,
    confirmation: null,
    help: false,
    identity: null,
  };
}

/**
 * A successful poll completes a zero-exit land whose refresh failed: when that run is still
 * selected, an absent run returns to the list with the landed notice and a listed one keeps its
 * selection. A selection the user moved to is left alone.
 */
export function settleLanding(data: UiData): UiData {
  const id = data.pendingLand;
  if (id === null) return data;
  if (data.selectedRunId !== id) return { ...data, pendingLand: null };
  return landSettled(data, id, { status: data.status, runs: data.runs });
}

export interface LandRun extends ControlDeps {
  readonly guard: LandGuard;
  /** The UI's `setData`. */
  readonly update: (change: (data: UiData) => UiData) => void;
  /** Refreshes `status()` and `listRuns()`; null when the refresh failed. */
  readonly refresh: () => Promise<LandRefresh | null>;
  readonly stopTail: () => void;
}

/**
 * Starts one detached `land` and watches its exit: a repeat while a child runs — for any run — is
 * ignored, a zero exit returns to the list when the refreshed status no longer lists the run, and a
 * failure shows the code and log tail without claiming the change landed.
 */
export function startLand(deps: LandRun, id: string): void {
  if (!deps.guard.begin()) return;
  void (async () => {
    let result: LaunchResult;
    try {
      result = await performControl(deps, { kind: "land", id });
    } catch (err: unknown) {
      deps.guard.end();
      const message = err instanceof Error ? err.message : String(err);
      deps.update((current) => ({ ...current, notice: message }));
      return;
    }
    deps.update((current) => landStarted(current, id, result.displayPath));
    void result.exited.then(({ code }) => {
      deps.guard.end();
      if (code === null) {
        const tail = tailLog(result.logPath, 10);
        deps.update((current) => ({
          ...current,
          notice: [
            `land ${id} ended without an exit code`,
            spawnLogLine(result.displayPath),
            ...tail,
          ].join("\n"),
          pendingLand: null,
        }));
        return;
      }
      if (code !== 0) {
        deps.update((current) => landFailed(current, id, result, code));
        return;
      }
      // A failed refresh must not strand the run: retry once, then the next poll settles this id.
      deps.update((current) => ({ ...current, pendingLand: id }));
      const settle = (refreshed: LandRefresh): void => {
        deps.update((current) => landSettled(current, id, refreshed));
        if (!refreshed.status.runs.some((run) => run.id === id)) deps.stopTail();
      };
      void deps.refresh().then((refreshed) => {
        if (refreshed !== null) {
          settle(refreshed);
          return;
        }
        void deps.refresh().then((retry) => {
          if (retry !== null) settle(retry);
        });
      });
    });
    // The spawn is the one extra poll that does not wait for the next second.
    try {
      await deps.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      deps.update((current) => ({ ...current, notice: message }));
    }
  })();
}

/** The land confirmation; null while a land child is in flight, so a second land cannot start. */
export function landConfirmation(viewModel: ViewModel, guard: LandGuard): ControlAction | null {
  const action = landFor(viewModel);
  if (action === null || guard.has()) return null;
  return action;
}

/** `Factory.answer` writes the command inbox and returns; the run is not waited for. */
export async function recordAnswer(
  factory: Pick<Factory, "answer">,
  changeId: string,
  answer: string,
  question: string,
): Promise<void> {
  await factory.answer(changeId, answer, question);
}

export interface SessionRun {
  readonly session: TerminalSession;
  /** Resolves when the UI quits and rejects when rendering throws. */
  readonly render: () => Promise<void>;
}
