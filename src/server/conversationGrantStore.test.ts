import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { z } from "zod";
import type { GovernedToolCall } from "./governedTools";
import type { CurrentExecutionPolicy } from "./exec/execution-authorization";

// DB-dependent modules load after the test data directory: db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conversation-grants-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { users, domains, conversationActionGrants } = await import("@shared/schema");
const store = await import("./conversationGrantStore");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { upsertPersonaPreferences } = await import("./personaPreferenceService");
const { startTemporaryRun } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { proposeSandboxTerminalSession, reviewSandboxTerminalSession } = await import("./governedSandboxSession");
const { GovernedToolRegistry } = await import("./governedTools");
const { localExecutionBackend } = await import("./exec/backends/local");
const { prepareAnalyzedGovernedCommand } = await import("./exec/authority/governed-command");

type User = typeof users.$inferSelect;

async function seedUser(role: User["role"] = "internal_analyst"): Promise<User> {
  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Grant tester", role, organizationId: null,
  }).returning();
  return user!;
}

async function eventsOf(requestId: string, userId: number): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<void>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (event.type === "done") done.resolve();
  });
  assert.ok(subscription);
  try {
    await done.promise;
    return events;
  } finally {
    subscription.detach();
  }
}

test("server-side conversation grants (GM-11a)", { timeout: 90_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await seedUser();
  const stranger = await seedUser();
  const ownerCtx = { userId: owner.id, role: owner.role, organizationId: null };
  const projectA = await createProject(ownerCtx, { name: "Grant project A" });
  const projectB = await createProject(ownerCtx, { name: "Grant project B" });
  const chatA = await createProjectChat(ownerCtx, { projectId: projectA.id, scope: "project" });
  const chatB = await createProjectChat(ownerCtx, { projectId: projectB.id, scope: "project" });
  const toolSchema = z.object({ message: z.string().trim().min(1).max(80) }).strict();
  const toolId = "lios.test.send";
  const planHash = "a".repeat(64);
  const policy = { permissionClass: "user_confirm" as const, policyRevision: "b".repeat(64) };
  async function proposeTool(options: {
    requestId?: string;
    projectId?: number | null;
    chatId?: number | null;
    user?: User;
    controller?: AbortController;
    currentPolicy?: () => CurrentExecutionPolicy;
    now?: number;
  } = {}) {
    const requestId = options.requestId ?? crypto.randomUUID();
    const controller = options.controller ?? new AbortController();
    let effect: (signal: AbortSignal) => Promise<void> = async () => {};
    const tools = sendTool((signal) => effect(signal));
    const descriptor = tools.get(toolId)!;
    const proposal = await store.proposeGovernedToolOperation({
      user: options.user ?? owner, requestId,
      projectId: options.projectId === undefined ? projectA.id : options.projectId,
      chatId: options.chatId === undefined ? chatA.id : options.chatId,
      stepId: "step-send", toolCallId: "step-send-call", toolId,
      input: { message: "  reviewed  " }, descriptor, planHash,
      policy, currentPolicy: options.currentPolicy ?? (() => policy), runSignal: controller.signal, now: options.now,
    });
    return { ...proposal, requestId, controller, tools, descriptor, setEffect(next: typeof effect) { effect = next; } };
  }
  async function approveTool(
    proposal: { reviewId: string; requestId: string },
    scope: "once" | "project" = "once",
    now?: number,
  ) {
    await store.reviewGovernedToolOperation({ user: owner, ...proposal, allow: true, scope, now });
    return store.resolveGovernedToolOperation({ user: owner, ...proposal, now });
  }
  function toolCall(
    proposal: { requestId: string; controller: AbortController },
    authorization: unknown,
    overrides: Partial<GovernedToolCall> = {},
  ): GovernedToolCall {
    return {
      source: "agent", requestId: proposal.requestId, userId: owner.id, projectId: projectA.id, chatId: chatA.id,
      stepId: "step-send", toolCallId: "step-send-call", planHash, runSignal: proposal.controller.signal,
      role: owner.role, authorization, idempotencyKey: "reviewed-external-call",
      beforeExternalDispatch: async () => {},
      afterExternalDispatchCommitted: async () => {},
      ...overrides,
    };
  }
  function sendTool(effect: (signal: AbortSignal) => Promise<void> = async () => {}) {
    const tools = new GovernedToolRegistry<"act", { ok: true }>();
    tools.register({
      id: toolId, label: "Send", kind: "act", permissionClass: "user_confirm",
      access: "write", sideEffect: "external", replaySafe: false, inputSchema: toolSchema,
      outputSchema: z.object({ ok: z.literal(true) }).strict(), cancel: null,
      invoke: async (_input, signal) => { await effect(signal); return { ok: true }; },
    });
    return tools;
  }

  await t.test("tool owner review is mandatory and never accepts client step/tool/input identities", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...proposal }), /review is required/);
    await assert.rejects(
      store.reviewGovernedToolOperation({ user: stranger, ...proposal, allow: true, scope: "once" }),
      /not found/,
    );
    await assert.rejects(
      store.reviewGovernedToolOperation({ user: owner, ...proposal, requestId: crypto.randomUUID(), allow: true, scope: "once" }),
      /not found/,
    );
    await store.reviewGovernedToolOperation({ user: owner, ...proposal, allow: false, scope: "once" });
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...proposal }), /unavailable/);
    await assert.rejects(proposeTool({ user: stranger }), /not found|access|denied/i);
    await assert.rejects(proposeTool({ chatId: chatB.id }), /mismatch/);
  });

  await t.test("one L4 governed review also approves the exact agent command bound to the same tool call", async () => {
    store.clearOnceApprovals();
    const requestId = crypto.randomUUID();
    const prepared = await prepareAnalyzedGovernedCommand({
      backend: localExecutionBackend,
      request: {
        argv: [process.execPath, "-e", "process.stdout.write('ok')"],
        cwd: dataDir,
        isolation: { filesystem: "host", network: "inherit", processes: "host" },
        resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
      },
    });
    const exact = await store.proposeExactConversationOperation({
      user: owner,
      projectId: projectA.id,
      chatId: chatA.id,
      requestId,
      toolCallId: "step-send-call",
      prepared,
      policy,
    });
    const governed = await proposeTool({ requestId });

    await assert.rejects(
      () => store.reviewExactConversationOperation({
        user: owner,
        projectId: projectA.id,
        chatId: chatA.id,
        requestId,
        operationDigest: exact.operationDigest,
        approvalDigest: exact.approvalDigest,
        allow: true,
      }),
      /reviewed with their governed tool call/,
      "agent exact commands cannot use a second standalone approval path",
    );

    await store.reviewGovernedToolOperation({
      user: owner,
      requestId,
      reviewId: governed.reviewId,
      allow: true,
      scope: "once",
      exactToolCallId: "step-send-call",
    });
    await assert.rejects(
      () => store.consumeExactConversationOperation({
        user: owner,
        projectId: projectA.id,
        chatId: chatA.id,
        requestId,
        toolCallId: "step-send-call",
      }),
      /not found/,
      "the exact command is not executable until governed authorization resolves",
    );
    const authorization = await store.resolveGovernedToolOperation({
      user: owner,
      requestId,
      reviewId: governed.reviewId,
    });
    assert.equal(authorization.binding.toolCallId, "step-send-call");

    await assert.rejects(
      () => store.consumeExactConversationOperation({
        user: owner,
        projectId: projectA.id,
        chatId: chatA.id,
        requestId,
        toolCallId: "other-call",
      }),
      /not found/,
      "a different L2 tool call cannot consume the reviewed exact command",
    );

    const consumed = await store.consumeExactConversationOperation({
      user: owner,
      projectId: projectA.id,
      chatId: chatA.id,
      requestId,
      toolCallId: "step-send-call",
    });
    assert.equal(consumed.prepared.operation.digest, prepared.operation.digest);
    assert.equal(consumed.approvedOperationDigest, exact.operationDigest);
    assert.equal(consumed.approvedDigest, exact.approvalDigest);
    consumed.lease.close();
    authorization.lease.close();
  });

  await t.test("denying the governed tool also destroys its bound exact agent command", async () => {
    store.clearOnceApprovals();
    const requestId = crypto.randomUUID();
    const prepared = await prepareAnalyzedGovernedCommand({
      backend: localExecutionBackend,
      request: {
        argv: [process.execPath, "-e", "process.stdout.write('never')"],
        cwd: dataDir,
        isolation: { filesystem: "host", network: "inherit", processes: "host" },
        resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
      },
    });
    await store.proposeExactConversationOperation({
      user: owner,
      projectId: projectA.id,
      chatId: chatA.id,
      requestId,
      toolCallId: "step-send-call",
      prepared,
      policy,
    });
    const governed = await proposeTool({ requestId });
    await store.reviewGovernedToolOperation({
      user: owner,
      requestId,
      reviewId: governed.reviewId,
      allow: false,
      scope: "once",
      exactToolCallId: "step-send-call",
    });

    await assert.rejects(
      () => store.resolveGovernedToolOperation({ user: owner, requestId, reviewId: governed.reviewId }),
      /unavailable/,
    );
    await assert.rejects(
      () => store.consumeExactConversationOperation({
        user: owner,
        projectId: projectA.id,
        chatId: chatA.id,
        requestId,
        toolCallId: "step-send-call",
      }),
      /not found/,
    );
  });

  await t.test("once resolution and invocation are single-use even concurrently or after a throw", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    await store.reviewGovernedToolOperation({ user: owner, ...proposal, allow: true, scope: "once" });
    const resolutions = await Promise.allSettled([
      store.resolveGovernedToolOperation({ user: owner, ...proposal }),
      store.resolveGovernedToolOperation({ user: owner, ...proposal }),
    ]);
    assert.equal(resolutions.filter((result) => result.status === "fulfilled").length, 1);
    const success = resolutions.find((result) => result.status === "fulfilled");
    assert.ok(success && success.status === "fulfilled");
    const authorization = success.value;
    assert.equal(await store.assertGovernedToolAuthorizationCurrent(authorization), authorization, "L4 can check before releasing journal");
    let effects = 0;
    proposal.setEffect(async () => { effects += 1; throw new Error("effect failed"); });
    const tools = proposal.tools;
    const call = toolCall(proposal, authorization);
    const invocations = await Promise.allSettled([
      tools.invoke(toolId, { message: "reviewed" }, proposal.controller.signal, call),
      tools.invoke(toolId, { message: "reviewed" }, proposal.controller.signal, call),
    ]);
    assert.equal(effects, 1);
    assert.ok(invocations.every((result) => result.status === "rejected"));
    assert.equal(authorization.lease.active, false);
    await assert.rejects(tools.invoke(toolId, { message: "reviewed" }, proposal.controller.signal, call), /unavailable/);
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...proposal }), /unavailable/);
  });

  await t.test("changed input/owner/Project/Chat/run/step/call/tool/plan/signal cannot cause an effect", async () => {
    for (const mutation of [
      { input: { message: "changed" }, call: {} },
      { input: { message: "reviewed" }, call: { userId: stranger.id } },
      { input: { message: "reviewed" }, call: { projectId: projectB.id } },
      { input: { message: "reviewed" }, call: { chatId: chatB.id } },
      { input: { message: "reviewed" }, call: { requestId: crypto.randomUUID() } },
      { input: { message: "reviewed" }, call: { stepId: "step-other" } },
      { input: { message: "reviewed" }, call: { toolCallId: "call-other" } },
      { input: { message: "reviewed" }, call: { planHash: "c".repeat(64) } },
      { input: { message: "reviewed" }, call: { runSignal: new AbortController().signal } },
    ]) {
      store.clearOnceApprovals();
      const proposal = await proposeTool();
      const authorization = await approveTool(proposal);
      let effects = 0;
      proposal.setEffect(async () => { effects += 1; });
      const tools = proposal.tools;
      await assert.rejects(store.assertGovernedToolAuthorizationMatches({
        authorization, ...authorization.binding, permissionClass: policy.permissionClass,
        runSignal: proposal.controller.signal, descriptor: proposal.descriptor, input: mutation.input, ...mutation.call,
      }), /exact invocation/, "L4 must reject the changed pause before journal release");
      await assert.rejects(
        tools.invoke(toolId, mutation.input, proposal.controller.signal, toolCall(proposal, authorization, mutation.call)),
        /exact invocation/,
      );
      assert.equal(effects, 0);
      // The original parsed input is still authorized; whitespace canonicalizes through the strict schema.
      assert.deepEqual(await tools.invoke(toolId, { message: " reviewed " }, proposal.controller.signal, toolCall(proposal, authorization)), { ok: true });
      assert.equal(effects, 1);
    }
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    await assert.rejects(store.consumeGovernedToolAuthorization({
      authorization, ...authorization.binding, toolId: "lios.other.send",
      input: { message: "reviewed" }, descriptor: proposal.descriptor, permissionClass: policy.permissionClass, runSignal: proposal.controller.signal,
    }), /exact invocation/);
  });

  await t.test("registered descriptor substitution/re-registration requires new owner review", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    const facts = {
      authorization, ...authorization.binding, permissionClass: policy.permissionClass,
      runSignal: proposal.controller.signal, input: { message: "reviewed" },
    };
    assert.ok(Object.isFrozen(proposal.descriptor));
    await assert.rejects(store.assertGovernedToolAuthorizationMatches({
      ...facts, descriptor: Object.freeze({ ...proposal.descriptor }),
    }), /exact invocation/);
    await assert.rejects(store.assertGovernedToolAuthorizationMatches({
      ...facts, descriptor: Object.freeze({ ...proposal.descriptor, permissionClass: "admin_confirm" }),
    }), /exact invocation/);
    let effects = 0;
    proposal.tools.register({ ...proposal.descriptor, invoke: async () => { effects += 1; return { ok: true }; } });
    await assert.rejects(proposal.tools.invoke(toolId, { message: "reviewed" }, proposal.controller.signal, toolCall(proposal, authorization)), /exact invocation/);
    assert.equal(effects, 0);
  });

  await t.test("parsed JSON input snapshots are immutable across review and asynchronous claim", async () => {
    const original = { nested: { message: "reviewed" }, ordered: [1, 2] };
    const snapshot = store.snapshotGovernedToolInput(original);
    original.nested.message = "changed";
    original.ordered.push(3);
    assert.deepEqual(snapshot, { nested: { message: "reviewed" }, ordered: [1, 2] });
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.nested));
    assert.ok(Object.isFrozen(snapshot.ordered));
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    let effects = 0;
    proposal.setEffect(async () => { effects += 1; });
    const args = { message: "reviewed" };
    const invocation = proposal.tools.invoke(toolId, args, proposal.controller.signal, toolCall(proposal, authorization));
    args.message = "changed-after-claim";
    assert.deepEqual(await invocation, { ok: true }, "registry snapshot, not mutable caller args, is executed");
    assert.equal(effects, 1);
  });

  await t.test("copied/JSON/model authorizations and restart cannot resurrect approval", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    for (const copy of [
      { ...authorization }, JSON.parse(JSON.stringify(authorization)),
      { ...authorization, binding: { ...authorization.binding } },
    ]) {
      await assert.rejects(store.assertGovernedToolAuthorizationCurrent(copy), /identity/);
      await assert.rejects(proposal.tools.invoke(toolId, { message: "reviewed" }, proposal.controller.signal, toolCall(proposal, copy)), /identity/);
    }
    const restarted = `
      import assert from "node:assert/strict";
      const store = await import(process.argv[1]);
      const authorization = JSON.parse(process.argv[2]);
      await assert.rejects(store.assertGovernedToolAuthorizationCurrent(authorization), /unavailable/);
      await assert.rejects(store.resolveGovernedToolOperation({
        user: JSON.parse(process.argv[3]), requestId: authorization.binding.requestId, reviewId: authorization.reviewId
      }), /unavailable/);
    `;
    // A genuinely new process/module graph has no once authority; intentionally no DB init.
    await promisify(execFile)(process.execPath, [
      "--import", "tsx", "--input-type=module", "-e", restarted,
      new URL("./conversationGrantStore.ts", import.meta.url).href,
      JSON.stringify(authorization), JSON.stringify({ id: owner.id, role: owner.role, organizationId: owner.organizationId }),
    ]);
    store.clearOnceApprovals(); // same destruction as restart of the canonical process-local authority
    assert.equal(authorization.lease.active, false);
    await assert.rejects(store.assertGovernedToolAuthorizationCurrent(authorization), /unavailable/);
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...proposal }), /unavailable/);
  });

  await t.test("strict schema and parsed-input hashing cannot be bypassed by extra keys or ambiguous JSON", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    assert.equal(authorization.binding.inputSha256, store.governedToolInputSha256({ message: "reviewed" }));
    assert.equal(store.governedToolInputSha256({ b: 2, a: 1 }), store.governedToolInputSha256({ a: 1, b: 2 }));
    await assert.rejects(proposal.tools.invoke(toolId, { message: "reviewed", authorization }, proposal.controller.signal, toolCall(proposal, authorization)), /input did not satisfy/);
    for (const invalid of [{ a: undefined }, { a: NaN }, { a: new Date() }, { a: [, 1] }]) {
      assert.throws(() => store.governedToolInputSha256(invalid), /JSON input/);
    }
  });

  await t.test("policy/permission drift, expiry, cancellation, close fail closed before effects", async () => {
    for (const mode of ["policy", "permission", "expiry", "cancel", "close"] as const) {
      store.clearOnceApprovals();
      let current: CurrentExecutionPolicy = policy;
      const proposal = await proposeTool({ currentPolicy: () => current, now: 1_000 });
      const authorization = await approveTool(proposal, "once", 1_001);
      if (mode === "policy") current = { ...policy, policyRevision: "c".repeat(64) };
      if (mode === "permission") current = { ...policy, permissionClass: "admin_confirm" };
      if (mode === "cancel") proposal.controller.abort();
      if (mode === "close") authorization.lease.close();
      let effects = 0;
      proposal.setEffect(async () => { effects += 1; });
      await assert.rejects(proposal.tools.invoke(
        toolId, { message: "reviewed" }, new AbortController().signal,
        toolCall(proposal, authorization, { nowMs: mode === "expiry" ? proposal.expiresAtMs : 1_002 }),
      ));
      assert.equal(effects, 0);
      current = policy;
      await assert.rejects(store.assertGovernedToolAuthorizationCurrent(authorization, 1_002), /stale|expired|cancelled|closed|permission/i, "drift never recovers");
    }
    store.clearOnceApprovals();
    const expiredReview = await proposeTool({ now: 1_000 });
    await assert.rejects(approveTool(expiredReview, "once", expiredReview.expiresAtMs), /expired/);
  });

  await t.test("canonical run cancellation reaches the tool signal without revealing its private cause", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const authorization = await approveTool(proposal);
    let observed: AbortSignal | undefined;
    const tools = proposal.tools;
    proposal.setEffect(async (signal) => {
      observed = signal;
      proposal.controller.abort(new Error("private-owner-cause"));
      assert.equal(signal.aborted, true);
      assert.equal(String(signal.reason).includes("private-owner-cause"), false);
    });
    await assert.rejects(tools.invoke(toolId, { message: "reviewed" }, new AbortController().signal, toolCall(proposal, authorization)));
    assert.ok(observed?.aborted);
  });

  await t.test("once-only governed tools ignore stale Project grants and reject Project-scope review", async () => {
    store.clearOnceApprovals();
    const onceId = "lios.test.once-only";
    const tools = new GovernedToolRegistry<"act", { ok: true }>();
    tools.register({
      id: onceId,
      label: "Once only",
      kind: "act",
      permissionClass: "user_confirm",
      allowProjectApproval: false,
      access: "write",
      sideEffect: "internal_write",
      replaySafe: false,
      inputSchema: toolSchema,
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      cancel: null,
      invoke: async () => ({ ok: true }),
    });
    const descriptor = tools.get(onceId)!;
    await getDb().insert(conversationActionGrants).values({
      id: crypto.randomUUID(),
      ownerUserId: owner.id,
      organizationId: null,
      projectId: projectA.id,
      action: `tool:${onceId}`,
    }).onConflictDoNothing();
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const proposal = await store.proposeGovernedToolOperation({
      user: owner,
      projectId: projectA.id,
      chatId: chatA.id,
      requestId,
      stepId: "step-once",
      toolCallId: "step-once-call",
      toolId: onceId,
      input: { message: "reviewed" },
      descriptor,
      planHash,
      policy,
      currentPolicy: () => policy,
      runSignal: controller.signal,
    });
    await assert.rejects(
      store.resolveGovernedToolOperation({ user: owner, requestId, reviewId: proposal.reviewId }),
      /review is required/,
      "a stored Project grant cannot authorize a once-only tool",
    );
    await assert.rejects(
      store.reviewGovernedToolOperation({
        user: owner,
        requestId,
        reviewId: proposal.reviewId,
        allow: true,
        scope: "project",
      }),
      /one-time approval only/,
    );
    await store.reviewGovernedToolOperation({
      user: owner,
      requestId,
      reviewId: proposal.reviewId,
      allow: true,
      scope: "once",
    });
    const authorization = await store.resolveGovernedToolOperation({
      user: owner,
      requestId,
      reviewId: proposal.reviewId,
    });
    assert.equal(authorization.grant.scope, "once");
    authorization.lease.close();
  });

  await t.test("Project tool grants persist through restart but every authorization is exact and revocable", async () => {
    store.clearOnceApprovals();
    const proposal = await proposeTool();
    const original = await approveTool(proposal, "project");
    store.clearOnceApprovals();
    assert.equal(original.lease.active, false);
    const next = await proposeTool();
    const authorization = await store.resolveGovernedToolOperation({ user: owner, ...next });
    assert.equal(authorization.grant.scope, "project");
    assert.notEqual(authorization.lease, original.lease);
    await assert.rejects(next.tools.invoke(toolId, { message: "changed" }, next.controller.signal, toolCall(next, authorization)), /exact invocation/);
    const otherProject = await proposeTool({ projectId: projectB.id, chatId: chatB.id });
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...otherProject }), /review is required/);
    await assert.rejects(store.resolveGovernedToolOperation({ user: stranger, ...next }), /not found/);
    await store.revokeProjectToolGrant(owner, projectA.id, toolId);
    await assert.rejects(store.assertGovernedToolAuthorizationCurrent(authorization), /unavailable|revoked|closed/);
    store.clearOnceApprovals();
    const revoked = await proposeTool();
    await assert.rejects(store.resolveGovernedToolOperation({ user: owner, ...revoked }), /review is required/);
    assert.deepEqual(await store.listProjectGrants(owner, projectA.id), [], "tool subjects do not leak into legacy action grants");
  });

  await t.test("admin tool review cannot be minted or consumed using a non-admin owner", async () => {
    store.clearOnceApprovals();
    const adminPolicy = { ...policy, permissionClass: "admin_confirm" as const };
    const tools = new GovernedToolRegistry<"act", { ok: true }>();
    tools.register({
      id: toolId, label: "Admin", kind: "act", permissionClass: "admin_confirm",
      access: "write", sideEffect: "external", replaySafe: false,
      inputSchema: toolSchema, outputSchema: z.object({ ok: z.literal(true) }).strict(), cancel: null,
      invoke: async () => ({ ok: true }),
    });
    await assert.rejects(store.proposeGovernedToolOperation({
      user: owner, projectId: projectA.id, chatId: chatA.id, requestId: crypto.randomUUID(),
      stepId: "step-admin", toolCallId: "call-admin", toolId, input: { message: "reviewed" },
      descriptor: tools.get(toolId)!, planHash, policy: adminPolicy, currentPolicy: () => adminPolicy,
      runSignal: new AbortController().signal,
    }), /Administrator/);
    const admin = await seedUser("internal_admin");
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    const proposal = await store.proposeGovernedToolOperation({
      user: admin, projectId: null, chatId: null, requestId,
      stepId: "step-admin", toolCallId: "call-admin", toolId, input: { message: "reviewed" },
      descriptor: tools.get(toolId)!, planHash, policy: adminPolicy, currentPolicy: () => adminPolicy, runSignal: controller.signal,
    });
    await assert.rejects(store.reviewGovernedToolOperation({
      user: { ...admin, role: "internal_analyst" }, requestId, reviewId: proposal.reviewId, allow: true, scope: "once",
    }), /Administrator/);
    await store.reviewGovernedToolOperation({ user: admin, requestId, reviewId: proposal.reviewId, allow: true, scope: "once" });
    const authorization = await store.resolveGovernedToolOperation({ user: admin, requestId, reviewId: proposal.reviewId });
    assert.deepEqual(await tools.invoke(toolId, { message: "reviewed" }, controller.signal, {
      userId: admin.id, projectId: null, chatId: null, requestId, stepId: "step-admin", toolCallId: "call-admin",
      planHash, runSignal: controller.signal, role: admin.role, authorization,
    }), { ok: true });
  });

  await t.test("one-time approvals are single-use, request-bound, user-bound and expire", async () => {
    store.clearOnceApprovals();
    const requestId = crypto.randomUUID();
    await store.recordConversationGrant({ user: owner, action: "RunBacktest", scope: "once", requestId });
    assert.deepEqual(await store.effectiveApprovals({ user: stranger, projectId: null, continuationOf: requestId }), [], "another user cannot use it");
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: crypto.randomUUID() }), [], "bound to its request");
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: null }), [], "a fresh request has no approval");
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: requestId }), [{ action: "RunBacktest", scope: "once" }]);
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: requestId }), [], "consumed by the first use");

    const stale = crypto.randomUUID();
    const t0 = 1_000_000;
    await store.recordConversationGrant({ user: owner, action: "RunBacktest", scope: "once", requestId: stale, now: t0 });
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: stale, now: t0 + store.ONCE_APPROVAL_TTL_MS + 1 }), [], "expired");
  });

  await t.test("Project grants are owned by the user, scoped to one Project, and revocable", async () => {
    await store.recordConversationGrant({ user: owner, action: "AIDirectEstimate", scope: "project", projectId: projectA.id });
    await store.recordConversationGrant({ user: owner, action: "AIDirectEstimate", scope: "project", projectId: projectA.id }); // idempotent
    assert.deepEqual(await store.listProjectGrants(owner, projectA.id), [{ action: "AIDirectEstimate", scope: "project" }]);
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: projectA.id, continuationOf: null }), [{ action: "AIDirectEstimate", scope: "project" }]);
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: projectB.id, continuationOf: null }), [], "another Project does not inherit it");
    assert.deepEqual(await store.effectiveApprovals({ user: owner, projectId: null, continuationOf: null }), [], "Quick and Temporary chats never see Project grants");
    await assert.rejects(() => store.recordConversationGrant({ user: stranger, action: "RunBacktest", scope: "project", projectId: projectA.id }), /not found|access|denied/i);
    await assert.rejects(() => store.listProjectGrants(stranger, projectA.id), /not found|access|denied/i);
    await store.revokeProjectGrant(owner, projectA.id, "AIDirectEstimate");
    assert.deepEqual(await store.listProjectGrants(owner, projectA.id), []);
  });

  await t.test("actions that need no decision cannot be granted, and a Project grant needs a Project", async () => {
    await assert.rejects(() => store.recordConversationGrant({ user: owner, action: "OpenArtifact", scope: "once", requestId: crypto.randomUUID() }), store.ConversationGrantError);
    await assert.rejects(() => store.recordConversationGrant({ user: owner, action: "RunBacktest", scope: "project" }), store.ConversationGrantError);
    await assert.rejects(() => store.recordConversationGrant({ user: owner, action: "RunBacktest", scope: "once" }), store.ConversationGrantError);
  });

  await t.test("a request that merely claims approval is refused; a server-recorded approval is honoured once", async () => {
    store.clearOnceApprovals();
    await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true }).onConflictDoNothing();
    await upsertPersonaPreferences(owner, { preferences: { waveCMasterAi: { state: "on", mode: "manual" } } });
    const ask = { message: "What might higher rates do to bank margins?", executionMode: "ai_direct", sourceScope: "my_data", history: [] } as const;
    const claimed = crypto.randomUUID();
    await startTemporaryRun(owner, {
      ...ask, requestId: claimed, aiDirectApproved: true, approvals: [{ action: "AIDirectEstimate", scope: "once" }, { action: "AIDirectEstimate", scope: "project" }],
    });
    const claimedEvents = await eventsOf(claimed, owner.id);
    assert.ok(claimedEvents.some((event) => event.type === "approval_required" && event.action === "AIDirectEstimate"), "body-supplied grants are ignored");

    await store.recordConversationGrant({ user: owner, action: "AIDirectEstimate", scope: "once", requestId: claimed });
    const continued = crypto.randomUUID();
    await startTemporaryRun(owner, { ...ask, requestId: continued, continuationOf: claimed });
    const continuedEvents = await eventsOf(continued, owner.id);
    assert.equal(continuedEvents.some((event) => event.type === "approval_required"), false, "the recorded approval lets the run proceed");

    const replay = crypto.randomUUID();
    await startTemporaryRun(owner, { ...ask, requestId: replay, continuationOf: claimed });
    const replayEvents = await eventsOf(replay, owner.id);
    assert.ok(replayEvents.some((event) => event.type === "approval_required"), "the approval was single-use");
  });

  await t.test("exact-operation approval is owner/Project/Chat bound and denial is durable without launch", async () => {
    const old = {
      isolation: process.env.LIOS_EXECUTION_ISOLATION,
      engine: process.env.LIOS_EXECUTION_SANDBOX_ENGINE,
      target: process.env.LIOS_EXECUTION_SANDBOX_TARGET,
      image: process.env.LIOS_EXECUTION_SANDBOX_IMAGE,
      base64: process.env.LIOS_EXECUTION_SANDBOX_BASE64,
      path: process.env.PATH,
    };
    process.env.LIOS_EXECUTION_ISOLATION = "strict";
    const engineBin = fs.mkdtempSync(path.join(os.tmpdir(), "lios-denied-engine-"));
    t.after(() => fs.rmSync(engineBin, { recursive: true, force: true }));
    // This real executable is only hashed for a denial; it must never be launched.
    // The fixture proves approval custody, not Docker availability or isolation.
    fs.copyFileSync(process.execPath, path.join(engineBin, process.platform === "win32" ? "docker.exe" : "docker"));
    process.env.PATH = [engineBin, old.path].filter(Boolean).join(path.delimiter);
    process.env.LIOS_EXECUTION_SANDBOX_ENGINE = "docker";
    process.env.LIOS_EXECUTION_SANDBOX_TARGET = "unix:///var/run/docker.sock";
    process.env.LIOS_EXECUTION_SANDBOX_IMAGE = "alpine@sha256:" + "a".repeat(64);
    process.env.LIOS_EXECUTION_SANDBOX_BASE64 = "/bin/base64";
    try {
      const chat = await createProjectChat(ownerCtx, { projectId: projectA.id, scope: "project" });
      const proposal = await proposeSandboxTerminalSession(owner, projectA.id, chat.id);
      await assert.rejects(
        () => reviewSandboxTerminalSession({
          user: stranger,
          projectId: projectA.id,
          chatId: chat.id,
          requestId: proposal.requestId,
          operationDigest: proposal.operationDigest,
          approvalDigest: proposal.approvalDigest,
          allow: false,
        }),
        /not found|access|denied/i,
      );
      await assert.rejects(
        () => reviewSandboxTerminalSession({
          user: owner,
          projectId: projectA.id,
          chatId: chat.id,
          requestId: proposal.requestId,
          operationDigest: "0".repeat(64),
          approvalDigest: proposal.approvalDigest,
          allow: false,
        }),
        /changed/i,
      );
      const denied = await reviewSandboxTerminalSession({
        user: owner,
        projectId: projectA.id,
        chatId: chat.id,
        requestId: proposal.requestId,
        operationDigest: proposal.operationDigest,
        approvalDigest: proposal.approvalDigest,
        allow: false,
      });
      assert.deepEqual(denied, { sessionId: proposal.requestId, status: "denied" });
      const journal = await (await import("./exec/execution-scope")).getConversationExecutionJournal();
      const receipt = await journal.read(proposal.requestId, { userId: owner.id, projectId: projectA.id, chatId: chat.id });
      assert.equal(receipt?.status, "denied");
      assert.equal(receipt?.stdout, "");
      assert.equal(receipt?.trust?.decision, "denied");
      assert.equal(receipt?.trust?.operationDigest, proposal.operationDigest);
    } finally {
      if (old.path === undefined) delete process.env.PATH;
      else process.env.PATH = old.path;
      if (old.isolation === undefined) delete process.env.LIOS_EXECUTION_ISOLATION;
      else process.env.LIOS_EXECUTION_ISOLATION = old.isolation;
      if (old.engine === undefined) delete process.env.LIOS_EXECUTION_SANDBOX_ENGINE;
      else process.env.LIOS_EXECUTION_SANDBOX_ENGINE = old.engine;
      if (old.target === undefined) delete process.env.LIOS_EXECUTION_SANDBOX_TARGET;
      else process.env.LIOS_EXECUTION_SANDBOX_TARGET = old.target;
      if (old.image === undefined) delete process.env.LIOS_EXECUTION_SANDBOX_IMAGE;
      else process.env.LIOS_EXECUTION_SANDBOX_IMAGE = old.image;
      if (old.base64 === undefined) delete process.env.LIOS_EXECUTION_SANDBOX_BASE64;
      else process.env.LIOS_EXECUTION_SANDBOX_BASE64 = old.base64;
    }
  });
  await t.test("GM20 owner-scoped Project/Chat MCP approval, real saved source, release receipt and live revocation", { timeout: 60_000 }, async () => {
    store.clearOnceApprovals();
    const { eq } = await import("drizzle-orm");
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const { sourceConnections } = await import("@shared/schema");
    const { conversationRequestSchema } = await import("@shared/conversationRuntime");
    const { executeConversationRuntime, getConversationTool, currentConversationToolApprovalPolicy } = await import("./conversationRuntime");
    const { createAttribution } = await import("./byoaiRouter");
    const { createExecutionJournal } = await import("./exec/execution-journal");
    type PersistedLedger = Awaited<ReturnType<typeof createExecutionJournal>>;
    const wireCalls: string[] = [];
    let cancelAfterRemoteToolEntered: (() => void) | null = null;
    const server = createServer(async (request, response) => {
      if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
      if (request.method === "GET") { response.writeHead(405).end(); return; }
      if (request.method !== "POST") { response.writeHead(202).end(); return; }
      const body: Buffer[] = [];
      for await (const chunk of request) body.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(body).toString("utf8")) as {
        id?: number | string; method?: string; params?: { name?: string; arguments?: { symbol?: string } };
      };
      if (rpc.method === "tools/call") {
        wireCalls.push(String(rpc.params?.name));
        assert.equal(rpc.params?.arguments?.symbol, "TEST");
        cancelAfterRemoteToolEntered?.();
      }
      if (rpc.id === undefined) { response.writeHead(202).end(); return; }
      const result = rpc.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mcp-project-fixture", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [{ name: "quotes.read", inputSchema: { type: "object", properties: {} } }] }
        : rpc.method === "tools/call" ? { isError: false, content: [{ type: "text", text: "OWNER_APPROVED_MCP_QUOTE_127" }] }
        : null;
      const envelope = result === null
        ? { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } }
        : { jsonrpc: "2.0", id: rpc.id, result };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(envelope));
    });
    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const [connection] = await getDb().insert(sourceConnections).values({
        userId: owner.id, organizationId: null, connectorId: "mcp",
        name: "GM20 owner-backed fixture", sourceType: "mcp",
        config: {
          endpoint: "http://127.0.0.1:" + address.port + "/mcp",
          projectId: projectA.id, allowedToolIds: "quotes.read",
          aiTransmission: "allow", aiUsageRights: "cleared", requireApprovalForTools: true,
        },
        credentialRef: null, status: "configured",
      }).returning();
      assert.ok(connection);
      const descriptor = getConversationTool("lios.external-mcp.call");
      assert.ok(descriptor, "the real product MCP tool must be registered");
      const plannedInput = { connectionId: connection.id, toolId: "quotes.read", arguments: { symbol: "TEST" } };
      const plan = JSON.stringify({ steps: [{
        id: "mcp", toolId: "lios.external-mcp.call", label: "Read connected source",
        input: plannedInput, dependsOn: [],
      }] });
      const reply = JSON.stringify({ decision: "complete", answer: "The connected source supplied a test observation." });
      const run = (requestId: string, controller: AbortController, answers: string[], resume?: {
        state: import("./agentLoop").AgentLoopResumeState; authorization: unknown;
      }, onLedger?: (event: import("./exec/agent-run-events").AgentEventInput) => void | Promise<void>,
      persisted?: PersistedLedger) => {
        const ledger: import("./exec/agent-run-events").AgentEventInput[] = [];
        const events: ConversationRuntimeEvent[] = [];
        const prompts: string[] = [];
        const queue = [...answers];
        const request = conversationRequestSchema.parse({
          requestId, message: "Read TEST through my connected MCP",
          sourceScope: "my_data", executionMode: "ai_assisted",
          transmissionPolicy: { allowResourceReferences: true },
        });
        const promise = executeConversationRuntime({
          tenant: ownerCtx, scope: "project", chatId: chatA.id,
          projectId: projectA.id, resources: [], history: [], request,
          signal: controller.signal,
          agentLoop: { ledger: async event => {
            ledger.push(event);
            await persisted?.appendAgentEvent(requestId, event);
            await onLedger?.(event);
          }, ...(resume ? { resume } : {}) },
          aiCompletion: async completion => {
            const prompt = completion.messages.map(msg => msg.content).join("\n");
            prompts.push(prompt);
            const text = queue.shift();
            if (!text) throw new Error("The fixture model was called unexpectedly.");
            return { provider: "openai", model: "offline", text,
              attribution: createAttribution({ provider: "openai", model: "offline", prompt, output: text }) };
          },
          emit: event => { events.push(event); },
        });
        return { promise, ledger, events, prompts };
      };
      const reviewOwner = async (
        requestId: string, controller: AbortController,
        pause: NonNullable<Awaited<ReturnType<typeof executeConversationRuntime>>["agentPause"]>,
        allow: boolean,
      ) => {
        const policy = currentConversationToolApprovalPolicy("lios.external-mcp.call");
        const proposal = await store.proposeGovernedToolOperation({
          user: owner, projectId: projectA.id, chatId: chatA.id, requestId,
          stepId: pause.stepId, toolCallId: pause.resume.paused.toolCallId,
          toolId: "lios.external-mcp.call", input: plannedInput, descriptor,
          planHash: pause.planSha256, policy, runSignal: controller.signal,
          currentPolicy: () => currentConversationToolApprovalPolicy("lios.external-mcp.call"),
        });
        await assert.rejects(
          store.reviewGovernedToolOperation({
            user: stranger, requestId, reviewId: proposal.reviewId, allow: true, scope: "once",
          }),
          /not found/i,
        );
        await store.reviewGovernedToolOperation({
          user: owner, requestId, reviewId: proposal.reviewId, allow, scope: "once",
        });
        if (!allow) {
          await assert.rejects(store.resolveGovernedToolOperation({
            user: owner, requestId, reviewId: proposal.reviewId,
          }), /unavailable/i);
          return null;
        }
        return store.resolveGovernedToolOperation({ user: owner, requestId, reviewId: proposal.reviewId });
      };
      const noId = crypto.randomUUID();
      const noController = new AbortController();
      const denied = await run(noId, noController, [plan]).promise;
      assert.equal(denied.awaitingApproval, true);
      assert.ok(denied.agentPause);
      assert.equal(await reviewOwner(noId, noController, denied.agentPause, false), null);
      assert.deepEqual(wireCalls, [], "denied L4 review cannot reach the source");

      const approvedId = crypto.randomUUID();
      const approvedController = new AbortController();
      const savedOwner = { userId: owner.id, projectId: projectA.id, chatId: chatA.id };
      const journalOptions = {
        directory: path.join(dataDir, "gm20-mcp-journal"),
        keyDirectory: path.join(dataDir, "gm20-mcp-keys"),
      };
      const persisted = await createExecutionJournal(journalOptions);
      await persisted.begin({ id: approvedId, owner: savedOwner, label: "Approved MCP", agentRun: true });
      const pending = await run(approvedId, approvedController, [plan], undefined, undefined, persisted).promise;
      assert.equal(pending.awaitingApproval, true);
      assert.ok(pending.agentPause);
      assert.deepEqual(wireCalls, []);
      await persisted.markWaitingApproval(approvedId);
      assert.equal((await persisted.read(approvedId, savedOwner))?.status, "waiting_approval");
      const authorization = await reviewOwner(approvedId, approvedController, pending.agentPause, true);
      await persisted.resumeAfterApproval(
        approvedId, savedOwner, pending.agentPause.resume.paused.toolCallId,
        "owner-approved:" + crypto.createHash("sha256").update(approvedId).digest("hex"),
      );
      assert.ok(authorization);
      const resumed = run(approvedId, approvedController, [reply], {
        state: pending.agentPause.resume, authorization,
      }, undefined, persisted);
      const outcome = await resumed.promise;
      assert.equal(outcome.awaitingApproval, false);
      assert.equal(outcome.cancelled, false);
      assert.deepEqual(wireCalls, ["quotes.read"]);
      assert.equal(resumed.prompts.length, 1, "the resumed agent does not re-plan");
      assert.match(resumed.prompts[0]!, /BEGIN_UNTRUSTED_MCP_EVIDENCE/);
      assert.match(resumed.prompts[0]!, /OWNER_APPROVED_MCP_QUOTE_127/);
      assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_dispatch_intent").length, 1);
      assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_dispatch_committed").length, 1);
      assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_finished" && event.status === "succeeded").length, 1);
      assert.ok(resumed.events.some(event => event.type === "receipt"));
      assert.equal(JSON.stringify(resumed.ledger).includes("OWNER_APPROVED_MCP_QUOTE_127"), false, "L2 stores refs, not raw MCP passages");
      await persisted.finish(approvedId, "completed", 0);
      // Reinstantiate storage to force a real encrypted-disk read instead
      // of inspecting only live JS objects or callback-local event arrays.
      const coldJournal = await createExecutionJournal(journalOptions);
      const durable = await coldJournal.read(approvedId, savedOwner);
      assert.ok(durable);
      assert.equal(durable.version, 2);
      assert.equal(durable.status, "completed");
      assert.deepEqual(durable.events?.map(event => event.kind), [
        "step_started", "tool_call_started", "tool_call_waiting_approval",
        "tool_call_resumed", "tool_call_dispatch_intent", "tool_call_dispatch_committed",
        "tool_call_finished", "step_finished",
      ]);
      assert.equal(durable.events?.filter(event => event.kind === "tool_call_dispatch_committed").length, 1);
      assert.equal(await coldJournal.read(approvedId, { ...savedOwner, userId: stranger.id }), null,
        "unrelated signed-in users cannot read an execution record");
      const encryptedBytes = fs.readFileSync(path.join(journalOptions.directory, approvedId));
      for (const forbidden of ["OWNER_APPROVED_MCP_QUOTE_127", "quotes.read", "aiUsageRights", "cleared", "read_mcp"]) {
        assert.equal(encryptedBytes.includes(Buffer.from(forbidden)), false,
          "encrypted journal must not contain plaintext input, content or release consent");
      }
      assert.equal(JSON.stringify(durable.events).includes("OWNER_APPROVED_MCP_QUOTE_127"), false,
        "decrypted durable dispatch events contain hashes and refs, never the MCP excerpt");

      const revokedId = crypto.randomUUID();
      const revokedController = new AbortController();
      const revokedPending = await run(revokedId, revokedController, [plan]).promise;
      assert.ok(revokedPending.agentPause);
      const revokedGrant = await reviewOwner(revokedId, revokedController, revokedPending.agentPause, true);
      assert.ok(revokedGrant);
      await getDb().update(sourceConnections).set({ status: "invalid" }).where(eq(sourceConnections.id, connection.id));
      const revokedRun = run(revokedId, revokedController, [reply], {
        state: revokedPending.agentPause.resume, authorization: revokedGrant,
      });
      const revokedOutcome = await revokedRun.promise;
      assert.equal(revokedOutcome.awaitingApproval, false);
      assert.deepEqual(wireCalls, ["quotes.read"], "revoked source cannot dispatch a second MCP request");
      assert.equal(revokedRun.ledger.some(event => event.kind === "tool_call_dispatch_intent"), false,
        "refusal must precede L5 intent: no remote effect was possible");
      assert.equal(revokedRun.ledger.some(event => event.kind === "tool_call_dispatch_committed"), false);
      assert.equal(revokedRun.ledger.some(event => event.kind === "tool_call_finished" && event.status === "succeeded"), false);
      assert.ok(!revokedRun.prompts.some(prompt => prompt.includes("OWNER_APPROVED_MCP_QUOTE_127")));

      // Stop is signalled after L5 acknowledged the intent but BEFORE the
      // registry enters tool.invoke. The registry alone can prove zero effect
      // and append a no_effect proof without any remote tools/call.
      await getDb().update(sourceConnections).set({ status: "configured" }).where(eq(sourceConnections.id, connection.id));
      const noEffectId = crypto.randomUUID();
      const noEffectController = new AbortController();
      const noEffectPending = await run(noEffectId, noEffectController, [plan]).promise;
      assert.ok(noEffectPending.agentPause);
      const noEffectAuth = await reviewOwner(noEffectId, noEffectController, noEffectPending.agentPause, true);
      assert.ok(noEffectAuth);
      const noEffectRun = run(noEffectId, noEffectController, [reply], {
        state: noEffectPending.agentPause.resume, authorization: noEffectAuth,
      }, event => { if (event.kind === "tool_call_dispatch_intent") noEffectController.abort(); });
      await noEffectRun.promise.catch(() => undefined);
      assert.deepEqual(wireCalls, ["quotes.read"], "stopping after intent acknowledgement must not invoke the MCP SDK");
      assert.equal(noEffectRun.ledger.filter(event => event.kind === "tool_call_dispatch_intent").length, 1);
      assert.equal(noEffectRun.ledger.filter(event => event.kind === "tool_call_dispatch_no_effect").length, 1,
        "a pre-entry stop has a durable zero-effect reconciliation proof");
      assert.equal(noEffectRun.ledger.some(event => event.kind === "tool_call_dispatch_committed"), false);
      assert.equal(noEffectRun.ledger.some(event => event.kind === "tool_call_finished" && event.status === "succeeded"), false);
      assert.equal(noEffectRun.prompts.length, 0, "cancelled runs do not synthesize results");

      // In contrast, after the MCP server has received tools/call, even a
      // client-side abort cannot prove the server did not perform the effect.
      // The L5 intent remains unresolved, NEVER a no_effect proof or commit.
      const unknownId = crypto.randomUUID();
      const unknownController = new AbortController();
      const unknownPending = await run(unknownId, unknownController, [plan]).promise;
      assert.ok(unknownPending.agentPause);
      const unknownAuth = await reviewOwner(unknownId, unknownController, unknownPending.agentPause, true);
      assert.ok(unknownAuth);
      cancelAfterRemoteToolEntered = () => unknownController.abort();
      try {
        const unknownRun = run(unknownId, unknownController, [reply], {
          state: unknownPending.agentPause.resume, authorization: unknownAuth,
        });
        await unknownRun.promise.catch(() => undefined);
        assert.deepEqual(wireCalls, ["quotes.read", "quotes.read"],
          "only one additional remote effect attempt may begin");
        assert.equal(unknownRun.ledger.filter(event => event.kind === "tool_call_dispatch_intent").length, 1);
        assert.equal(unknownRun.ledger.some(event => event.kind === "tool_call_dispatch_no_effect"), false,
          "an already received remote call is never falsely reconciled as no effect");
        assert.equal(unknownRun.ledger.some(event => event.kind === "tool_call_dispatch_committed"), false);
        assert.equal(unknownRun.ledger.some(event => event.kind === "tool_call_finished" && event.status === "succeeded"), false);
        assert.ok(!unknownRun.prompts.some(prompt => prompt.includes("OWNER_APPROVED_MCP_QUOTE_127")));
      } finally {
        cancelAfterRemoteToolEntered = null;
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

});
