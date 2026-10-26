import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-memory-lifecycle-tool-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { runWithRequestIdentity } = await import("./requestContext");
const { appendDurableMemory } = await import("./aiMemory");
const {
  memoryInspectTool,
  memoryCorrectTool,
  memoryDeleteTool,
} = await import("./memoryLifecycleTool");
const { projects, users } = await import("@shared/schema");

type Identity = { userId: number | null; organizationId: number | null };
const asIdentity = <T>(identity: Identity, fn: () => T): T => runWithRequestIdentity(identity, fn);

function callFor(userId: number, projectId: number | null, sourceScope: "auto" | "my_data" | "web" = "my_data") {
  return {
    source: "agent" as const,
    userId,
    tenant: { userId, organizationId: null, role: "internal_analyst" as const },
    projectId,
    requestId: crypto.randomUUID(),
    sourceScope,
  };
}

test("SI-03.03 governed memory lifecycle tools expose owned revisions and require exact-confirm mutations", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner, other] = await Promise.all([
    getDb().insert(users).values({
      email: "memory-tools-owner-" + Math.random().toString(36).slice(2) + "@example.com",
      passwordHash: "x",
      role: "internal_analyst",
      organizationId: null,
      name: "Memory tools owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: "memory-tools-other-" + Math.random().toString(36).slice(2) + "@example.com",
      passwordHash: "x",
      role: "internal_analyst",
      organizationId: null,
      name: "Other",
    }).returning().then((rows) => rows[0]),
  ]);
  const [project] = await getDb().insert(projects).values({
    ownerUserId: owner.id,
    organizationId: null,
    name: "Memory Lifecycle Tool Project",
  }).returning();

  const original = await asIdentity({ userId: owner.id, organizationId: null }, () =>
    appendDurableMemory({
      content: "Remember the wrong deployment region.",
      projectId: project.id,
      kind: "project_context",
      originClass: "agent",
      originKind: "dreaming_reflection",
      epistemicStatus: "inferred",
      sourceRefs: ["project:note:1"],
      observedAt: "2026-10-06T09:00:00.000Z",
    }),
  );
  assert.ok(original);

  await t.test("memory inspection and mutations require exact one-shot confirmation", () => {
    assert.equal(memoryInspectTool.permissionClass, "user_confirm");
    assert.equal(memoryInspectTool.allowProjectApproval, false);
    assert.equal(memoryInspectTool.access, "read");
    assert.equal(memoryInspectTool.sideEffect, "none");
    assert.equal(memoryInspectTool.replaySafe, true);

    for (const tool of [memoryCorrectTool, memoryDeleteTool]) {
      assert.equal(tool.permissionClass, "user_confirm");
      assert.equal(tool.allowProjectApproval, false);
      assert.equal(tool.access, "write");
      assert.equal(tool.sideEffect, "internal_write");
      assert.equal(tool.replaySafe, false);
    }
  });

  await t.test("inspect shows the active owned memory and correction adds an observable revision", async () => {
    const before = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryInspectTool.invoke({}, new AbortController().signal, callFor(owner.id, project.id)),
    );
    const listed = before.output as any;
    assert.equal(listed.operation, "inspect");
    assert.ok(listed.memories.some((row: any) => row.memoryKey === original.memoryKey && row.revision === 1 && row.state === "active"));

    const corrected = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryCorrectTool.invoke({
        memoryKey: original.memoryKey,
        expectedRevision: 1,
        content: "Use the owner-confirmed deployment region.",
        reason: "Correction requested by owner.",
      }, new AbortController().signal, callFor(owner.id, project.id)),
    );
    const correctedRow = (corrected.output as any).memories[0];
    assert.equal(correctedRow.memoryKey, original.memoryKey);
    assert.equal(correctedRow.revision, 2);
    assert.equal(correctedRow.state, "active");
    assert.equal(correctedRow.originClass, "owner");
    assert.equal(correctedRow.epistemicStatus, "confirmed");

    const history = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryInspectTool.invoke({ memoryKey: original.memoryKey }, new AbortController().signal, callFor(owner.id, project.id)),
    );
    assert.deepEqual((history.output as any).memories.map((row: any) => [row.revision, row.state]), [[2, "active"], [1, "superseded"]]);
  });

  await t.test("delete leaves only a tombstone visible to explicit history inspection", async () => {
    const deleted = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryDeleteTool.invoke({
        memoryKey: original.memoryKey,
        expectedRevision: 2,
        reason: "No longer remember this.",
      }, new AbortController().signal, callFor(owner.id, project.id)),
    );
    const tombstone = (deleted.output as any).memories[0];
    assert.equal(tombstone.revision, 3);
    assert.equal(tombstone.state, "deleted");
    assert.equal(tombstone.content, "[deleted]");

    const active = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryInspectTool.invoke({}, new AbortController().signal, callFor(owner.id, project.id)),
    );
    assert.equal((active.output as any).memories.some((row: any) => row.memoryKey === original.memoryKey), false);

    const history = await asIdentity({ userId: owner.id, organizationId: null }, () =>
      memoryInspectTool.invoke({ memoryKey: original.memoryKey }, new AbortController().signal, callFor(owner.id, project.id)),
    );
    assert.equal((history.output as any).memories.length, 1);
    assert.equal((history.output as any).memories[0].state, "deleted");
    assert.equal(JSON.stringify(history.output).includes("wrong deployment region"), false);
    assert.equal(JSON.stringify(history.output).includes("owner-confirmed deployment region"), false);
  });

  await t.test("cross-owner Project scope and non-memory source scope fail before disclosure or mutation", async () => {
    await assert.rejects(
      () => asIdentity({ userId: other.id, organizationId: null }, () =>
        memoryInspectTool.invoke({}, new AbortController().signal, callFor(other.id, project.id)),
      ),
      /not owned/,
    );
    await assert.rejects(
      () => asIdentity({ userId: owner.id, organizationId: null }, () =>
        memoryInspectTool.invoke({}, new AbortController().signal, callFor(owner.id, project.id, "web")),
      ),
      /Auto or My Data/,
    );
  });

  await t.test("confirmed inspection survives a second approval without exposing contents to the model", async () => {
    const { executeConversationRuntime, currentConversationToolApprovalPolicy, getConversationTool } = await import("./conversationRuntime");
    const { createAttribution } = await import("./byoaiRouter");
    const { proposeGovernedToolOperation, reviewGovernedToolOperation, resolveGovernedToolOperation } = await import("./conversationGrantStore");
    const { conversationRequestSchema } = await import("@shared/conversationRuntime");
    const marker = "OWNER_ONLY_SAVED_MEMORY_20261026";
    const saved = await asIdentity({ userId: owner.id, organizationId: null }, () => appendDurableMemory({
      content: marker, kind: "owner_note", originClass: "owner", originKind: "explicit_owner_note",
    }));
    assert.ok(saved);
    const ownerMemoryInspection: { text: string | null } = { text: null };
    const requestId = crypto.randomUUID();
    const signal = new AbortController().signal;
    const prompts: string[] = [];
    const replies = [JSON.stringify({ steps: [
      { id: "inspect", toolId: memoryInspectTool.id, label: "Inspect saved memories", input: {}, dependsOn: [] },
      { id: "correct", toolId: memoryCorrectTool.id, label: "Correct saved note", input: { memoryKey: saved.memoryKey, expectedRevision: 1, content: "Owner corrected note" }, dependsOn: ["inspect"] },
    ] }), JSON.stringify({ decision: "complete", answer: "The recorded memories are shown below." })];
    const request = conversationRequestSchema.parse({
      requestId, message: "Inspect my saved memories.", sourceScope: "my_data", executionMode: "ai_assisted",
      transmissionPolicy: { mode: "configured", allowToolCalling: true, allowResourceReferences: false },
    });
    const user = { id: owner.id, organizationId: null, role: "internal_analyst" as const };
    const events: ConversationRuntimeEvent[] = [];
    const base = {
      tenant: { userId: owner.id, organizationId: null, role: user.role }, scope: "quick" as const,
      chatId: null, projectId: null, resources: [], history: [], request, signal,
      emit: (event: ConversationRuntimeEvent) => { events.push(event); },
      aiCompletion: async (input: unknown) => {
        prompts.push(JSON.stringify(input));
        const text = replies.shift();
        if (!text) throw new Error("Unexpected model call");
        return { provider: "openai" as const, model: "gpt-4o", text, attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "public test", output: text }) };
      },
    };
    const paused = await asIdentity({ userId: owner.id, organizationId: null }, () => executeConversationRuntime({ ...base, agentLoop: { ownerMemoryInspection } }));
    assert.equal(paused.awaitingApproval, true);
    assert.doesNotMatch(paused.text, new RegExp(marker));
    const authorize = async (pause: NonNullable<typeof paused.agentPause>) => {
      const planned = pause.resume.steps.find(step => step.id === pause.stepId)!;
      const proposal = await proposeGovernedToolOperation({
        user, projectId: null, chatId: null, requestId, stepId: pause.stepId, toolCallId: pause.resume.paused.toolCallId,
        toolId: pause.toolId, input: planned.input, descriptor: getConversationTool(pause.toolId)!,
        planHash: pause.planSha256, policy: currentConversationToolApprovalPolicy(pause.toolId), runSignal: signal,
        currentPolicy: () => currentConversationToolApprovalPolicy(pause.toolId),
      });
      await reviewGovernedToolOperation({ user, requestId, reviewId: proposal.reviewId, allow: true, scope: "once" });
      return resolveGovernedToolOperation({ user, requestId, reviewId: proposal.reviewId });
    };
    const pause = paused.agentPause!;
    const authorization = await authorize(pause);
    const secondPause = await asIdentity({ userId: owner.id, organizationId: null }, () => executeConversationRuntime({
      ...base, agentLoop: { ownerMemoryInspection, resume: { state: pause.resume, authorization } },
    }));
    assert.equal(secondPause.awaitingApproval, true);
    assert.match(secondPause.text, new RegExp(marker));
    assert.equal(JSON.stringify(secondPause.agentPause).includes(marker), false, "raw memory is not part of model continuation");
    const next = secondPause.agentPause!;
    const nextAuthorization = await authorize(next);
    const result = await asIdentity({ userId: owner.id, organizationId: null }, () => executeConversationRuntime({
      ...base, agentLoop: { ownerMemoryInspection, resume: { state: next.resume, authorization: nextAuthorization } },
    }));
    assert.equal(result.awaitingApproval, false);
    assert.match(result.text, new RegExp(marker));
    assert.match(result.text, /"memoryKey"/);
    assert.match(result.text, /"revision":1/);
    assert.ok(events.some(event => event.type === "text" && event.text.includes(marker)), "owner-facing text event must include the recorded memory");
    assert.equal(prompts.length, 2);
    assert.equal(prompts.some(prompt => prompt.includes(marker)), false, "inspection content must not enter planner or review model requests");
  });
});
