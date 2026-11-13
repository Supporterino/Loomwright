import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execOk } from "../src/exec.ts";
import type { LockEntry } from "../src/lock/lock.ts";
import { executeSync, planSync, sha256 } from "../src/managed/sync.ts";
import type { ManagedFile } from "../src/render/workspace.ts";
import { createSingleRepoFixture } from "./fixtures/workspaces.ts";

const PATH = ".opencode/example.md";

const file = (content: string): ManagedFile => ({
  path: PATH,
  template: "example",
  mode: "file",
  content,
});

const catFile = async (root: string, blob: string): Promise<string> =>
  execOk(["git", "cat-file", "-p", blob], { cwd: root });

test("lock entries record real git blobs, writable without one process per file", async () => {
  const fx = await createSingleRepoFixture();
  try {
    let previous: Record<string, LockEntry> = {};
    for (const content of ["# one\n", "", "# ünïcode\n\nwith a trailing newline\n"]) {
      const plan = planSync(fx.root, [file(content)], previous, { unmanaged: [] });
      const outcome = await executeSync(fx.root, plan, previous);
      const blob = outcome.managed[PATH]?.blob ?? "";
      expect(blob).toMatch(/^[0-9a-f]{40}$/);
      // The factory writes loose objects itself (src/managed/sync.ts), so pin them to git's hash.
      expect(
        await execOk(["git", "hash-object", "--stdin"], { cwd: fx.root, input: content }),
      ).toBe(blob);
      expect(await catFile(fx.root, blob)).toBe(content.trimEnd());
      previous = outcome.managed;
    }
  } finally {
    fx.cleanup();
  }
});

test("a merge base written by an older factory (a git blob) still merges", async () => {
  const fx = await createSingleRepoFixture();
  try {
    const base = "# previous template\n\nbody\n\nend\n";
    const blob = await execOk(["git", "hash-object", "-w", "--stdin"], {
      cwd: fx.root,
      input: base,
    });
    const previous: Record<string, LockEntry> = {
      [PATH]: {
        template: "example",
        templateVersion: "0.1.0",
        mode: "file",
        sha256: sha256(base),
        blob,
      },
    };
    mkdirSync(join(fx.root, ".opencode"), { recursive: true });
    writeFileSync(join(fx.root, PATH), `${base}\nmy own section\n`);

    const plan = planSync(fx.root, [file("# new template\n\nbody\n\nend\n")], previous, {
      unmanaged: [],
    });
    expect(plan[0]?.action).toBe("keep-user-edit");
    const outcome = await executeSync(fx.root, plan, previous, { merge: true });
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.merged).toEqual([PATH]);
  } finally {
    fx.cleanup();
  }
});
