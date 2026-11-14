import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, gitOk } from "../exec.ts";

/**
 * Check-only guard (§9). Before a gate, the worktree's dirty files (the agent's uncommitted
 * work) are snapshotted with their content; afterwards any difference fails the gate and the
 * worktree is restored, so a gate that "fixes" code never changes it silently.
 */

interface Entry {
  readonly hash: string;
  /** Content of files dirty before the gate, so they can be restored. */
  readonly content?: Buffer;
}

export interface Snapshot {
  readonly worktree: string;
  readonly head: string;
  readonly entries: ReadonlyMap<string, Entry>;
}

const MISSING = "missing";

/**
 * One `git status` for both halves of a snapshot: porcelain v2 carries the branch oid in its
 * header, so a gate run costs two processes instead of four (status + rev-parse, before and
 * after) — and gate-heavy tests run hundreds of them.
 */
async function state(worktree: string): Promise<{ head: string; paths: string[] }> {
  const res = await git(
    ["status", "--porcelain=v2", "-z", "--branch", "--no-renames", "--untracked-files=all"],
    { cwd: worktree },
  );
  if (res.code !== 0) throw new Error(`git status failed in ${worktree}: ${res.stderr.trim()}`);
  const records = res.stdout.split("\0");
  const paths: string[] = [];
  let head = "";
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    if (record.startsWith("# branch.oid ")) head = record.slice("# branch.oid ".length);
    else if (record.startsWith("? ")) paths.push(record.slice(2));
    else if (record.startsWith("1 ")) paths.push(record.split(" ").slice(8).join(" "));
    else if (record.startsWith("u ")) paths.push(record.split(" ").slice(10).join(" "));
    else if (record.startsWith("2 ")) {
      paths.push(record.split(" ").slice(9).join(" "));
      i++; // the original path is its own NUL-terminated record
    }
  }
  return { head, paths };
}

function hashFile(abs: string): { hash: string; content?: Buffer } {
  if (!existsSync(abs)) return { hash: MISSING };
  const content = readFileSync(abs);
  return { hash: createHash("sha256").update(content).digest("hex"), content };
}

export async function snapshot(worktree: string): Promise<Snapshot> {
  const { head, paths } = await state(worktree);
  const entries = new Map<string, Entry>();
  for (const path of paths) entries.set(path, hashFile(join(worktree, path)));
  return { worktree, head, entries };
}

/** Paths whose state differs from the snapshot (including a moved HEAD). */
export async function changedSince(before: Snapshot): Promise<string[]> {
  const after = await snapshot(before.worktree);
  const changed = new Set<string>();
  if (after.head !== before.head) changed.add("HEAD");
  for (const [path, entry] of after.entries) {
    if (before.entries.get(path)?.hash !== entry.hash) changed.add(path);
  }
  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) changed.add(path);
  }
  return [...changed].sort();
}

/** Puts every changed path back to its snapshot state. */
export async function restore(before: Snapshot, paths: readonly string[]): Promise<void> {
  // HEAD first, so files restored below compare against the original commit.
  if (paths.includes("HEAD")) {
    // Keep the working tree (the agent's work); drop the gate's commit and staging.
    await gitOk(["reset", "-q", "--mixed", before.head], { cwd: before.worktree });
  }
  for (const path of paths.filter((p) => p !== "HEAD")) {
    const abs = join(before.worktree, path);
    const entry = before.entries.get(path);
    if (entry === undefined) {
      // Clean before the gate: tracked files go back to HEAD, new files are removed.
      const tracked = await gitOk(["ls-files", "--", path], { cwd: before.worktree });
      if (tracked !== "") await gitOk(["checkout", "-q", "--", path], { cwd: before.worktree });
      else rmSync(abs, { force: true });
    } else if (entry.content === undefined) {
      rmSync(abs, { force: true });
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, entry.content);
    }
  }
}
