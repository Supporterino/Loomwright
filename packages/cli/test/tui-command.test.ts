import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ExitCode } from "@loomwright/core/exit-codes";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { completeWords } from "../src/completion/engine.ts";
import { COMMANDS } from "../src/main.ts";

const REPLAY_FIXTURE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "test",
  "fixtures",
  "tui",
  "approval-gate.jsonl",
);

describe("tui command", () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createSingleRepoFixture();
  });
  afterEach(() => fx.cleanup());

  test("help and completion include the command", async () => {
    const command = COMMANDS.find((candidate) => candidate.name === "tui");
    expect(command).toBeDefined();
    expect(command?.hidden).not.toBe(true);
    expect(command?.help.startsWith("Usage: loomwright tui [--replay <file>] [--once] [--ascii]"));
    for (const flag of ["--replay", "--once", "--ascii"]) expect(command?.help).toContain(flag);

    const help = await cli(fx.root, "tui", "--help");
    expect(help.code).toBe(ExitCode.Ok);
    expect(help.out.split("\n")[0]).toStartWith("Usage: loomwright tui");

    const completion = await completeWords(["tui", "--"], fx.root);
    const values = completion.candidates?.map((candidate) => candidate.value) ?? [];
    expect(values).toEqual(expect.arrayContaining(["--replay", "--once", "--ascii"]));
  });

  test("no terminal prints a hint", async () => {
    const run = await cli(fx.root, "tui");
    expect(run.code).toBe(ExitCode.Failure);
    expect(run.err).toContain("loomwright status <change-id> --watch");
    expect(run.err).toContain("loomwright events <change-id> --follow");
    expect(run.out).toBe("");
  });

  test("bad flags are usage errors: --once without --replay", async () => {
    const run = await cli(fx.root, "tui", "--once");
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.err).toContain("--once");
  });

  test("bad flags are usage errors: a missing --replay path", async () => {
    const run = await cli(fx.root, "tui", "--replay", "./missing.jsonl");
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.err).toContain("./missing.jsonl");
  });

  test("bad flags are usage errors: a --replay path that is a directory", async () => {
    const run = await cli(fx.root, "tui", "--replay", ".");
    expect(run.code).toBe(ExitCode.Usage);
    expect(run.err).toContain(".");
    expect(run.err).not.toContain("internal error");
  });

  test("a recorded replay renders one frame and exits 0", async () => {
    const run = await cli(fx.root, "tui", "--replay", REPLAY_FIXTURE, "--once");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.err).toBe("");
    expect(run.out).toContain("add-health");
    expect(run.out).toContain("Approval");
    expect(run.out).toContain("spec hash: <sha>");
    expect(run.out).not.toContain("\u001b[");
  });
});
