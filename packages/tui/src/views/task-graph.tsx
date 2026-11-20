import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { truncate } from "../model/format.ts";
import type { TaskRow } from "../model/view-model.ts";
import { sliceWindow, type Window, windowTitle } from "../model/viewport.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, statusGlyph, statusToken } from "./style.ts";

export interface TaskGraphProps {
  readonly tasks: readonly TaskRow[];
  readonly window: Window;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

export function TaskGraph({ tasks, window, glyphs, depth }: TaskGraphProps): ReactElement {
  const title = windowTitle("tasks", window);
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Tasks</Text>
        {title === null ? null : (
          <Text {...colorProps("muted", depth)}>{` ${glyphs.bullet} ${title}`}</Text>
        )}
      </Text>
      {sliceWindow(tasks, window).map((task) => (
        <Text key={task.id} wrap="truncate" {...(task.selected ? { bold: true } : {})}>
          <Text {...(task.selected ? colorProps("focus", depth) : {})}>
            {task.selected ? glyphs.focus : " "}
          </Text>{" "}
          [
          <Text {...colorProps(statusToken(task.status), depth)}>
            {statusGlyph(task.status, glyphs)}
          </Text>
          ] {task.id} {task.status} {task.repo} attempt {task.attempt} {truncate(task.title, 40)}
        </Text>
      ))}
    </Box>
  );
}
