import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { formatZodIssues } from "../config/load.ts";
import { factoryDir, writeJsonAtomic } from "../state/files.ts";
import { Command } from "./protocol.ts";

/**
 * The file inbox for commands that have no on-disk path: `.factory/commands/<runId>/` holds
 * one JSON file per command. Writers rename a temp file into place and readers ignore
 * anything that is not a complete `*.json`, so a partial write is never applied.
 */

export type InboxCommand = Command & { readonly runId: string };

export interface InboxFile {
  /** Absolute path of the file. */
  readonly file: string;
  /** The validated command, when the file parses. */
  readonly command?: Command;
  /** Why the file could not be read or parsed; the file is left in place. */
  readonly error?: string;
}

const commandsDir = (root: string, runId: string): string => factoryDir(root, "commands", runId);

/** Writes one validated command atomically and returns its path. */
export function writeCommand(root: string, command: Command): string {
  const parsed = Command.parse(command);
  const file = factoryDir(root, "commands", parsed.runId, `${parsed.command}-${Date.now()}.json`);
  writeJsonAtomic(file, parsed);
  return file;
}

const isMissing = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";

/**
 * Reads every complete command file of a run. A missing directory is an empty inbox; a file
 * that does not parse is reported with its path and left for the reader to inspect.
 */
export function readCommands(root: string, runId: string): InboxFile[] {
  const dir = commandsDir(root, runId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err: unknown) {
    if (isMissing(err)) return [];
    throw err;
  }
  const files: InboxFile[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const file = join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (err: unknown) {
      files.push({ file, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const parsed = Command.safeParse(raw);
    if (!parsed.success) {
      files.push({ file, error: formatZodIssues(parsed.error).join("; ") });
      continue;
    }
    files.push({ file, command: parsed.data });
  }
  return files;
}

/** Removes a consumed command; callers do this only after the effect is persisted. */
export function removeCommand(file: string): void {
  rmSync(file, { force: true });
}

/**
 * Where `consumeCommands` reports a file it refuses to apply. `Factory` routes it to its
 * `err`; a bare `Pipeline` (the CLI today) falls back to stderr.
 */
const reporters = new WeakMap<object, (line: string) => void>();

export function setCommandErrorReporter(pipeline: object, reporter: (line: string) => void): void {
  reporters.set(pipeline, reporter);
}

export function reportCommandProblem(pipeline: object, line: string): void {
  const reporter = reporters.get(pipeline);
  if (reporter !== undefined) {
    reporter(line);
    return;
  }
  process.stderr.write(`${line}\n`);
}
