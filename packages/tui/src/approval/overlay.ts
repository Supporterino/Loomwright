/**
 * The phase-driven approval overlay: one pure state machine and one panel builder. Nothing here
 * opens the factory, spawns a child or runs git; `entry.tsx` owns every effect and turns the
 * emitted action into a launcher call.
 */
import type { Phase } from "@loomwright/protocol";
import type { KeyInput } from "../model/keys.ts";
import type { PanelView, RunDetail } from "../model/view-model.ts";
import { keyHint, LABELS } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import { type ColorDepth, colorFor, TOKENS } from "../theme/tokens.ts";

export type ApprovalActionKind = "approve" | "approve-only" | "reword" | "reapprove";

/** The exact CLI message; the overlay must not invent a shorter one. */
export const MISSING_IDENTITY = "git user.email is not set; it records who approved";

export interface ApprovalEvidence {
  /** `git config user.email` in the AI repo; `""` when unset. */
  readonly identity: string;
  /** `run.specFindings.length`. */
  readonly findings: number;
  /** Only from `approval.granted`; `approval.requested` has no approver yet. */
  readonly specCommit: string | null;
}

export function approvalAvailable(evidence: ApprovalEvidence): Record<ApprovalActionKind, boolean> {
  const identity = evidence.identity !== "";
  return {
    approve: identity,
    "approve-only": identity,
    // Reword writes no approval, so it does not need the identity.
    reword: evidence.findings > 0,
    reapprove: identity && evidence.specCommit !== null,
  };
}

export type ApprovalState =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming"; readonly action: ApprovalActionKind }
  | { readonly kind: "launching"; readonly action: ApprovalActionKind }
  | {
      readonly kind: "waiting";
      readonly action: ApprovalActionKind;
      readonly waitingFor: readonly Phase[];
      readonly sawGranted: boolean;
      readonly grantedNeeded: boolean;
    }
  | {
      readonly kind: "failed";
      readonly action: ApprovalActionKind;
      readonly code: number;
      readonly tail: readonly string[];
    }
  | { readonly kind: "done" };

const WAITING_FOR = {
  approve: ["queued", "implementing"],
  "approve-only": ["queued"],
  reword: ["design", "awaiting-approval"],
  reapprove: ["awaiting-approval", "queued"],
} as const satisfies Readonly<Record<ApprovalActionKind, readonly Phase[]>>;

const GRANTED_NEEDED = {
  approve: true,
  "approve-only": true,
  reword: false,
  reapprove: true,
} as const satisfies Readonly<Record<ApprovalActionKind, boolean>>;

const ALL_AVAILABLE = {
  approve: true,
  "approve-only": true,
  reword: true,
  reapprove: true,
} as const satisfies Readonly<Record<ApprovalActionKind, boolean>>;

export interface ApprovalInput {
  readonly run: RunDetail;
  readonly evidence: ApprovalEvidence;
  readonly state: ApprovalState;
  readonly glyphs: GlyphSet;
  /** `run.draft` from run state; the display change dir when set. */
  readonly draft?: string;
}

