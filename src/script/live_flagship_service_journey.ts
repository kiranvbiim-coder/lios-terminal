import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeProviderId } from "../server/byoaiRouter";
import { verifyAIProviderConnection } from "../server/aiProviderVerification";

function argument(name: string): string | null {
  const prefix = "--" + name + "=";
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

const requestedProvider = argument("provider") || process.env.LIOS_AI_PROVIDER?.trim() || "";
const provider = normalizeProviderId(requestedProvider);
if (!provider) {
  throw new Error("Choose a provider with --provider=<id> or LIOS_AI_PROVIDER.");
}
const requestedModel = argument("model") || process.env.LIOS_AI_MODEL?.trim() || null;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-live-flagship-"));
process.env.LIOS_DATA_ROOT = dataDir;

const { initDb, closeDb, getDb } = await import("../server/db");
const { users } = await import("../shared/schema");
const { createProject, getProject } = await import("../server/projectStore");
const {
  addProjectChatMessage,
  createProjectChat,
  getProjectChat,
  listProjectChatMessages,
} = await import("../server/projectChatStore");
const { executeConversationRuntime } = await import("../server/conversationRuntime");
const {
  getArtifact,
  getArtifactVersion,
  keepConversationDraft,
} = await import("../server/artifactStore");
const { getArtifactExportPlan } = await import("../server/artifactExport");

const personalFinance = {
  schemaVersion: "1" as const,
  asOf: "2026-09-27",
  accounts: [
    { id: "bank", kind: "bank" as const, balance: 250000, currency: "INR" },
    { id: "loan", kind: "loan" as const, balance: -75000, currency: "INR" },
  ],
  transactions: [
    { id: "salary", at: "2026-09-05", amount: 120000, category: "salary", accountId: "bank" },
    { id: "rent", at: "2026-09-06", amount: -35000, category: "rent", accountId: "bank" },
  ],
  debts: [],
  goals: [],
  retirement: null,
};

function aiRequest(requestId: string) {
  return {
    requestId,
    continuationOf: null,
    message: "Explain in two concise sentences why a professional financial workflow should separate observed facts, deterministic calculations, and AI synthesis.",
    executionMode: "ai_assisted" as const,
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured" as const,
      providerAllow: [provider],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: false,
      allowSelection: false,
      allowToolCalling: false,
      dataClassification: "public" as const,
    },
    attachments: [],
    context: { view: "live-flagship-service-journey" },
  };
}

function deterministicRequest(requestId: string) {
  return {
    requestId,
    continuationOf: null,
    message: "Calculate my personal finances and show what the current position implies.",
    executionMode: "deterministic_first" as const,
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured" as const,
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private" as const,
    },
    attachments: [],
    context: { personalFinance },
  };
}

await initDb();

