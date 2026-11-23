/**
 * The TUI entry. Interactive mode reads the workspace through `Factory`, renders the run list and
 * run view, and restores the terminal from a `finally`. Replay builds the same model from a
 * recorded stream; `--once` renders one frame into an in-memory stdout and writes it out.
 */
import { execFile } from "node:child_process";
import process from "node:process";
import { type Factory, open, openReadOnly, type StatusDocument } from "@loomwright/core/factory";
import type { Io } from "@loomwright/core/io";
import type { RunState } from "@loomwright/core/state/run";
import type { RunEvent, RunSnapshot } from "@loomwright/protocol";
import { render, useApp, useInput } from "ink";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ExecResult, readApprover } from "./approval/identity.ts";
import {
  type ApprovalActionKind,
  type ApprovalEvidence,
  type ApprovalState,
  approvalAvailable,
  approvalExited,
  approvalForPhase,
  approvalKeys,
  approvalPanel,
  approvalProgress,
  approvalStarted,
} from "./approval/overlay.ts";
import {
  type ControlAction,
  confirmFor,
  confirmKeys,
  confirmPanel,
  landFor,
  resumeFor,
  retryFor,
} from "./controls/actions.ts";
import {
  type ActivityPaneState,
  activityPaneBodyRows,
  activityPaneKeys,
  activityPanePanel,
  openActivityPane,
} from "./controls/activity-pane.ts";
import {
  openQuestions,
  type QuestionsState,
  questionsKeys,
  questionsPanel,
  recordAnswerInState,
  withRecordedAnswer,
} from "./controls/questions.tsx";
import { openReword, type RewordState, rewordKeys, rewordPanel } from "./controls/reword.ts";
import { helpKeys, helpPanel } from "./help.ts";
import { type IntakeState, initialIntake, intakeKeys, intakePanel } from "./intake/dialog.tsx";
import { watchSpawn } from "./intake/follow.ts";
import {
  createLauncher,
  type LaunchAction,
  type Launcher,
  type LaunchResult,
  tailLog,
} from "./launch/launcher.ts";
import { collectFacts, type EventFacts } from "./model/facts.ts";
import { type FoldedRun, foldRun } from "./model/fold.ts";
import { applyKey, type KeyInput } from "./model/keys.ts";
import { createStatusPoller, type StatusPoller } from "./model/poll.ts";
import { createFrameScheduler, type FrameScheduler } from "./model/render-loop.ts";
import {
  buildViewModel,
  type Screen,
  type ViewModel,
  type ViewModelInput,
} from "./model/view-model.ts";
import { firstOffset, lastOffset, moveBy, nextOffset, pageSize } from "./model/viewport.ts";
import { type ReplayLoad, readReplayFile, replayModel } from "./replay/replay.ts";
import { createTerminalSession, type TerminalSession } from "./session.ts";
import { landedNotice } from "./strings.ts";
import { detectColorDepth, type TerminalEnv, terminalEnv } from "./theme/env.ts";
import { type GlyphSet, glyphsFor } from "./theme/glyphs.ts";
import type { ColorDepth } from "./theme/tokens.ts";
import { Frame, renderFrame } from "./views/frame.tsx";

export interface TuiOptions {
  /** Resolved workspace root; null when replaying a recording. */
  readonly workspace: string | null;
  readonly replay?: string;
  readonly once: boolean;
  readonly ascii: boolean;
  readonly columns?: number;
  readonly rows?: number;
  readonly out: (text: string) => void;
  /** The workspace path's TTY and abort signal; replay never touches it. */
  readonly io?: Io;
  /** Tests inject NO_COLOR / TERM / LANG and whether stdout is a TTY. */
  readonly env?: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  /** Tests inject a factory, launcher, terminal session and the intake `open`. */
  readonly factory?: Factory;
  readonly launcher?: Launcher;
  readonly session?: TerminalSession;
  /** Tests inject the intake `Factory.open` so its rejection can be driven. */
  readonly open?: typeof open;
  /**
   * Print every frame instead of rewriting the previous one. Ink only writes the last frame
   * when CI is set (the gates and GitHub Actions do), so tests that read a live screen need it.
   */
  readonly frames?: boolean;
}

/** The entry normalises the terminal size once; every rendered component gets both numbers. */
interface TerminalOptions extends TuiOptions {
  readonly columns: number;
  readonly rows: number;
}

