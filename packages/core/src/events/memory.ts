import type { EventType, RunEvent, RunSnapshot } from "./protocol.ts";
import { reduce } from "./protocol.ts";
import type { EventSink } from "./sink.ts";

/** Keeps every event in memory; tests assert on the stream and its projection. */
export class MemorySink implements EventSink {
  readonly events: RunEvent[] = [];

  write(event: RunEvent): void {
    this.events.push(event);
  }

  types(): string[] {
    return this.events.map((event) => event.type);
  }

  ofType<T extends EventType>(type: T): Extract<RunEvent, { type: T }>[] {
    return this.events.filter((event): event is Extract<RunEvent, { type: T }> => {
      return event.type === type;
    });
  }

  snapshot(): RunSnapshot {
    return reduce(this.events);
  }
}
