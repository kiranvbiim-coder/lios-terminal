import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-coding-flow-db-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lios-coding-flow-repo-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_CODING_WORKSPACE_ROOT = workspace;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];

await fsp.writeFile(path.join(workspace, "check.test.mjs"), [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "test('coding check', () => assert.equal(2 + 2, 4));",
  "",
].join("\n"));

const { initDb, closeDb, getDb } = await import("../db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("../projectStore");
const { createProjectChat } = await import("../projectChatStore");
const { listProjectResources } = await import("../projectResourceStore");
const {
  getConversationTool,
  invokeConversationTool,
  currentConversationToolApprovalPolicy,
} = await import("../conversationRuntime");
const {
  proposeGovernedToolOperation,
  reviewGovernedToolOperation,
  resolveGovernedToolOperation,
} = await import("../conversationGrantStore");
const { snapshotCodingWorkspace } = await import("./coding-workspace");
const { createProcessSupervisor } = await import("../exec");
const { proposeCodingCheckOperation } = await import("./coding-exec-operation");

test("one owner review releases the exact prepared coding check and persists only bounded receipt evidence", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    delete process.env.LIOS_CODING_WORKSPACE_ROOT;
  });
  const [finance] = await getDb().select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!finance) await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true });
  const [user] = await getDb().insert(users).values({
    email: `coding-${crypto.randomUUID()}@example.test`,
    passwordHash: "test-only",
    name: "Coding owner",
    role: "internal_analyst",
    organizationId: null,
  }).returning();
  assert.ok(user);
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const grantUser = { id: user.id, role: user.role, organizationId: null };
  const project = await createProject(tenant, { name: "Coding project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });

  const requestId = crypto.randomUUID();
  const toolCallId = "check-call";
  const stepId = "check";
  const planHash = "a".repeat(64);
  const snapshot = await snapshotCodingWorkspace();
  const input = {
    workspaceSha256: snapshot.workspaceSha256,
    check: "node-test" as const,
    targets: ["check.test.mjs"],
  };
  const preparedEvents: unknown[] = [];
  const exact = await proposeCodingCheckOperation({
    user: grantUser,
    projectId: project.id,
    chatId: chat.id,
    requestId,
    toolCallId,
    workspaceSha256: snapshot.workspaceSha256,
    check: input.check,
    targets: input.targets,
    recordPreparedEvidence: async (event) => { preparedEvents.push(event); },
  });
  assert.match(exact.operationDigest, /^[a-f0-9]{64}$/);
  assert.equal(preparedEvents.length, 1);

  const descriptor = getConversationTool("lios.coding.run_check");
  assert.ok(descriptor);
  const policy = currentConversationToolApprovalPolicy(descriptor.id);
  const controller = new AbortController();
  const pending = await proposeGovernedToolOperation({
    user: grantUser,
    projectId: project.id,
    chatId: chat.id,
    requestId,
    stepId,
    toolCallId,
    toolId: descriptor.id,
    input,
    descriptor,
    planHash,
    policy,
    runSignal: controller.signal,
    currentPolicy: () => currentConversationToolApprovalPolicy(descriptor.id),
  });

  await reviewGovernedToolOperation({
    user: grantUser,
    requestId,
    reviewId: pending.reviewId,
    allow: true,
    scope: "once",
    exactToolCallId: toolCallId,
  });
  const authorization = await resolveGovernedToolOperation({
    user: grantUser,
    requestId,
    reviewId: pending.reviewId,
  });

  const receiptRefs: string[] = [];
  const result = await invokeConversationTool(descriptor.id, input, controller.signal, {
    source: "agent",
    tenant,
    userId: user.id,
    projectId: project.id,
    chatId: chat.id,
    requestId,
    stepId,
    toolCallId,
    planHash,
    runSignal: controller.signal,
    authorization,
    coding: {
      recordReceipt: async (ref) => { receiptRefs.push(ref); },
      processSupervisor: createProcessSupervisor(),
    },
  });
  assert.match(result.summary, /node-test passed/);
  assert.equal(receiptRefs.length, 1);
  assert.match(receiptRefs[0]!, /^coding-receipt:[a-f0-9]{64}$/);

  const resources = await listProjectResources(tenant, project.id);
  const receipt = resources.find((resource) => resource.resourceRef === receiptRefs[0]);
  assert.equal(receipt?.kind, "coding_receipt");
  const serialized = JSON.stringify(receipt?.metadata ?? {});
  assert.equal(serialized.includes("2 + 2"), false, "receipt must not persist test source/output");
  assert.match(serialized, /commandDigest/);
  assert.match(serialized, /outputSha256/);
  assert.match(serialized, /workspaceSha256After/);
});
