import type { ActivityLine } from "./view-model.ts";

/** The activity tail keeps the newest lines only; `seq` is monotonic so the drop is stable. */
export const ACTIVITY_LIMIT = 2_000;

/**
 * A fixed-capacity ring: at most `ACTIVITY_LIMIT` lines are retained no matter how long a run is,
 * and every push stays O(1). `toArray` returns oldest first.
 */
export class ActivityRing {
  private readonly slots: (ActivityLine | undefined)[] = new Array(ACTIVITY_LIMIT);
  private start = 0;
  private count = 0;

  /** Seeding from an older ring keeps the cap: only the newest `ACTIVITY_LIMIT` lines survive. */
  constructor(initial: readonly ActivityLine[] = []) {
    for (const line of initial) this.push(line);
  }

  push(line: ActivityLine): void {
    if (this.count < ACTIVITY_LIMIT) {
      this.slots[(this.start + this.count) % ACTIVITY_LIMIT] = line;
      this.count += 1;
      return;
    }
    this.slots[this.start] = line;
    this.start = (this.start + 1) % ACTIVITY_LIMIT;
  }

  /** True when the newest retained line was pushed with `kind`. */
  lastIs(kind: string): boolean {
    if (this.count === 0) return false;
    return this.slots[(this.start + this.count - 1) % ACTIVITY_LIMIT]?.kind === kind;
  }

  /** Replace the newest line in place; no growth and no eviction when the ring is full. */
  replaceLast(line: ActivityLine): void {
    if (this.count === 0) {
      this.push(line);
      return;
    }
    this.slots[(this.start + this.count - 1) % ACTIVITY_LIMIT] = line;
  }

  toArray(): readonly ActivityLine[] {
    const lines: ActivityLine[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const line = this.slots[(this.start + index) % ACTIVITY_LIMIT];
      if (line !== undefined) lines.push(line);
    }
    return lines;
  }

  get length(): number {
    return this.count;
  }
}
