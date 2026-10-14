import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { createAttribution } from "../byoaiRouter";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-coding-restart-db-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lios-coding-restart-repo-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_CODING_WORKSPACE_ROOT = workspace;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
await fsp.mkdir(path.join(workspace, "src"), { recursive: true });
await fsp.writeFile(path.join(workspace, "src", "answer.ts"), "export const answer = 41;\n");

const { initDb, closeDb, getDb } = await import("../db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("../projectStore");
const { createProjectChat } = await import("../projectChatStore");
const { listProjectResources } = await import("../projectResourceStore");
const {
  startProjectChatRun,
  resumeInterruptedConversationRun,
  reviewGovernedToolRun,
  ConversationStartError,
} = await import("../conversationRunService");
const { conversationRuns } = await import("../conversationRunRegistry");
const { getConversationExecutionJournal } = await import("../exec/execution-scope");
const { getPersonaPreferences, upsertPersonaPreferences } = await import("../personaPreferenceService");
const { snapshotCodingWorkspace, previewCodingPatch } = await import("./coding-workspace");

function model(script: string[]) {
  const queue = [...script];
  return async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("model called more often than scripted");
    return {
      provider: "openai",
      model: "gpt-4o",
      text: next,
      attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: next }),
    };
  };
}

function waitForEvent(
  requestId: string,
  userId: number,
  match: (event: ConversationRuntimeEvent) => boolean,
): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<ConversationRuntimeEvent[]>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (match(event)) done.resolve(events);
  });
  assert.ok(subscription, "the coding run is registered");
  return done.promise.finally(() => subscription.detach());
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("coding patch survives reconnect as the same run and fails closed when the workspace drifts", { timeout: 120_000 }, async (t) => {
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
    email: `coding-restart-${crypto.randomUUID()}@example.test`,
    passwordHash: "test-only",
    name: "Coding restart owner",
    role: "internal_analyst",
    organizationId: null,
  }).returning();
  assert.ok(user);
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const conversationUser = { id: user.id, email: user.email, role: user.role, organizationId: null };
  const project = await createProject(tenant, { name: "Coding restart project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const owner = { userId: user.id, projectId: project.id, chatId: chat.id };
  const current = await getPersonaPreferences(conversationUser);
  await upsertPersonaPreferences(conversationUser, {
    preferences: {
      ...current.preferences.preferences,
      waveCMasterAi: { state: "on", mode: "ai_assist", updatedAt: new Date().toISOString() },
    },
  });

  const before = await snapshotCodingWorkspace();
  const file = before.files.find((candidate) => candidate.path === "src/answer.ts");
  assert.ok(file);
  const changes = [{
    path: file.path,
    beforeSha256: file.sha256,
    content: "export const answer = 42;\n",
  }];
  const preview = await previewCodingPatch(before.workspaceSha256, changes);
  const requestId = crypto.randomUUID();
  const plan = JSON.stringify({
    steps: [{
      id: "patch",
      toolId: "lios.coding.apply_patch",
      label: "Apply the reviewed answer patch",
      input: {
        workspaceSha256: before.workspaceSha256,
        previewSha256: preview.previewSha256,
        changes,
      },
      dependsOn: [],
    }],
  });

  await startProjectChatRun(
    conversationUser,
    chat.id,
    {
      requestId,
      message: "Apply the reviewed patch to answer.ts.",
      executionMode: "ai_assisted",
      sourceScope: "my_data",
      agent: true,
    },
    { aiCompletion: model([plan]) },
  );
  const initialEvents = await waitForEvent(
    requestId,
    user.id,
    (event) => event.type === "governed_tool_approval_required",
  );
  const firstApproval = initialEvents.find((event) => event.type === "governed_tool_approval_required");
  assert.ok(firstApproval && firstApproval.type === "governed_tool_approval_required");
  assert.deepEqual(firstApproval.choices, ["allow_once", "deny"], "coding writes never offer Project-wide approval");
  assert.equal(conversationRuns.cancel(requestId, user.id), true);
  await waitForEvent(requestId, user.id, (event) => event.type === "done" && event.status === "cancelled");

  const journal = await getConversationExecutionJournal();
  const interrupted = await until(
    () => journal.read(requestId, owner),
    (record) => record?.status === "interrupted",
    "coding run to park as interrupted",
  );
  assert.ok(interrupted?.checkpoint?.continuation);
  assert.equal(await fsp.readFile(path.join(workspace, "src", "answer.ts"), "utf8"), "export const answer = 41;\n");

  // The user/repo changes while the UI is disconnected. The old patch must
  // never overwrite this newer state when the exact requestId resumes.
  await fsp.writeFile(path.join(workspace, "src", "answer.ts"), "export const answer = 43;\n");

  await resumeInterruptedConversationRun(conversationUser, requestId, {
    aiCompletion: model([JSON.stringify({ decision: "complete", answer: "Workspace changed; patch was not applied." })]),
  });
  const resumedEvents = await waitForEvent(
    requestId,
    user.id,
    (event) => event.type === "governed_tool_approval_required",
  );
  const secondApproval = resumedEvents.find((event) => event.type === "governed_tool_approval_required");
  assert.ok(secondApproval && secondApproval.type === "governed_tool_approval_required");
  assert.notEqual(secondApproval.reviewId, firstApproval.reviewId, "restart requires a fresh review");
  assert.deepEqual(secondApproval.choices, ["allow_once", "deny"]);

  await assert.rejects(
    reviewGovernedToolRun(conversationUser, requestId, secondApproval.reviewId, "allow_project"),
    (error: unknown) => error instanceof ConversationStartError
      && error.status === 409
      && error.body.code === "project_approval_not_allowed",
  );
  await reviewGovernedToolRun(conversationUser, requestId, secondApproval.reviewId, "allow_once");
  await waitForEvent(
    requestId,
    user.id,
    (event) => event.type === "done" && event.status !== "waiting_approval",
  );

  assert.equal(
    await fsp.readFile(path.join(workspace, "src", "answer.ts"), "utf8"),
    "export const answer = 43;\n",
    "stale resumed patch never overwrites drifted repository state",
  );
  const record = await journal.read(requestId, owner);
  assert.notEqual(record?.status, "interrupted");
  const patchStep = record?.events?.find((event) => event.kind === "step_finished" && event.stepId === "patch");
  assert.equal(patchStep?.kind === "step_finished" && patchStep.status, "failed");
  const receipts = await listProjectResources(tenant, project.id);
  assert.equal(
    receipts.some((resource) => resource.kind === "coding_receipt"),
    false,
    "failed stale patch cannot mint a success receipt",
  );
});
