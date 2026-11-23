import { Box, Text } from "ink";
import type { ReactElement } from "react";
import {
  type ActivityLine,
  singlePaneTailRows,
  TAIL_FLOOR,
  taskDetailGateRows,
  taskDetailTailRows,
  twoPaneTailRows,
  type ViewModel,
} from "../model/view-model.ts";
import { nextOffset, type Window } from "../model/viewport.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { ActivityTail } from "./activity.tsx";
import { RunHeader } from "./header.tsx";
import { colorProps } from "./style.ts";
import { TaskDetail } from "./task-detail.tsx";
import { TaskGraph } from "./task-graph.tsx";

export { singlePaneTailRows, taskDetailTailRows, twoPaneTailRows };

export interface RunViewProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly twoPane: boolean;
}

interface SinglePaneBudget {
  readonly window: Window;
  readonly tailRows: number;
}

/**
 * The restyle adds a blank line and an `Activity` title the view-model budget does not know about.
 * When the tail would overflow, the graph gives up the rows instead: the tail keeps its floor.
 * Only a budget below chrome plus the floor is a shortfall; a tail that already overflows needs
 * no task rows.
 */
function singlePaneBudget(viewModel: ViewModel): SinglePaneBudget {
  const window = viewModel.taskWindow;
  const run = viewModel.run;
  const budget = singlePaneTailRows(viewModel);
  if (run === null) return { window, tailRows: budget };
  const chrome = 2;
  const shownTasks = Math.min(run.tasks.length, window.size);
  const overflow = Math.max(0, run.activity.length - Math.max(0, budget - chrome));
  const shortfall = Math.max(0, chrome + TAIL_FLOOR - budget);
  const removed = Math.min(chrome, shownTasks, overflow, shortfall);
  const size = Math.max(0, window.size - removed);
  const index = run.tasks.findIndex((task) => task.selected);
  return {
    window: {
      offset: nextOffset(window.offset, index, window.total, size),
      size,
      total: window.total,
    },
    tailRows: Math.max(0, budget - chrome + removed),
  };
}

function ActivitySection({
  lines,
  glyphs,
  depth,
  maxLines,
  spaced,
  columns,
}: {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly maxLines: number;
  readonly spaced: boolean;
  readonly columns: number;
}): ReactElement {
  return (
    <>
      {spaced ? <Text> </Text> : null}
      <Text bold>Activity</Text>
      <ActivityTail
        lines={lines}
        glyphs={glyphs}
        depth={depth}
        maxLines={maxLines}
        columns={columns}
      />
    </>
  );
}

export function RunView({ viewModel, glyphs, depth, twoPane }: RunViewProps): ReactElement {
  const run = viewModel.run;
  if (run === null) {
    return <Text>No run selected.</Text>;
  }
  const single = singlePaneBudget(viewModel);
  // One column of padding on each side; the right pane spends one more on its left padding, so its
  // content gets the remainder minus that column. Counting it here keeps a full-width line out of
  // Ink's own truncation, which always ends in the non-ASCII ellipsis.
  const inner = Math.max(0, viewModel.columns - 2);
  const leftWidth = Math.max(0, Math.floor(inner / 2) - 1);
  const rightWidth = Math.max(0, inner - leftWidth - 1);
  return (
    <Box flexDirection="column" paddingX={1}>
      <RunHeader run={run} glyphs={glyphs} depth={depth} columns={inner} />
      {viewModel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {viewModel.notice}
        </Text>
      )}
      {twoPane ? (
        <Box flexDirection="row">
          <Box flexDirection="column" width={leftWidth}>
            <TaskGraph
              tasks={run.tasks}
              window={viewModel.taskWindow}
              glyphs={glyphs}
              depth={depth}
              columns={leftWidth}
            />
          </Box>
          <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
            {run.detail === null ? (
              <ActivitySection
                lines={run.activity}
                glyphs={glyphs}
                depth={depth}
                maxLines={Math.max(0, twoPaneTailRows(viewModel) - 2)}
                spaced={true}
                columns={rightWidth}
              />
            ) : (
              <TaskDetail
                detail={run.detail}
                glyphs={glyphs}
                depth={depth}
                maxLines={taskDetailTailRows(viewModel)}
                gateRows={taskDetailGateRows(viewModel)}
                columns={rightWidth}
              />
            )}
          </Box>
        </Box>
      ) : run.detail === null ? (
        <Box flexDirection="column">
          <TaskGraph
            tasks={run.tasks}
            window={single.window}
            glyphs={glyphs}
            depth={depth}
            columns={inner}
          />
          <ActivitySection
            lines={run.activity}
            glyphs={glyphs}
            depth={depth}
            maxLines={single.tailRows}
            spaced={true}
            columns={inner}
          />
        </Box>
      ) : (
        <TaskDetail
          detail={run.detail}
          glyphs={glyphs}
          depth={depth}
          maxLines={taskDetailTailRows(viewModel)}
          gateRows={taskDetailGateRows(viewModel)}
          columns={inner}
        />
      )}
    </Box>
  );
}
