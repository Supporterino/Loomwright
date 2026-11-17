import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createSingleRepoFixture, type Fixture } from "../../../test/fixtures/workspaces.ts";
import { cli } from "../../../test/helpers.ts";
import { ConfigError, PreconditionError } from "../src/errors.ts";
import { eventLogPath } from "../src/events/jsonl.ts";
import { type EventType, RunEvent } from "../src/events/protocol.ts";
import { ExitCode } from "../src/exit-codes.ts";
import { type EventLogLine, type Factory, open, type StatusDocument } from "../src/factory.ts";
import { claimActive, enqueue } from "../src/state/active.ts";
import { newRun, saveRun, TaskState } from "../src/state/run.ts";

const RUN = "add-health";
const ISO = "2026-11-17T10:00:00.000Z";

let fx: Fixture;

beforeEach(async () => {
  fx = await createSingleRepoFixture();
});

afterEach(() => fx.cleanup());

/** The smallest config that validates; `open` only needs a config to resolve. */
const CONFIG = {
  schemaVersion: 4,
  layout: "single",
  repos: [{ name: "app", path: ".", languages: ["typescript"] }],
  models: {
    orchestrator: "test/model",
    architect: "test/model",
    reviewer: "test/model",
    implementer: "test/model",
    tester: "test/model",
    explorer: "test/model",
  },
} as const;

