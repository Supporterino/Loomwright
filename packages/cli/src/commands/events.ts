import { existsSync } from "node:fs";
import { findWorkspaceRoot } from "@loomwright/core/config/load";
import { PreconditionError, UsageError } from "@loomwright/core/errors";
import { eventLogPath } from "@loomwright/core/events/jsonl";
import { readEventLines } from "@loomwright/core/events/reader";
import { ExitCode } from "@loomwright/core/exit-codes";
import { loadRun } from "@loomwright/core/state/run";
import { type Command, type CommandOptions, type Io, parseCommandArgs } from "../command.ts";
import { changeIdArg, openReadOnlyFactory } from "./pipeline-commands.ts";

const EVENTS_OPTIONS = {
  follow: {
    type: "boolean",
    default: false,
    description: "Keep printing new events until Ctrl-C",
  },
  from: { type: "string", description: "Start at this sequence number (default 1)" },
  json: {
    type: "boolean",
    default: false,
    description: "Explicit form of the same JSONL output",
  },
} satisfies CommandOptions;

function fromSeq(value: string | undefined): number {
  if (value === undefined) return 1;
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 1)
    throw new UsageError("events: --from must be a positive integer", [
      "see `loomwright events --help`",
    ]);
  return seq;
}

async function root(io: Io): Promise<string> {
  const found = await findWorkspaceRoot(io.cwd);
  if (found === undefined) throw new PreconditionError("not inside a git repository");
  return found;
}

export const eventsCommand: Command = {
  name: "events",
  summary: "Print a change's event stream as JSONL",
  options: EVENTS_OPTIONS,
  positionals: [{ name: "change-id", complete: "change" }],
  help: `Usage: loomwright events <change-id> [--follow] [--from <n>] [--json]

Prints a change's stored event stream as JSONL, one stored line per line and unchanged.
The default output is already the canonical JSONL; \`--json\` only makes that explicit.
Corrupt lines are reported on stderr and do not stop the rest of the stream.

  --follow           Keep printing new events until Ctrl-C
  --from <n>         Start at this sequence number (inclusive, default 1)
  --json             Explicit form of the same JSONL output

Exit codes: 0 ok, 2 invalid --from, 4 unknown change.`,
  async run(args, io) {
    const { values, positionals } = parseCommandArgs("events", args, EVENTS_OPTIONS, true);
    const id = changeIdArg("events", positionals);
    const start = fromSeq(values.from);
    const workspace = await root(io);
    if (loadRun(workspace, id) === undefined && !existsSync(eventLogPath(workspace, id)))
      throw new PreconditionError(`no change ${id} in this workspace`);
    for (const skipped of readEventLines(workspace, id).skipped)
      io.err(
        `warning: .factory/events/${id}.jsonl line ${skipped.line} skipped (${skipped.reason})`,
      );

    const factory = await openReadOnlyFactory(io);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (io.signal === undefined) process.once("SIGINT", onAbort);
    else io.signal.addEventListener("abort", onAbort, { once: true });
    if (io.signal?.aborted === true) controller.abort();
    try {
      for await (const item of factory.events(id, {
        fromSeq: start,
        follow: values.follow === true,
        signal: controller.signal,
      })) {
        if (item.reason !== undefined)
          io.err(`warning: .factory/events/${id}.jsonl appended line skipped (${item.reason})`);
        io.out(item.line);
      }
    } finally {
      if (io.signal === undefined) process.off("SIGINT", onAbort);
      else io.signal.removeEventListener("abort", onAbort);
    }
    return ExitCode.Ok;
  },
};
