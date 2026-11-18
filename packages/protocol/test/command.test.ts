import { expect, test } from "bun:test";
import { Command } from "@loomwright/protocol";

test("the command union is closed", () => {
  expect(Command.safeParse({ command: "approve", runId: "add-health" }).success).toBe(true);
  expect(Command.safeParse({ command: "pause", runId: "add-health" }).success).toBe(true);
  for (const bad of [
    { command: "clean", runId: "add-health" },
    { command: "future-command", runId: "add-health" },
    { command: "approve" },
    { command: "approve", runId: "" },
  ]) {
    expect(Command.safeParse(bad).success).toBe(false);
  }
});

test("a pause command is accepted", () => {
  expect(Command.parse({ command: "pause", runId: "add-health" })).toEqual({
    command: "pause",
    runId: "add-health",
  });
});

test("answer and retry carry their optional fields", () => {
  expect(
    Command.parse({
      command: "answer",
      runId: "add-health",
      question: "Which repo?",
      answer: "loomwright",
    }),
  ).toEqual({
    command: "answer",
    runId: "add-health",
    question: "Which repo?",
    answer: "loomwright",
  });
  expect(Command.parse({ command: "retry", runId: "add-health", task: "2.1" })).toEqual({
    command: "retry",
    runId: "add-health",
    task: "2.1",
  });
  expect(Command.parse({ command: "answer", runId: "add-health", answer: "" })).toEqual({
    command: "answer",
    runId: "add-health",
    answer: "",
  });
});

test("an empty or missing runId is rejected", () => {
  for (const bad of [
    { command: "abort" },
    { command: "resume", runId: "" },
    { command: "pause" },
  ]) {
    expect(Command.safeParse(bad).success).toBe(false);
  }
});

test("a malformed runId that could escape the inbox is rejected", () => {
  for (const runId of ["../../x", "add/health", "Add-health", "add health", "-add-health"]) {
    expect(Command.safeParse({ command: "pause", runId }).success).toBe(false);
  }
});