function installWorkspace(root: string): void {
  writeFileSync(join(root, "factory.config.jsonc"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(root, "factory.lock.json"), "{}\n");
}

/** One active, one queued and one paused run with a task, plus a corrupt run file. */
function seedRuns(root: string): void {
  saveRun(root, newRun("add-x", "Add a health endpoint", "implementing"));
  saveRun(root, newRun("next-thing", "Later", "queued"));
  const paused = newRun("paused-y", "Paused", "paused");
  paused.tasks = [
    TaskState.parse({
      id: "1.1",
      title: "Task 1.1",
      repo: "app",
      deps: [],
      touches: ["src/**"],
      status: "failed",
    }),
  ];
  saveRun(root, paused);
  mkdirSync(join(root, ".factory/runs"), { recursive: true });
  writeFileSync(join(root, ".factory/runs/broken.json"), "{not json");
}

const lineFor = (
  seq: number,
  type: EventType = "heartbeat",
  data: unknown = { text: `beat ${seq}` },
): string => JSON.stringify(RunEvent.parse({ v: 1, runId: RUN, seq, ts: ISO, type, data }));

function writeLog(root: string, runId: string, lines: readonly string[]): string {
  const path = eventLogPath(root, runId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
  return path;
}

async function collect(stream: AsyncIterable<EventLogLine>): Promise<EventLogLine[]> {
  const items: EventLogLine[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

async function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface SnapshotEntry {
  readonly path: string;
  readonly mtimeMs: number;
}

function snapshotFactory(root: string): SnapshotEntry[] {
  const base = join(root, ".factory");
  const entries: SnapshotEntry[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const stat = statSync(abs);
      entries.push({ path: relative(base, abs), mtimeMs: stat.mtimeMs });
      if (stat.isDirectory()) walk(abs);
    }
  };
  if (existsSync(base)) walk(base);
  return entries;
}

describe("Factory read API", () => {
  test("read methods do not mutate", async () => {
    installWorkspace(fx.root);
    seedRuns(fx.root);
    await claimActive(fx.root, "add-x");
    await enqueue(fx.root, "next-thing");
    writeLog(fx.root, "add-x", [lineFor(1), lineFor(2)]);
    const factory = await open(fx.root);

    const before = snapshotFactory(fx.root);
    await factory.status();
    await factory.listRuns();
    expect(await collect(factory.events("add-x"))).toHaveLength(2);
    const after = snapshotFactory(fx.root);

    expect(after).toEqual(before);
    expect(
      before.some((entry) => entry.path.endsWith(".guard") || entry.path.endsWith(".json.lock")),
    ).toBe(false);
  });

  test("status() equals status --json", async () => {
    installWorkspace(fx.root);
    seedRuns(fx.root);
    await claimActive(fx.root, "add-x");
    await enqueue(fx.root, "next-thing");
    const factory = await open(fx.root);

    // `status --json` serialises the same document this type describes.
    const all = JSON.parse((await cli(fx.root, "status", "--json")).out) as StatusDocument;
    expect(await factory.status()).toEqual(all);

    const one = JSON.parse((await cli(fx.root, "status", "add-x", "--json")).out) as StatusDocument;
    expect(await factory.status("add-x")).toEqual(one);
    expect("workspaceUsage" in (await factory.status("add-x"))).toBe(false);

    const runCorrupt = (await factory.status()).corrupt.find((entry) => entry.id === "broken");
    if (runCorrupt === undefined) throw new Error("the corrupt run file is not reported");
    expect(Object.keys(runCorrupt).sort()).toEqual(["error", "file", "id"]);

    // Corrupt lock and queue entries use the { file, error } shape, in lock/queue/run order.
    writeFileSync(join(fx.root, ".factory/active.lock"), "");
    writeFileSync(join(fx.root, ".factory/queue.json"), "");
    const corruptDocs = JSON.parse((await cli(fx.root, "status", "--json")).out) as StatusDocument;
    const after = await factory.status();
    expect(after).toEqual(corruptDocs);
    expect(after.corrupt.map((entry) => Object.keys(entry).sort())).toEqual([
      ["error", "file"],
      ["error", "file"],
      ["error", "file", "id"],
    ]);
  });

  test("listRuns() returns the parseable runs and omits the corrupt one", async () => {
    installWorkspace(fx.root);
    saveRun(fx.root, newRun("alpha", "First", "paused"));
    saveRun(fx.root, newRun("beta", "Second", "done"));
    mkdirSync(join(fx.root, ".factory/runs"), { recursive: true });
    writeFileSync(join(fx.root, ".factory/runs/broken.json"), "{not json");
    const factory = await open(fx.root);

    const runs = await factory.listRuns();

    expect(runs.map((run) => run.id).sort()).toEqual(["alpha", "beta"]);
  });

  test("events on a finished stream yields the stored lines in order", async () => {
    installWorkspace(fx.root);
    const lines = [lineFor(1), lineFor(2), lineFor(3)];
    writeLog(fx.root, RUN, lines);
    const factory = await open(fx.root);

    const all = await collect(factory.events(RUN));
    expect(all.map((item) => item.line)).toEqual(lines);
    expect(all.map((item) => item.event?.seq)).toEqual([1, 2, 3]);

    const fromTwo = await collect(factory.events(RUN, { fromSeq: 2 }));
    expect(fromTwo.map((item) => item.line)).toEqual(lines.slice(1));
  });

  test("a missing event log is not an error", async () => {
    installWorkspace(fx.root);
    const factory = await open(fx.root);

    expect(await collect(factory.events("never-ran"))).toEqual([]);
  });

  test("events reports an unknown type with the line and no event", async () => {
    installWorkspace(fx.root);
    const unknown = JSON.stringify({
      v: 1,
      runId: RUN,
      seq: 2,
      ts: ISO,
      type: "future.thing",
      data: {},
    });
    const lines = [lineFor(1), unknown, lineFor(3)];
    writeLog(fx.root, RUN, lines);
    const factory = await open(fx.root);

    const items = await collect(factory.events(RUN));

    expect(items).toHaveLength(3);
    const second = items[1];
    if (second === undefined) throw new Error("missing second line");
    expect(second.line).toBe(unknown);
    expect(second.event).toBeUndefined();
    expect(items[0]?.event?.seq).toBe(1);
    expect(items[2]?.event?.seq).toBe(3);
  });

  test("events follow yields appended lines until the signal aborts", async () => {
    installWorkspace(fx.root);
    const path = writeLog(fx.root, RUN, [lineFor(1), lineFor(2), lineFor(3)]);
    const factory = await open(fx.root);
    const controller = new AbortController();
    const iterator = factory
      .events(RUN, {
        follow: true,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();

    try {
      const prefix: EventLogLine[] = [];
      for (let index = 0; index < 3; index += 1) {
        const next = await withTimeout(iterator.next());
        if (next.done === true) throw new Error("follow ended before the stored prefix");
        prefix.push(next.value);
      }
      expect(prefix.map((item) => item.event?.seq)).toEqual([1, 2, 3]);

      const fourth = lineFor(4);
      appendFileSync(path, `${fourth}\n`);
      const next = await withTimeout(iterator.next());
      if (next.done === true) throw new Error("follow ended before the appended event");
      expect(next.value.event?.seq).toBe(4);
      expect(next.value.line).toBe(fourth);

      controller.abort();
      const done = await withTimeout(iterator.next());
      expect(done.done).toBe(true);
    } finally {
      controller.abort();
      await iterator.return?.(undefined);
    }
  });

  test("events follow yields the stored bytes of an appended line, unknown fields included", async () => {
    installWorkspace(fx.root);
    const path = writeLog(fx.root, RUN, [lineFor(1)]);
    const factory = await open(fx.root);
    const controller = new AbortController();
    const iterator = factory
      .events(RUN, { follow: true, signal: controller.signal })
      [Symbol.asyncIterator]();

    try {
      const first = await withTimeout(iterator.next());
      if (first.done === true) throw new Error("follow ended before the stored prefix");
      expect(first.value.event?.seq).toBe(1);

      // A newer writer's field the schema does not know, and keys in its own order: the stored
      // line must come back untouched, as a restart would print it.
      const appended = JSON.stringify({
        writer: "a-newer-loomwright",
        data: { text: "beat 4" },
        type: "heartbeat",
        ts: ISO,
        seq: 4,
        runId: RUN,
        v: 1,
      });
      appendFileSync(path, `${appended}\n`);

      const next = await withTimeout(iterator.next());
      if (next.done === true) throw new Error("follow ended before the appended event");
      expect(next.value.event?.seq).toBe(4);
      expect(next.value.line).toBe(appended);

      controller.abort();
      const done = await withTimeout(iterator.next());
      expect(done.done).toBe(true);
    } finally {
      controller.abort();
      await iterator.return?.(undefined);
    }
  });

  test("open rejects an empty directory that is not installed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-factory-empty-"));
    try {
      await open(dir);
      throw new Error("open should have rejected");
    } catch (err: unknown) {
      if (!(err instanceof PreconditionError)) throw err;
      expect(err.message).toBe("loomwright is not installed here");
      expect(err.details).toContain("run `loomwright init`");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("open rejects a broken config with the CLI's config error", async () => {
    writeFileSync(join(fx.root, "factory.lock.json"), "{}\n");
    writeFileSync(join(fx.root, "factory.config.jsonc"), "{ not jsonc");
    try {
      await open(fx.root);
      throw new Error("open should have rejected");
    } catch (err: unknown) {
      if (!(err instanceof ConfigError)) throw err;
      expect(err.exitCode).toBe(ExitCode.ConfigInvalid);
    }
  });

  test("the API surface is complete", async () => {
    installWorkspace(fx.root);
    const factory: Factory = await open(fx.root);

    const members = [
      "run",
      "resume",
      "approve",
      "retry",
      "abort",
      "answer",
      "pause",
      "status",
      "listRuns",
      "events",
    ] as const;
    for (const member of members) expect(typeof factory[member]).toBe("function");
  });
});
