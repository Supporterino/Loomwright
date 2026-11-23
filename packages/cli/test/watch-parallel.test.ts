import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const REPETITIONS = 3;
const WATCH_SUITE = "packages/cli/test/state-commands.test.ts";

function tail(text: string, limit = 2_000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

describe("the status --watch suite is deterministic", () => {
  test(`repeated parallel runs stay green (${REPETITIONS} repetitions)`, () => {
    const failures: string[] = [];
    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      const run = spawnSync(
        process.execPath,
        ["test", WATCH_SUITE, "--parallel", "--timeout", "60000", "-t", "status --watch"],
        { cwd: ROOT, encoding: "utf8" },
      );
      if (run.status !== 0) {
        failures.push(
          `repetition ${repetition} exited ${String(run.status)}\n${tail(run.stdout)}${tail(run.stderr)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);
});
