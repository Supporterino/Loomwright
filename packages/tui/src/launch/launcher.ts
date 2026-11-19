/**
 * The one seam every long action goes through: a detached CLI child whose output goes to a log
 * this process can tail. It never signals a child, so quitting the UI or crashing leaves a run
 * exactly as it would be without the UI.
 */
import { type ChildProcess, spawn as defaultSpawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";

export type LaunchAction =
  | { readonly kind: "run-text"; readonly text: string }
  | { readonly kind: "run-file"; readonly path: string }
  | { readonly kind: "approve"; readonly id: string }
  | { readonly kind: "approve-only"; readonly id: string }
  | { readonly kind: "reword"; readonly id: string }
  | { readonly kind: "reapprove"; readonly id: string }
  | { readonly kind: "resume"; readonly id: string };

export interface ExitResult {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface LaunchResult {
  readonly pid: number | undefined;
  readonly logPath: string;
  readonly displayPath: string;
  readonly exited: Promise<ExitResult>;
}

export interface Launcher {
  launch(action: LaunchAction): Promise<LaunchResult>;
}

/** The command part only: `-C` and the workspace are added by the launcher. */
export function actionArgs(action: LaunchAction): readonly string[] {
  switch (action.kind) {
    case "run-text":
      return ["run", action.text, "--no-interactive"];
    case "run-file":
      return ["run", "--request", action.path, "--no-interactive"];
    case "approve":
      return ["approve", action.id];
    case "approve-only":
      return ["approve", action.id, "--no-continue"];
    case "reword":
      return ["reword", action.id];
    case "reapprove":
      return ["reapprove", action.id];
    case "resume":
      return ["resume", action.id];
    default: {
      const unhandled: never = action;
      throw new Error(`unknown launch action: ${String(unhandled)}`);
    }
  }
}

export interface LauncherOptions {
  readonly workspace: string;
  /** Default `process.execPath`. */
  readonly execPath?: string;
  /** Default `process.argv[1]`. */
  readonly entryPath?: string;
  readonly spawn?: typeof import("node:child_process").spawn;
  /** Default `openSync(path, "a")`. */
  readonly openLog?: (path: string) => number;
  /** Test seam for the log filename. */
  readonly now?: () => number;
}

function logName(now: number): string {
  return `tui-spawn-${new Date(now).toISOString().replace(/[:.]/g, "-")}.log`;
}

export function createLauncher(options: LauncherOptions): Launcher {
  const execPath = options.execPath ?? process.execPath;
  const entryPath = options.entryPath ?? process.argv[1];
  if (entryPath === undefined) {
    throw new Error("cannot launch: process.argv[1] is not set");
  }
  const spawnFn = options.spawn ?? defaultSpawn;
  const openLog = options.openLog ?? ((path: string): number => openSync(path, "a"));
  const now = options.now ?? Date.now;
  const ownsLogFd = options.openLog === undefined;

  return {
    async launch(action: LaunchAction): Promise<LaunchResult> {
      const name = logName(now());
      const logPath = join(options.workspace, ".factory", "logs", name);
      mkdirSync(dirname(logPath), { recursive: true });
      const fd = openLog(logPath);
      let child: ChildProcess;
      try {
        child = spawnFn(execPath, [entryPath, "-C", options.workspace, ...actionArgs(action)], {
          cwd: options.workspace,
          detached: true,
          stdio: ["ignore", fd, fd],
        });
      } catch (err: unknown) {
        if (ownsLogFd) closeSync(fd);
        throw err instanceof Error ? err : new Error("spawn failed", { cause: err });
      }
      // The child inherited the fd; the parent can exit once it is closed here.
      if (ownsLogFd) closeSync(fd);
      child.unref();
      const exited: Promise<ExitResult> =
        child.pid === undefined
          ? Promise.resolve({ code: null, signal: null })
          : new Promise((resolve) => {
              child.once("exit", (code, signal) => resolve({ code, signal }));
            });
      return {
        pid: child.pid,
        logPath,
        displayPath: relative(options.workspace, logPath),
        exited,
      };
    },
  };
}

/** How many trailing bytes `tailLog` reads: enough for ten lines of any realistic child. */
const TAIL_BYTES = 64 * 1024;

/** The last `cap` bytes of a file; a leading partial line from the seek point is dropped. */
function readTail(logPath: string, cap: number): string {
  const fd = openSync(logPath, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - cap);
    const buffer = Buffer.alloc(size - start);
    const read = readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, read).toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    closeSync(fd);
  }
}

/** The last `lines` lines of a spawn log; an absent log reads as an empty tail. */
export function tailLog(logPath: string, lines = 10): readonly string[] {
  if (lines <= 0) return [];
  let text: string;
  try {
    text = readTail(logPath, TAIL_BYTES);
  } catch {
    return [];
  }
  const rows = text.split(/\r?\n/u);
  if (rows.at(-1) === "") rows.pop();
  return rows.slice(-lines);
}
