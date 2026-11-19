import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatusDocument } from "@loomwright/core/factory";
import { RunState } from "@loomwright/core/state/run";
import {
  PROTOCOL_VERSION,
  type RunEvent,
  RunEvent as RunEventSchema,
  reduce,
} from "@loomwright/protocol";
import { readApprover } from "../src/approval/identity.ts";
import {
  APPROVAL_TOKEN,
  type ApprovalActionKind,
  type ApprovalEvidence,
  type ApprovalState,
  approvalAvailable,
  approvalColor,
  approvalExited,
  approvalForPhase,
  approvalKeys,
  approvalPanel,
  approvalProgress,
  approvalStarted,
  MISSING_IDENTITY,
  shortCommit,
} from "../src/approval/overlay.ts";
import { initialQuestions } from "../src/controls/questions.tsx";
import { syncApproval, type UiData } from "../src/entry.tsx";
import { initialIntake } from "../src/intake/dialog.tsx";
import { collectFacts } from "../src/model/facts.ts";
import type { KeyInput } from "../src/model/keys.ts";
import { buildViewModel, type RunDetail, type ViewModelInput } from "../src/model/view-model.ts";
import { ASCII_GLYPHS } from "../src/theme/glyphs.ts";
import { TOKENS } from "../src/theme/tokens.ts";

const ISO = "2026-11-18T10:00:00.000Z";
const RUN = "add-health";
const SPEC_HASH = "0123456789abcdef0123456789abcdef";
const SPEC_COMMIT = "abcdef1234567890abcdef1234567890abcdef12";

let seq = 0;

function event(type: RunEvent["type"], data: unknown): RunEvent {
  seq += 1;
  return RunEventSchema.parse({ v: PROTOCOL_VERSION, runId: RUN, seq, ts: ISO, type, data });
}

function resetSeq(): void {
  seq = 0;
}

function runState(overrides: Record<string, unknown> = {}): RunState {
  return RunState.parse({
    version: 1,
    id: RUN,
    factoryVersion: "0.0.0",
    request: "Add health endpoints",
    createdAt: ISO,
    updatedAt: ISO,
    phase: "awaiting-approval",
    summary: "Add health endpoints",
    ...overrides,
  });
}

function statusDoc(run: RunState): StatusDocument {
  return {
    active: null,
    driverAlive: false,
    queue: [],
    corrupt: [],
    runs: [
      {
        ...run,
        usage: {
          total: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
          sessions: 0,
          byAgent: {},
          byStep: {},
          byModel: {},
          retryOverhead: {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
          },
          top: [],
          wastedReads: 0,
        },
      },
    ],
  };
}

function viewInput(run: RunState, events: readonly RunEvent[]): ViewModelInput {
  return {
    source: "live",
    screen: "run",
    columns: 120,
    rows: 40,
    now: Date.parse(ISO),
    snapshot: reduce(events),
    facts: collectFacts(events),
    status: statusDoc(run),
    runs: [run],
    selectedRunId: run.id,
    selectedTaskId: null,
    panel: null,
    notice: null,
  };
}

function detail(run: RunState, events: readonly RunEvent[]): RunDetail {
  const view = buildViewModel(viewInput(run, events));
  if (view.run === null) throw new Error("the fixture has no run detail");
  return view.run;
}

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    ctrl: false,
    shift: false,
    meta: false,
    pageUp: false,
    pageDown: false,
    delete: false,
    backspace: false,
    ...overrides,
  };
}

function evidence(overrides: Partial<ApprovalEvidence> = {}): ApprovalEvidence {
  return { identity: "dev@example.com", findings: 0, specCommit: null, ...overrides };
}

function pendingEvents(): RunEvent[] {
  resetSeq();
  return [
    event("approval.pending", {
      specHash: SPEC_HASH,
      changeDir: "openspec/changes/add-health",
    }),
  ];
}

function grantedEvents(): RunEvent[] {
  return [
    ...pendingEvents(),
    event("approval.requested", { specHash: SPEC_HASH, specCommit: SPEC_COMMIT }),
    event("approval.granted", {
      approver: "dev@example.com",
      specHash: SPEC_HASH,
      specCommit: SPEC_COMMIT,
    }),
  ];
}

