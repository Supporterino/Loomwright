import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, truncate } from "../model/format.ts";
import type { TaskDetail as TaskDetailView } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { ActivityTail } from "./activity.tsx";
import { colorProps, joinFields, statusGlyph, statusToken } from "./style.ts";

export interface TaskDetailProps {
  readonly detail: TaskDetailView;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** Rows left for the activity tail, so the newest lines fit inside the frame. */
  readonly maxLines: number;
}

export function TaskDetail({ detail, glyphs, depth, maxLines }: TaskDetailProps): ReactElement {
  const { task, agent, retries, gates, activity } = detail;
  const agentLine =
    agent === null
      ? "agent (none)"
      : joinFields(glyphs, [
          `agent ${agent.role}`,
          `model ${agent.model === "" ? "unknown" : agent.model}`,
          `duration ${agent.durationMs === null ? "-" : formatElapsed(agent.durationMs)}`,
        ]);
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {task.id} {glyphs.bullet} {truncate(task.title, 56)}
      </Text>
      <Text wrap="truncate">
        {joinFields(glyphs, [
          `status ${task.status}`,
          `repo ${task.repo}`,
          `attempt ${task.attempt}`,
        ])}
      </Text>
      <Text wrap="truncate">{agentLine}</Text>
      <Text>{`retries ${retries}`}</Text>
      <Text bold>Gates</Text>
      {gates.length === 0 ? (
        <Text {...colorProps("muted", depth)}>no gate results</Text>
      ) : (
        gates.map((gate) => (
          <Text key={`${gate.step}-${gate.name}`} wrap="truncate">
            <Text {...colorProps(statusToken(gate.status), depth)}>
              {statusGlyph(gate.status, glyphs)}
            </Text>{" "}
            {gate.name} {gate.status} {formatElapsed(gate.durationMs)}
          </Text>
        ))
      )}
      <Text bold>Activity</Text>
      <ActivityTail lines={activity} glyphs={glyphs} depth={depth} maxLines={maxLines} />
    </Box>
  );
}
