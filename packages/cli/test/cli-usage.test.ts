import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ExitCode } from "@loomwright/core/exit-codes";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import type { Command, Io } from "../src/command.ts";
import { COMMANDS, runCli } from "../src/main.ts";

/** A command that records the argv it receives instead of doing any work. */
function recorder(name: string, seen: string[][]): Command {
  return {
    name,
    summary: "",
    help: `Usage: loomwright ${name}`,
    async run(args) {
      seen.push([...args]);
      return ExitCode.Ok;
    },
  };
}

function capturingIo(cwd: string): { io: Io; out: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { cwd, out: (text) => out.push(text), err: (text) => err.push(text) }, out };
}

describe("CLI usage", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
  });
  afterEach(() => fx.cleanup());

  test("top-level help names loomwright", async () => {
    const run = await cli(fx.root, "--help");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.out).toContain("Usage: loomwright [-C <dir>] <command> [options]");
    expect(run.out).not.toContain("Usage: ai-factory");
  });

  test("every command help names loomwright", async () => {
    for (const command of COMMANDS.filter((candidate) => candidate.hidden !== true)) {
      const run = await cli(fx.root, command.name, "--help");
      expect(run.code).toBe(ExitCode.Ok);
      expect(run.out.split("\n")[0]).toStartWith(`Usage: loomwright ${command.name}`);
      expect(run.out).not.toContain("Usage: ai-factory");
    }
  });

  test("a usage error points at loomwright help", async () => {
    const run = await cli(fx.root, "run", "--bogus");
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.err).toContain("see `loomwright run --help`");
  });

  test("a first token still prints help", async () => {
    const dash = await cli(fx.root, "-h");
    expect(dash.code).toBe(ExitCode.Ok);
    expect(dash.out).toContain("Usage: loomwright [-C <dir>] <command> [options]");

    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["run", "--help"], io, [recorder("run", seen)]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen).toHaveLength(0);
    expect(out.join("\n")).toContain("Usage: loomwright run");
  });

  test("a flag value is not help", async () => {
    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["reword", "add-health", "--prompt", "-h"], io, [
      recorder("reword", seen),
    ]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen.at(-1)).toEqual(["add-health", "--prompt", "-h"]);
    expect(out.join("\n")).not.toContain("Usage: loomwright");
  });

  test("a file named -h is not help", async () => {
    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["run", "--request", "-h"], io, [recorder("run", seen)]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen.at(-1)).toEqual(["--request", "-h"]);
    expect(out.join("\n")).not.toContain("Usage: loomwright");
  });

  test("--help after -- is positional text", async () => {
    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["run", "--", "--help"], io, [recorder("run", seen)]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen.at(-1)).toEqual(["--", "--help"]);
    expect(out.join("\n")).not.toContain("Usage: loomwright");
  });

  test("-h after -- is positional text", async () => {
    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["run", "--", "-h"], io, [recorder("run", seen)]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen.at(-1)).toEqual(["--", "-h"]);
    expect(out.join("\n")).not.toContain("Usage: loomwright");
  });

  test("a later help token is the command's business", async () => {
    const seen: string[][] = [];
    const { io, out } = capturingIo(fx.root);
    const code = await runCli(["run", "add-health", "--help"], io, [recorder("run", seen)]);
    expect(code).toBe(ExitCode.Ok);
    expect(seen.at(-1)).toEqual(["add-health", "--help"]);
    expect(out.join("\n")).not.toContain("Usage: loomwright");
  });

  test("one-shot commands are untouched and still registered", () => {
    const names = new Set(COMMANDS.map((command) => command.name));
    for (const name of [
      "init",
      "update",
      "doctor",
      "detect",
      "refine",
      "quick",
      "reword",
      "reapprove",
      "usage",
      "gate",
      "graph",
      "repoint",
      "land",
      "artifacts",
      "bench",
      "completion",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});