function panelText(
  run: RunDetail,
  state: Parameters<typeof approvalPanel>[0]["state"],
  given: ApprovalEvidence = evidence(),
  draft?: string,
): string {
  const panel = approvalPanel({
    run,
    evidence: given,
    state,
    glyphs: ASCII_GLYPHS,
    ...(draft === undefined ? {} : { draft }),
  });
  return [
    panel.title,
    ...panel.lines,
    panel.notice ?? "",
    ...panel.keys.map((hint) => `${hint.key} ${hint.label}`),
  ].join("\n");
}

describe("the overlay opens on the phase", () => {
  test("the overlay opens on the phase, not on approval.requested while design", () => {
    expect(approvalForPhase("awaiting-approval", null)).toEqual({ kind: "idle" });
    expect(approvalForPhase("design", null)).toBeNull();

    const run = runState({ phase: "design" });
    resetSeq();
    const requested = [
      event("approval.requested", { specHash: SPEC_HASH, specCommit: SPEC_COMMIT }),
    ];
    const view = buildViewModel(viewInput(run, requested));
    expect(view.run?.phase).toBe("design");
    expect(approvalForPhase(view.run?.phase ?? "design", null)).toBeNull();
  });

  test("the panel shows summary, change dir, spec hash and no spec commit until approval.granted", () => {
    const run = runState({ draft: ".factory/drafts/add-health" });
    const beforeGrant = panelText(
      detail(run, pendingEvents()),
      { kind: "idle" },
      evidence(),
      run.draft,
    );

    expect(beforeGrant).toContain("Add health endpoints");
    expect(beforeGrant).toContain("change dir: .factory/drafts/add-health");
    expect(beforeGrant).toContain(`spec hash: ${SPEC_HASH.slice(0, 12)}`);
    expect(beforeGrant).toContain("spec commit: - until approval.granted");
    expect(beforeGrant).not.toContain(shortCommit(SPEC_COMMIT));

    const afterGrant = panelText(
      detail(run, grantedEvents()),
      { kind: "idle" },
      evidence(),
      run.draft,
    );
    expect(afterGrant).toContain(`spec commit: ${shortCommit(SPEC_COMMIT)}`);
    expect(afterGrant).toContain("approver: dev@example.com");
  });

  test("a requires its own confirmation instead of approving on the opening key", () => {
    const state = approvalForPhase("awaiting-approval", null);
    if (state === null) throw new Error("the overlay did not open");
    const pressed = approvalKeys(state, "a", key());
    expect(pressed.launch).toBeUndefined();
    expect(pressed.state).toEqual({ kind: "confirming", action: "approve" });

    const confirmed = approvalKeys(pressed.state, "", key({ return: true }));
    expect(confirmed.launch).toBe("approve");
    expect(confirmed.state).toEqual({ kind: "launching", action: "approve" });
  });
});

describe("a poll does not steal an open panel for the approval overlay", () => {
  const run = runState();

  function uiData(overrides: Partial<UiData> = {}): UiData {
    return {
      screen: "run",
      selectedRunId: RUN,
      selectedTaskId: null,
      columns: 120,
      rows: 40,
      status: statusDoc(run),
      runs: [run],
      snapshot: null,
      facts: collectFacts([]),
      notice: null,
      intake: null,
      approval: null,
      questions: null,
      confirmation: null,
      help: false,
      identity: null,
      ...overrides,
    };
  }

  const panels = [
    ["intake", { intake: initialIntake }],
    ["questions", { questions: initialQuestions }],
    ["confirmation", { confirmation: { kind: "abort", id: RUN } }],
    ["help", { help: true }],
  ] as const satisfies readonly (readonly [string, Partial<UiData>])[];

  for (const [name, panel] of panels) {
    test(`the approval overlay stays shut while the ${name} panel is open`, () => {
      const polled = syncApproval(uiData(panel));
      expect(polled.approval).toBeNull();
      expect(polled).toMatchObject(panel);
    });
  }

  test("the next poll opens the approval overlay once the open panel closes", () => {
    const polled = syncApproval(uiData({ questions: initialQuestions }));
    expect(polled.approval).toBeNull();
    expect(syncApproval({ ...polled, questions: null }).approval).toEqual({ kind: "idle" });
  });

  test("with no panel open the poll opens the approval overlay on awaiting-approval", () => {
    expect(syncApproval(uiData()).approval).toEqual({ kind: "idle" });
  });
});

