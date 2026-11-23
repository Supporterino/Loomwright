import { type ParseArgsConfig, parseArgs } from "node:util";
import { UsageError } from "@loomwright/core/errors";
import type { ExitCode } from "@loomwright/core/exit-codes";
import type { Io } from "@loomwright/core/io";

export type { Io };

/** What a flag or positional value can be completed from. */
export type CompletionValue =
  | "change"
  | "ledger"
  | "task"
  | "repo"
  | "agent"
  | "model"
  | "shell"
  | "level"
  | "file"
  | "dir";

type ParseOption = NonNullable<ParseArgsConfig["options"]>[string];

/** A parse-args option plus the description and value completion used by `completion`. */
export interface CommandOption extends ParseOption {
  readonly description?: string;
  readonly complete?: CompletionValue;
  readonly choices?: readonly string[];
}

export type CommandOptions = Record<string, CommandOption>;

export interface CommandPositional {
  readonly name: string;
  readonly optional?: boolean;
  readonly variadic?: boolean;
  readonly complete?: CompletionValue;
}

export interface Command {
  readonly name: string;
  readonly summary: string;
  /** Full help text shown by `loomwright <name> --help`. */
  readonly help: string;
  /** The same options passed to `parseCommandArgs`; completion reads them. */
  readonly options?: CommandOptions;
  readonly positionals?: readonly CommandPositional[];
  /** Names of subcommands accepted after the command word (e.g. `bench ponytail`). */
  readonly subcommands?: readonly string[];
  /** Hidden commands still run, but are not listed or completed. */
  readonly hidden?: boolean;
  run(args: readonly string[], io: Io): Promise<ExitCode>;
}

/**
 * `-h`/`--help` are help only before the command; a string option may take one as its value.
 * `parseArgs` reads a dash-leading token as an option, so bind it to the option explicitly.
 */
function bindHelpValue(args: readonly string[], options: CommandOptions): string[] {
  const bound: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      bound.push(...args.slice(i));
      break;
    }
    const next = args[i + 1];
    if (
      arg !== undefined &&
      next !== undefined &&
      (next === "-h" || next === "--help") &&
      arg.startsWith("--") &&
      !arg.includes("=") &&
      options[arg.slice(2)]?.type === "string"
    ) {
      bound.push(`${arg}=${next}`);
      i++;
      continue;
    }
    if (arg !== undefined) bound.push(arg);
  }
  return bound;
}

/** `node:util` parseArgs in strict mode, with its errors turned into usage errors. */
export function parseCommandArgs<const O extends CommandOptions>(
  command: string,
  args: readonly string[],
  options: O,
  allowPositionals = false,
) {
  try {
    // CommandOption extends the parse-args descriptor; parseArgs ignores the extra keys.
    return parseArgs({
      args: bindHelpValue(args, options),
      options,
      strict: true,
      allowPositionals,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UsageError(`${command}: ${message}`, [`see \`loomwright ${command} --help\``]);
  }
}
