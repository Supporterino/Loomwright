import type { Phase } from "../state/run.ts";
import { EventEmitter } from "./emitter.ts";
import { JsonlSink } from "./jsonl.ts";
import type { EventType } from "./protocol.ts";

export interface StandaloneEvents {
  emit(type: EventType, data: unknown): void;
  close(): void;
}

/**
 * A JSONL-only emitter for a control write with no driver: no terminal sink, so a TUI's frame
 * stays intact, and no config load, so an uninstalled workspace still gets its event.
 */
export function openStandaloneEvents(root: string, runId: string, phase: Phase): StandaloneEvents {
  const emitter = new EventEmitter({ root, sinks: [new JsonlSink(root)] });
  emitter.bind(runId, { resumed: true });
  if (emitter.lastSeq === 0) emitter.emit("run.started", { phase });
  return {
    emit: (type, data) => {
      emitter.emit(type, data);
    },
    close: () => {
      emitter.close();
    },
  };
}
