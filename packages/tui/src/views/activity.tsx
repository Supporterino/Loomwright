import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ActivityLine } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps } from "./style.ts";

export interface ActivityTailProps {
  readonly lines: readonly ActivityLine[];
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  readonly maxLines?: number;
}

/** Renders the already-capped lines from `EventFacts.activity`; `maxLines` clips to the rows left. */
export function ActivityTail({
  lines,
  glyphs,
  depth,
  maxLines = 20,
}: ActivityTailProps): ReactElement {
  const count = Math.max(0, maxLines);
  const shown = count === 0 ? [] : lines.slice(Math.max(0, lines.length - count));
  if (shown.length === 0) {
    return <Text {...colorProps("muted", depth)}>no activity yet</Text>;
  }
  return (
    <Box flexDirection="column">
      {shown.map((line) => (
        <Text key={line.seq} wrap="truncate">
          {line.step} {glyphs.bullet} {line.kind} {glyphs.bullet} {line.text}
          {line.logRef === undefined ? "" : ` ${glyphs.arrow} ${line.logRef}`}
        </Text>
      ))}
    </Box>
  );
}
