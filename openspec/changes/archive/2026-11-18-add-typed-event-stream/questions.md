<!-- ai-factory:questions:start -->
## Clarifications

### design: Retention: should land keep .factory/events/<runId>.jsonl with the logs (the design's choice) or delete it with the run state? The answer changes what a landed change can replay.

**Answer:** yes keep them

### design: Scope: should pause be added to the Command union and the .factory/commands/<runId>/ inbox in this change, or stay a follow-up until a pause command exists? The request limits the union to commands that exist today.

**Answer:** add it

### design: UX: should events without --json print human-readable lines (the design's choice) or the raw JSONL stream? The acceptance only fixes events --json.

**Answer:** raw json

<!-- ai-factory:questions:end -->
