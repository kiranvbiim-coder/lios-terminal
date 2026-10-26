import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-doctor-"));
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
process.env.LIOS_EXECUTION_ISOLATION = "strict";
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { executeConversationRuntime, planConversationWorkflow } = await import("./conversationRuntime");
const { conversationRequestSchema } = await import("@shared/conversationRuntime");
const { runtimeDoctorTool, configureRuntimeDoctorProvisioning } = await import("./runtimeDoctorTool");

const request = (message: string) => conversationRequestSchema.parse({ requestId: crypto.randomUUID(), message, executionMode: "deterministic_first" });

test("runtime Doctor is read-only, owner-scoped and available without a model", async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner, other] = await getDb().insert(users).values([
    { email: "doctor-owner@example.test", passwordHash: "test-only", name: "Doctor Owner", role: "internal_admin" as const },
    { email: "doctor-other@example.test", passwordHash: "test-only", name: "Other Owner", role: "internal_admin" as const },
  ]).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Runtime diagnosis" });
  for (const message of ["LiOS doctor", "Please check my runtime health", "diagnose Python runtime"]) {
    const plan = planConversationWorkflow(request(message));
    assert.equal(plan.intent.parameters.workflow, "runtime_doctor");
    assert.equal(plan.intent.requiresAI, false);
  }
  for (const message of ["What is the Python runtime?", "Check the runtime of my valuation model", "Install Python packages"]) {
    assert.notEqual(planConversationWorkflow(request(message)).intent.parameters.workflow, "runtime_doctor");
  }
  const events: ConversationRuntimeEvent[] = [];
  const result = await executeConversationRuntime({
    tenant, scope: "project", projectId: project.id, chatId: null, history: [], request: request("LiOS doctor"),
    aiCompletion: async () => { throw new Error("Runtime diagnosis must not call AI"); },
    emit: event => { events.push(event); },
  });
  assert.match(result.text, /Managed runtime: missing/);
  assert.match(result.text, /strict_provisioning_authority_missing/);
  assert.equal(result.label, "deterministic");
  const receipt = events.find(event => event.type === "receipt");
  assert.ok(receipt && receipt.type === "receipt");
  assert.equal(receipt.receipt.deterministic, true);
  configureRuntimeDoctorProvisioning(true);
  t.after(() => configureRuntimeDoctorProvisioning(false));
  const available = await executeConversationRuntime({
    tenant, scope: "quick", projectId: null, chatId: null, history: [], request: request("LiOS doctor"),
    aiCompletion: async () => { throw new Error("Diagnosis must not invoke AI"); }, emit: () => {},
  });
  assert.match(available.text, /Managed runtime: missing/);
  assert.doesNotMatch(available.text, /Repair blocked: strict_provisioning_authority_missing/);
  configureRuntimeDoctorProvisioning(false);
  assert.ok(!fs.existsSync(path.join(root, "runtime", "python", "current")), "diagnosis must not install a runtime");
  const call = { source: "workflow" as const, requestId: crypto.randomUUID(), userId: other.id, projectId: project.id,
    tenant: { userId: other.id, organizationId: null, role: other.role } };
  await assert.rejects(runtimeDoctorTool.invoke({}, new AbortController().signal, call), /Project not found|not owned/);
  await assert.rejects(runtimeDoctorTool.invoke({}, new AbortController().signal, { ...call, userId: owner.id }), /authenticated governed call/);
  const quick = await executeConversationRuntime({
    tenant, scope: "quick", projectId: null, chatId: null, history: [], request: request("Check runtime health"),
    aiCompletion: async () => { throw new Error("Quick diagnosis must not call AI"); }, emit: () => {},
  });
  assert.match(quick.text, /Managed runtime: missing/);
  const { eq } = await import("drizzle-orm");
  await getDb().update(users).set({ active: false }).where(eq(users.id, owner.id));
  await assert.rejects(runtimeDoctorTool.invoke({}, new AbortController().signal, {
    source: "workflow", requestId: crypto.randomUUID(), userId: owner.id, projectId: null, tenant,
  }), /current active account/);
});
