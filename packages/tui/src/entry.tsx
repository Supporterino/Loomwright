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
  resumeFor,
  retryFor,
} from "./controls/actions.ts";
import {
  openQuestions,
  type QuestionsState,
  questionsKeys,
  questionsPanel,
} from "./controls/questions.tsx";
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
import { type ReplayLoad, readReplayFile, replayModel } from "./replay/replay.ts";
import { createTerminalSession, type TerminalSession } from "./session.ts";
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
  /** Tests inject a factory, launcher and terminal session. */
  readonly factory?: Factory;
  readonly launcher?: Launcher;
  readonly session?: TerminalSession;
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
  key: { return: boolean; escape: boolean; upArrow: boolean; downArrow: boolean },
): string {
  if (key.return) return "Enter";
  if (key.escape) return "Esc";
  if (key.upArrow) return "Up";
  if (key.downArrow) return "Down";
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
  "Q",
]);

export interface ReplayKeyOutcome {
  readonly quit: boolean;
  readonly notice: string | null;
}

/** A replay consumes only quit; every write key becomes the read-only notice. */
export function replayKey(view: ViewModel, input: string, key: KeyInput): ReplayKeyOutcome {
  if (key.ctrl && input === "c") return { quit: true, notice: null };
  if (!key.ctrl && input === "q") return { quit: true, notice: null };
  if (isReadOnly(view) && REPLAY_WRITE_KEYS.has(input)) {
    return { quit: false, notice: REPLAY_READ_ONLY };
  }
  return { quit: false, notice: null };
}

interface UiData {
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
  /** The new-run dialog, or null when no panel is open. */
  readonly intake: IntakeState | null;
  /** The approval overlay, or null when the selected run is not at the gate. */
  readonly approval: ApprovalState | null;
  /** The questions pane, or null when it is closed. */
  readonly questions: QuestionsState | null;
  /** The abort confirmation, or null when no confirmation is open. */
  readonly confirmation: ControlAction | null;
  /** `git config user.email`; null until the overlay has read it once. */
  readonly identity: string | null;
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
    identity: data.identity ?? "",
    findings: selectedRunState(data)?.specFindings.length ?? 0,
    specCommit: grantedCommit(data.snapshot),
  };
}

/** Opens on the phase and advances a launch from the facts the stream now carries. */
function syncApproval(data: UiData): UiData {
  if (data.screen !== "run" || data.selectedRunId === null) return data;
  const run = selectedRunState(data);
  const phase = data.snapshot?.phase ?? run?.phase ?? null;
  if (data.approval === null) {
    if (phase === null) return data;
    const opened = approvalForPhase(phase, null);
    return opened === null ? data : { ...data, approval: opened, identity: null };
  }
  if (data.approval.kind !== "waiting") return data;
  const next = approvalProgress(data.approval, {
    phase,
    granted: grantedCommit(data.snapshot) !== null,
  });
  if (next === data.approval) return data;
  return { ...data, approval: next.kind === "done" ? null : next };
}

