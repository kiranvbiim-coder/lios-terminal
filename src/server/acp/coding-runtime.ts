import {
  runtimeComponentDescriptorSchema,
  type RuntimeAdapter,
} from "@shared/runtimeContracts";
import { codingWorkspaceConfigured } from "./coding-workspace";

export const GOVERNED_CODING_WORKSPACE_DESCRIPTOR = runtimeComponentDescriptorSchema.parse({
  contractVersion: "1",
  id: "coding:lios-governed-workspace",
  kind: "agent",
  name: "LiOS governed coding workspace",
  version: "1",
  lifecycle: "optional",
  executionScopes: ["node_worker", "local_api"],
  capabilities: [
    "coding:inspect",
    "coding:patch-preview",
    "coding:patch-apply",
    "coding:checks",
    "coding:acp-session-identity",
  ],
  permissions: ["coding:write", "coding:execute"],
  runtimePackId: null,
  replaceable: true,
  source: {
    origin: "lios",
    importedPaths: [],
    modified: false,
  },
});

/**
 * Truthful discovery for the LiOS-native governed coding path. It does not
 * imply that any third-party ACP transport or vendor CLI was verified.
 */
export function createGovernedCodingWorkspaceAdapter(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAdapter {
  return {
    descriptor: GOVERNED_CODING_WORKSPACE_DESCRIPTOR,
    async health() {
      const ready = await codingWorkspaceConfigured(env);
      return {
        componentId: GOVERNED_CODING_WORKSPACE_DESCRIPTOR.id,
        state: ready ? "available" : "disabled",
        detail: ready
          ? "A server-owned coding workspace is configured; governed inspect, patch and check operations are available through the canonical agent authority."
          : "Governed coding is disabled until LIOS_CODING_WORKSPACE_ROOT names a user-owned workspace on this node.",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
