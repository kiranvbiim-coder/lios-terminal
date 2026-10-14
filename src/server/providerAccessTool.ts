import { z } from "zod";
import {
  canonicalDataCapabilitySchema,
  providerAccessPostureSchema,
} from "@shared/universalDataFabric";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { describeProviderAccess } from "./providerSdk";
import { getProject } from "./projectStore";
import { assertNotAborted } from "./conversationRuntimeCore";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const providerAccessToolInputSchema = z.object({
  capability: canonicalDataCapabilitySchema,
  pointInTimeMode: z.enum(["latest", "as_known_on", "revision_exact"]).default("latest"),
  providerAllow: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  providerDeny: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
}).strict();

export const providerAccessToolOutputSchema = z.object({
  output: z.object({
    capability: canonicalDataCapabilitySchema,
    providers: z.array(providerAccessPostureSchema).max(100),
    providerCount: z.number().int().nonnegative(),
    secretMaterialExposed: z.literal(false),
    dataFetchPerformed: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

export const providerAccessTool: ConversationToolDefinition = {
  id: "lios.provider.access",
  label: "Inspect provider capability, entitlement, locality and AI-use posture without fetching data",
  kind: "resolve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: providerAccessToolInputSchema,
  outputSchema: providerAccessToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 64 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Provider access inspection requires an authenticated governed agent call.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId) throw new Error("Provider access owner scope does not match the governed call.");
    const projectId = Number(call.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Provider access inspection requires an active Project.");
    }
    await getProject(tenant, projectId);

    const parsed = providerAccessToolInputSchema.parse(input);
    const providers = describeProviderAccess({
      capability: parsed.capability,
      pointInTimeMode: parsed.pointInTimeMode,
      providerAllow: parsed.providerAllow,
      providerDeny: parsed.providerDeny,
    });
    assertNotAborted(signal);

    return {
      output: {
        capability: parsed.capability,
        providers,
        providerCount: providers.length,
        secretMaterialExposed: false,
        dataFetchPerformed: false,
      },
      summary: providers.length
        ? `Inspected ${providers.length} provider access posture${providers.length === 1 ? "" : "s"} for ${parsed.capability} without fetching provider data. Unknown rights remain unknown.`
        : `No provider metadata remains after capability and provider-policy filtering for ${parsed.capability}; no provider data was fetched.`,
      deterministic: true,
      sourceRefs: providers.map((provider) => `provider:${provider.providerId}`),
    };
  },
};
