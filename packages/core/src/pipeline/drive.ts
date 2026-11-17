import { PreconditionError, TransientError } from "../errors.ts";
import {
  type InboxCommand,
  readCommands,
  removeCommand,
  reportCommandProblem,
} from "../events/inbox.ts";
import { checkDesign } from "../openspec/cli.ts";
import { claimActive, dequeue, readActive, releaseActive, releaseDriver } from "../state/active.ts";
import { readOrCorrupt } from "../state/files.ts";
import { loadRun, now, type Phase } from "../state/run.ts";
import { verifyApproval } from "./approve.ts";
import { ChangeAborted, type Pipeline } from "./context.ts";
import { contractPhase } from "./contracts.ts";
import { design, specDir } from "./design.ts";
import {
  archivedName,
  close,
  fullSuite,
  review,
  specPauseReason,
  writePauseReport,
} from "./finish.ts";
import { activate, ensureContextPacks, implement } from "./implement.ts";

/**
 * The pipeline state machine (§7). Every phase is idempotent and its result is persisted, so
 * `resume` can re-enter at the recorded phase after a pause, an abort or a crash.
 *
 *   intake → design → awaiting-approval ⇒ (approve) → queued → implementing ⇄ reviewing
 *          → contracts → full-suite (⇄ implementing for fix tasks) → closing → done
 */

export interface DriveOutcome {
  readonly id: string;
  readonly phase: Phase;
  readonly detail?: string;
}

async function ensureDriver(p: Pipeline, id: string): Promise<void> {
  const claim = await claimActive(p.root, id);
  if (claim.status === "busy")
    throw new PreconditionError(`${claim.holder.changeId} is the active change; ${id} must wait`);
  if (claim.status === "running")
    throw new PreconditionError(`${id} is already being driven by pid ${claim.holder.pid}`);
}

async function setPhase(p: Pipeline, id: string, phase: Phase, reason?: string): Promise<void> {
  const from = p.run(id).phase;
  const updated = await p.update(id, (d) => {
    if (d.abortRequested) return; // `abort` won: the change stays aborted
    d.phase = phase;
    if (reason === undefined) delete d.pausedReason;
    else d.pausedReason = reason;
  });
  if (updated.phase !== phase) return; // the update was a no-op (aborted)
  p.emit("phase.changed", { from, to: phase, ...(reason === undefined ? {} : { reason }) });
  if (phase === "paused") p.emit("run.paused", { reason: reason ?? "paused" });
}

/** Stops an aborted change: it stays aborted and frees the workspace for the next one. */
async function stopAborted(p: Pipeline, id: string): Promise<DriveOutcome> {
  await p.update(id, (d) => {
    d.phase = "aborted";
  });
  p.emit("run.aborted", {});
  p.emit("run.finished", { outcome: "aborted" });
  if (readActive(p.root)?.changeId === id) await releaseActive(p.root, id);
  return { id, phase: "aborted", detail: "aborted; branches and worktrees are kept" };
}

/** The next queued change that still waits; entries for changes that moved on are dropped. */
async function nextQueued(p: Pipeline): Promise<string | undefined> {
  for (;;) {
    const next = await dequeue(p.root);
    if (next === undefined) return undefined;
    const run = readOrCorrupt(() => loadRun(p.root, next)).value;
    if (run !== undefined && WAITING.has(run.phase)) return next;
  }
}

const WAITING: ReadonlySet<Phase> = new Set(["queued", "awaiting-approval", "paused"]);

const PAUSE_REASON = "pause requested";

type AnswerCommand = InboxCommand & { readonly command: "answer" };

/** Records an inbox answer on the run's clarification list; the caller turns a failure into a diagnostic. */
async function applyAnswer(p: Pipeline, id: string, command: AnswerCommand): Promise<void> {
  let step = "answer";
  let question = command.question ?? "answer";
  await p.update(id, (draft) => {
    const record =
      command.question === undefined
        ? draft.clarifications.find((c) => c.status === "unanswered")
        : draft.clarifications.find((c) => c.question === command.question);
    if (record === undefined) {
      // A TUI can answer before an ask loop recorded the question: keep the answer anyway.
      draft.clarifications.push({
        step: "answer",
        question,
        status: "answered",
        answer: command.answer,
        at: now(),
      });
      return;
    }
    record.status = "answered";
    record.answer = command.answer;
    record.at = now();
    step = record.step;
    question = record.question;
  });
  p.emit("question.answered", { step, question, status: "answered", answer: command.answer });
}

