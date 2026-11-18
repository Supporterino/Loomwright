import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { PanelView } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps } from "./style.ts";

export interface PanelBoxProps {
  readonly panel: PanelView;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

/** The generic bordered box 1.5-1.7 fill with a `PanelView`; it owns no panel-specific content. */
export function PanelBox({ panel, glyphs, depth }: PanelBoxProps): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="classic" {...colorProps("focus", depth)} paddingX={1}>
      <Text bold>{panel.title}</Text>
      {panel.lines.map((line) => (
        <Text key={line} wrap="truncate">
          {line}
        </Text>
      ))}
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
