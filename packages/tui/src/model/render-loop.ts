/**
 * Coalesces requests into at most ten frames per second. `request` during a pending interval does
 * nothing; the single flush renders once with all state collected so far.
 */
export interface FrameScheduler {
  request(): void;
  readonly frames: number;
  stop(): void;
}

export interface FrameSchedulerOptions {
  /** Default 100 ms → 10 fps. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly render: () => void;
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export function createFrameScheduler(options: FrameSchedulerOptions): FrameScheduler {
  const intervalMs = options.intervalMs ?? 100;
  let cancelPending: (() => void) | null = null;
  let frames = 0;
  let stopped = false;

  const flush = (): void => {
    cancelPending = null;
    if (stopped) return;
    frames += 1;
    options.render();
  };

  const arm = (): void => {
    if (options.schedule !== undefined) {
      const handle = options.schedule(flush, intervalMs);
      cancelPending = () => options.cancel?.(handle);
      return;
    }
    const handle = setTimeout(flush, intervalMs);
    cancelPending = () => clearTimeout(handle);
  };

  return {
    request(): void {
      if (stopped || cancelPending !== null) return;
      arm();
    },
    get frames(): number {
      return frames;
    },
    stop(): void {
      stopped = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
}
