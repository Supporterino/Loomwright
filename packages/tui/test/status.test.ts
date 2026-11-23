import { describe, expect, test } from "bun:test";
import type { Factory, StatusDocument } from "@loomwright/core/factory";
import { RunState } from "@loomwright/core/state/run";
import type { UsageSummary, WorkspaceUsageSummary } from "@loomwright/core/usage/usage";
import type { LandRefresh } from "../src/model/controls.ts";
import { collectFacts } from "../src/model/facts.ts";
import { createStatusSource } from "../src/model/status.ts";
import type { UiData } from "../src/model/ui-data.ts";

const ISO = "2026-11-18T10:00:00.000Z";
const SELECTED = "add-health";
const OTHER = "add-metrics";
const ZERO_USAGE = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

type Usage = UsageSummary["total"];
type RunWithUsage = StatusDocument["runs"][number];

function runState(id: string): RunState {
  return RunState.parse({
    version: 1,
    id,
    factoryVersion: "0.0.0",
    request: id,
    createdAt: ISO,
    updatedAt: ISO,
    phase: "implementing",
    summary: id,
  });
}

function usage(input: number): Usage {
  return { ...ZERO_USAGE, input };
}

function summary(input: number): UsageSummary {
  return {
    total: usage(input),
    sessions: 0,
    byAgent: {},
    byStep: {},
    byModel: {},
    retryOverhead: ZERO_USAGE,
    top: [],
    wastedReads: 0,
  };
}

function runWithUsage(id: string, input: number): RunWithUsage {
  return { ...runState(id), usage: summary(input) };
}

const WORKSPACE: WorkspaceUsageSummary = {
  total: usage(99),
  sessions: 1,
  changes: 2,
  entries: 2,
  retryOverhead: ZERO_USAGE,
  wastedReads: 0,
  byChange: {},
  sessionsByChange: {},
  byAgent: {},
  byModel: {},
  byDay: {},
  corrupt: [],
};

function fullStatus(): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    workspaceUsage: WORKSPACE,
    runs: [runWithUsage(SELECTED, 1), runWithUsage(OTHER, 2)],
    corrupt: [],
  };
}

function selectedStatus(): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    runs: [runWithUsage(SELECTED, 7)],
    corrupt: [],
  };
}

function uiData(): UiData {
  const status = fullStatus();
  return {
    screen: "run",
    selectedRunId: SELECTED,
    selectedTaskId: null,
    columns: 80,
    rows: 24,
    status,
    runs: status.runs,
    snapshot: null,
    facts: collectFacts([]),
    notice: null,
    intake: null,
    approval: null,
    questions: null,
    confirmation: null,
    help: false,
    identity: null,
    pendingLand: null,
  };
}

function tokensOf(data: UiData, id: string): number | undefined {
  return data.status.runs.find((run) => run.id === id)?.usage.total.input;
}

describe("the status source polls the selected run only", () => {
  test("an open run reads only its own usage ledger", async () => {
    const calls: (string | undefined)[] = [];
    const factory: Pick<Factory, "status"> = {
      async status(changeId?: string): Promise<StatusDocument> {
        calls.push(changeId);
        // Any id-less or other-run call is the failure this scenario guards against.
        if (changeId !== SELECTED) throw new Error(`read ${String(changeId)}`);
        return selectedStatus();
      },
    };
    let current = uiData();
    const source = createStatusSource({
      factory,
      selectedRunId: () => SELECTED,
      update: (change) => {
        current = change(current);
      },
      refresh: async () => {
        throw new Error("the open run must not read the full document");
      },
    });

    await source.poll();

    expect(calls).toEqual([SELECTED]);
    expect(current.status.runs.map((run) => run.id)).toEqual([SELECTED, OTHER]);
    expect(tokensOf(current, SELECTED)).toBe(7);
    expect(tokensOf(current, OTHER)).toBe(2);
    expect(current.status.workspaceUsage).toBe(WORKSPACE);
  });

  test("the run list still paints every run's usage", async () => {
    const calls: (string | undefined)[] = [];
    const factory: Pick<Factory, "status"> = {
      async status(changeId?: string): Promise<StatusDocument> {
        calls.push(changeId);
        return fullStatus();
      },
    };
    let current = uiData();
    let refreshes = 0;
    const refresh = async (): Promise<LandRefresh | null> => {
      refreshes += 1;
      const status = await factory.status();
      current = { ...current, status, runs: status.runs };
      return { status, runs: status.runs };
    };
    const source = createStatusSource({
      factory,
      selectedRunId: () => null,
      update: (change) => {
        current = change(current);
      },
      refresh,
    });

    await source.poll();

    expect(calls).toEqual([undefined]);
    expect(refreshes).toBe(1);
    expect(current.status.runs.map((run) => run.id)).toEqual([SELECTED, OTHER]);
    expect(tokensOf(current, SELECTED)).toBe(1);
    expect(tokensOf(current, OTHER)).toBe(2);
    expect(current.status.workspaceUsage).toBe(WORKSPACE);
  });

  test("a removed run falls back to the full status", async () => {
    const calls: (string | undefined)[] = [];
    const factory: Pick<Factory, "status"> = {
      async status(changeId?: string): Promise<StatusDocument> {
        calls.push(changeId);
        if (changeId !== undefined) throw new Error(`${changeId} is gone`);
        return fullStatus();
      },
    };
    let current = uiData();
    let refreshes = 0;
    const source = createStatusSource({
      factory,
      selectedRunId: () => SELECTED,
      update: (change) => {
        current = change(current);
      },
      refresh: async () => {
        refreshes += 1;
        const status = await factory.status();
        current = { ...current, status, runs: status.runs };
        return { status, runs: status.runs };
      },
    });

    await source.poll();

    expect(calls).toEqual([SELECTED, undefined]);
    expect(refreshes).toBe(1);
    expect(current.status.runs.map((run) => run.id)).toEqual([SELECTED, OTHER]);
  });
});
