import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findWorkspaceRoot } from "@loomwright/core/config/load";
import { UsageError } from "@loomwright/core/errors";
import { ExitCode } from "@loomwright/core/exit-codes";
import { TUI_SUMMARY, tuiHelp } from "@loomwright/tui/strings";
import { type Command, type CommandOptions, type Io, parseCommandArgs } from "../command.ts";

const TUI_OPTIONS = {
  replay: {
    type: "string",
    description: "Render a recorded event stream instead of a workspace",
    complete: "file",
  },
  once: {
    type: "boolean",
    default: false,
    description: "Render one frame and exit",
  },
  ascii: {
    type: "boolean",
    default: false,
    description: "Force the ASCII glyph set",
  },
} satisfies CommandOptions;

/** Loads the second entry lazily: the specifiers are variables so the CLI bundle never inlines it. */
async function loadTui(): Promise<typeof import("@loomwright/tui/entry")> {
  const sibling = new URL("./tui.js", import.meta.url);
  if (existsSync(fileURLToPath(sibling))) {
    const href = sibling.href;
    // The dynamic import cannot be typed; both branches load the same entry module.
    return (await import(href)) as typeof import("@loomwright/tui/entry");
  }
  const specifier = "@loomwright/tui/entry";
  return (await import(specifier)) as typeof import("@loomwright/tui/entry");
}

export const tuiCommand: Command = {
  name: "tui",
  summary: TUI_SUMMARY,
  options: TUI_OPTIONS,
  help: tuiHelp(),
  async run(args: readonly string[], io: Io): Promise<ExitCode> {
    const { values } = parseCommandArgs("tui", args, TUI_OPTIONS);
    const replay = typeof values.replay === "string" ? values.replay : undefined;
    const once = values.once === true;
    const ascii = values.ascii === true;

    if (once && replay === undefined) {
      throw new UsageError("tui: --once needs --replay", ["see `loomwright tui --help`"]);
    }
    const replayPath = replay === undefined ? undefined : resolve(io.cwd, replay);
    if (replay !== undefined && replayPath !== undefined) {
      try {
        accessSync(replayPath, constants.R_OK);
      } catch (err: unknown) {
        throw new UsageError(`tui: cannot read --replay ${replay}`, [
          err instanceof Error ? err.message : String(err),
        ]);
      }
    }
    if (io.tty !== true && replay === undefined) {
      io.err("no terminal: `loomwright tui` needs a TTY to open the run list.");
      io.err(
        "use `loomwright status <change-id> --watch` or `loomwright events <change-id> --follow`.",
      );
      return ExitCode.Failure;
    }

    // No install marker is required: `-C` already moved io.cwd before this runs.
    const workspace = replay === undefined ? ((await findWorkspaceRoot(io.cwd)) ?? io.cwd) : null;
    const { runTui } = await loadTui();
    const code = await runTui({
      workspace,
      ...(replayPath === undefined ? {} : { replay: replayPath }),
      once,
      ascii,
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
      out: io.out,
      env: process.env,
    });
    return code === ExitCode.Ok ? ExitCode.Ok : ExitCode.Failure;
  },
};
