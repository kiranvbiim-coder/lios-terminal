import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { REMOTE_FINANCE_CAPABILITY, remoteFinanceReportSchema, remoteNodeMethods, remoteNodePlacementPolicySchema, remoteNodePlacementSelectionSchema, remoteOperationOutcomeSchema } from "@shared/remoteNode";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import type { GovernedToolCall } from "./governedTools";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";

/** Bound by the server to the calling live Gateway connection. Never accepted
 * from request/model arguments; the existing Gateway handlers own all checks. */
export interface NodeFinanceGatewaySession {
  userId: number;
  request(method: "node.operation.select" | "node.finance.run", params: unknown): Promise<unknown>;
}

const financePolicySchema = remoteNodePlacementPolicySchema.options[1];
export const nodeFinanceToolInputSchema = z.object({ policy: financePolicySchema }).strict();
export const nodeFinanceToolOutputSchema = z.object({
  output: z.object({
    report: remoteFinanceReportSchema,
    selection: remoteNodePlacementSelectionSchema,
    outcome: remoteOperationOutcomeSchema,
    composition: z.object({
      provider: z.literal("user-owned-node-profile"),
      model: z.literal("lios.personal-finance.core-v1"),
      engineVersion: z.literal("1.1.0"),
      privacy: z.literal("node-local-profile-bounded-summary-to-owner-home"),
      maxAiCalls: z.literal(0),
      inferenceRequired: z.literal(false),
      dataRights: z.literal("user-owned-profile"),
      permittedUse: z.literal("owner-requested-deterministic-summary"),
      policyHash: z.string().regex(/^[a-f0-9]{64}$/),
      outputHash: z.string().regex(/^[a-f0-9]{64}$/),
      trust: z.literal("authenticated-paired-node-remote-reported-not-independent-attestation"),
    }).strict(),
  }).strict(),
  summary: z.string().max(2_000), deterministic: z.literal(true),
  sourceRefs: z.array(z.string().min(1).max(1_000)).max(12),
}).strict();

/** Canonical P6 execution, not a joint-router plan. AI explanation is a
 * separate owner-selected conversation step; this source tool cannot expose
 * a private node report to an agent or silently replace it with Home data. */
export function createNodeFinanceTool(dependencies: {
  sessionForCall: (call: GovernedToolCall) => NodeFinanceGatewaySession | null;
}): ConversationToolDefinition {
  return {
    id: "lios.finance.node_snapshot", label: "Calculate an exact owner-selected paired-node personal-finance snapshot",
    kind: "calculate", permissionClass: "safe_auto", access: "write", sideEffect: "internal_write", replaySafe: false,
    inputSchema: nodeFinanceToolInputSchema,
    outputSchema: nodeFinanceToolOutputSchema.transform((value): ConversationToolResult => value),
    maxOutputBytes: 32 * 1024, cancel: null,
    invoke: async (raw, signal, call) => {
      assertNotAborted(signal);
      if (call.source !== "workflow" || !call.requestId || !call.userId || !sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
        throw new Error("Node finance requires an owner-requested governed workflow in Auto or My Data scope; agent and Web/Files access is not permitted.");
      }
      const input = nodeFinanceToolInputSchema.parse(raw);
      const session = dependencies.sessionForCall(call);
      if (!session || session.userId !== call.userId) throw new Error("A current same-owner Gateway session is required for node finance; Home fallback is forbidden.");
      const requestId = randomUUID();
      const selection = remoteNodeMethods["node.operation.select"].result.parse(await session.request("node.operation.select", { requestId, policy: input.policy }));
      assertNotAborted(signal);
      const policyHash = createHash("sha256").update(JSON.stringify(input.policy)).digest("hex");
      if (selection.userId !== call.userId || selection.requestId !== requestId || selection.target.capability !== REMOTE_FINANCE_CAPABILITY || selection.policyHash !== policyHash || JSON.stringify(selection.policy) !== JSON.stringify(input.policy)) {
        throw new Error("Node selection does not match the exact owner, capability or source policy.");
      }
      const outcome = remoteNodeMethods["node.finance.run"].result.parse(await session.request("node.finance.run", {
        ...selection.target, requestId, placement: { policy: input.policy, selection },
      }));
      assertNotAborted(signal);
      const binding = outcome.binding;
      const placementDigest = createHash("sha256").update(JSON.stringify(selection)).digest("hex");
      if (outcome.status !== "completed" || outcome.reason !== "reported" || outcome.outcome !== "remote-reported"
        || binding.capability !== REMOTE_FINANCE_CAPABILITY || binding.userId !== call.userId || binding.requestId !== requestId
        || binding.deviceId !== selection.target.deviceId || binding.generationId !== selection.target.generationId || binding.placementDigest !== placementDigest
        || outcome.homeVerified.authenticatedDeviceId !== binding.deviceId || outcome.homeVerified.connectionGenerationId !== binding.generationId || outcome.homeVerified.capability !== binding.capability
        || JSON.stringify(binding.source) !== JSON.stringify(input.policy.source)) {
        throw new Error("The exact paired-node P6 operation did not complete with current matching provenance; no fallback or automatic retry is permitted.");
      }
      const report = remoteFinanceReportSchema.parse(outcome.report);
      if (report.source.sourceId !== input.policy.source.sourceId || report.source.inputHash !== input.policy.source.inputHash) throw new Error("Node finance output source changed.");
      const outputHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
      return nodeFinanceToolOutputSchema.parse({
        output: { report, selection, outcome, composition: {
          provider: "user-owned-node-profile", model: report.engineId, engineVersion: report.engineVersion,
          privacy: "node-local-profile-bounded-summary-to-owner-home", maxAiCalls: 0, inferenceRequired: false,
          dataRights: "user-owned-profile", permittedUse: "owner-requested-deterministic-summary", policyHash, outputHash,
          trust: "authenticated-paired-node-remote-reported-not-independent-attestation",
        } },
        summary: `Canonical P6 ${report.asOf} snapshot computed on the exact paired node; private source profile stayed node-local. Result is remote-reported, not independently attested. No AI was called.`,
        deterministic: true,
        sourceRefs: [`node:${binding.deviceId}`, `node-generation:${binding.generationId}`, `node-finance-source:${report.source.sourceId}`, `input-sha256:${report.source.inputHash}`, `engine:${report.engineId}@${report.engineVersion}`, `engine-input-sha256:${report.engineInputHash}`, `execution-session:${requestId}`, `placement-sha256:${placementDigest}`, `source-policy-sha256:${policyHash}`, `output-sha256:${outputHash}`],
      });
    },
  };
}
