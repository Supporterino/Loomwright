import { findWorkspaceRoot, loadConfig } from "@loomwright/core/config/load";
import { PreconditionError, UsageError } from "@loomwright/core/errors";
import { ExitCode } from "@loomwright/core/exit-codes";
import { CHANGE_ID } from "@loomwright/core/git/repo";
import { changeDiff } from "@loomwright/core/pipeline/diff";
import { stripControls } from "@loomwright/core/util/controls";
import { type Command, type CommandOptions, parseCommandArgs } from "../command.ts";

const OPTIONS = {
  stat: {
    type: "boolean",
    default: false,
    description: "Per-file added/deleted counts instead of the patch",
  },
  repo: { type: "string", complete: "repo", description: "Only this repo" },
  json: { type: "boolean", default: false, description: "Print the result as JSON" },
} satisfies CommandOptions;

const HELP = `Usage: loomwright diff <change-id> [--stat] [--repo <name>] [--json]

Shows a finished change's patch against its land base, per touched repo.

Reads each repo's \`change/<id>\` branch against the same merge base \`land\` would use. It is
read-only: nothing is fetched, merged, written or pushed. It works for a change in any phase;
\`done\` is when the CLI advertises it as the step before \`land\`.

  --stat         Print per-file added/deleted counts instead of the patch
  --repo <name>  Only one configured repo
  --json         Machine-readable ChangeDiff result

Exit codes: 0 ok (including a repo with no change branch), 2 for an unknown --repo, 4 for an
unknown change.`;

export const diffCommand: Command = {
  name: "diff",
  summary: "Show a finished change's patch against its land base",
  help: HELP,
  options: OPTIONS,
  positionals: [{ name: "change-id", complete: "change" }],
  async run(args, io) {
    const { values, positionals } = parseCommandArgs("diff", args, OPTIONS, true);
    const id = positionals[0];
    if (id === undefined || positionals.length > 1)
      throw new UsageError("diff: expected exactly one <change-id>");
    if (!CHANGE_ID.test(id)) throw new UsageError(`diff: invalid change id "${id}"`);
    const root = await findWorkspaceRoot(io.cwd);
    if (root === undefined) throw new PreconditionError("not inside a git repository");
    const { config } = loadConfig(root);
    const names = config.repos.map((repo) => repo.name);
    if (values.repo !== undefined && !names.includes(values.repo))
      throw new UsageError(`diff: unknown repo "${values.repo}"`, [
        `choose one of: ${names.join(", ")}`,
      ]);

    const diff = await changeDiff(root, config, id, {
      ...(values.repo === undefined ? {} : { repo: values.repo }),
      // `--json` reports the whole result, so only a text `--stat` skips the patch read.
      stat: values.stat && !values.json,
    });

    if (values.json) {
      io.out(JSON.stringify(diff, null, 2));
      return ExitCode.Ok;
    }

    io.out(`diff ${id}`);
    for (const repo of diff.repos) {
      io.out(`  ${repo.repo}: ${repo.target} <- ${repo.branch} (${repo.status})`);
      if (repo.status === "missing") {
        io.out("  no change branch");
        continue;
      }
      if (repo.status === "empty") {
        io.out(`  no commits on ${repo.branch}`);
        continue;
      }
      if (values.stat) {
        for (const file of repo.files) io.out(`  ${file.path} +${file.added} -${file.deleted}`);
        continue;
      }
      // Patch text is untrusted file content: drop terminal controls before it reaches a reviewer.
      io.out(stripControls(repo.patch));
    }
    return ExitCode.Ok;
  },
};
