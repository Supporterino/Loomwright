import { describe, expect, test } from "bun:test";
import { exec } from "../src/exec.ts";

describe("exec", () => {
  test("a timed-out command settles even while a grandchild holds the pipe open", async () => {
    const started = performance.now();
    // The shell exits at once, but the background `sleep` keeps stderr open, so `close` only
    // fires two seconds later. The deadline must settle the promise itself.
    const result = await exec(["sh", "-c", "sleep 2 & echo started"], {
      cwd: import.meta.dir,
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
