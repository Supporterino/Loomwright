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

  test("a child that closes stdin before a large write still settles", async () => {
    const result = await exec(["sh", "-c", "exec 0<&-; sleep 0.05"], {
      cwd: import.meta.dir,
      input: "x".repeat(4 * 1024 * 1024),
      timeoutMs: 5_000,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("a child that closes stdin and exits non-zero keeps its exit code", async () => {
    const result = await exec(["sh", "-c", "exec 0<&-; exit 3"], {
      cwd: import.meta.dir,
      input: "x".repeat(4 * 1024 * 1024),
      timeoutMs: 5_000,
    });
    expect(result.code).toBe(3);
  });

  test("a child that reads stdin receives the input", async () => {
    const result = await exec(["sh", "-c", "cat"], { cwd: import.meta.dir, input: "hello" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  test("a child that reads stdin is still ended when there is no input", async () => {
    const result = await exec(["sh", "-c", "cat"], { cwd: import.meta.dir });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("a stdin failure adds nothing to stderr and does not settle early", async () => {
    const started = performance.now();
    const result = await exec(["sh", "-c", "exec 0<&-; sleep 0.2"], {
      cwd: import.meta.dir,
      input: "x".repeat(4 * 1024 * 1024),
      timeoutMs: 5_000,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(performance.now() - started).toBeGreaterThanOrEqual(190);
  });

  test("a timed-out child that closed stdin still reports the timeout", async () => {
    const result = await exec(["sh", "-c", "exec 0<&-; sleep 2"], {
      cwd: import.meta.dir,
      input: "x".repeat(4 * 1024 * 1024),
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });
});
