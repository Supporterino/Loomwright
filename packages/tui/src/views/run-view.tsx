import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ViewModel } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { ActivityTail } from "./activity.tsx";
import { RunHeader } from "./header.tsx";
import { colorProps } from "./style.ts";
import { TaskDetail } from "./task-detail.tsx";
import { TaskGraph } from "./task-graph.tsx";

export interface RunViewProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly twoPane: boolean;
}

/** Rows left for the tail in one pane: header, notice, graph title and rows, footer. */
export function singlePaneTailRows(viewModel: ViewModel): number {
  const run = viewModel.run;
  if (run === null) return 0;
  const headerRows = run.phase === "awaiting-approval" ? 2 : 1;
  const noticeRows = viewModel.notice === null ? 0 : viewModel.notice.split("\n").length;
  const graphRows = 1 + run.tasks.length;
  return Math.max(0, viewModel.rows - headerRows - noticeRows - graphRows - 1);
}

/** Rows left for the two-pane run tail: header, notice, footer. */
export function twoPaneTailRows(viewModel: ViewModel): number {
  const run = viewModel.run;
  if (run === null) return 0;
  const headerRows = run.phase === "awaiting-approval" ? 2 : 1;
  const noticeRows = viewModel.notice === null ? 0 : viewModel.notice.split("\n").length;
  return Math.max(0, viewModel.rows - headerRows - noticeRows - 1);
}

/** Rows left for the detail tail: header, notice, task facts, gate rows, footer. */
export function taskDetailTailRows(viewModel: ViewModel): number {
  const run = viewModel.run;
  if (run === null || run.detail === null) return 0;
  const headerRows = run.phase === "awaiting-approval" ? 2 : 1;
  const noticeRows = viewModel.notice === null ? 0 : viewModel.notice.split("\n").length;
  // Title, status, agent, retries, Gates heading, gate rows, Activity heading.
  const detailRows = 6 + Math.max(1, run.detail.gates.length);
  return Math.max(0, viewModel.rows - headerRows - noticeRows - detailRows - 1);
}

export function RunView({ viewModel, glyphs, depth, twoPane }: RunViewProps): ReactElement {
  const run = viewModel.run;
  if (run === null) {
    return <Text>No run selected.</Text>;
  }
  return (
    <Box flexDirection="column">
      <RunHeader run={run} glyphs={glyphs} depth={depth} />
      {viewModel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {viewModel.notice}
        </Text>
      )}
      {twoPane ? (
        <Box flexDirection="row">
          <Box flexDirection="column" width={Math.floor(viewModel.columns / 2)}>
            <TaskGraph tasks={run.tasks} glyphs={glyphs} depth={depth} />
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
            {run.detail === null ? (
              <ActivityTail
                lines={run.activity}
                glyphs={glyphs}
                depth={depth}
                maxLines={twoPaneTailRows(viewModel)}
              />
            ) : (
              <TaskDetail
                detail={run.detail}
                glyphs={glyphs}
                depth={depth}
                maxLines={taskDetailTailRows(viewModel)}
              />
            )}
          </Box>
        </Box>
      ) : run.detail === null ? (
        <Box flexDirection="column">
          <TaskGraph tasks={run.tasks} glyphs={glyphs} depth={depth} />
          <ActivityTail
            lines={run.activity}
            glyphs={glyphs}
            depth={depth}
            maxLines={singlePaneTailRows(viewModel)}
          />
        </Box>
      ) : (
        <TaskDetail
          detail={run.detail}
          glyphs={glyphs}
          depth={depth}
          maxLines={taskDetailTailRows(viewModel)}
        />
      )}
    </Box>
  );
}