describe("a missing identity disables approval", () => {
  test("the CLI message shows, a/A/R are unavailable and w stays with findings", () => {
    const run = runState({
      specFindings: [
        {
          severity: "nice",
          what: "the spec is wordy",
          problem: "it repeats the request",
          fix: "shorten it",
          impact: "review is slower",
        },
      ],
    });
    const given = evidence({ identity: "", findings: 1 });
    const available = approvalAvailable(given);

    expect(available).toEqual({
      approve: false,
      "approve-only": false,
      reword: true,
      reapprove: false,
    });

    const text = panelText(detail(run, pendingEvents()), { kind: "idle" }, given);
    expect(text).toContain(MISSING_IDENTITY);
    expect(text).toContain("w reword");
    expect(text).not.toContain("a approve and run");
    expect(text).not.toContain("A approve only");
    expect(text).not.toContain("R reapprove");
  });

  test("an action key for an unavailable action stays idle", () => {
    const state = approvalForPhase("awaiting-approval", null);
    if (state === null) throw new Error("the overlay did not open");
    const available = approvalAvailable(evidence({ identity: "", findings: 1 }));
    expect(approvalKeys(state, "a", key(), available).state).toEqual({ kind: "idle" });
    expect(approvalKeys(state, "w", key(), available).state).toEqual({
      kind: "confirming",
      action: "reword",
    });
  });
});

describe("approve only changes what the overlay says", () => {
  test("A launches approve --no-continue and the waiting overlay offers r and the hint", () => {
    const run = runState();
    const confirming = approvalKeys({ kind: "idle" }, "A", key());
    expect(confirming.state).toEqual({ kind: "confirming", action: "approve-only" });

    const confirmed = approvalKeys(confirming.state, "", key({ return: true }));
    expect(confirmed.launch).toBe("approve-only");
    const waiting = approvalStarted(confirmed.state);
    expect(waiting).toEqual({
      kind: "waiting",
      action: "approve-only",
      waitingFor: ["queued"],
      sawGranted: false,
      grantedNeeded: true,
    });

    const text = panelText(detail(run, pendingEvents()), waiting);
    expect(text).toContain("nothing is implemented");
    expect(text).toContain(`loomwright approve ${RUN}`);
    expect(text).toContain("r resume");
    expect(text).toContain("waiting for queued - read-only");
  });

  test("the waiting overlay is read-only: the other action keys and Enter are ignored", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve-only" });
    for (const [input, overrides] of [
      ["a", {}],
      ["A", {}],
      ["", { return: true }],
    ] as const) {
      const outcome = approvalKeys(waiting, input, key(overrides));
      expect(outcome.state).toBe(waiting);
      expect(outcome.launch).toBeUndefined();
      expect(outcome.resume).toBeUndefined();
    }
  });

  test("approve only changes what the overlay says: r launches resume through the launcher", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve-only" });
    expect(approvalKeys(waiting, "r", key())).toEqual({ state: waiting, resume: true });

    // Only the approve-only wait resumes: the approve wait added nothing to resume.
    const approving = approvalStarted({ kind: "launching", action: "approve" });
    expect(approvalKeys(approving, "r", key())).toEqual({ state: approving });

    // During the spawn the approval is still being recorded; `r` would race it.
    const spawning: ApprovalState = { kind: "launching", action: "approve-only" };
    expect(approvalKeys(spawning, "r", key())).toEqual({ state: spawning });
  });
});