try {
  process.stdout.write("LiOS live flagship service journey\n");
  process.stdout.write("1/6 Verify real BYOAI provider...\n");
  const verification = await verifyAIProviderConnection({ provider, model: requestedModel });
  process.stdout.write("PASS provider · " + verification.provider + " · " + verification.model + "\n");

  const [user] = await getDb().insert(users).values({
    email: `flagship-${crypto.randomUUID()}@example.com`,
    passwordHash: "live-flagship-service-acceptance",
    role: "internal_analyst",
    organizationId: null,
    name: "Live Flagship Acceptance",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };

  process.stdout.write("2/6 Create Project and governed conversation...\n");
  const project = await createProject(tenant, {
    name: "Live Flagship Product Acceptance",
    instructions: "Keep observed facts, deterministic calculations and AI synthesis distinguishable. Never invent missing financial observations.",
  });
  const chat = await createProjectChat(tenant, {
    projectId: project.id,
    scope: "project",
    title: "Live flagship acceptance",
  });

  const aiRequestId = crypto.randomUUID();
  const aiPrompt = aiRequest(aiRequestId);
  await addProjectChatMessage(tenant, chat.id, { role: "user", content: aiPrompt.message });
  const ai = await executeConversationRuntime({
    tenant,
    scope: "project",
    chatId: chat.id,
    projectId: project.id,
    projectName: project.name,
    projectInstructions: project.instructions,
    resources: [],
    history: [],
    preferredProvider: verification.provider,
    preferredModel: verification.model,
    request: aiPrompt,
    emit: () => undefined,
  });
  assert.equal(ai.label, "ai_derived");
  assert.equal(ai.cancelled, false);
  assert.equal(ai.awaitingApproval, false);
  assert.ok(ai.text.trim());
  assert.ok(ai.receiptIds.length > 0);
  await addProjectChatMessage(tenant, chat.id, {
    role: "assistant",
    content: ai.text,
    metadata: {
      requestId: aiRequestId,
      receiptIds: ai.receiptIds,
      provider: verification.provider,
      model: verification.model,
    },
  });
  process.stdout.write("PASS real AI conversation · receipt " + ai.receiptIds[0] + "\n");

  process.stdout.write("3/6 Run deterministic finance workflow in the same Project...\n");
  const deterministicRequestId = crypto.randomUUID();
  const deterministicPrompt = deterministicRequest(deterministicRequestId);
  await addProjectChatMessage(tenant, chat.id, { role: "user", content: deterministicPrompt.message });
  const deterministic = await executeConversationRuntime({
    tenant,
    scope: "project",
    chatId: chat.id,
    projectId: project.id,
    projectName: project.name,
    projectInstructions: project.instructions,
    resources: [],
    history: [
      { role: "user", content: aiPrompt.message },
      { role: "assistant", content: ai.text },
    ],
    request: deterministicPrompt,
    emit: () => undefined,
  });
  assert.equal(deterministic.label, "deterministic");
  assert.equal(deterministic.artifacts.length, 1);
  assert.ok(deterministic.receiptIds.length > 0);
  await addProjectChatMessage(tenant, chat.id, {
    role: "assistant",
    content: deterministic.text,
    metadata: { requestId: deterministicRequestId, receiptIds: deterministic.receiptIds },
  });
  process.stdout.write("PASS deterministic workflow · receipt " + deterministic.receiptIds[0] + "\n");

  process.stdout.write("4/6 Keep Artifact and verify export plan...\n");
  const kept = await keepConversationDraft(tenant, {
    projectId: project.id,
    draft: deterministic.artifacts[0]!,
    requestId: deterministicRequestId,
  });
  const exportPlan = await getArtifactExportPlan(tenant, kept.artifact.id);
  assert.ok(exportPlan.formats.includes("json"));
  assert.ok(exportPlan.formats.includes("pdf"));
  assert.ok(exportPlan.formats.includes("pptx"));
  process.stdout.write("PASS Artifact kept · version " + kept.version.version + "\n");

  process.stdout.write("5/6 Close and reopen local state...\n");
  await closeDb();
  await initDb();

  const reopenedProject = await getProject(tenant, project.id);
  const reopenedChat = await getProjectChat(tenant, chat.id);
  const reopenedMessages = await listProjectChatMessages(tenant, chat.id);
  const reopenedArtifact = await getArtifact(tenant, kept.artifact.id);
  const reopenedVersion = await getArtifactVersion(tenant, kept.artifact.id);
  const reopenedExport = await getArtifactExportPlan(tenant, kept.artifact.id);

  assert.equal(reopenedProject.id, project.id);
  assert.equal(reopenedChat.id, chat.id);
  assert.equal(reopenedMessages.length, 4);
  assert.equal(reopenedArtifact.id, kept.artifact.id);
  assert.equal(reopenedVersion.version, kept.version.version);
  assert.equal(reopenedExport.contentHash, reopenedVersion.contentHash);
  const aiAssistant = reopenedMessages.find((message) => message.role === "assistant"
    && (message.metadata as { requestId?: string } | null)?.requestId === aiRequestId);
  assert.ok(aiAssistant, "Reopened chat lost the live AI assistant turn.");
  const aiMetadata = aiAssistant.metadata as { receiptIds?: string[]; provider?: string; model?: string } | null;
  assert.ok(aiMetadata?.receiptIds?.includes(ai.receiptIds[0]!));
  assert.equal(aiMetadata?.provider, verification.provider);
  assert.equal(aiMetadata?.model, verification.model);
  process.stdout.write("PASS Project, chat, AI receipt and Artifact survived reopen\n");

  process.stdout.write("6/6 Final acceptance accounting...\n");
  process.stdout.write(JSON.stringify({
    provider: verification.provider,
    model: verification.model,
    aiReceiptCount: ai.receiptIds.length,
    deterministicReceiptCount: deterministic.receiptIds.length,
    artifactKind: reopenedArtifact.kind,
    artifactVersion: reopenedArtifact.headVersion,
    exportFormats: reopenedExport.formats,
    projectPersisted: true,
    chatPersisted: true,
    credentialMaterialLogged: false,
  }) + "\n");
  process.stdout.write("LIVE_FLAGSHIP_SERVICE_JOURNEY: PASS\n");
} finally {
  await closeDb().catch(() => undefined);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
