import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { TaskRow } from "../model/view-model.ts";
import { sliceWindow, type Window, windowTitle } from "../model/viewport.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { clip, colorProps, statusGlyph, statusToken } from "./style.ts";

export interface TaskGraphProps {
  readonly tasks: readonly TaskRow[];
  readonly window: Window;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** The graph pane's columns; each row is clipped so Ink never cuts it with its `…`. */
  readonly columns: number;
}

export function TaskGraph({ tasks, window, glyphs, depth, columns }: TaskGraphProps): ReactElement {
  const title = windowTitle("tasks", window);
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Tasks</Text>
        {title === null ? null : (
          <Text {...colorProps("muted", depth)}>{` ${glyphs.bullet} ${title}`}</Text>
        )}
      </Text>
      {sliceWindow(tasks, window).map((task) => {
        const marker = task.selected ? glyphs.focus : " ";
        const glyph = statusGlyph(task.status, glyphs);
        const head = `${marker} [${glyph}] `;
        const rest = `${task.id} ${task.status} ${task.repo} attempt ${task.attempt} ${task.title}`;
        if (columns <= head.length) {
          return (
            <Text key={task.id} wrap="truncate" {...(task.selected ? { bold: true } : {})}>
              {clip(`${head}${rest}`, columns, glyphs)}
            </Text>
          );
        }
        return (
          <Text key={task.id} wrap="truncate" {...(task.selected ? { bold: true } : {})}>
            <Text {...(task.selected ? colorProps("focus", depth) : {})}>{marker}</Text> [
            <Text {...colorProps(statusToken(task.status), depth)}>{glyph}</Text>]{" "}
            {clip(rest, columns - head.length, glyphs)}
          </Text>
        );
      })}
    </Box>
  );
}
