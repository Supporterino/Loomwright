import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatElapsed, truncate } from "../model/format.ts";
import type { GateRow, TaskDetail as TaskDetailView } from "../model/view-model.ts";
import type { GlyphSet } from "../theme/glyphs.ts";
import type { ColorDepth } from "../theme/tokens.ts";
import { ActivityTail } from "./activity.tsx";
import { colorProps, gateLine, statusGlyph, statusToken } from "./style.ts";

export interface TaskDetailProps {
  readonly detail: TaskDetailView;
  readonly glyphs: GlyphSet;
  readonly depth: ColorDepth;
  /** Rows left for the activity tail, so the newest lines fit inside the frame. */
  readonly maxLines: number;
  /** Rows the gate list may use; the last one counts the gates it hides. */
  readonly gateRows: number;
}

/** The fact labels; the widest one sets the column the values line up in. */
const FACT_LABELS = [
  "task",
  "status",
  "repo",
  "attempt",
  "retries",
  "agent",
  "model",
  "duration",
] as const;

interface GateWindow {
  readonly shown: readonly GateRow[];
  readonly more: number;
}

/**
 * The rows that fit, cutting the tail of the list; the final row counts what it hides so a gate
 * result is never silently dropped. With no row to spare the count moves into the title instead.
 */
function windowGates(gates: readonly GateRow[], rows: number): GateWindow {
  if (rows <= 0) return { shown: [], more: gates.length };
  if (gates.length <= rows) return { shown: gates, more: 0 };
  const shown = gates.slice(0, rows - 1);
  return { shown, more: gates.length - shown.length };
}

interface Fact {
  readonly label: string;
  readonly value: string;
  readonly bold: boolean;
}

function factsOf(detail: TaskDetailView, glyphs: GlyphSet): readonly Fact[] {
  const { task, agent, retries } = detail;
  return [
    {
      label: "task",
      value: `${task.id} ${glyphs.bullet} ${truncate(task.title, 56)}`,
      bold: true,
    },
    { label: "status", value: task.status, bold: false },
    { label: "repo", value: task.repo, bold: false },
    { label: "attempt", value: String(task.attempt), bold: false },
    { label: "retries", value: String(retries), bold: false },
    { label: "agent", value: agent === null ? "(none)" : agent.role, bold: false },
    {
      label: "model",
      value: agent === null || agent.model === "" ? "unknown" : agent.model,
      bold: false,
    },
    {
      label: "duration",
      value: agent === null || agent.durationMs === null ? "-" : formatElapsed(agent.durationMs),
      bold: false,
    },
  ];
}

export function TaskDetail({
  detail,
  glyphs,
  depth,
  maxLines,
  gateRows,
}: TaskDetailProps): ReactElement {
  const { gates, activity } = detail;
  const facts = factsOf(detail, glyphs);
  const labelWidth = Math.max(...FACT_LABELS.map((label) => label.length));
  const nameWidth = gates.reduce((width, gate) => Math.max(width, gate.name.length), 0);
  const statusWidth = gates.reduce((width, gate) => Math.max(width, gate.status.length), 0);
  const widths = { name: nameWidth, status: statusWidth };
  const gateWindow = windowGates(gates, gateRows);
  // No gate row fits: the count folds into the title row the fixed budget already pays for.
  const foldedGates = gateRows <= 0 && gates.length > 0;
  return (
    <Box flexDirection="column">
      {facts.map((fact) => (
        <Text key={fact.label} wrap="truncate">
          <Text {...colorProps("muted", depth)}>{fact.label.padEnd(labelWidth)}</Text>{" "}
          <Text {...(fact.bold ? { bold: true } : {})}>{fact.value}</Text>
        </Text>
      ))}
      <Text bold>{foldedGates ? `Gates ${glyphs.bullet} ${gateWindow.more} hidden` : "Gates"}</Text>
      {gates.length === 0 ? (
        <Text {...colorProps("muted", depth)}>no gate results</Text>
      ) : (
        <>
          {gateWindow.shown.map((gate) => (
            <Text key={`${gate.step}-${gate.name}`} wrap="truncate">
              <Text {...colorProps(statusToken(gate.status), depth)}>
                {statusGlyph(gate.status, glyphs)}
              </Text>{" "}
              {gateLine(gate.name, gate.status, formatElapsed(gate.durationMs), widths)}
            </Text>
          ))}
          {gateWindow.more === 0 || foldedGates ? null : (
            <Text {...colorProps("muted", depth)}>{`${gateWindow.more} more gates`}</Text>
          )}
        </>
      )}
      <Text bold>Activity</Text>
      <ActivityTail lines={activity} glyphs={glyphs} depth={depth} maxLines={maxLines} />
    </Box>
  );
}
