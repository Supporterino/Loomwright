/**
 * The TUI entry. Task 1.2 proves the Ink/React stack end to end with a placeholder frame;
 * later tasks replace it with the run list and run view.
 */
import process from "node:process";
import { render, Text, useApp, useInput } from "ink";
import { type ReactElement, useEffect } from "react";

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

interface FrameProps {
  readonly workspace: string | null;
  readonly replay: string | undefined;
  readonly once: boolean;
}

function label(options: { workspace: string | null; replay: string | undefined }): string {
  return options.replay === undefined
    ? `workspace: ${options.workspace ?? "(none)"}`
    : `replay: ${options.replay}`;
}

function Frame({ workspace, replay, once }: FrameProps): ReactElement {
  const { exit } = useApp();
  useEffect(() => {
    // Defer past `waitUntilExit()`, which Ink registers only after render returns.
    if (once) queueMicrotask(() => exit());
  }, [exit, once]);
  return <Text>{`loomwright tui — ${label({ workspace, replay })}`}</Text>;
}

function Interactive({ workspace, replay }: FrameProps): ReactElement {
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
  const instance = render(<Frame workspace={options.workspace} replay={options.replay} once />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: { isTTY: false } as unknown as NodeJS.ReadStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
  instance.unmount();
  return chunks.join("");
}

/** Opens the UI and resolves with the process exit code. */
export async function runTui(options: TuiOptions): Promise<number> {
  if (options.once) {
    options.out(await renderOnce(options));
    return 0;
  }
  const instance = render(
    <Interactive workspace={options.workspace} replay={options.replay} once={false} />,
    { stdout: process.stdout, stdin: process.stdin, patchConsole: false },
  );
  await instance.waitUntilExit();
  return 0;
}
