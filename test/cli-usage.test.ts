import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ExitCode } from "../src/cli/exit-codes.ts";
import { COMMANDS } from "../src/cli/main.ts";
import { createSingleRepoFixture, type Fixture } from "./fixtures/workspaces.ts";
import { cli } from "./helpers.ts";

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
});
