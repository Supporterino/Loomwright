/**
 * The TUI entry. Interactive mode reads the workspace through `Factory`, renders the run list and
 * run view, and restores the terminal from a `finally`. `--once` still uses the 1.2 placeholder
 * path; 1.8 wires the real screens into it.
 */
import process from "node:process";
import { type Factory, open, openReadOnly, type StatusDocument } from "@loomwright/core/factory";
import type { RunState } from "@loomwright/core/state/run";
import { type RunEvent, type RunSnapshot, reduce } from "@loomwright/protocol";
import { render, Text, useApp, useInput } from "ink";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type IntakeState, initialIntake, intakeKeys, intakePanel } from "./intake/dialog.tsx";
import {
  createLauncher,
  type LaunchAction,
  type LaunchResult,
  tailLog,
} from "./launch/launcher.ts";
import { collectFacts, type EventFacts } from "./model/facts.ts";
import { applyKey } from "./model/keys.ts";
import {
  buildViewModel,
  type Screen,
  type ViewModel,
  type ViewModelInput,
} from "./model/view-model.ts";
import { createTerminalSession } from "./session.ts";
import { type GlyphSet, glyphsFor } from "./theme/glyphs.ts";
import type { ColorDepth } from "./theme/tokens.ts";
import { Frame } from "./views/frame.tsx";

export interface TuiOptions {
  /** Resolved workspace root; null when replaying a recording. */
  readonly workspace: string | null;
  readonly replay?: string;
  readonly once: boolean;
  readonly ascii: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly out: (text: string) => void;
  /** Tests inject NO_COLOR / TERM / LANG. */
  readonly env?: NodeJS.ProcessEnv;
}

function label(options: { workspace: string | null; replay: string | undefined }): string {
  return options.replay === undefined
    ? `workspace: ${options.workspace ?? "(none)"}`
    : `replay: ${options.replay}`;
}

function depthFor(env: NodeJS.ProcessEnv | undefined): ColorDepth {
  return env?.NO_COLOR === undefined ? "truecolor" : "none";
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
}

function viewOf(data: UiData, glyphs: GlyphSet): ViewModel {
  const input: ViewModelInput = {
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
    panel: data.intake === null ? null : intakePanel(data.intake, glyphs),
    notice: data.notice,
  };
  return buildViewModel(input);
}

function initialData(
  options: TuiOptions,
  status: StatusDocument,
  runs: readonly RunState[],
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
  };
  // The list is newest first, so the first item is the run the list opens on.
  const view = viewOf(base, glyphsFor(options.ascii));
  return { ...base, selectedRunId: view.list[0]?.id ?? null };
}

interface InteractiveProps {
  readonly options: TuiOptions;
  readonly workspace: string;
  readonly factory: Factory;
  readonly initial: UiData;
}

