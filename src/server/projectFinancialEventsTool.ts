import { z } from "zod";
import { financialEventClassSchema } from "@shared/financialEventContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { currentProjectFinancialEvents } from "./projectFinancialEvents";
import { tenantContext } from "./tenantContext";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";

const inputSchema = z.object({
  eventClasses: z.array(financialEventClassSchema).max(10).optional(),
  entityRef: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();
const tenantSchema = z.object({
  userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();
const outputSchema = z.object({
  output: z.object({
    status: z.enum(["available", "unknown", "unavailable"]), events: z.array(z.unknown()).max(50),
    graph: z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).strict(),
    omittedEvents: z.number().int().nonnegative(), invalidDeclarations: z.number().int().nonnegative(), reason: z.string().nullable(),
  }).strict(),
  summary: z.string().max(2_000), deterministic: z.literal(true), sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict();

export const projectFinancialEventsTool: ConversationToolDefinition = {
  id: "lios.project.financial_events", label: "Inspect cited financial events and explicit relationship impacts", kind: "retrieve",
  permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
  inputSchema, outputSchema: outputSchema.transform((value): ConversationToolResult => value), maxOutputBytes: 256 * 1024, cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    if (call.source === "agent" && call.resourceTransmissionAllowed === false) {
      throw new Error("Project resource transmission is disabled; no financial event evidence was read.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) throw new Error("Financial event research requires Auto or My Data scope.");
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId || !call.requestId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0) {
      throw new Error("Financial event research requires authenticated Project context.");
    }
    const parsed = inputSchema.parse(input);
    const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
    const result = await currentProjectFinancialEvents(ctx, call.projectId!, { ...parsed, allowedSourceRefs: call.allowedSourceRefs, maxOutputBytes: 128 * 1024 });
    assertNotAborted(signal);
    return {
      output: result,
      summary: result.events.length
        ? `${result.events.length} source-declared financial event(s); impacts are explicit source declarations, not predictions. ${JSON.stringify(result.events.slice(0, 5).map(item => ({ ref: item.ref, eventClass: item.event.eventClass, title: item.title.slice(0, 120), sourceRef: item.sourceRef, period: item.event.period, effectiveAt: item.event.effectiveAt }))).slice(0, 1_600)}`
        : result.reason!,
      deterministic: true,
      sourceRefs: [...new Set(result.events.map(item => item.sourceRef))],
    };
  },
};
