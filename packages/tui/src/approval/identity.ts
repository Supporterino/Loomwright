/**
 * The identity the CLI will record for an approval: `git config user.email` in the AI repo.
 * The command runner is injected so the module never touches a process or a terminal.
 */

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
}

/** Returns the trimmed email, or `""` when git has none; a failed command never throws. */
export async function readApprover(
  workspace: string,
  exec: (args: readonly string[], cwd: string) => Promise<ExecResult>,
): Promise<string> {
  const result = await exec(["config", "user.email"], workspace);
  return result.stdout.trim();
}