function Interactive({ options, workspace, factory, initial }: InteractiveProps): ReactElement {
  const { exit } = useApp();
  const [data, setData] = useState<UiData>(initial);
  const [openError, setOpenError] = useState<string | null>(null);
  const glyphs = useMemo(() => glyphsFor(options.ascii), [options.ascii]);
  const view = useMemo(() => viewOf(data, glyphs), [data, glyphs]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dataRef = useRef(data);
  dataRef.current = data;
  const eventsRef = useRef<RunEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const intakeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const launcher = useMemo(() => createLauncher({ workspace }), [workspace]);

  const depth = depthFor(options.env);

  const stopIntakePoll = useCallback((): void => {
    if (intakeTimer.current !== null) {
      clearInterval(intakeTimer.current);
      intakeTimer.current = null;
    }
  }, []);

  const stopTail = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const appendTail = useCallback(
    async (id: string, fromSeq: number, signal: AbortSignal): Promise<void> => {
      for await (const item of factory.events(id, { fromSeq, follow: true, signal })) {
        if (signal.aborted) return;
        if (item.event === undefined) continue;
        eventsRef.current.push(item.event);
        const events = eventsRef.current;
        setData((current) =>
          current.screen === "run" && current.selectedRunId === id
            ? { ...current, snapshot: reduce(events), facts: collectFacts(events) }
            : current,
        );
      }
    },
    [factory],
  );

  const openRun = useCallback(
    (id: string): void => {
      stopTail();
      eventsRef.current = [];
      setData((current) => ({
        ...current,
        screen: "run",
        selectedRunId: id,
        selectedTaskId: null,
        snapshot: null,
        facts: collectFacts([]),
        notice: null,
        intake: null,
      }));
      const load = async (): Promise<void> => {
        const controller = new AbortController();
        abortRef.current = controller;
        const events: RunEvent[] = [];
        for await (const item of factory.events(id, { follow: false })) {
          if (controller.signal.aborted) return;
          if (item.event !== undefined) events.push(item.event);
        }
        eventsRef.current = events;
        if (events.length === 0 || controller.signal.aborted) return;
        const snapshot = reduce(events);
        setData((current) =>
          current.screen === "run" && current.selectedRunId === id
            ? { ...current, snapshot, facts: collectFacts(events) }
            : current,
        );
        await appendTail(id, snapshot.lastSeq + 1, controller.signal);
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
      void (async () => {
        try {
          await open(workspace);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setOpenError(message);
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

        const previous = new Set(dataRef.current.status.runs.map((run) => run.id));
        stopIntakePoll();
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

        const tick = async (): Promise<void> => {
          try {
            const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
            const started = status.runs.find((run) => !previous.has(run.id));
            setData((current) => {
              const intake = current.intake;
              return {
                ...current,
                status,
                runs,
                intake:
                  intake === null || intake.spawned === null
                    ? intake
                    : {
                        ...intake,
                        spawned: { ...intake.spawned, tail: tailLog(result.logPath) },
                      },
              };
            });
            if (started !== undefined) {
              stopIntakePoll();
              openRun(started.id);
            }
          } catch {
            // The next tick retries; the dialog keeps showing the log path meanwhile.
          }
        };
        const timer = setInterval(() => {
          void tick();
        }, 500);
        timer.unref();
        intakeTimer.current = timer;
        void tick();

        void result.exited.then(({ code }) => {
          if (code === null || code === 0) return;
          stopIntakePoll();
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
    [factory, launcher, openRun, stopIntakePoll, workspace],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        try {
          const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
          setData((current) => ({ ...current, status, runs }));
        } catch {
          // A poll failure keeps the last good status; the next tick retries.
        }
      })();
    }, 1000);
    timer.unref();
    return () => clearInterval(timer);
  }, [factory]);

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
  useEffect(() => () => stopIntakePoll(), [stopIntakePoll]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    const state = dataRef.current;
    if (state.intake !== null) {
      if (key.escape) {
        setData((current) => ({ ...current, intake: null }));
        return;
      }
      const outcome = intakeKeys(state.intake, input, key, {
        cwd: workspace,
        workspace,
        status: state.status,
        openError,
      });
      setData((current) => ({ ...current, intake: outcome.state }));
      if (outcome.submit !== undefined) submitAction(outcome.submit);
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
      case "back":
        stopTail();
        setData((state) => ({
          ...state,
          screen: "list",
          selectedTaskId: null,
          snapshot: null,
          facts: collectFacts([]),
          notice: null,
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

interface PlaceholderProps {
  readonly workspace: string | null;
  readonly replay: string | undefined;
  readonly once: boolean;
}

function PlaceholderFrame({ workspace, replay, once }: PlaceholderProps): ReactElement {
  const { exit } = useApp();
  useEffect(() => {
    // Defer past `waitUntilExit()`, which Ink registers only after render returns.
    if (once) queueMicrotask(() => exit());
  }, [exit, once]);
  return <Text>{`loomwright tui — ${label({ workspace, replay })}`}</Text>;
}

function PlaceholderInteractive({ workspace, replay }: PlaceholderProps): ReactElement {
  const { exit } = useApp();
  useInput((input) => {
    if (input === "q") exit();
  });
  return <Text>{`loomwright tui — ${label({ workspace, replay })} (press q to quit)`}</Text>;
}

/** Renders once into an in-memory stdout: the same tree, without a terminal. */
async function renderOnce(options: TuiOptions): Promise<string> {
  const chunks: string[] = [];
  const stdout = {
    columns: options.columns,
    rows: options.rows,
    isTTY: false,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
    on(): void {},
    off(): void {},
  };
  // shortcut: Ink only reads write/columns/rows/on/off/isTTY from the alternate stdout,
  // cast to its NodeJS.WriteStream type; replace with a real stream if Ink starts using more.
  const instance = render(
    <PlaceholderFrame workspace={options.workspace} replay={options.replay} once />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: { isTTY: false } as unknown as NodeJS.ReadStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );
  await instance.waitUntilExit();
  instance.unmount();
  return chunks.join("");
}

async function runPlaceholder(options: TuiOptions): Promise<number> {
  const session = createTerminalSession(process.stdin, process.stdout);
  session.enter();
  try {
    const instance = render(
      <PlaceholderInteractive workspace={options.workspace} replay={options.replay} once={false} />,
      { stdout: process.stdout, stdin: process.stdin, patchConsole: false, exitOnCtrlC: false },
    );
    await instance.waitUntilExit();
  } finally {
    session.leave();
  }
  return 0;
}

/** Opens the UI and resolves with the process exit code. */
export async function runTui(options: TuiOptions): Promise<number> {
  if (options.once) {
    options.out(await renderOnce(options));
    return 0;
  }
  if (options.workspace === null) return runPlaceholder(options);
  const workspace = options.workspace;

  // Read-only: the run list must open without the install marker (`open` is for intake, 1.5).
  const factory = await openReadOnly(workspace);
  const [status, runs] = await Promise.all([factory.status(), factory.listRuns()]);
  const initial = initialData(options, status, runs);
  const session = createTerminalSession(process.stdin, process.stdout);
  session.enter();
  const offSignal = session.onSignal(() => {
    session.leave();
    process.exit(0);
  });
  try {
    const instance = render(
      <Interactive options={options} workspace={workspace} factory={factory} initial={initial} />,
      {
        stdout: process.stdout,
        stdin: process.stdin,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );
    await instance.waitUntilExit();
  } finally {
    offSignal();
    session.leave();
  }
  return 0;
}