interface ResolvedTheme {
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** One place resolves the theme for the live view, replay and the captured frames. */
function themeFor(options: TuiOptions): ResolvedTheme {
  const env = terminalEnv(options.env);
  return {
    glyphs: glyphsFor({ ascii: options.ascii, env }),
    depth: detectColorDepth(env, options.isTTY ?? process.stdout.isTTY === true),
  };
}

function keyName(
  input: string,
  key: {
    return: boolean;
    escape: boolean;
    upArrow: boolean;
    downArrow: boolean;
    pageUp: boolean;
    pageDown: boolean;
  },
): string {
  if (key.return) return "Enter";
  if (key.escape) return "Esc";
  if (key.upArrow) return "Up";
  if (key.downArrow) return "Down";
  if (key.pageUp) return "PgUp";
  if (key.pageDown) return "PgDn";
  return input;
}

/** One guard for every effect: a replayed view-model may never write or poll. */
export function isReadOnly(view: ViewModel): boolean {
  return view.source === "replay";
}

/** What a write key says in replay instead of doing anything. */
export const REPLAY_READ_ONLY = "this stream is replayed — read-only";

/** The keys that start a write in the live UI: intake, approvals, resume, abort, retry, answers. */
const REPLAY_WRITE_KEYS: ReadonlySet<string> = new Set([
  "n",
  "a",
  "A",
  "w",
  "R",
  "r",
  "x",
  "t",
  "l",
  "Q",
]);

export interface ReplayKeyOutcome {
  readonly quit: boolean;
  readonly notice: string | null;
  /** The help panel's next open state; null leaves it as it is. */
  readonly help: boolean | null;
}

/**
 * A replay consumes quit and help; every write key becomes the read-only notice, and `?` opens
 * help only where the footer advertises it (the approval overlay owns the screen otherwise).
 */
export function replayKey(view: ViewModel, input: string, key: KeyInput): ReplayKeyOutcome {
  // Ctrl-C quits before any panel, help included: the terminal must be restored on an interrupt.
  if (key.ctrl && input === "c") return { quit: true, notice: null, help: null };
  if (view.panel?.kind === "help") {
    const outcome = helpKeys(input, key);
    if (outcome === "quit") return { quit: true, notice: null, help: null };
    return { quit: false, notice: null, help: outcome === "close" ? false : null };
  }
  if (!key.ctrl && input === "q") return { quit: true, notice: null, help: null };
  if (!key.ctrl && input === "?" && view.footer.some((hint) => hint.key === "?")) {
    return { quit: false, notice: null, help: true };
  }
  if (isReadOnly(view) && REPLAY_WRITE_KEYS.has(input)) {
    return { quit: false, notice: REPLAY_READ_ONLY, help: null };
  }
  return { quit: false, notice: null, help: null };
}

/** The help panel over a replay view; the footer lists the panel's own keys while it is open. */
export function replayHelpView(view: ViewModel): ViewModel {
  const panel = helpPanel();
  return { ...view, panel, footer: panel.keys };
}

/** The activity pane over a replay view; it renders and scrolls, and has no write path. */
export function replayActivityView(
  view: ViewModel,
  state: ActivityPaneState,
  glyphs: GlyphSet,
): ViewModel {
  if (view.run === null) return view;
  const panel = activityPanePanel({ run: view.run, state, glyphs, rows: view.rows });
  return { ...view, panel, footer: panel.keys };
}

export interface UiData {
  readonly screen: Screen;
  readonly selectedRunId: string | null;
  readonly selectedTaskId: string | null;
  readonly columns: number;
  readonly rows: number;
  readonly status: StatusDocument;
  readonly runs: readonly RunState[];
  readonly snapshot: RunSnapshot | null;
  readonly facts: EventFacts;
  readonly notice: string | null;
  /** The requested run-list scroll offset; the model re-clamps it every build. */
  readonly listOffset?: number;
  /** The requested task-graph scroll offset; the model re-clamps it every build. */
  readonly taskOffset?: number;
  /** The new-run dialog, or null when no panel is open. */
  readonly intake: IntakeState | null;
  /** The approval overlay, or null when the selected run is not at the gate. */
  readonly approval: ApprovalState | null;
  /**
   * The user hid the overlay with Esc; the run view's coral banner stays. Optional so `UiData`
   * literals owned by other tasks stay valid; every reader normalises it with `=== true`.
   */
  readonly approvalCollapsed?: boolean;
  /** The questions pane, or null when it is closed. */
  readonly questions: QuestionsState | null;
  /**
   * The activity log pane, or null when it is closed. Optional so `UiData` literals owned by other
   * tasks stay valid; every reader normalises it with `?? null`.
   */
  readonly activity?: ActivityPaneState | null;
  /**
   * The reword panel, or null when it is closed. Optional so `UiData` literals owned by other
   * tasks stay valid; every reader normalises it with `?? null`.
   */
  readonly reword?: RewordState | null;
  /** The abort confirmation, or null when no confirmation is open. */
  readonly confirmation: ControlAction | null;
  /** The help panel is open; `?` sets it and Esc clears it. */
  readonly help: boolean;
  /** `git config user.email`; null until the overlay has read it once. */
  readonly identity: string | null;
  /** A zero-exit land whose refresh failed; the next successful poll settles it. */
  readonly pendingLand: string | null;
}

function selectedRunState(data: UiData): RunState | undefined {
  const id = data.selectedRunId;
  if (id === null) return undefined;
  return data.status.runs.find((run) => run.id === id) ?? data.runs.find((run) => run.id === id);
}

function grantedCommit(snapshot: RunSnapshot | null): string | null {
  const approval = snapshot?.approval ?? null;
  return approval === null || approval.approver === "" ? null : approval.specCommit;
}

function evidenceOf(data: UiData): ApprovalEvidence {
  return {
    // `null` means the async read has not resolved yet; only a real `""` is a missing identity.
    ...(data.identity === null ? {} : { identity: data.identity }),
    findings: selectedRunState(data)?.specFindings.length ?? 0,
    specCommit: grantedCommit(data.snapshot),
  };
}

/** Intake, questions, reword, help, the log pane and confirmations own the screen while open. */
function panelOpen(data: UiData): boolean {
  return (
    data.intake !== null ||
    data.questions !== null ||
    (data.reword ?? null) !== null ||
    data.confirmation !== null ||
    data.help ||
    (data.activity ?? null) !== null
  );
}

/**
 * Opens on the phase and advances a launch from the facts the stream now carries. Run state is
 * canonical: a tail snapshot can lag behind a phase another process already drove.
 */
export function syncApproval(data: UiData): UiData {
  if (data.screen !== "run" || data.selectedRunId === null) return data;
  const run = selectedRunState(data);
  const phase = run?.phase ?? data.snapshot?.phase ?? null;
  if (data.approval === null) {
    // A poll never steals an open panel; the next one opens the gate once the panel closes.
    if (panelOpen(data)) return data;
    if (phase === null) return data;
    const opened = approvalForPhase(phase, null);
    return opened === null
      ? data
      : { ...data, approval: opened, approvalCollapsed: false, identity: null };
  }
  // Another process may approve while the overlay sits idle: clear it once the run leaves the
  // gate, but keep a launch that is still waiting for its own outcome.
  if (
    (data.approval.kind === "idle" || data.approval.kind === "failed") &&
    phase !== null &&
    phase !== "awaiting-approval"
  ) {
    return { ...data, approval: null, approvalCollapsed: false };
  }
  if (data.approval.kind !== "waiting") return data;
  const next = approvalProgress(data.approval, {
    phase,
    granted: grantedCommit(data.snapshot) !== null,
  });
  if (next === data.approval) return data;
  return { ...data, approval: next.kind === "done" ? null : next, approvalCollapsed: false };
}

/**
 * The collapsed overlay is one key away: `a`/`A`/`R` reopen it and the next press confirms. Esc
 * leaves an actionable overlay but is inert while nothing can be done with it.
 */
export type ApprovalKeyRoute = "overlay" | "collapse" | "reopen" | "run";

export function approvalKeyRoute(
  data: Pick<UiData, "screen" | "approval" | "approvalCollapsed">,
  key: KeyInput,
  input: string,
): ApprovalKeyRoute {
  if (data.approval === null) return "run";
  if (data.screen !== "run") return "overlay";
  if (data.approvalCollapsed === true) {
    if (key.escape) return "overlay"; // already collapsed: the key goes nowhere
    if (!key.ctrl && (input === "a" || input === "A" || input === "R")) return "reopen";
    return "run";
  }
  if (key.escape && (data.approval.kind === "idle" || data.approval.kind === "failed")) {
    return "collapse";
  }
  return "overlay";
}

/**
 * `q` quits from every screen and panel, but a text field open over them owns printable keys: the
 * intake dialog, the answer composer and the reword prompt append a bare `q`. Ctrl-C always quits
 * so an interrupt still restores the terminal.
 */
export function quitsOnKey(
  data: Pick<UiData, "intake" | "questions" | "reword">,
  input: string,
  key: KeyInput,
): boolean {
  if (key.ctrl && input === "c") return true;
  if (key.ctrl || input !== "q") return false;
  return !(
    data.intake !== null ||
    data.questions?.focus === "composer" ||
    (data.reword ?? null) !== null
  );
}

export function viewOf(data: UiData, glyphs: GlyphSet): ViewModel {
  const baseInput: ViewModelInput = {
    source: "live",
    screen: data.screen,
    columns: data.columns,
    rows: data.rows,
    now: Date.now(),
    snapshot: data.snapshot,
    facts: data.facts,
    status: data.status,
    runs: data.runs,
    selectedRunId: data.selectedRunId,
    selectedTaskId: data.selectedTaskId,
    panel: null,
    notice: data.notice,
    listOffset: data.listOffset ?? 0,
    taskOffset: data.taskOffset ?? 0,
  };
  const base = buildViewModel(baseInput);
  const activity = data.activity ?? null;
  if (data.help) {
    return buildViewModel({ ...baseInput, panel: helpPanel() });
  }
  if (activity !== null && base.run !== null) {
    return buildViewModel({
      ...baseInput,
      panel: activityPanePanel({
        run: base.run,
        state: activity,
        glyphs,
        rows: data.rows,
      }),
    });
  }
  if (data.approval !== null && data.screen === "run" && data.approvalCollapsed !== true) {
    if (base.run === null) return base;
    const run = selectedRunState(data);
    const panel = approvalPanel({
      run: base.run,
      evidence: evidenceOf(data),
      state: data.approval,
      glyphs,
      ...(run?.draft === undefined ? {} : { draft: run.draft }),
    });
    return buildViewModel({ ...baseInput, panel });
  }
  const reword = data.reword ?? null;
  if (reword !== null && base.run !== null) {
    const panel = rewordPanel({
      run: base.run,
      state: reword,
      glyphs,
      rows: data.rows,
      columns: data.columns,
    });
    return buildViewModel({ ...baseInput, panel });
  }
  if (data.intake !== null) {
    return buildViewModel({ ...baseInput, panel: intakePanel(data.intake, glyphs, data.rows) });
  }
  if (data.questions !== null && base.run !== null) {
    return buildViewModel({
      ...baseInput,
      panel: questionsPanel({ run: base.run, state: data.questions, glyphs, rows: data.rows }),
    });
  }
  if (data.confirmation !== null) {
    return buildViewModel({ ...baseInput, panel: confirmPanel(data.confirmation, glyphs) });
  }
  return base;
}

function initialData(
  options: TerminalOptions,
  status: StatusDocument,
  runs: readonly RunState[],
  glyphs: GlyphSet,
): UiData {
  const base: UiData = {
    screen: "list",
    selectedRunId: null,
    selectedTaskId: null,
    columns: options.columns,
    rows: options.rows,
    status,
    runs,
    snapshot: null,
    facts: collectFacts([]),
    notice: null,
    listOffset: 0,
    taskOffset: 0,
    intake: null,
    approval: null,
    approvalCollapsed: false,
    questions: null,
    activity: null,
    reword: null,
    confirmation: null,
    help: false,
    identity: null,
    pendingLand: null,
  };
  // The list is newest first, so the first item is the run the list opens on.
  const view = viewOf(base, glyphs);
  return { ...base, selectedRunId: view.list[0]?.id ?? null };
}

/** The identity check's only process call; tests inject their own executor. */
function gitExec(args: readonly string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile("git", [...args], { cwd, encoding: "utf8" }, (error, stdout) => {
      if (error === null) {
        resolve({ code: 0, stdout });
        return;
      }
      resolve({ code: typeof error.code === "number" ? error.code : 1, stdout });
    });
  });
}

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