/** `approval.granted` fills the approver; `approval.requested` leaves it empty. */
function grantedCommit(commit: string | null, approver: string | null): string | null {
  return commit === null || approver === null || approver === "" ? null : commit;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

/** The overlay appears on the phase, never on `approval.requested`. */
export function approvalForPhase(
  phase: Phase,
  current: ApprovalState | null,
): ApprovalState | null {
  if (current !== null) return current;
  return phase === "awaiting-approval" ? { kind: "idle" } : null;
}

export interface ApprovalProgress {
  readonly phase: Phase | null;
  readonly granted: boolean;
}

/** Closes only after the outcome is known; reword needs no grant. */
export function approvalProgress(state: ApprovalState, progress: ApprovalProgress): ApprovalState {
  if (state.kind !== "waiting") return state;
  const sawGranted = state.sawGranted || progress.granted;
  const leftPhase = progress.phase !== null && progress.phase !== "awaiting-approval";
  if (leftPhase && (sawGranted || !state.grantedNeeded)) return { kind: "done" };
  return sawGranted === state.sawGranted ? state : { ...state, sawGranted };
}

export function approvalStarted(state: ApprovalState): ApprovalState {
  if (state.kind !== "launching") return state;
  return {
    kind: "waiting",
    action: state.action,
    waitingFor: WAITING_FOR[state.action],
    sawGranted: false,
    grantedNeeded: GRANTED_NEEDED[state.action],
  };
}

export function approvalExited(
  state: ApprovalState,
  code: number,
  tail: readonly string[],
): ApprovalState {
  if (state.kind !== "waiting" && state.kind !== "launching") return state;
  return { kind: "failed", action: state.action, code, tail: tail.slice(-10) };
}

/** The coral token belongs to (and is only used by) the approval gate. */
export const APPROVAL_TOKEN = TOKENS.approval;

export function approvalColor(depth: ColorDepth): string | undefined {
  return colorFor("approval", depth);
}

export interface ApprovalOutcome {
  readonly state: ApprovalState;
  /** The action to spawn; `entry.tsx` adds the run id and calls the launcher. */
  readonly launch?: ApprovalActionKind;
  /** `r` in the approve-only wait: `entry.tsx` launches `resume <id>` for that run. */
  readonly resume?: boolean;
}

function actionForKey(input: string): ApprovalActionKind | null {
  switch (input) {
    case "a":
      return "approve";
    case "A":
      return "approve-only";
    case "w":
      return "reword";
    case "R":
      return "reapprove";
    default:
      return null;
  }
}

/** One keypress. Effects never happen here: a confirmed action is returned for the caller. */
export function approvalKeys(
  state: ApprovalState,
  input: string,
  key: KeyInput,
  available: Readonly<Record<ApprovalActionKind, boolean>> = ALL_AVAILABLE,
): ApprovalOutcome {
  if (state.kind === "waiting") {
    // The approve-only wait is read-only except `r`: the CLI recorded the approval and
    // started nothing, so the only way on is `resume <id>`.
    if (state.action === "approve-only" && !key.ctrl && input === "r") {
      return { state, resume: true };
    }
    return { state };
  }
  if (state.kind === "launching" || state.kind === "done") {
    return { state };
  }
  if (state.kind === "confirming") {
    if (key.return || (!key.ctrl && input === "y")) {
      return { state: { kind: "launching", action: state.action }, launch: state.action };
    }
    if (key.escape || (!key.ctrl && input === "n")) return { state: { kind: "idle" } };
    return { state };
  }
  const action = actionForKey(input);
  if (action === null || !available[action]) return { state };
  return { state: { kind: "confirming", action } };
}

function dash(glyphs: GlyphSet): string {
  // The ASCII frame must stay printable ASCII, like the intake title.
  return glyphs.bullet === "-" ? "-" : "—";
}

function actionLabel(action: ApprovalActionKind): string {
  switch (action) {
    case "approve":
      return "approve and run";
    case "approve-only":
      return "approve only";
    case "reword":
      return "reword";
    case "reapprove":
      return "reapprove";
    default: {
      const unhandled: never = action;
      throw new Error(`unknown approval action: ${String(unhandled)}`);
    }
  }
}

function confirmation(input: ApprovalInput): string[] {
  const { state, run } = input;
  if (state.kind !== "confirming") return [];
  switch (state.action) {
    case "approve":
      return [
        "confirm approve and run:",
        "the approval is recorded, the spec is committed",
        "and implementation starts locally",
      ];
    case "approve-only":
      return [
        "confirm approve only: nothing is implemented",
        `press r (resume) later or run \`loomwright approve ${run.id}\``,
      ];
    case "reword":
      return ["confirm reword: this starts the architect session", "and may take long"];
    case "reapprove": {
      const commit = input.evidence.specCommit;
      return [
        `confirm reapprove: accepts spec commit ${commit === null ? "unknown" : shortCommit(commit)}`,
      ];
    }
    default: {
      const unhandled: never = state.action;
      throw new Error(`unknown approval action: ${String(unhandled)}`);
    }
  }
}

function waitingLines(input: ApprovalInput, glyphs: GlyphSet): string[] {
  const { state, run } = input;
  if (state.kind !== "waiting") return [];
  const phases = state.waitingFor.map((phase) => LABELS[phase]).join(", ");
  const lines = [`waiting for ${phases} ${dash(glyphs)} read-only`];
  if (state.action === "approve-only") {
    lines.push("nothing is implemented");
    lines.push(`press r to resume, or run \`loomwright approve ${run.id}\``);
  }
  return lines;
}

function stateLines(input: ApprovalInput, glyphs: GlyphSet): string[] {
  const { state } = input;
  switch (state.kind) {
    case "idle":
      return [];
    case "confirming":
      return confirmation(input);
    case "launching":
      return [`starting ${actionLabel(state.action)}...`];
    case "waiting":
      return waitingLines(input, glyphs);
    case "failed":
      return [
        `exited with code ${state.code}; the overlay is actionable again`,
        "log tail:",
        ...state.tail.map((line) => `  ${line}`),
      ];
    case "done":
      return [];
    default: {
      const unhandled: never = state;
      throw new Error(`unknown approval state: ${String(unhandled)}`);
    }
  }
}

function panelKeys(input: ApprovalInput): PanelView["keys"] {
  const { state, evidence } = input;
  const keys: PanelView["keys"][number][] = [];
  if (state.kind === "confirming") {
    keys.push(keyHint("Enter", "confirm"), keyHint("Esc", "cancel"));
  } else if (state.kind === "waiting") {
    if (state.action === "approve-only") keys.push(keyHint("r", "resume"));
  } else if (state.kind === "idle") {
    const available = approvalAvailable(evidence);
    if (available.approve) keys.push(keyHint("a", "approve and run"));
    if (available["approve-only"]) keys.push(keyHint("A", "approve only"));
    if (available.reword) keys.push(keyHint("w", "reword"));
    if (available.reapprove) keys.push(keyHint("R", "reapprove"));
  }
  // `q` quits from every state, so the footer names it wherever the overlay is open.
  keys.push(keyHint("q", "quit"));
  return keys;
}

export function approvalPanel(input: ApprovalInput): PanelView {
  const { run, evidence, glyphs } = input;
  const granted = run.approval;
  const changeDir =
    input.draft !== undefined && input.draft !== ""
      ? input.draft
      : (granted?.changeDir ?? `openspec/changes/${run.id}`);
  const specCommit = grantedCommit(granted?.specCommit ?? null, granted?.approver ?? null);
  const lines = [
    run.summary,
    `change dir: ${changeDir}`,
    granted?.specHash === null || granted?.specHash === undefined
      ? "spec hash: unknown (older stream)"
      : `spec hash: ${granted.specHash.slice(0, 12)}`,
    specCommit === null
      ? `spec commit: ${dash(glyphs)} until approval.granted`
      : `spec commit: ${shortCommit(specCommit)}`,
    granted?.approver === null || granted?.approver === undefined || granted.approver === ""
      ? `approver: ${dash(glyphs)} until approval.granted`
      : `approver: ${granted.approver}`,
    `identity: ${evidence.identity === "" ? MISSING_IDENTITY : evidence.identity}`,
    ...stateLines(input, glyphs),
  ];
  return {
    kind: "approval",
    title: `Approval ${dash(glyphs)} ${run.id}`,
    lines,
    keys: panelKeys(input),
    notice: null,
  };
}
