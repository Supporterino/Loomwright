import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { PanelView } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, inkColor } from "./style.ts";

export interface PanelBoxProps {
  readonly panel: PanelView;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** The generic bordered box 1.5-1.7 fill with a `PanelView`; it owns no panel-specific content. */
export function PanelBox({ panel, glyphs, depth }: PanelBoxProps): ReactElement {
  // Coral belongs to the approval gate alone; every other panel is lilac.
  const token = panel.kind === "approval" ? "approval" : "focus";
  const borderColor = inkColor(token, depth);
  // Lines repeat (blank preview rows, log tails), so a key pairs each line with its occurrence.
  const occurrences = new Map<string, number>();
  return (
    <Box
      flexDirection="column"
      borderStyle="classic"
      {...(borderColor === undefined ? {} : { borderColor })}
      paddingX={1}
    >
      <Text bold {...colorProps(token, depth)}>
        {panel.title}
      </Text>
      {panel.lines.map((line) => {
        const count = (occurrences.get(line) ?? 0) + 1;
        occurrences.set(line, count);
        return (
          <Text key={`${line}#${count}`} wrap="truncate">
            {line}
          </Text>
        );
      })}
      {panel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {panel.notice}
        </Text>
      )}
      <Text {...colorProps("muted", depth)} wrap="truncate">
        {panel.keys.map((hint) => `${hint.key} ${hint.label}`).join(` ${glyphs.bullet} `)}
      </Text>
    </Box>
  );
}
