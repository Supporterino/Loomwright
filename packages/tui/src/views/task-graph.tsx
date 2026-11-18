import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { truncate } from "../model/format.ts";
import type { TaskRow } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, statusGlyph, statusToken } from "./style.ts";

export interface TaskGraphProps {
  readonly tasks: readonly TaskRow[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

export function TaskGraph({ tasks, glyphs, depth }: TaskGraphProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Tasks</Text>
      {tasks.map((task) => (
        <Text key={task.id} wrap="truncate">
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
