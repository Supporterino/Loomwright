import { existsSync } from "node:fs";
import { redact, secretEnvValues } from "../logs/redact.ts";
import { appendTruncatedValue, eventLogPath, lastCompleteSeq } from "./jsonl.ts";
import { type EventType, PROTOCOL_VERSION, RunEvent } from "./protocol.ts";
import type { EventSink, SinkTarget, Verbosity } from "./sink.ts";

export interface EmitterOptions {
  /** Workspace root. */
  readonly root: string;
  /** JSONL + terminal (+ memory in tests). */
  readonly sinks: readonly EventSink[];
  /** Passthrough for the terminal sink. */
  readonly verbosity?: Verbosity;
  /** From `config.logs.redact`; false only disables the generic `key=value` heuristic. */
  readonly redact?: boolean;
  /** Test seam for `secretEnvValues`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Default 8 * 1024. */
  readonly capBytes?: number;
  /** Test seam for `ts`. */
  readonly now?: () => Date;
}

export interface Emitter {
  /** Binds to a run; the first bind seeds `seq` from the last complete line of an existing log. */
  bind(runId: string, options?: { readonly resumed?: boolean }): void;
  /** Emits one event; throws if not bound. Returns the event as written. */
  emit(type: EventType, data: unknown): RunEvent;
  /** The bound run id, or undefined before binding. */
  readonly runId: string | undefined;
  readonly lastSeq: number;
  close(): void;
}

const DEFAULT_CAP_BYTES = 8 * 1024;

/**
 * Allocates `seq`, redacts the payload, caps it and validates the result before any sink sees
 * it. The orchestrator owns one emitter; sinks never allocate a sequence or read run state.
 */
export class EventEmitter implements Emitter {
  readonly #root: string;
  readonly #sinks: readonly EventSink[];
  readonly #verbosity: Verbosity;
  readonly #heuristic: boolean;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #capBytes: number;
  readonly #now: () => Date;
  #runId: string | undefined;
  #lastSeq = 0;
  #resumed = false;
  #closed = false;

  constructor(options: EmitterOptions) {
    this.#root = options.root;
    this.#sinks = options.sinks;
    this.#verbosity = options.verbosity ?? "normal";
    this.#heuristic = options.redact ?? true;
    this.#env = options.env ?? process.env;
    this.#capBytes = options.capBytes ?? DEFAULT_CAP_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  get runId(): string | undefined {
    return this.#runId;
  }

  get lastSeq(): number {
    return this.#lastSeq;
  }

  bind(runId: string, options: { readonly resumed?: boolean } = {}): void {
    if (this.#closed) throw new Error("event emitter is closed");
    if (this.#runId === runId) return;
    if (this.#runId !== undefined)
      throw new Error(`event emitter is already bound to ${this.#runId}`);
    const path = eventLogPath(this.#root, runId);
    this.#lastSeq = existsSync(path) ? lastCompleteSeq(path) : 0;
    // A resumed stream continues at last+1 and must not grow a second `run.started`.
    this.#resumed = options.resumed === true && this.#lastSeq > 0;
    this.#runId = runId;
    const target: SinkTarget = { root: this.#root, runId, verbosity: this.#verbosity };
    for (const sink of this.#sinks) sink.bind?.(target);
  }

  emit(type: EventType, data: unknown): RunEvent {
    if (this.#closed) throw new Error("event emitter is closed");
    const runId = this.#runId;
    if (runId === undefined) throw new Error("event emitter is not bound to a run");
    if (this.#resumed && type === "run.started")
      throw new Error(`run ${runId} is resumed; it must not emit run.started again`);
    const at = this.#now();
    const seq = this.#lastSeq + 1;
    const redacted = this.#redactValue(data, secretEnvValues(this.#env), this.#heuristic);
    const capped = this.#cap(runId, at, redacted);
    const event = RunEvent.parse({
      v: PROTOCOL_VERSION,
      runId,
      seq,
      ts: at.toISOString(),
      type,
      data: capped,
    });
    for (const sink of this.#sinks) sink.write(event);
    this.#lastSeq = seq;
    return event;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const sink of this.#sinks) sink.close?.();
    this.#runId = undefined;
    this.#lastSeq = 0;
    this.#resumed = false;
  }

  #redactValue(value: unknown, envValues: readonly string[], heuristic: boolean): unknown {
    if (typeof value === "string") return redact(value, envValues, { heuristic });
    if (Array.isArray(value))
      return value.map((item) => this.#redactValue(item, envValues, heuristic));
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.#redactValue(item, envValues, heuristic),
        ]),
      );
    return value;
  }

  #cap(runId: string, at: Date, data: unknown): unknown {
    const json = JSON.stringify(data) ?? "null";
    if (Buffer.byteLength(json) <= this.#capBytes) return data;
    const ref = appendTruncatedValue(this.#root, runId, at, json);
    return { truncated: true, ref };
  }
}
