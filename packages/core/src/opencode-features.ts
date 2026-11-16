import type { FactoryConfig } from "./config/schema.ts";
import { compareVersions } from "./tools.ts";

/** opencode-dependent capabilities whose effective floor can sit above OPENCODE.min. */
export type OpencodeFeatureId = "mcp.roles";

export interface OpencodeFeature {
  /** Lowest opencode version that provides the capability. */
  readonly min: string;
  /** Why the floor exists; used verbatim in init/update/doctor messages. */
  readonly why: string;
}

export const OPENCODE_FEATURES: Readonly<Record<OpencodeFeatureId, OpencodeFeature>> = {
  "mcp.roles": {
    min: "2.2.0",
    why: "direct MCP/plugin tool exposure when `execute` is denied, which makes `config.mcp.roles` effective",
  },
};

export type OpencodeRequirement = { readonly min: string; readonly reason: string };

/** Feature ids the config actually turns on. A role with an empty pattern list does not count. */
export function enabledOpencodeFeatures(config: Pick<FactoryConfig, "mcp">): OpencodeFeatureId[] {
  const enabled: OpencodeFeatureId[] = [];
  if (Object.values(config.mcp.roles).some((patterns) => (patterns?.length ?? 0) > 0)) {
    enabled.push("mcp.roles");
  }
  return enabled;
}

/** Highest enabled feature floor, or undefined when the base floor is enough. */
export function opencodeRequirement(
  config: Pick<FactoryConfig, "mcp">,
): OpencodeRequirement | undefined {
  let requirement: OpencodeRequirement | undefined;
  for (const id of enabledOpencodeFeatures(config)) {
    const feature = OPENCODE_FEATURES[id];
    if (requirement === undefined || compareVersions(feature.min, requirement.min) > 0) {
      requirement = {
        min: feature.min,
        reason: `${id} needs opencode >= ${feature.min}: ${feature.why}`,
      };
    }
  }
  return requirement;
}
