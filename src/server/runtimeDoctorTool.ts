import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { users } from "@shared/schema";
import { getDb } from "./db";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { getProject } from "./projectStore";
import { assertNotAborted } from "./conversationRuntimeCore";
import { readManagedRuntimeState, managedRuntimePythonPath } from "./pythonRuntimeManager";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import { planManagedRuntimeRepair } from "./doctorRepairPlan";
import { getEnvironmentSetupStatus } from "./environmentSetupService";
import { inspectRunningPythonService } from "./pythonService";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export function inspectRuntimeDoctor() {
  const state = readManagedRuntimeState();
  const readiness = evaluateManagedRuntimeReadiness({
    state,
    pythonAvailable: managedRuntimePythonPath() !== null,
    requiredPackIds: ["core"],
  });
  const repair = planManagedRuntimeRepair(readiness, { isolationMode: "strict" });
  return { readiness, repair, mutationPerformed: false as const, credentialValuesExposed: false as const };
}

export const runtimeDoctorTool: ConversationToolDefinition = {
  id: "lios.runtime.doctor",
  label: "Diagnose managed runtime readiness and safe repair prerequisites without executing a repair",
  planningHint: "Use for LiOS runtime/Python/Core health or Doctor requests. Input {}. Returns current canonical readiness and repair blockers; never installs, runs commands, grants authority or retries the user's task.",
  kind: "resolve", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ output: z.record(z.unknown()), summary: z.string().max(2_000), deterministic: z.literal(true), sourceRefs: z.array(z.string()) }).strict().transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024, cancel: null,
  invoke: async (_input, signal, call) => {
    assertNotAborted(signal);
    const tenant = tenantSchema.parse(call.tenant);
    if ((call.source !== "workflow" && call.source !== "agent") || !call.requestId || call.userId !== tenant.userId) {
      throw new Error("Runtime diagnosis requires an authenticated governed call.");
    }
    const [actor] = await getDb().select({ id: users.id, mustChangePassword: users.mustChangePassword, lockedUntil: users.lockedUntil }).from(users).where(and(
      eq(users.id, tenant.userId), eq(users.role, tenant.role), eq(users.active, true),
      tenant.organizationId === null ? isNull(users.organizationId) : eq(users.organizationId, tenant.organizationId),
    )).limit(1);
    if (!actor || actor.mustChangePassword || (actor.lockedUntil && actor.lockedUntil.getTime() > Date.now())) throw new Error("Runtime diagnosis requires a current active account.");
    if (call.projectId !== null && call.projectId !== undefined) {
      const projectId = Number(call.projectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("Invalid diagnostic Project scope.");
      await getProject(tenant, projectId);
    }
    const [environment, pythonService] = await Promise.all([getEnvironmentSetupStatus(tenant.userId), inspectRunningPythonService()]);
    const selectedConnectorIds = environment.setup?.selectedConnectorIds ?? [];
    const output = {
      ...inspectRuntimeDoctor(),
      pythonService,
      account: { role: tenant.role, administratorRepairRequired: true },
      connectors: environment.connectors.health.filter((entry) => selectedConnectorIds.includes(entry.connectorId)),
      onboarding: {
        aiRequired: false, selectedConnectorCount: selectedConnectorIds.length,
        availableWithoutAi: ["Projects", "Chats", "Artifact Library", "LiOS Doctor"],
        nextAction: "Use Connections to inspect current runtime prerequisites; missing AI or providers never blocks local Project organization or this diagnosis.",
      },
    };
    assertNotAborted(signal);
    return {
      output,
      summary: `Managed runtime: ${output.readiness.state}. ${output.repair.summary} ${output.repair.executionBlocker ? `Repair blocked: ${output.repair.executionBlocker}.` : ""} Selected connectors: ${selectedConnectorIds.length}; ${output.connectors.filter((entry) => entry.state === "live_verified").length} live verified. ${pythonService.reason} Projects, Chats and Library remain available without AI. No repair, download or task execution was performed.`,
      deterministic: true, sourceRefs: ["runtime:managed-python", "policy:managed-runtime-readiness"],
    };
  },
};