describe("the actions are gated by their evidence", () => {
  test("no findings and no spec commit leaves only a and A, and the footer lists only those", () => {
    const given = evidence({ findings: 0, specCommit: null });
    expect(approvalAvailable(given)).toEqual({
      approve: true,
      "approve-only": true,
      reword: false,
      reapprove: false,
    });

    const text = panelText(detail(runState(), pendingEvents()), { kind: "idle" }, given);
    expect(text).toContain("a approve and run");
    expect(text).toContain("A approve only");
    expect(text).not.toContain("w reword");
    expect(text).not.toContain("R reapprove");
    expect(text).toContain("q quit");
  });

  test("a grant in the stream offers reapprove and a commit names it in the confirmation", () => {
    const given = evidence({ specCommit: SPEC_COMMIT });
    const run = detail(runState(), grantedEvents());
    expect(approvalAvailable(given).reapprove).toBe(true);

    const confirming = approvalKeys({ kind: "idle" }, "R", key(), approvalAvailable(given));
    expect(confirming.state).toEqual({ kind: "confirming", action: "reapprove" });
    const text = panelText(run, confirming.state, given);
    expect(text).toContain(shortCommit(SPEC_COMMIT));
  });
});

describe("q quits from the gate", () => {
  test("every overlay state offers q quit in the footer", () => {
    const run = detail(runState(), pendingEvents());
    const states: readonly ApprovalState[] = [
      { kind: "idle" },
      { kind: "confirming", action: "approve" },
      { kind: "launching", action: "approve" },
      approvalStarted({ kind: "launching", action: "approve-only" }),
      { kind: "failed", action: "approve", code: 1, tail: [] },
      { kind: "done" },
    ];
    for (const state of states) {
      const panel = approvalPanel({ run, evidence: evidence(), state, glyphs: ASCII_GLYPHS });
      expect(panel.keys.map((hint) => `${hint.key} ${hint.label}`)).toContain("q quit");
    }
  });
});

describe("each action has its own confirmation", () => {
  const MATRIX: readonly {
    readonly action: ApprovalActionKind;
    readonly key: string;
    readonly expected: readonly string[];
  }[] = [
    {
      action: "approve",
      key: "a",
      expected: ["approval is recorded", "spec is committed", "implementation starts locally"],
    },
    {
      action: "approve-only",
      key: "A",
      expected: ["nothing is implemented", "r", `loomwright approve ${RUN}`],
    },
    {
      action: "reword",
      key: "w",
      expected: ["architect session", "may take long"],
    },
    {
      action: "reapprove",
      key: "R",
      expected: [shortCommit(SPEC_COMMIT)],
    },
  ];

  for (const { action, key: actionKey, expected } of MATRIX) {
    test(`${action} confirms with Enter and names what it does`, () => {
      const given = evidence({ findings: 1, specCommit: SPEC_COMMIT });
      const state = { kind: "idle" } as const;
      const pressed = approvalKeys(state, actionKey, key(), approvalAvailable(given));
      expect(pressed.state).toEqual({ kind: "confirming", action });

      const confirmed = approvalKeys(pressed.state, "", key({ return: true }));
      expect(confirmed.launch).toBe(action);
      expect(confirmed.state).toEqual({ kind: "launching", action });

      const text = panelText(detail(runState(), grantedEvents()), pressed.state, given);
      for (const part of expected) expect(text).toContain(part);
    });

    test(`${action} cancels with Esc and produces no launch`, () => {
      const state = { kind: "confirming", action } as const;
      const cancelled = approvalKeys(state, "", key({ escape: true }));
      expect(cancelled.state).toEqual({ kind: "idle" });
      expect(cancelled.launch).toBeUndefined();
    });
  }

  test("y also confirms and n cancels", () => {
    const pressed = approvalKeys({ kind: "idle" }, "a", key());
    expect(approvalKeys(pressed.state, "y", key()).launch).toBe("approve");
    expect(approvalKeys(pressed.state, "n", key()).state).toEqual({ kind: "idle" });
    expect(approvalKeys(pressed.state, "a", key()).state).toBe(pressed.state);
  });
});

