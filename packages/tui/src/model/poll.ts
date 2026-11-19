/**
 * One status poll per second, never two in flight. A tick while a poll is running is dropped, so a
 * slow `status()` cannot build a queue, and `kick()` runs one poll immediately after a spawn.
 */
export interface StatusPoller {
  start(): void;
  stop(): void;
  kick(): void;
  readonly calls: number;
}

export interface StatusPollerOptions {
  /** Default 1000 ms. */
  readonly intervalMs?: number;
  readonly poll: () => Promise<void>;
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export function createStatusPoller(options: StatusPollerOptions): StatusPoller {
  const intervalMs = options.intervalMs ?? 1_000;
  let cancelPending: (() => void) | null = null;
  let running = false;
  let inFlight = false;
  let calls = 0;

  const run = async (): Promise<void> => {
    if (!running || inFlight) return;
    inFlight = true;
    calls += 1;
    try {
      await options.poll();
    } catch {
      // A failed poll keeps the last good status; the next tick retries.
    } finally {
      inFlight = false;
    }
  };

  const arm = (): void => {
    if (options.schedule !== undefined) {
      const handle = options.schedule(tick, intervalMs);
      cancelPending = () => options.cancel?.(handle);
      return;
    }
    const handle = setTimeout(tick, intervalMs);
    cancelPending = () => clearTimeout(handle);
  };

  const cancelTimer = (): void => {
    cancelPending?.();
    cancelPending = null;
  };

  function tick(): void {
    cancelPending = null;
    if (!running) return;
    void run();
    arm();
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      arm();
    },
    stop(): void {
      running = false;
      cancelTimer();
    },
    kick(): void {
      if (!running) return;
      cancelTimer();
      void run();
      arm();
    },
    get calls(): number {
      return calls;
    },
  };
}
