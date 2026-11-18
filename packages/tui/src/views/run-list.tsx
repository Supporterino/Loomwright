import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, formatTokensShort } from "../model/format.ts";
import { roleLabel, type ViewModel } from "../model/view-model.ts";
import { LABELS } from "../strings.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { colorProps, joinFields } from "./style.ts";

export interface RunListProps {
  readonly viewModel: ViewModel;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
}

export function RunList({ viewModel, glyphs, depth }: RunListProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Runs</Text>
      {viewModel.list.map((item) => (
        <Text key={item.id} wrap="truncate">
          <Text {...(item.selected ? colorProps("focus", depth) : {})}>
            {item.selected ? glyphs.focus : " "}
          </Text>{" "}
          {joinFields(glyphs, [
            item.id,
            LABELS[item.phase],
            roleLabel(item.role),
            `${formatTokensShort(item.tokens)} tokens`,
            `$${item.cost.toFixed(2)}`,
            formatElapsed(item.elapsedMs),
          ])}
        </Text>
      ))}
      {viewModel.notice === null ? null : (
        <Text {...colorProps("muted", depth)} wrap="truncate">
          {viewModel.notice}
        </Text>
      )}
    </Box>
  );
}