/** The one place the alternate screen and raw mode are entered and restored. */
export async function runInSession(input: SessionRun): Promise<void> {
  input.session.enter();
  try {
    await input.render();
  } finally {
    input.session.leave();
  }
}

interface InteractiveProps {
  readonly workspace: string;
  readonly factory: Factory;
  readonly launcher: Launcher;
  readonly open: typeof open;
  readonly initial: UiData;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

function Interactive({
  workspace,
  factory,
  launcher,
  open,
  initial,
  glyphs,
  depth,
}: InteractiveProps): ReactElement {
  const { exit } = useApp();
  const [data, setData] = useState<UiData>(initial);
  const view = useMemo(() => viewOf(data, glyphs), [data, glyphs]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dataRef = useRef(data);
  dataRef.current = data;
  const eventsRef = useRef<RunEvent[]>([]);
  /** The running projection; the events that built it are drained on every frame. */
  const foldRef = useRef<FoldedRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** The run ids seen before a spawn; the shared status poll compares each result against them. */
  const spawnBaseline = useRef<{
    readonly ids: ReadonlySet<string>;
    readonly logPath: string;
  } | null>(null);
  const schedulerRef = useRef<FrameScheduler | null>(null);
  const pollerRef = useRef<StatusPoller | null>(null);

  const stopTail = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** The frame's only state write: it folds the events arrived since the last flush and drops them. */
  const flushFrame = useCallback((): void => {
    const events = eventsRef.current;
    if (events.length === 0) return;
    eventsRef.current = [];
    const folded = foldRun(foldRef.current, events);
    foldRef.current = folded;
    setData((current) =>
      current.screen === "run" && current.selectedRunId !== null
        ? syncApproval({ ...current, snapshot: folded.snapshot, facts: folded.facts })
        : current,
    );
  }, []);

  useEffect(() => {
    const scheduler = createFrameScheduler({ render: flushFrame });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [flushFrame]);

  const appendTail = useCallback(
    async (id: string, fromSeq: number, signal: AbortSignal): Promise<void> => {
      for await (const item of factory.events(id, { fromSeq, follow: true, signal })) {
        if (signal.aborted) return;
        if (item.event === undefined) continue;
        eventsRef.current.push(item.event);
        const scheduler = schedulerRef.current;
        if (scheduler === null) flushFrame();
        else scheduler.request();
      }
    },
    [factory, flushFrame],
  );

  const openRun = useCallback(
    (id: string): void => {
      stopTail();
      eventsRef.current = [];
      foldRef.current = null;
      setData((current) => ({
        ...current,
        screen: "run",
        selectedRunId: id,
        selectedTaskId: null,
        snapshot: null,
        facts: collectFacts([]),
        notice: null,
        intake: null,
        approval: null,
        approvalCollapsed: false,
        questions: null,
        activity: null,
        reword: null,
        confirmation: null,
        help: false,
        identity: null,
      }));
      const load = async (): Promise<void> => {
        const controller = new AbortController();
        abortRef.current = controller;
        const events: RunEvent[] = [];
        for await (const item of factory.events(id, { follow: false })) {
          if (controller.signal.aborted) return;
          if (item.event !== undefined) events.push(item.event);
        }
        if (controller.signal.aborted) return;
        const folded = events.length === 0 ? null : foldRun(null, events);
        foldRef.current = folded;
        if (folded !== null) {
          setData((current) =>
            current.screen === "run" && current.selectedRunId === id
              ? syncApproval({ ...current, snapshot: folded.snapshot, facts: folded.facts })
              : current,
          );
        }
        // A queued run has no log yet: follow from 1 so its first events still reach the view.
        await appendTail(id, folded === null ? 1 : folded.snapshot.lastSeq + 1, controller.signal);
      };
      void load().catch((err: unknown) => {
        // An abort ends a tail normally; anything else is shown without breaking the frame.
        if (err instanceof Error && err.name === "AbortError") return;
        setData((current) => ({
          ...current,
          notice: err instanceof Error ? err.message : String(err),
        }));
      });
    },
    [appendTail, factory, stopTail],
  );

  /** Set before `open`, so two Enter events in one frame cannot both start a run. */
  const submitting = useRef(false);

  const submitAction = useCallback(
    (action: LaunchAction): void => {
      if (isReadOnly(viewRef.current) || submitting.current) return;
      submitting.current = true;
      void (async () => {
        try {
          await open(workspace);
        } catch (err: unknown) {
          submitting.current = false;
          const message = err instanceof Error ? err.message : String(err);
          setData((current) =>
            current.intake === null
              ? current
              : {
                  ...current,
                  intake: {
                    ...current.intake,
                    submitting: false,
                    error: `${message} — run \`loomwright init\``,
                  },
                },
          );
          return;
        }

        let result: LaunchResult;
        try {
          result = await launcher.launch(action);
        } catch (err: unknown) {
          submitting.current = false;
          const message = err instanceof Error ? err.message : String(err);
          setData((current) =>
            current.intake === null
              ? current
              : { ...current, intake: { ...current.intake, submitting: false, error: message } },
          );
          return;
        }

        // The run ids seen before the spawn let the shared poll find the new run; the spawn is the
        // one extra poll that does not wait for the next second.
        spawnBaseline.current = {
          ids: new Set(dataRef.current.status.runs.map((run) => run.id)),
          logPath: result.logPath,
        };
        pollerRef.current?.kick();
        setData((current) =>
          current.intake === null
            ? current
            : {
                ...current,
                intake: {
                  ...current.intake,
                  spawned: {
                    logPath: result.logPath,
                    displayPath: result.displayPath,
                    tail: tailLog(result.logPath),
                  },
                },
              },
        );

        // The dialog follows the spawn from the shared 1 s poll; it schedules nothing of its own.

        void result.exited.then(({ code }) => {
          if (code === null || code === 0) return;
          spawnBaseline.current = null;
          submitting.current = false;
          setData((current) =>
            current.intake === null
              ? current
              : {
                  ...current,
                  intake: {
                    ...current.intake,
                    submitting: false,
                    error: `exited with code ${code}`,
                    spawned:
                      current.intake.spawned === null
                        ? current.intake.spawned
                        : { ...current.intake.spawned, tail: tailLog(result.logPath) },
                  },
                },
          );
        });
      })();
    },
    [launcher, open, workspace],
  );

  const launchApproval = useCallback(
    (id: string, kind: ApprovalActionKind): void => {
      if (isReadOnly(viewRef.current)) return;
      let action: LaunchAction;
      switch (kind) {
        case "approve":
          action = { kind, id };
          break;
        case "approve-only":
          action = { kind, id };
          break;
        case "reapprove":
          action = { kind, id };
          break;
        default: {
          const unhandled: never = kind;
          throw new Error(`unknown approval action: ${String(unhandled)}`);
        }
      }
      void (async () => {
        let result: LaunchResult;
        try {
          result = await launcher.launch(action);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setData((current) =>
            current.approval === null
              ? current
              : {
                  ...current,
                  approval: { kind: "failed", action: kind, code: 1, tail: [message] },
                },
          );
          return;
        }
        pollerRef.current?.kick();
        setData((current) =>
          current.approval === null
            ? current
            : { ...current, approval: approvalStarted(current.approval, result.displayPath) },
        );
        void result.exited.then(({ code }) => {
          if (code === null || code === 0) return;
          const tail = tailLog(result.logPath, 10);
          setData((current) =>
            current.approval === null
              ? current
              : { ...current, approval: approvalExited(current.approval, code, tail) },
          );
        });
      })();
    },
    [launcher],
  );

  const refreshStatus = useCallback(async (): Promise<LandRefresh | null> => {
    try {
      const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
      const selected = dataRef.current.selectedRunId;
      if (selected !== null && !status.runs.some((run) => run.id === selected)) stopTail();
      const pending = spawnBaseline.current;
      if (pending === null) {
        setData((current) => settleLanding(syncApproval({ ...current, status, runs })));
        return { status, runs };
      }
      const watch = watchSpawn(pending.ids, status, pending.logPath, tailLog);
      if (watch.started !== null) {
        spawnBaseline.current = null;
        setData((current) => settleLanding(syncApproval({ ...current, status, runs })));
        openRun(watch.started);
        return { status, runs };
      }
      setData((current) => {
        const intake = current.intake;
        return settleLanding(
          syncApproval({
            ...current,
            status,
            runs,
            intake:
              intake === null || intake.spawned === null
                ? intake
                : { ...intake, spawned: { ...intake.spawned, tail: watch.tail } },
          }),
        );
      });
      return { status, runs };
    } catch {
      // A refresh failure keeps the last good status; the next poll retries.
      return null;
    }
  }, [factory, openRun, stopTail]);

  const answering = useRef(false);
  /** Answers already sent, per run, so a re-opened pane still reports them as recorded. */
  const recordedAnswers = useRef(new Map<string, ReadonlySet<string>>());

  /** Records the answer, then waits only for the short command write, never for the run. */
  const submitAnswer = useCallback(
    (id: string, rawQuestion: string, question: string, step: string, answer: string): void => {
      if (isReadOnly(viewRef.current) || answering.current) return;
      answering.current = true;
      void (async () => {
        try {
          await recordAnswer(factory, id, answer, rawQuestion);
          recordedAnswers.current.set(
            id,
            withRecordedAnswer(recordedAnswers.current.get(id) ?? new Set(), step, question),
          );
          const run = viewRef.current.run;
          setData((current) => {
            if (current.questions === null || run === null) return current;
            return {
              ...current,
              questions: recordAnswerInState(run, current.questions, step, question, current.rows),
            };
          });
          await refreshStatus();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setData((current) =>
            current.questions === null
              ? current
              : { ...current, questions: { ...current.questions, notice: message } },
          );
        } finally {
          answering.current = false;
        }
      })();
    },
    [factory, refreshStatus],
  );

  /** Abort and retry return immediately; resume runs one guarded detached child per run. */
  const resumeGuard = useRef<ResumeGuard>(createResumeGuard());
  const rewordGuard = useRef<ResumeGuard>(createResumeGuard());
  const landGuard = useRef<LandGuard>(createLandGuard());
  const applyControl = useCallback(
    (action: ControlAction): void => {
      if (isReadOnly(viewRef.current)) return;
      if (action.kind === "resume") {
        startResume(
          {
            factory,
            launcher,
            guard: resumeGuard.current,
            update: setData,
            refresh: async () => {
              await refreshStatus();
            },
          },
          action.id,
        );
        return;
      }
      if (action.kind === "land") {
        startLand(
          {
            factory,
            launcher,
            guard: landGuard.current,
            update: setData,
            refresh: refreshStatus,
            stopTail,
          },
          action.id,
        );
        return;
      }
      void (async () => {
        try {
          await performControl({ factory, launcher }, action);
          await refreshStatus();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setData((current) => ({ ...current, notice: message }));
        }
      })();
    },
    [factory, launcher, refreshStatus, stopTail],
  );

  useEffect(() => {
    if (isReadOnly(viewRef.current)) return;
    const poller = createStatusPoller({
      poll: async () => {
        await refreshStatus();
      },
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      pollerRef.current = null;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const onResize = (): void => {
      setData((current) => ({
        ...current,
        columns: process.stdout.columns ?? current.columns,
        rows: process.stdout.rows ?? current.rows,
      }));
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useEffect(() => () => stopTail(), [stopTail]);

  // Read the identity once per overlay opening; a missing email disables the approval actions.
  const approvalOpen = data.approval !== null;
  useEffect(() => {
    if (isReadOnly(viewRef.current) || !approvalOpen || data.identity !== null) return;
    let cancelled = false;
    void readApprover(workspace, gitExec).then((identity) => {
      if (cancelled) return;
      setData((current) => (current.identity === null ? { ...current, identity } : current));
    });
    return () => {
      cancelled = true;
    };
  }, [approvalOpen, data.identity, workspace]);

  // This handler closes over the current render, so it is new every time; Ink re-runs its
  // `useInput` effect for a new function and can drop a key pressed inside that window. Keep the
  // subscription on one stable function and route it to the latest handler through a ref.
  const keyHandler = useRef<(input: string, key: KeyInput) => void>(() => {});
  keyHandler.current = (input, key) => {
    const state = dataRef.current;
    if (quitsOnKey(state, input, key)) {
      exit();
      return;
    }
    if (state.approval !== null) {
      // A panel opened from the collapsed run view owns the keys; nothing would reopen there.
      const route =
        state.approvalCollapsed === true && panelOpen(state)
          ? "run"
          : approvalKeyRoute(state, key, input);
      if (route === "collapse") {
        setData((current) => ({ ...current, approvalCollapsed: true }));
        return;
      }
      if (route === "reopen") {
        setData((current) => ({ ...current, approvalCollapsed: false }));
        return;
      }
      if (route === "overlay") {
        const run = selectedRunState(state);
        if (run !== undefined) {
          const outcome = approvalKeys(
            state.approval,
            input,
            key,
            approvalAvailable(evidenceOf(state)),
          );
          if (outcome.state !== state.approval) {
            setData((current) => ({ ...current, approval: outcome.state }));
          }
          if (outcome.launch !== undefined) launchApproval(run.id, outcome.launch);
          if (outcome.resume === true) applyControl({ kind: "resume", id: run.id });
        }
        return;
      }
      // Collapsed and not an approval key: the run keys own it again.
    }
    if (state.intake !== null) {
      if (key.escape) {
        spawnBaseline.current = null;
        setData((current) => ({ ...current, intake: null }));
        return;
      }
      const outcome = intakeKeys(state.intake, input, key, {
        cwd: workspace,
        workspace,
        status: state.status,
      });
      setData((current) => ({ ...current, intake: outcome.state }));
      if (outcome.submit !== undefined) submitAction(outcome.submit);
      return;
    }
    if (state.questions !== null) {
      const run = viewRef.current.run;
      if (run !== null) {
        const outcome = questionsKeys(run, state.questions, input, key, state.rows);
        if (outcome.close === true) {
          setData((current) => ({ ...current, questions: null }));
          return;
        }
        if (outcome.state !== state.questions) {
          setData((current) => ({ ...current, questions: outcome.state }));
        }
        if (outcome.answer !== undefined) {
          const record = run.questions[state.questions.selected];
          submitAnswer(
            run.id,
            outcome.answer.rawQuestion,
            outcome.answer.question,
            record?.step ?? "",
            outcome.answer.answer,
          );
        }
      }
      return;
    }
    if (state.confirmation !== null) {
      const result = confirmKeys(input, key);
      if (result === "cancel") {
        setData((current) => ({ ...current, confirmation: null }));
        return;
      }
      if (result === "confirm") {
        const action = state.confirmation;
        setData((current) => ({ ...current, confirmation: null }));
        applyControl(action);
      }
      return;
    }
    if (state.help) {
      const outcome = helpKeys(input, key);
      if (outcome === "close") {
        setData((current) => ({ ...current, help: false }));
        return;
      }
      if (outcome === "quit") exit();
      return;
    }
    const activity = state.activity ?? null;
    if (activity !== null) {
      const run = viewRef.current.run;
      if (run === null) {
        setData((current) => ({ ...current, activity: null }));
        return;
      }
      const outcome = activityPaneKeys(run, activity, input, key, activityPaneBodyRows(state.rows));
      if (outcome.close === true) {
        setData((current) => ({ ...current, activity: null }));
        return;
      }
      if (outcome.state !== activity) {
        setData((current) => ({ ...current, activity: outcome.state }));
      }
      return;
    }
    const reword = state.reword ?? null;
    if (reword !== null) {
      const run = viewRef.current.run;
      if (run === null) {
        setData((current) => ({ ...current, reword: null }));
        return;
      }
      const outcome = rewordKeys(run, reword, input, key, state.rows, state.columns);
      if (outcome.close === true) {
        setData((current) => ({ ...current, reword: null }));
        return;
      }
      if (outcome.state !== reword) {
        setData((current) => ({ ...current, reword: outcome.state }));
      }
      if (outcome.launch !== undefined) {
        startReword(
          { launcher, guard: rewordGuard.current, update: setData },
          run.id,
          outcome.launch.prompt,
        );
      }
      return;
    }
    // The panel owns its keys, so its intent lives here: `w` is inert or absent without
    // `run.reword`, and the panel reads that predicate instead of re-deriving it.
    if (!key.ctrl && input === "w" && !panelOpen(state) && state.screen === "run") {
      const run = viewRef.current.run;
      if (run !== null) {
        switch (run.reword.state) {
          case "available": {
            const opened = openReword(run);
            if (opened !== null) setData((current) => ({ ...current, reword: opened }));
            return;
          }
          case "inert":
            setData((current) => ({ ...current, notice: run.reword.reason }));
            return;
          case "absent":
            return;
          default: {
            const unhandled: never = run.reword.state;
            throw new Error(`unknown reword state: ${String(unhandled)}`);
          }
        }
      }
    }
    if (!key.ctrl && input === "n") {
      submitting.current = false;
      setData((current) => ({ ...current, intake: initialIntake }));
      return;
    }
    const current = viewRef.current;
    // At one pane `Enter` on a run opens its first task; at two panes the detail is already shown.
    if (key.return && current.screen === "run" && current.run?.selectedTaskId === null) {
      const first = current.run?.tasks[0];
      if (first !== undefined) {
        setData((state) => ({ ...state, selectedTaskId: first.id }));
        return;
      }
    }
    const intent = applyKey(current, keyName(input, key));
    switch (intent.kind) {
      case "quit":
        exit();
        return;
      case "help":
        setData((state) => ({ ...state, help: true }));
        return;
      case "open-run":
        openRun(intent.runId);
        return;
      case "open-questions": {
        const run = current.run;
        const questions =
          run === null
            ? null
            : openQuestions(run, recordedAnswers.current.get(run.id) ?? new Set());
        if (questions !== null) {
          setData((state) => ({ ...state, questions, confirmation: null }));
        }
        return;
      }
      case "open-activity": {
        const run = current.run;
        if (run !== null) {
          setData((state) => ({ ...state, activity: openActivityPane(run) }));
        }
        return;
      }
      case "abort": {
        const action = confirmFor(current);
        if (action !== null) {
          setData((state) => ({ ...state, confirmation: action, questions: null }));
        }
        return;
      }
      case "retry": {
        const action = retryFor(current);
        if (action !== null) {
          setData((state) => ({ ...state, confirmation: null }));
          applyControl(action);
        }
        return;
      }
      case "resume": {
        const action = resumeFor(current);
        if (action !== null) {
          setData((state) => ({ ...state, confirmation: null }));
          applyControl(action);
        }
        return;
      }
      case "land": {
        const action = landConfirmation(current, landGuard.current);
        if (action !== null) {
          setData((state) => ({ ...state, confirmation: action, questions: null }));
        }
        return;
      }
      case "clear-task":
        setData((state) => ({ ...state, selectedTaskId: null }));
        return;
      case "back":
        stopTail();
        eventsRef.current = [];
        foldRef.current = null;
        setData((state) => ({
          ...state,
          activity: null,
          screen: "list",
          selectedTaskId: null,
          snapshot: null,
          facts: collectFacts([]),
          notice: null,
          approval: null,
          approvalCollapsed: false,
          questions: null,
          reword: null,
          confirmation: null,
          help: false,
          identity: null,
        }));
        return;
      case "next-run":
      case "prev-run": {
        const items = current.list;
        const index = items.findIndex((item) => item.id === current.selectedRunId);
        const step = intent.kind === "next-run" ? 1 : -1;
        const probe = index === -1 ? 0 : index + step;
        const clamped = Math.min(items.length - 1, Math.max(0, probe));
        const next = items[clamped];
        if (next !== undefined) {
          const offset = nextOffset(
            current.listWindow.offset,
            clamped,
            items.length,
            current.listWindow.size,
          );
          setData((state) => ({
            ...state,
            selectedRunId: next.id,
            selectedTaskId: null,
            listOffset: offset,
          }));
        }
        return;
      }
      case "next-task":
      case "prev-task": {
        const tasks = current.run?.tasks ?? [];
        if (tasks.length === 0) return;
        const index = tasks.findIndex((task) => task.selected);
        const step = intent.kind === "next-task" ? 1 : -1;
        const probe = index === -1 ? 0 : index + step;
        const clamped = Math.min(tasks.length - 1, Math.max(0, probe));
        const next = tasks[clamped];
        if (next !== undefined) {
          const offset = nextOffset(
            current.taskWindow.offset,
            clamped,
            tasks.length,
            current.taskWindow.size,
          );
          setData((state) => ({ ...state, selectedTaskId: next.id, taskOffset: offset }));
        }
        return;
      }
      case "page-up":
      case "page-down":
        if (current.screen === "list") {
          const items = current.list;
          if (items.length === 0) return;
          const size = current.listWindow.size;
          const step = pageSize(size) * (intent.kind === "page-down" ? 1 : -1);
          const index = items.findIndex((item) => item.id === current.selectedRunId);
          const clamped = Math.min(
            items.length - 1,
            Math.max(0, (index === -1 ? 0 : index) + step),
          );
          const next = items[clamped];
          if (next !== undefined) {
            const offset = moveBy(current.listWindow.offset, step, items.length, size);
            setData((state) => ({
              ...state,
              selectedRunId: next.id,
              selectedTaskId: null,
              listOffset: offset,
            }));
          }
          return;
        }
        {
          const tasks = current.run?.tasks ?? [];
          if (tasks.length === 0) return;
          const size = current.taskWindow.size;
          const step = pageSize(size) * (intent.kind === "page-down" ? 1 : -1);
          const index = tasks.findIndex((task) => task.selected);
          const clamped = Math.min(
            tasks.length - 1,
            Math.max(0, (index === -1 ? 0 : index) + step),
          );
          const next = tasks[clamped];
          if (next !== undefined) {
            const offset = moveBy(current.taskWindow.offset, step, tasks.length, size);
            setData((state) => ({ ...state, selectedTaskId: next.id, taskOffset: offset }));
          }
          return;
        }
      case "first":
      case "last":
        if (current.screen === "list") {
          const items = current.list;
          if (items.length === 0) return;
          const index = intent.kind === "first" ? 0 : items.length - 1;
          const next = items[index];
          if (next !== undefined) {
            const offset =
              intent.kind === "first"
                ? firstOffset(items.length)
                : lastOffset(items.length, current.listWindow.size);
            setData((state) => ({
              ...state,
              selectedRunId: next.id,
              selectedTaskId: null,
              listOffset: offset,
            }));
          }
          return;
        }
        {
          const tasks = current.run?.tasks ?? [];
          if (tasks.length === 0) return;
          const index = intent.kind === "first" ? 0 : tasks.length - 1;
          const next = tasks[index];
          if (next !== undefined) {
            const offset =
              intent.kind === "first"
                ? firstOffset(tasks.length)
                : lastOffset(tasks.length, current.taskWindow.size);
            setData((state) => ({ ...state, selectedTaskId: next.id, taskOffset: offset }));
          }
          return;
        }
      default:
        return;
    }
  };
  useInput(useCallback((input: string, key: KeyInput): void => keyHandler.current(input, key), []));

  return <Frame viewModel={view} glyphs={glyphs} depth={depth} />;
}

export interface ReplayViewOptions {
  readonly now: number;
  readonly ascii: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly env?: TerminalEnv;
}

/** The same view-model the live entry builds, with the approval panel driven by the stream. */
export function replayView(load: ReplayLoad, options: ReplayViewOptions): ViewModel {
  const model = replayModel(load, options.now);
  const glyphs = glyphsFor({ ascii: options.ascii, env: options.env ?? {} });
  const input: ViewModelInput = {
    source: "replay",
    screen: "run",
    columns: options.columns,
    rows: options.rows,
    now: options.now,
    snapshot: model.snapshot,
    facts: model.facts,
    status: model.status,
    runs: [model.run],
    selectedRunId: model.run.id,
    selectedTaskId: null,
    panel: null,
    notice: null,
  };
  const base = buildViewModel(input);
  // The phase drives the overlay; an older stream without `approval.pending` still shows it.
  if (base.run === null || model.snapshot.phase !== "awaiting-approval") return base;
  const panel = approvalPanel({
    run: base.run,
    evidence: { findings: 0, specCommit: null },
    state: { kind: "idle" },
    glyphs,
  });
  return buildViewModel({ ...input, panel: { ...panel, notice: "replay: read-only" } });
}

interface ReplayProps {
  readonly view: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

function Replay({ view, glyphs, depth }: ReplayProps): ReactElement {
  const { exit } = useApp();
  const [notice, setNotice] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [activity, setActivity] = useState<ActivityPaneState | null>(null);
  const base = useMemo(() => (notice === null ? view : { ...view, notice }), [view, notice]);
  const withActivity = activity === null ? base : replayActivityView(base, activity, glyphs);
  const current = help ? replayHelpView(withActivity) : withActivity;
  const currentRef = useRef(current);
  currentRef.current = current;

  useInput((input, key) => {
    const running = currentRef.current;
    if (activity === null && !help && !key.ctrl && input === "L" && running.run !== null) {
      setActivity(openActivityPane(running.run));
      return;
    }
    if (activity !== null && running.run !== null) {
      const outcome = activityPaneKeys(
        running.run,
        activity,
        input,
        key,
        activityPaneBodyRows(running.rows),
      );
      if (outcome.close === true) {
        setActivity(null);
        return;
      }
      if (outcome.state !== activity) {
        setActivity(outcome.state);
        return;
      }
    }
    const outcome = replayKey(running, input, key);
    if (outcome.quit) {
      exit();
      return;
    }
    if (outcome.notice !== null) setNotice(outcome.notice);
    if (outcome.help !== null) setHelp(outcome.help);
  });

  return <Frame viewModel={current} glyphs={glyphs} depth={depth} />;
}

async function runReplay(options: TerminalOptions, replay: string): Promise<number> {
  const { glyphs, depth } = themeFor(options);
  const env = terminalEnv(options.env);
  const load = await readReplayFile(replay);
  const view = replayView(load, {
    now: Date.now(),
    ascii: options.ascii,
    columns: options.columns,
    rows: options.rows,
    env,
  });
  if (options.once) {
    options.out(
      await renderFrame(
        view,
        { columns: options.columns, rows: options.rows },
        { ascii: options.ascii, env },
      ),
    );
    return 0;
  }

  const session = options.session ?? createTerminalSession(process.stdin, process.stdout);
  const offSignal = session.onSignal(() => {
    session.leave();
    process.exit(0);
  });
  try {
    await runInSession({
      session,
      render: async () => {
        const instance = render(<Replay view={view} glyphs={glyphs} depth={depth} />, {
          stdout: process.stdout,
          stdin: process.stdin,
          patchConsole: false,
          exitOnCtrlC: false,
          debug: options.frames === true,
        });
        await instance.waitUntilExit();
      },
    });
  } finally {
    offSignal();
  }
  return 0;
}

/** Opens the UI and resolves with the process exit code. */
export async function runTui(options: TuiOptions): Promise<number> {
  const terminal: TerminalOptions = {
    ...options,
    columns: options.columns ?? 80,
    rows: options.rows ?? 24,
  };
  if (options.replay !== undefined) return runReplay(terminal, options.replay);
  if (options.once) throw new Error("tui: --once needs --replay");
  if (options.workspace === null) throw new Error("tui: a workspace or --replay is required");
  const workspace = options.workspace;

  // Read-only: the run list must open without the install marker (`open` is for intake, 1.5).
  const factory = options.factory ?? (await openReadOnly(workspace));
  const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
  const { glyphs, depth } = themeFor(terminal);
  const initial = initialData(terminal, status, runs, glyphs);
  const session = options.session ?? createTerminalSession(process.stdin, process.stdout);
  const offSignal = session.onSignal(() => {
    session.leave();
    process.exit(0);
  });
  const signal = options.io?.signal;
  const onAbort = (): void => {
    session.leave();
    process.exit(0);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await runInSession({
      session,
      render: async () => {
        const instance = render(
          <Interactive
            workspace={workspace}
            factory={factory}
            launcher={options.launcher ?? createLauncher({ workspace })}
            open={options.open ?? open}
            initial={initial}
            glyphs={glyphs}
            depth={depth}
          />,
          {
            stdout: process.stdout,
            stdin: process.stdin,
            patchConsole: false,
            exitOnCtrlC: false,
            debug: options.frames === true,
          },
        );
        await instance.waitUntilExit();
      },
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    offSignal();
  }
  return 0;
}