/** Applies pending `.factory/commands/<id>/` files. Returns true when the run paused. */
async function consumeCommands(p: Pipeline, id: string): Promise<boolean> {
  for (const entry of readCommands(p.root, id)) {
    if (entry.error !== undefined) {
      reportCommandProblem(p, `${entry.file}: ${entry.error}`);
      continue;
    }
    const command = entry.command;
    if (command === undefined) continue;
    if (command.runId !== id) {
      reportCommandProblem(p, `${entry.file}: command is for ${command.runId}, not ${id}`);
      continue;
    }
    switch (command.command) {
      case "pause": {
        // `abort` wins: its safe point stops the run and frees the workspace itself.
        if (p.abortRequested(id)) continue;
        if (p.run(id).phase === "done") {
          reportCommandProblem(p, `${entry.file}: ${id} is already done`);
          continue;
        }
        p.emit("run.pause-requested", { reason: PAUSE_REASON });
        await setPhase(p, id, "paused", PAUSE_REASON);
        // `abort` won the race: leave the request for a later reader instead of faking a pause.
        if (p.run(id).phase !== "paused") continue;
        // Pause keeps the change active: only the driver pid goes.
        if (readActive(p.root)?.changeId === id) await releaseDriver(p.root, id);
        // Last, so a crash before the pause persisted re-delivers the request.
        removeCommand(entry.file);
        return true;
      }
      case "answer": {
        try {
          await applyAnswer(p, id, command);
          removeCommand(entry.file);
        } catch (err: unknown) {
          reportCommandProblem(
            p,
            `${entry.file}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }
      default:
        reportCommandProblem(
          p,
          `${entry.file}: "${command.command}" has its own file path; use \`loomwright ${command.command} ${id}\``,
        );
    }
  }
  return false;
}

/** Drives one change as far as it can go; continues with the next queued change on close. */
export async function drive(p: Pipeline, firstId: string): Promise<DriveOutcome> {
  let id = firstId;
  p.bindRun(id);
  // `resume` of an aborted change is the decision to continue it.
  if (p.run(id).phase === "aborted") {
    await p.update(id, (d) => {
      d.abortRequested = false;
    });
    p.emit("run.resumed", {});
  }
  for (;;) {
    if (p.deps.signal.aborted) {
      p.emit("run.finished", { outcome: "paused" });
      return { id, phase: p.run(id).phase, detail: "interrupted" };
    }
    if (p.abortRequested(id)) return stopAborted(p, id);
    if (await consumeCommands(p, id)) return { id, phase: "paused", detail: PAUSE_REASON };
    try {
      const next = await step(p, id);
      if (next.kind === "stop") return next.outcome;
      id = next.id;
      if (await consumeCommands(p, id)) return { id, phase: "paused", detail: PAUSE_REASON };
    } catch (err) {
      if (err instanceof ChangeAborted) return stopAborted(p, err.changeId);
      if (err instanceof TransientError) {
        // Outside the scheduler (design, review, contracts): pause, nothing is spent.
        const reason = `the agent runtime failed (${err.message}); fix it and resume`;
        await setPhase(p, id, "paused", reason);
        return { id, phase: "paused", detail: reason };
      }
      throw err;
    }
  }
}

type Step = { kind: "continue"; id: string } | { kind: "stop"; outcome: DriveOutcome };
const go = (id: string): Step => ({ kind: "continue", id });
const stop = (outcome: DriveOutcome): Step => ({ kind: "stop", outcome });

/**
 * Phases that act on the approved spec: each entry takes the driver lock, so a second
 * `resume` cannot run the same phase twice (audit P14), and re-checks the approval (audit P9).
 */
const APPROVED_PHASES: ReadonlySet<Phase> = new Set([
  "implementing",
  "reviewing",
  "contracts",
  "full-suite",
  "closing",
]);

/** One phase transition of the state machine. */
async function step(p: Pipeline, id: string): Promise<Step> {
  const run = p.run(id);
  // Spec findings cannot be fixed by an implementer. Keep the pause until `reword`/`reapprove`
  // clears them, even when the change is resumed through `aborted` or `paused`.
  if (run.phase !== "paused" && run.specFindings.length > 0) {
    const reason = specPauseReason(id, run.specFindings.length);
    await setPhase(p, id, "paused", reason);
    return stop({ id, phase: "paused", detail: reason });
  }
  // Once archived the spec has moved (a close resumed after a crash): nothing left to check.
  if (APPROVED_PHASES.has(run.phase)) {
    await ensureDriver(p, id);
    const archived = run.phase === "closing" && archivedName(p.root, id) !== undefined;
    if (!archived) await verifyApproval(p, id, p.root);
  }
  switch (run.phase) {
    case "intake":
    case "design": {
      const result = await design(p, id);
      if (!result.ok) return stop({ id, phase: "paused", detail: result.issues.join("\n") });
      return go(id);
    }
    case "awaiting-approval":
      return stop({
        id,
        phase: run.phase,
        detail: `review openspec/changes/${id}/ and run \`loomwright approve ${id}\``,
      });
    case "aborted":
      // `resume` after `abort`: implementation continues from where it stopped.
      await setPhase(p, id, run.tasks.length > 0 ? "queued" : "design");
      return go(id);
    case "paused": {
      if (run.specFindings.length > 0) {
        return stop({ id, phase: "paused", detail: specPauseReason(id, run.specFindings.length) });
      }
      if (run.tasks.length === 0) {
        // Paused in design: a hand-fixed spec goes to approval, otherwise the architect repairs it.
        const { issues } = await checkDesign(
          p.root,
          specDir(p, run.draft),
          id,
          p.codeRepos().map((r) => r.name),
          p.config.contracts,
        );
        await setPhase(p, id, issues.length === 0 ? "awaiting-approval" : "design");
      } else {
        await setPhase(p, id, "implementing");
      }
      return go(id);
    }
    case "queued": {
      const activation = await activate(p, id);
      if (activation.status === "queued")
        return stop({ id, phase: "queued", detail: "waits for the active change to close" });
      if (activation.status === "running")
        return stop({ id, phase: "queued", detail: `already driven by pid ${activation.pid}` });
      return go(id);
    }
    case "implementing": {
      await ensureContextPacks(p, id);
      const summary = await implement(p, id);
      if (summary.status === "aborted" || p.deps.signal.aborted) {
        if (p.abortRequested(id)) return stop(await stopAborted(p, id));
        return stop({ id, phase: p.run(id).phase, detail: "interrupted" });
      }
      const specs = p.run(id).specFindings;
      if (specs.length > 0) {
        const failed = summary.failed.length > 0 ? `failed: ${summary.failed.join(", ")}; ` : "";
        const reason = `${failed}${specPauseReason(id, specs.length)}`;
        await setPhase(p, id, "paused", reason);
        const report = summary.status === "paused" ? writePauseReport(p, id, summary) : undefined;
        return stop({
          id,
          phase: "paused",
          detail: report === undefined ? reason : `${reason}; report: ${report}`,
        });
      }
      if (summary.status === "paused") {
        const report = writePauseReport(p, id, summary);
        const failed = summary.failed.length > 0 ? `failed: ${summary.failed.join(", ")}; ` : "";
        return stop({ id, phase: "paused", detail: `${failed}report: ${report}` });
      }
      await setPhase(p, id, "reviewing");
      return go(id);
    }
    case "reviewing": {
      const { added, incomplete } = await review(p, id);
      if (incomplete.length > 0) {
        const reason = `${incomplete.join("; ")}; resume to review again`;
        await setPhase(p, id, "paused", reason);
        return stop({ id, phase: "paused", detail: reason });
      }
      const specs = p.run(id).specFindings;
      if (specs.length > 0) {
        const reason = specPauseReason(id, specs.length);
        await setPhase(p, id, "paused", reason);
        return stop({ id, phase: "paused", detail: reason });
      }
      // Pending fix tasks still have to run, even when this pass added none (a resumed round).
      const pending = p.run(id).tasks.some((t) => t.status === "pending");
      await setPhase(p, id, added > 0 || pending ? "implementing" : "contracts");
      return go(id);
    }
    case "contracts": {
      const result = await contractPhase(p, id);
      if (!result.ok) {
        await setPhase(
          p,
          id,
          "paused",
          result.reason ?? "the contract gate still fails after a fix round",
        );
        return stop({ id, phase: "paused", detail: result.issues.join("\n") });
      }
      const specs = p.run(id).specFindings;
      if (specs.length > 0) {
        const reason = specPauseReason(id, specs.length);
        await setPhase(p, id, "paused", reason);
        return stop({ id, phase: "paused", detail: reason });
      }
      await setPhase(p, id, result.added > 0 ? "implementing" : "full-suite");
      return go(id);
    }
    case "full-suite": {
      const failing = await fullSuite(p, id);
      if (failing.length > 0) {
        const reason = `full suite still failing in ${failing.join(", ")} after fix rounds`;
        await setPhase(p, id, "paused", reason);
        return stop({ id, phase: "paused", detail: reason });
      }
      const pending = p.run(id).tasks.some((t) => t.status === "pending");
      await setPhase(p, id, pending ? "implementing" : "closing");
      return go(id);
    }
    case "closing": {
      await close(p, id);
      const next = await nextQueued(p);
      p.emit("run.finished", { outcome: "done" });
      if (next === undefined) return stop({ id, phase: "done" });
      p.bindRun(next);
      p.out(`▶ starting queued change ${next}`);
      return go(next);
    }
    case "done":
      p.emit("run.finished", { outcome: "done" });
      return stop({ id, phase: "done" });
  }
}
