import type { FactoryConfig } from "./config/schema.ts";
import type { AgentRuntime } from "./runtime/types.ts";

export type RuntimeFactory = (
  root: string,
  config: FactoryConfig,
  changeId: string,
) => AgentRuntime;

/** Where a command writes and where it runs. Injected so tests can capture output. */
export interface Io {
  readonly cwd: string;
  out(text: string): void;
  err(text: string): void;
  /** stdout is a terminal: in-place screens and colors are safe. */
  readonly tty?: boolean;
  /** Stops a watch loop (tests pass a signal; the CLI relies on Ctrl-C terminating). */
  readonly signal?: AbortSignal;
  /** Agent runtime; defaults to a private opencode server. Tests inject a scripted one. */
  readonly runtime?: RuntimeFactory;
  /** Asks the user a yes/no question; undefined when nobody can answer (no TTY). */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** Asks for free text; undefined when nobody can answer (no TTY). */
  readonly ask?: (question: string, initial?: string) => Promise<string | undefined>;
}
