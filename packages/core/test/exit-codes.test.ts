import { describe, expect, test } from "bun:test";
import { ExitCode } from "../src/exit-codes.ts";

describe("exit codes", () => {
  test("exit codes are unchanged: ExitCode still exposes the documented values", () => {
    expect(ExitCode).toEqual({
      Ok: 0,
      Failure: 1,
      Usage: 2,
      ConfigInvalid: 3,
      Precondition: 4,
      GateFailed: 5,
      Paused: 6,
      Drift: 10,
    });
  });

  test("exit codes are unchanged: each documented meaning keeps its existing code", () => {
    expect(ExitCode.Ok).toBe(0);
    expect(ExitCode.Failure).toBe(1);
    expect(ExitCode.Usage).toBe(2);
    expect(ExitCode.ConfigInvalid).toBe(3);
    expect(ExitCode.Precondition).toBe(4);
    expect(ExitCode.GateFailed).toBe(5);
    expect(ExitCode.Paused).toBe(6);
    expect(ExitCode.Drift).toBe(10);
  });
});