describe("the overlay closes on the outcome", () => {
  test("every action waits for the phases it was launched into", () => {
    const expected = {
      approve: ["queued", "implementing"],
      "approve-only": ["queued"],
      reword: ["design", "awaiting-approval"],
      reapprove: ["awaiting-approval", "queued"],
    } as const;
    for (const action of ["approve", "approve-only", "reword", "reapprove"] as const) {
      const waiting = approvalStarted({ kind: "launching", action });
      expect(waiting.kind).toBe("waiting");
      if (waiting.kind !== "waiting") return;
      expect(waiting.waitingFor).toEqual(expected[action]);
    }
  });

  test("approval.granted then the next phase closes approve and run", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve" });
    const granted = approvalProgress(waiting, { phase: "awaiting-approval", granted: true });
    expect(granted.kind).toBe("waiting");
    const closed = approvalProgress(granted, { phase: "queued", granted: true });
    expect(closed).toEqual({ kind: "done" });
  });

  test("a phase without a grant keeps approve and run open", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve" });
    expect(approvalProgress(waiting, { phase: "queued", granted: false })).toEqual(waiting);
  });

  test("reword closes on the next phase without a grant", () => {
    const waiting = approvalStarted({ kind: "launching", action: "reword" });
    expect(approvalProgress(waiting, { phase: "design", granted: false })).toEqual({
      kind: "done",
    });
  });
  test("approve only closes once the grant and queued phase are both known", () => {
    const waiting = approvalStarted({ kind: "launching", action: "approve-only" });
    const granted = approvalProgress(waiting, { phase: "awaiting-approval", granted: true });
    expect(approvalProgress(granted, { phase: "queued", granted: true })).toEqual({ kind: "done" });
  });
});

describe("a non-zero child exit restores the actionable overlay", () => {
  test("failed shows the exit code and ten log lines and the keys work again", () => {
    const tail = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    const waiting = approvalStarted({ kind: "launching", action: "approve" });
    const failed = approvalExited(waiting, 3, tail);
    expect(failed).toEqual({
      kind: "failed",
      action: "approve",
      code: 3,
      tail: tail.slice(-10),
    });

    const text = panelText(detail(runState(), pendingEvents()), failed);
    expect(text).toContain("exited with code 3");
    for (const line of tail.slice(-10)) expect(text).toContain(line);

    const pressed = approvalKeys(failed, "a", key());
    expect(pressed.state).toEqual({ kind: "confirming", action: "approve" });
  });

  test("failed lists the action hints for the available actions", () => {
    const failed = approvalExited({ kind: "launching", action: "approve" }, 3, ["boom"]);
    const text = panelText(detail(runState(), pendingEvents()), failed);
    expect(text).toContain("a approve and run");
    expect(text).toContain("A approve only");
    expect(text).toContain("q quit");
    expect(text).not.toContain("w reword");
    expect(text).not.toContain("R reapprove");
  });
});

describe("the identity check", () => {
  test("reads git config user.email in the workspace and trims it", async () => {
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const identity = await readApprover("/work/app", async (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: "  dev@example.com\n" };
    });
    expect(identity).toBe("dev@example.com");
    expect(calls).toEqual([{ args: ["config", "user.email"], cwd: "/work/app" }]);
  });

  test("an empty or failed command means unset and never throws", async () => {
    expect(await readApprover("/work/app", async () => ({ code: 0, stdout: " \n" }))).toBe("");
    expect(await readApprover("/work/app", async () => ({ code: 1, stdout: "" }))).toBe("");
  });
});

describe("the coral token belongs to the approval gate", () => {
  test("TOKENS.approval is used only by this panel", () => {
    expect(TOKENS.approval.hex).toBe("#E0714F");
    expect(APPROVAL_TOKEN).toBe(TOKENS.approval);
    expect(approvalColor("truecolor")).toContain("224;113;79");
    expect(approvalColor("none")).toBeUndefined();

    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          const rel = relative(srcRoot, full);
          if (rel !== "theme/tokens.ts" && readFileSync(full, "utf8").includes("TOKENS.approval")) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual(["approval/overlay.ts"]);
  });
});
