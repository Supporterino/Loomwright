/**
 * Path completion and request-file validation for the new-run dialog. Pure filesystem reads:
 * no `Factory`, no request parsing — the preview is the file's first lines, verbatim.
 */
import {
  accessSync,
  constants,
  type Dirent,
  readdirSync,
  readFileSync,
  type Stats,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface PathCandidate {
  readonly path: string;
  readonly absolute: string;
  readonly kind: "file" | "dir";
}

export interface RequestFile {
  readonly absolute: string;
  readonly bytes: number;
  readonly preview: readonly string[];
}

export type RequestCheck = { ok: true; file: RequestFile } | { ok: false; reason: string };

function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function joinDisplay(dir: string, name: string): string {
  if (dir === "") return name;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * Reads under `<cwd>/.factory` are limited to `.factory/requests/*.md`: everything else there is
 * run state, the event log, the lock or driver files the TUI must not read or list.
 * shortcut: the guard is lexical; a symlink under `requests` could still point elsewhere.
 */
function allowedUnderFactory(absolute: string, cwd: string): boolean {
  const requests = join(cwd, ".factory", "requests");
  if (absolute === requests) return true;
  return absolute.startsWith(`${requests}${sep}`) && absolute.endsWith(".md");
}

function blockedByFactory(absolute: string, cwd: string): boolean {
  const factory = join(cwd, ".factory");
  const inside = absolute === factory || absolute.startsWith(`${factory}${sep}`);
  return inside && !allowedUnderFactory(absolute, cwd);
}

function rankOf(candidate: PathCandidate, cwd: string): number {
  const requests = join(cwd, ".factory", "requests");
  return candidate.absolute.startsWith(`${requests}${sep}`) && candidate.absolute.endsWith(".md")
    ? 0
    : 1;
}

function byRequestThenPath(cwd: string): (a: PathCandidate, b: PathCandidate) => number {
  return (a, b) => {
    const rank = rankOf(a, cwd) - rankOf(b, cwd);
    if (rank !== 0) return rank;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  };
}

/**
 * Completes `input` against the filesystem. `~` expands to the home directory; `.`, `..` and a
 * trailing separator list that directory. Only `.factory/requests` is listed under `.factory`.
 * Candidates under `<cwd>/.factory/requests/*.md` come first, the rest alphabetically.
 */
export function completePath(input: string, cwd: string): readonly PathCandidate[] {
  const expanded = expandTilde(input);
  const absoluteInput = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const endsWithSep = input.endsWith("/") || input.endsWith(sep);

  let displayDir: string;
  let listDir: string;
  let prefix: string;

  if (input === "") {
    displayDir = "";
    listDir = cwd;
    prefix = "";
  } else if (!endsWithSep && isDirectory(absoluteInput)) {
    displayDir = input;
    listDir = absoluteInput;
    prefix = "";
  } else if (endsWithSep) {
    displayDir = input.replace(/[/\\]+$/u, "");
    listDir = resolve(cwd, expandTilde(input));
    prefix = "";
  } else {
    const dir = dirname(input);
    displayDir = dir === "." ? "" : dir;
    listDir = resolve(cwd, expandTilde(dir));
    prefix = basename(input);
  }

  let entries: Dirent[];
  try {
    if (blockedByFactory(listDir, cwd)) return [];
    entries = readdirSync(listDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: PathCandidate[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    candidates.push({
      path: joinDisplay(displayDir, entry.name),
      absolute: join(listDir, entry.name),
      kind: entry.isDirectory() ? "dir" : "file",
    });
  }
  return candidates.sort(byRequestThenPath(cwd));
}

function statReason(error: unknown, absolute: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ENOENT") return `${absolute} does not exist`;
    if (error.code === "EACCES" || error.code === "EPERM") return `${absolute} is not readable`;
  }
  return `${absolute} is not readable`;
}

/** Validates a request path and builds the preview without parsing the request. */
export function checkRequestFile(path: string, cwd: string): RequestCheck {
  const expanded = expandTilde(path);
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  if (blockedByFactory(absolute, cwd)) {
    return { ok: false, reason: `${absolute} is not a .factory/requests/*.md file` };
  }

  let stats: Stats;
  try {
    stats = statSync(absolute);
  } catch (err: unknown) {
    return { ok: false, reason: statReason(err, absolute) };
  }
  if (stats.isDirectory()) return { ok: false, reason: `${absolute} is a directory` };
  if (!stats.isFile()) return { ok: false, reason: `${absolute} is not a regular file` };

  try {
    accessSync(absolute, constants.R_OK);
  } catch {
    return { ok: false, reason: `${absolute} is not readable` };
  }

  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    return { ok: false, reason: `${absolute} is not readable` };
  }
  if (text.trim() === "") return { ok: false, reason: `${absolute} is empty` };

  return {
    ok: true,
    file: {
      absolute,
      bytes: stats.size,
      preview: text.split(/\r?\n/u).slice(0, 20),
    },
  };
}
