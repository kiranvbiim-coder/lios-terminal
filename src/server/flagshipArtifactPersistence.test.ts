import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent, RuntimeExecutionReceipt } from "@shared/conversationRuntime";
import { p5ReconciliationSchema } from "@shared/p5ProfessionalContracts";
import { REPORT_TEMPLATES } from "./reportEngine";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-flagship-artifact-"));
process.env.LIMURIA_DATA_DIR = dataDir;

// Database-dependent imports must follow the isolated Home assignment above.

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject, getProject } = await import("./projectStore");
const {
  addProjectChatMessage,
  createProjectChat,
  getProjectChat,
  listProjectChatMessages,
} = await import("./projectChatStore");
const { executeConversationRuntime } = await import("./conversationRuntime");
const {
  decideArtifactProposal,
  createArtifact,
  createArtifactVersion,
  getArtifact,
  getArtifactVersion,
  keepConversationDraft,
  listArtifactInteractionReceipts,
  listArtifactProposals,
} = await import("./artifactStore");
const { getArtifactExportPlan } = await import("./artifactExport");

const personalFinance = {
  schemaVersion: "1" as const,
  asOf: "2026-09-24",
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

function conversationRequest(
  requestId: string,
  message: string,
  context: Record<string, unknown>,
) {
  return {
    requestId,
    continuationOf: null,
    message,
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
    context,
  };
}

test("flagship offline journey keeps a conversation Artifact, edits it, exports it, and recovers it after restart", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
    passwordHash: "flagship-test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Flagship Acceptance User",
  }).returning();
  const [otherUser] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
    passwordHash: "flagship-other-test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Flagship Other User",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const otherTenant = { userId: otherUser.id, organizationId: null, role: otherUser.role };

  const project = await createProject(tenant, {
    name: "Flagship Acceptance Project",
    instructions: "Use explicit user-owned inputs and keep deterministic calculations auditable.",
  });
  const chat = await createProjectChat(tenant, {
    projectId: project.id,
    scope: "project",
    title: "Personal finance decision",
  });

  const firstRequestId = crypto.randomUUID();
  const firstMessage = "Calculate my personal finances and show what the current position implies.";
  await addProjectChatMessage(tenant, chat.id, { role: "user", content: firstMessage });

  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const conversation = await executeConversationRuntime({
    tenant,
    scope: "project",
    chatId: chat.id,
    projectId: project.id,
    projectName: project.name,
    projectInstructions: project.instructions,
    resources: [],
    history: [],
    request: conversationRequest(firstRequestId, firstMessage, { personalFinance }),
    emit: (event) => { events.push(event as { type: string; [key: string]: unknown }); },
  });

  assert.equal(conversation.label, "deterministic");
  assert.equal(conversation.awaitingApproval, false);
  assert.equal(conversation.cancelled, false);
  assert.equal(conversation.artifacts.length, 1);
  assert.equal(conversation.artifacts[0]?.artifactType, "personal-finance.decision");
  assert.equal(conversation.artifacts[0]?.projectId, project.id);
  assert.equal(conversation.receiptIds.length, 1);
  assert.ok(events.some((event) => event.type === "tool_result"));
  assert.ok(events.some((event) => event.type === "receipt"));
  assert.ok(events.some((event) => event.type === "artifact"));

  await addProjectChatMessage(tenant, chat.id, {
    role: "assistant",
    content: conversation.text,
    metadata: { requestId: firstRequestId, receiptIds: conversation.receiptIds },
  });

  const kept = await keepConversationDraft(tenant, {
    projectId: project.id,
    draft: conversation.artifacts[0]!,
    requestId: firstRequestId,
  });
  assert.equal(kept.artifact.projectId, project.id);
  assert.equal(kept.artifact.origin, "conversation");
  assert.equal(kept.artifact.kind, "decision");
  assert.equal(kept.artifact.headVersion, 1);
  assert.deepEqual(kept.version.executionReceiptIds, conversation.receiptIds);
  assert.deepEqual(kept.version.sourceRefs, ["user:personal-finance"]);
  await assert.rejects(
    () => getArtifact(otherTenant, kept.artifact.id),
    /not found|not owned/i,
  );

  const editRequestId = crypto.randomUUID();
  const editedObjective = "Prioritize liquidity, debt resilience, and long-term goal progress.";
  const editResult = await executeConversationRuntime({
    tenant,
    scope: "project",
    chatId: chat.id,
    projectId: project.id,
    projectName: project.name,
    projectInstructions: project.instructions,
    resources: [],
    history: [
      { role: "user", content: firstMessage },
      { role: "assistant", content: conversation.text },
    ],
    request: conversationRequest(
      editRequestId,
      `Set field objective to "${editedObjective}"`,
      { activeObjectRefs: [kept.artifact.id] },
    ),
    emit: () => undefined,
  });
  assert.equal(editResult.label, "deterministic");
  assert.match(editResult.text, /Created review proposal/);

  const proposals = await listArtifactProposals(tenant, kept.artifact.id);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.status, "pending");
  const accepted = await decideArtifactProposal(tenant, proposals[0]!.id, "accept");
  assert.equal(accepted.version?.version, 2);

  const interactionReceipts = await listArtifactInteractionReceipts(tenant, kept.artifact.id);
  assert.ok(interactionReceipts.some((receipt) => receipt.action === "keep" && receipt.toVersion === 1));
  assert.ok(interactionReceipts.some((receipt) => receipt.action === "propose_change" && receipt.fromVersion === 1));
  assert.ok(interactionReceipts.some((receipt) => receipt.action === "accept_change" && receipt.fromVersion === 1 && receipt.toVersion === 2));

  const beforeRestart = await getArtifact(tenant, kept.artifact.id);
  const beforeRestartVersion = await getArtifactVersion(tenant, kept.artifact.id);
  assert.equal(beforeRestart.headVersion, 2);
  assert.equal(
    (beforeRestartVersion.content as { objective?: string }).objective,
    editedObjective,
  );

  const exportPlan = await getArtifactExportPlan(tenant, kept.artifact.id);
  assert.equal(exportPlan.version, 2);
  assert.ok(exportPlan.formats.includes("json"));
  assert.ok(exportPlan.formats.includes("pdf"));
  assert.ok(exportPlan.formats.includes("pptx"));


  await t.test("active P4 Table templates execute offline only through the report assembler with exact version and receipt identity", async () => {
    const source = {
      kind: "table" as const,
      columns: [{ key: "amount", label: "Recorded amount", type: "currency" as const }],
      rows: [{ amount: "9007199254740993.250000001" }],
    };
    const table = await createArtifact(tenant, {
      projectId: project.id, title: "Recorded table", content: source,
      sourceRefs: ["user:recorded-table"], dependencyRefs: [kept.artifact.id + "@v2"],
    });
    const receipts: RuntimeExecutionReceipt[] = [];
    for (const template of REPORT_TEMPLATES) {
      const reportEvents: ConversationRuntimeEvent[] = [];
      const reportRun = await executeConversationRuntime({
        tenant, scope: "project", chatId: chat.id, projectId: project.id, projectName: project.name,
        resources: [], history: [],
        request: {
          ...conversationRequest(crypto.randomUUID(), `Create ${template.name} from this Artifact for AAPL`, {
            activeObjectRefs: [table.artifact.id], symbol: "AAPL",
          }),
          sourceScope: "my_data",
        },
        aiCompletion: async () => { throw new Error("Contextual report assembly must not use BYOAI."); },
        emit: (event) => { reportEvents.push(event); },
      });
      assert.equal(reportRun.label, "deterministic");
      assert.equal(reportRun.artifacts.length, 1, reportRun.text);
      const report = reportRun.artifacts[0];
      assert.equal(report.title, "Recorded table · " + template.name);
      if (report.data.kind !== "report") throw new Error("Expected report.");
      assert.equal(report.data.templateId, template.id);
      assert.ok(report.sourceRefs.includes(table.artifact.id + "@v1"));
      assert.ok(report.sourceRefs.includes(kept.artifact.id + "@v2"));
      assert.deepEqual(reportEvents.filter((event) => event.type === "tool_start").map((event) => event.componentId), ["lios.p5.report-assembler"]);
      const receiptEvent = reportEvents.find((event) => event.type === "receipt");
      assert.ok(receiptEvent?.type === "receipt");
      const receipt = receiptEvent.receipt;
      receipts.push(receipt);
      assert.equal(receipt.componentId, "lios.p5.report-assembler");
      assert.equal(receipt.inputEvidence?.templateId, template.id);
      assert.equal(receipt.outputEvidence?.templateId, template.id);
      assert.equal(receipt.outputEvidence?.title, report.title);
      assert.equal(receipt.outputEvidence?.analyticalRecalculation, false);
      assert.equal(receipt.inputEvidence?.sourceArtifactRef, table.artifact.id + "@v1");
      assert.deepEqual(report.executionReceiptIds, [receipt.id]);
      assert.deepEqual(report.data.sections.map((section) =>
        report.data.kind === "report" ? report.data.blocks.find((block) => block.id === section.blockIds[0])?.attrs.sectionType : null),
      template.sectionOrder);
      if (template.sectionOrder.includes("table")) {
        assert.ok(report.data.blocks.some((block) => block.type === "table" && JSON.stringify(block.attrs.table) === JSON.stringify(source)));
      }
      assert.equal(report.data.blocks.some((block) => block.type === "chart_ref"), false);
      assert.equal(p5ReconciliationSchema.parse(report.data.blocks[0].attrs.professionalReconciliation).analyticalRecalculation, false);
    }
    assert.equal(new Set(receipts.map((receipt) => receipt.inputHash)).size, REPORT_TEMPLATES.length);
    assert.equal(new Set(receipts.map((receipt) => receipt.outputHash)).size, REPORT_TEMPLATES.length);

    const changed = { ...source, rows: [{ amount: "10000000000000000.000000001" }] };
    await createArtifactVersion(tenant, {
      artifactId: table.artifact.id, baseVersion: 1, content: changed,
      sourceRefs: ["user:recorded-table"], dependencyRefs: [kept.artifact.id + "@v2"],
    });
    const versionEvents: ConversationRuntimeEvent[] = [];
    const revised = await executeConversationRuntime({
      tenant, scope: "project", chatId: chat.id, projectId: project.id, projectName: project.name,
      resources: [], history: [],
      request: { ...conversationRequest(crypto.randomUUID(), "Create a Risk Report from this Artifact", { activeObjectRefs: [table.artifact.id] }), sourceScope: "my_data" },
      emit: (event) => { versionEvents.push(event); },
    });
    assert.ok(revised.artifacts[0].sourceRefs.includes(table.artifact.id + "@v2"));
    const revisedReceipt = versionEvents.find((event) => event.type === "receipt");
    assert.ok(revisedReceipt?.type === "receipt");
    const originalRiskReceipt = receipts.find((receipt) => receipt.outputEvidence?.templateId === "risk_report")!;
    assert.notEqual(revisedReceipt.receipt.inputHash, originalRiskReceipt.inputHash);
    assert.notEqual(revisedReceipt.receipt.outputHash, originalRiskReceipt.outputHash);
    const revisedData = revised.artifacts[0].data;
    assert.ok(revisedData.kind === "report" && revisedData.blocks.some((block) => block.type === "table" && JSON.stringify(block.attrs.table) === JSON.stringify(changed)));

    for (const message of ["Create a Risk Report and Investment Memo from this Artifact", "Create a liquidity report from this Artifact"]) {
      const errorEvents: ConversationRuntimeEvent[] = [];
      await assert.rejects(executeConversationRuntime({
        tenant, scope: "project", chatId: chat.id, projectId: project.id, projectName: project.name,
        resources: [], history: [],
        request: { ...conversationRequest(crypto.randomUUID(), message, { activeObjectRefs: [table.artifact.id] }), sourceScope: "my_data" },
        emit: (event) => { errorEvents.push(event); },
      }), /Choose one report template|Unknown report template/);
      assert.equal(errorEvents.some((event) => event.type === "artifact" || event.type === "receipt"), false);
      assert.ok(errorEvents.some((event) => event.type === "data_gap" && /Choose one report template|Unknown report template/.test(event.gap.message)));
      assert.equal(errorEvents.some((event) => event.type === "tool_start"), false);
    }
  });
  await closeDb();
  await initDb();

  const reopenedProject = await getProject(tenant, project.id);
  const reopenedChat = await getProjectChat(tenant, chat.id);
  const reopenedMessages = await listProjectChatMessages(tenant, chat.id);
  const reopenedArtifact = await getArtifact(tenant, kept.artifact.id);
  const reopenedVersion = await getArtifactVersion(tenant, kept.artifact.id);
  const reopenedExportPlan = await getArtifactExportPlan(tenant, kept.artifact.id);

  assert.equal(reopenedProject.name, project.name);
  assert.equal(reopenedChat.projectId, project.id);
  assert.equal(reopenedMessages.length, 2);
  assert.equal(reopenedMessages[0]?.role, "user");
  assert.equal(reopenedMessages[1]?.role, "assistant");
  assert.equal(reopenedArtifact.headVersion, 2);
  assert.equal(reopenedArtifact.origin, "conversation");
  assert.equal(reopenedArtifact.kind, "decision");
  assert.equal((reopenedVersion.content as { objective?: string }).objective, editedObjective);
  assert.deepEqual(reopenedVersion.executionReceiptIds, conversation.receiptIds);
  assert.deepEqual(reopenedVersion.sourceRefs, ["user:personal-finance"]);
  assert.equal(reopenedExportPlan.contentHash, reopenedVersion.contentHash);
  assert.deepEqual(reopenedExportPlan.sourceRefs, ["user:personal-finance"]);
  await assert.rejects(
    () => getArtifact(otherTenant, kept.artifact.id),
    /not found|not owned/i,
  );
});
