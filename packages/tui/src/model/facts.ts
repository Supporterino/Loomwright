import type { RunEvent } from "@loomwright/protocol";
import { ActivityRing } from "./activity.ts";
import type { ActivityLine, AgentFact, GateRow } from "./view-model.ts";

export { ACTIVITY_LIMIT, ActivityRing } from "./activity.ts";

export interface EventFacts {
  /** Gate results keyed by the task (or step) the gate ran for, in arrival order. */
  readonly gates: Readonly<Record<string, readonly GateRow[]>>;
  /** The last agent seen for a step. */
  readonly agents: Readonly<Record<string, AgentFact>>;
  /** Retry counts keyed by task id or step, from `agent.retry` and `task.retried`. */
  readonly retries: Readonly<Record<string, number>>;
  /** The newest activity lines, oldest first. */
  readonly activity: readonly ActivityLine[];
}

/** One left-to-right pass over the events; no filesystem and no clock. */
export function collectFacts(events: readonly RunEvent[]): EventFacts {
  const gates: Record<string, GateRow[]> = {};
  const agents: Record<string, AgentFact> = {};
  const retries: Record<string, number> = {};
  const activity = new ActivityRing();

  const bump = (key: string): void => {
    retries[key] = (retries[key] ?? 0) + 1;
  };

  for (const event of events) {
    switch (event.type) {
      case "gate.finished": {
        const step = event.data.step ?? "";
        const row: GateRow = {
          step,
          name: event.data.name,
          type: event.data.type,
          status: event.data.status,
          durationMs: event.data.durationMs,
        };
        const rows = gates[step];
        if (rows === undefined) gates[step] = [row];
        else rows.push(row);
        break;
      }
      case "agent.started":
        agents[event.data.step] = {
          role: event.data.agent,
          model: event.data.model,
          durationMs: null,
        };
        break;
      case "agent.finished": {
        const step = event.data.step;
        const prior = agents[step];
        agents[step] = {
          role: event.data.role,
          model: prior?.model ?? "",
          durationMs: event.data.durationMs,
        };
        break;
      }
      case "agent.retry":
        bump(event.data.step);
        break;
      case "task.retried":
        bump(event.data.task.id);
        break;
      case "agent.activity": {
        const ref = event.data.ref?.path;
        activity.push({
          seq: event.seq,
          step: event.data.step,
          kind: event.data.kind,
          text: event.data.detail,
          ...(ref === undefined ? {} : { logRef: ref }),
        });
        break;
      }
      default:
        break;
    }
  }

  return { gates, agents, retries, activity: activity.toArray() };
}
