/** Eagerly bundled labels and help: kept free of Ink so the CLI stays light. */

export const TUI_SUMMARY = "Watch and drive runs in the terminal";

export function tuiHelp(): string {
  return `Usage: loomwright tui [--replay <file>] [--once] [--ascii]

Watch and drive runs in the terminal. On a terminal the run list opens, newest first.
Without a terminal use \`status --watch\` or \`events --follow\` instead.

  --replay <file>    Render a recorded event stream instead of a workspace
  --once             Render one frame and exit (requires --replay)
  --ascii            Force the ASCII glyph set

Exit codes: 0 ok, 2 invalid flags or an unreadable --replay file.`;
}