function viewOf(data: UiData, glyphs: GlyphSet): ViewModel {
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
  };
  const base = buildViewModel(baseInput);
  if (data.approval !== null && data.screen === "run") {
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
  if (data.intake !== null) {
    return buildViewModel({ ...baseInput, panel: intakePanel(data.intake, glyphs) });
  }
  if (data.questions !== null && base.run !== null) {
    return buildViewModel({
      ...baseInput,
      panel: questionsPanel({ run: base.run, state: data.questions, glyphs }),
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
    intake: null,
    approval: null,
    questions: null,
    confirmation: null,
    identity: null,
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

/**
 * The only in-process control effects: abort and retry return after writing run state, and
 * resume is a detached child. Nothing here waits for a pipeline phase.
 */
export async function performControl(deps: ControlDeps, action: ControlAction): Promise<void> {
  switch (action.kind) {
    case "abort":
      await deps.factory.abort(action.id);
      return;
    case "retry":
      await deps.factory.retry(action.id, action.taskId);
      return;
    case "resume":
      await deps.launcher.launch({ kind: "resume", id: action.id });
      return;
    default: {
      const unhandled: never = action;
      throw new Error(`unknown control action: ${String(unhandled)}`);
    }
  }
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
  readonly initial: UiData;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

function Interactive({
  workspace,
  factory,
  launcher,
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
        questions: null,
        confirmation: null,
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
        if (events.length === 0 || controller.signal.aborted) return;
        const folded = foldRun(null, events);
        foldRef.current = folded;
        setData((current) =>
          current.screen === "run" && current.selectedRunId === id
            ? syncApproval({ ...current, snapshot: folded.snapshot, facts: folded.facts })
            : current,
        );
        await appendTail(id, folded.snapshot.lastSeq + 1, controller.signal);
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

  const submitAction = useCallback(
    (action: LaunchAction): void => {
      if (isReadOnly(viewRef.current)) return;
      void (async () => {
        try {
          await open(workspace);
        } catch (err: unknown) {
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
    [launcher, workspace],
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
        case "reword":
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
            : { ...current, approval: approvalStarted(current.approval) },
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

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
      const pending = spawnBaseline.current;
      if (pending === null) {
        setData((current) => syncApproval({ ...current, status, runs }));
        return;
      }
      const watch = watchSpawn(pending.ids, status, pending.logPath, tailLog);
      if (watch.started !== null) {
        spawnBaseline.current = null;
        setData((current) => syncApproval({ ...current, status, runs }));
        openRun(watch.started);
        return;
      }
      setData((current) => {
        const intake = current.intake;
        return syncApproval({
          ...current,
          status,
          runs,
          intake:
            intake === null || intake.spawned === null
              ? intake
              : { ...intake, spawned: { ...intake.spawned, tail: watch.tail } },
        });
      });
    } catch {
      // A refresh failure keeps the last good status; the next poll retries.
    }
  }, [factory, openRun]);

  const answering = useRef(false);

  /** Records the answer, then waits only for the short command write, never for the run. */
  const submitAnswer = useCallback(
    (id: string, question: string, answer: string): void => {
      if (isReadOnly(viewRef.current) || answering.current) return;
      answering.current = true;
      void (async () => {
        try {
          await recordAnswer(factory, id, answer, question);
          setData((current) => {
            const questions = current.questions;
            if (questions === null || questions.draft === null) return current;
            return {
              ...current,
              questions: {
                ...questions,
                draft: { ...questions.draft, recorded: true },
                notice: null,
              },
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

  /** Abort and retry return immediately; resume is a detached child. Never a whole phase. */
  const applyControl = useCallback(
    (action: ControlAction): void => {
      if (isReadOnly(viewRef.current)) return;
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
    [factory, launcher, refreshStatus],
  );

  useEffect(() => {
    if (isReadOnly(viewRef.current)) return;
    const poller = createStatusPoller({ poll: refreshStatus });
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

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    const state = dataRef.current;
    if (state.approval !== null) {
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
        if (key.escape && state.questions.draft === null) {
          setData((current) => ({ ...current, questions: null }));
          return;
        }
        const outcome = questionsKeys(run, state.questions, input, key);
        if (outcome.state !== state.questions) {
          setData((current) => ({ ...current, questions: outcome.state }));
        }
        if (outcome.answer !== undefined) {
          submitAnswer(run.id, outcome.answer.question, outcome.answer.answer);
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
    if (!key.ctrl && input === "n") {
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
      case "open-run":
        openRun(intent.runId);
        return;
      case "open-questions": {
        const run = current.run;
        const questions = run === null ? null : openQuestions(run);
        if (questions !== null) {
          setData((state) => ({ ...state, questions, confirmation: null }));
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
      case "back":
        stopTail();
        eventsRef.current = [];
        foldRef.current = null;
        setData((state) => ({
          ...state,
          screen: "list",
          selectedTaskId: null,
          snapshot: null,
          facts: collectFacts([]),
          notice: null,
          approval: null,
          questions: null,
          confirmation: null,
          identity: null,
        }));
        return;
      case "next-run":
      case "prev-run": {
        const items = current.list;
        const index = items.findIndex((item) => item.id === current.selectedRunId);
        const step = intent.kind === "next-run" ? 1 : -1;
        const probe = index === -1 ? 0 : index + step;
        const next = items[Math.min(items.length - 1, Math.max(0, probe))];
        if (next !== undefined) {
          setData((state) => ({ ...state, selectedRunId: next.id, selectedTaskId: null }));
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
        const next = tasks[Math.min(tasks.length - 1, Math.max(0, probe))];
        if (next !== undefined) {
          setData((state) => ({ ...state, selectedTaskId: next.id }));
        }
        return;
      }
      default:
        return;
    }
  });

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
    evidence: { identity: "", findings: 0, specCommit: null },
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
  const current = useMemo(() => (notice === null ? view : { ...view, notice }), [view, notice]);
  const currentRef = useRef(current);
  currentRef.current = current;

  useInput((input, key) => {
    const outcome = replayKey(currentRef.current, input, key);
    if (outcome.quit) {
      exit();
      return;
    }
    if (outcome.notice !== null) setNotice(outcome.notice);
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
            initial={initial}
            glyphs={glyphs}
            depth={depth}
          />,
          {
            stdout: process.stdout,
            stdin: process.stdin,
            patchConsole: false,
            exitOnCtrlC: false,
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
