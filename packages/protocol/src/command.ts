import { z } from "zod";
import { RunId } from "./events.ts";

/**
 * The closed union of commands a reader may send for a run. Unknown command names and a
 * missing run id are rejected, so the CLI and `Factory` can parse before acting.
 */
export const Command = z.discriminatedUnion("command", [
  z.object({ command: z.literal("approve"), runId: RunId }),
  z.object({ command: z.literal("abort"), runId: RunId }),
  z.object({ command: z.literal("retry"), runId: RunId, task: z.string().min(1).optional() }),
  z.object({ command: z.literal("resume"), runId: RunId }),
  z.object({ command: z.literal("pause"), runId: RunId }),
  z.object({
    command: z.literal("answer"),
    runId: RunId,
    question: z.string().optional(),
    answer: z.string(),
  }),
]);
export type Command = z.infer<typeof Command>;
