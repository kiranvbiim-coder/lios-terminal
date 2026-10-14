import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { GovernedToolCall } from "./governedTools";
import type { ConversationToolKind, ConversationToolResult } from "./conversationRuntime";
import { S3StorageProvider, signS3Request } from "./s3StorageProvider";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-object-publication-"));
process.env.LIMURIA_DATA_DIR = dataDir;
// Test deliberately controls the module-load boundary: db.ts captures the isolated Home data root.
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { GovernedToolRegistry } = await import("./governedTools");
const grants = await import("./conversationGrantStore");
const { createProjectObjectPublicationTool, projectObjectPublicationOutputSchema, projectObjectPublicationPolicyBindingSha256 } = await import("./projectObjectPublicationTool");

// In-process protocol regression server, not a qualification provider or a production fallback.
function conditionalS3ProtocolServer() {
  const objects = new Map<string, Buffer>();
  const seen: Array<{ method: string; key: string; conditional: string; validSignature: boolean }> = [];
  let commits = 0;
  let nextWrite: "normal" | "lost-commit-response" | "unknown-no-commit" | "redirect" = "normal";
  let afterPut: (() => void) | null = null;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const bytes = Buffer.concat(chunks);
      const method = request.method ?? "";
      const key = request.url ?? "";
      const date = String(request.headers["x-amz-date"]);
      const extraHeaders: Record<string, string> = {};
      if (request.headers["if-none-match"]) extraHeaders["if-none-match"] = String(request.headers["if-none-match"]);
      if (request.headers["content-type"]) extraHeaders["content-type"] = String(request.headers["content-type"]);
      const expected = signS3Request({
        method, host: String(request.headers.host), canonicalPath: key,
        region: "us-east-1", accessKeyId: "PUBLICATIONACCESS", secretAccessKey: "publication-private-test-secret",
        payloadSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        now: new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`), extraHeaders,
      });
      const validSignature = request.headers.authorization === expected.headers.authorization
        && request.headers["x-amz-content-sha256"] === expected.headers["x-amz-content-sha256"];
      seen.push({ method, key, conditional: String(request.headers["if-none-match"] ?? ""), validSignature });
      if (!validSignature) { response.writeHead(403).end(); return; }
      if (method === "PUT") {
        const behavior = nextWrite;
        nextWrite = "normal";
        if (behavior === "redirect") { response.writeHead(307, { location: "http://127.0.0.1:1/forbidden" }).end(); return; }
        if (behavior === "unknown-no-commit") { request.socket.destroy(); return; }
        if (request.headers["if-none-match"] !== "*") { response.writeHead(400).end(); return; }
        if (objects.has(key)) { response.writeHead(412).end(); return; }
        objects.set(key, bytes);
        commits += 1;
        afterPut?.();
        afterPut = null;
        if (behavior === "lost-commit-response") request.socket.destroy();
        else response.writeHead(200).end();
      } else if (method === "GET") {
        const found = objects.get(key);
        if (found) response.writeHead(200, { "content-length": found.length }).end(found);
        else response.writeHead(404).end();
      } else response.writeHead(405).end();
    });
  });
  return {
    server, objects, seen,
    get commits() { return commits; },
    writeBehavior(value: typeof nextWrite, hook: (() => void) | null = null) { nextWrite = value; afterPut = hook; },
  };
}

async function listen(server: http.Server, port = 0): Promise<number> {
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(port, "127.0.0.1", listening.resolve);
  await listening.promise;
  server.off("error", listening.reject);
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  const closed = Promise.withResolvers<void>();
  server.close((error) => error ? closed.reject(error) : closed.resolve());
  server.closeAllConnections();
  await closed.promise;
}

const environmentFields = ["ENDPOINT", "BUCKET", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY_REF"] as const;

test("Project publication uses canonical owner review and a real signed immutable S3 protocol seam", { timeout: 90_000 }, async (t) => {
  const previous = environmentFields.map((field) => [field, process.env[`LIOS_PUBLICATION_S3_${field}`]] as const);
  const protocol = conditionalS3ProtocolServer();
  const port = await listen(protocol.server);
  const endpoint = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    LIOS_PUBLICATION_S3_ENDPOINT: endpoint, LIOS_PUBLICATION_S3_BUCKET: "publication-bucket",
    LIOS_PUBLICATION_S3_REGION: "us-east-1", LIOS_PUBLICATION_S3_ACCESS_KEY_ID: "PUBLICATIONACCESS",
    LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY: "publication-private-test-secret",
  });
  delete process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY_REF;
  await initDb();
  t.after(async () => {
    grants.clearOnceApprovals();
    await close(protocol.server);
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    for (const [field, value] of previous) {
      if (value === undefined) delete process.env[`LIOS_PUBLICATION_S3_${field}`];
      else process.env[`LIOS_PUBLICATION_S3_${field}`] = value;
    }
  });
  const [owner] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_analyst", name: "Publication owner" }).returning();
  const [other] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: "internal_analyst", name: "Other publication owner" }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const otherTenant = { userId: other.id, organizationId: null, role: other.role };
  const project = await createProject(tenant, { name: "External publication" });
  const otherProject = await createProject(otherTenant, { name: "Other owner" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const tool = createProjectObjectPublicationTool();
  const registry = new GovernedToolRegistry<ConversationToolKind, ConversationToolResult>();
  registry.register(tool);
  const descriptor = registry.get(tool.id)!;
  const args = { title: "Site accessibility", content: "The north entrance has a step-free ramp." };
  const signal = new AbortController().signal;
  let dispatches = 0;
  const noEffectProofs: string[] = [];
  function scopedCall(requestId = crypto.randomUUID(), overrides: Partial<GovernedToolCall> = {}): GovernedToolCall {
    return {
      source: "agent", tenant, userId: owner.id, projectId: project.id, chatId: chat.id, requestId,
      idempotencyKey: "server-owned-publication-call", beforeExternalDispatch: async () => { dispatches += 1; },
      markExternalDispatchNoEffect: async (proofRef) => { if (proofRef) noEffectProofs.push(proofRef); },
      afterExternalDispatchCommitted: async () => {}, ...overrides,
    };
  }
  async function approvedCall(input: Record<string, unknown>, call: GovernedToolCall, approvalDescriptor = descriptor): Promise<GovernedToolCall> {
    const policy = { permissionClass: "user_confirm" as const, policyRevision: projectObjectPublicationPolicyBindingSha256() };
    const proposal = await grants.proposeGovernedToolOperation({
      user: owner, requestId: call.requestId!, projectId: project.id, chatId: chat.id,
      stepId: "publish", toolCallId: `publish-${crypto.randomUUID()}`, toolId: tool.id, descriptor: approvalDescriptor, input,
      planHash: "a".repeat(64), policy, runSignal: signal,
      currentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: projectObjectPublicationPolicyBindingSha256() }),
    });
    await grants.reviewGovernedToolOperation({ user: owner, requestId: call.requestId!, reviewId: proposal.reviewId, allow: true, scope: "once" });
    const authorization = await grants.resolveGovernedToolOperation({ user: owner, requestId: call.requestId!, reviewId: proposal.reviewId });
    return { ...call, ...proposal.binding, authorization, runSignal: signal };
  }

  await t.test("catalogue rejects model target/scope and credential-shaped content; no grant means no remote effect", async () => {
    assert.equal(descriptor.id, "lios.project.publish_object");
    assert.equal(descriptor.sideEffect, "external");
    assert.equal(descriptor.replaySafe, true);
    assert.equal(descriptor.permissionClass, "user_confirm");
    assert.equal(descriptor.allowProjectApproval, false);
    for (const field of ["bucket", "key", "path", "endpoint", "projectId", "tenant", "idempotencyKey"]) {
      assert.equal(descriptor.inputSchema.safeParse({ ...args, [field]: "forged" }).success, false);
    }
    for (const content of ["api_key=private-value", "Authorization: Bearer private-value", "-----BEGIN PRIVATE KEY-----", "sk-abcdefghijklmnopqrstuvwx"]) {
      assert.equal(descriptor.inputSchema.safeParse({ ...args, content }).success, false);
    }
    assert.equal(descriptor.inputSchema.safeParse({ ...args, content: "😀".repeat(20_000) }).success, false);
    assert.equal(descriptor.inputSchema.safeParse({ ...args, content: "\u0001".repeat(20_000) }).success, false);
    await assert.rejects(registry.invoke(tool.id, args, signal, scopedCall()), /review|approval|confirm/i);
    assert.equal(protocol.seen.length, 0);
  });

  await t.test("exact canonical approval produces opaque receipts; same-call replay reconciles without another commit", async () => {
    const call = scopedCall();
    const result = projectObjectPublicationOutputSchema.parse(await registry.invoke(tool.id, args, signal, await approvedCall(args, call)));
    assert.equal(result.output.disposition, "created");
    const replay = projectObjectPublicationOutputSchema.parse(await registry.invoke(tool.id, args, signal, await approvedCall(args, call)));
    assert.equal(replay.output.disposition, "matched");
    assert.equal(replay.output.commitRef, result.output.commitRef);
    assert.equal(protocol.objects.size, 1);
    assert.equal(protocol.commits, 1);
    const [key, stored] = [...protocol.objects.entries()][0];
    assert.match(key, new RegExp(`^/publication-bucket/publications/v1/tenant-local/owner-${owner.id}/project-${project.id}/[a-f0-9]{64}\\.json$`));
    assert.deepEqual(JSON.parse(stored.toString()), { schemaVersion: "lios.project-publication/1", ...args });
    assert.equal(result.output.contentSha256, crypto.createHash("sha256").update(stored).digest("hex"));
    assert.equal(result.output.bytes, stored.length);
    assert.ok(protocol.seen.every((entry) => entry.validSignature));
    assert.ok(protocol.seen.filter((entry) => entry.method === "PUT").every((entry) => entry.conditional === "*"));
    assert.equal(/http:|publication-private-test-secret|PUBLICATIONACCESS|owner-/.test(JSON.stringify(result)), false);
    const changed = { ...args, content: "Different bytes must not overwrite the publication." };
    await assert.rejects(registry.invoke(tool.id, changed, signal, await approvedCall(changed, call)), /different content/);
    assert.equal(protocol.commits, 1);
    assert.equal(protocol.objects.get(key)?.toString(), stored.toString());
  });

  await t.test("wrong owner/Project, missing trusted scope and configured credentials fail before network effects", async () => {
    const before = protocol.seen.length;
    await assert.rejects(tool.invoke(args, signal, scopedCall(undefined, { userId: other.id })), /authenticated/);
    await assert.rejects(tool.invoke(args, signal, scopedCall(undefined, { projectId: otherProject.id })), /owner/);
    await assert.rejects(tool.invoke(args, signal, scopedCall(undefined, { idempotencyKey: undefined })), /idempotent/);
    await assert.rejects(tool.invoke({ ...args, content: "publication-private-test-secret" }, signal, scopedCall()), /credentials/);
    assert.equal(protocol.seen.length, before);
    const legitimateOther = projectObjectPublicationOutputSchema.parse(await tool.invoke(args, signal, scopedCall(undefined, { tenant: otherTenant, userId: other.id, projectId: otherProject.id })));
    assert.ok(legitimateOther.output.objectRef);
    assert.match([...protocol.objects.keys()].at(-1)!, new RegExp(`/owner-${other.id}/project-${otherProject.id}/`));
  });

  await t.test("concurrent identical calls commit one object; hash-conflicting replay is never an overwrite", async () => {
    const before = protocol.commits;
    const call = scopedCall();
    const results = await Promise.all([tool.invoke(args, signal, call), tool.invoke(args, signal, call)]);
    const receipts = results.map((value) => projectObjectPublicationOutputSchema.parse(value).output);
    assert.equal(protocol.commits - before, 1);
    assert.deepEqual(receipts.map((value) => value.disposition).sort(), ["created", "matched"]);
    assert.equal(receipts[0].commitRef, receipts[1].commitRef);
  });

  await t.test("lost commit response reads actual bytes; unknown outcome never retries, even after GET 404", async () => {
    const call = scopedCall();
    protocol.writeBehavior("lost-commit-response");
    const before = protocol.seen.length;
    const result = projectObjectPublicationOutputSchema.parse(await tool.invoke(args, signal, call));
    assert.equal(result.output.disposition, "matched");
    assert.deepEqual(protocol.seen.slice(before).map((entry) => entry.method), ["PUT", "GET"]);
    protocol.writeBehavior("unknown-no-commit");
    const unknownBefore = protocol.seen.length;
    const proofCount = noEffectProofs.length;
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /outcome is unknown/);
    assert.deepEqual(protocol.seen.slice(unknownBefore).map((entry) => entry.method), ["PUT", "GET"]);
    assert.equal(noEffectProofs.length, proofCount);
    protocol.writeBehavior("redirect");
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /HTTP 307/);
  });

  await t.test("destination/credential drift changes policy and blocks stale approval or reconciliation dispatch", async () => {
    const binding = projectObjectPublicationPolicyBindingSha256();
    const call = await approvedCall(args, scopedCall());
    process.env.LIOS_PUBLICATION_S3_BUCKET = "another-bucket";
    assert.notEqual(projectObjectPublicationPolicyBindingSha256(), binding);
    const before = protocol.seen.length;
    await assert.rejects(registry.invoke(tool.id, args, signal, call), /policy|approval|current/i);
    assert.equal(protocol.seen.length, before);
    process.env.LIOS_PUBLICATION_S3_BUCKET = "publication-bucket";
    protocol.writeBehavior("lost-commit-response", () => { process.env.LIOS_PUBLICATION_S3_BUCKET = "drifted-bucket"; });
    const reconcileBefore = protocol.seen.length;
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /destination or credentials changed/);
    assert.deepEqual(protocol.seen.slice(reconcileBefore).map((entry) => entry.method), ["PUT"]);
    process.env.LIOS_PUBLICATION_S3_BUCKET = "publication-bucket";
    process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY = "rotated-test-secret";
    assert.notEqual(projectObjectPublicationPolicyBindingSha256(), binding);
    process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY = "publication-private-test-secret";
    delete process.env.LIOS_PUBLICATION_S3_ENDPOINT;
    const disabled = projectObjectPublicationPolicyBindingSha256();
    assert.match(disabled, /^[a-f0-9]{64}$/);
    assert.equal(disabled, projectObjectPublicationPolicyBindingSha256());
    assert.notEqual(disabled, binding);
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /unavailable/);
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = "http://remote.example.test";
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /unavailable/);
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = endpoint;
  });

  await t.test("real refused socket enters cancellable backoff; restart-shaped fresh invocation publishes once", async () => {
    const closedPortServer = http.createServer();
    const refusedPort = await listen(closedPortServer);
    await close(closedPortServer);
    const previousEndpoint = process.env.LIOS_PUBLICATION_S3_ENDPOINT;
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = `http://127.0.0.1:${refusedPort}`;
    const controller = new AbortController();
    const call = scopedCall(undefined, {
      reportExternalDispatchStatus: async (message) => { assert.match(message, /No object was published.*2 seconds/); setImmediate(() => controller.abort()); },
    });
    const attemptsBefore = dispatches;
    await assert.rejects(tool.invoke(args, controller.signal, call), { name: "AbortError" });
    assert.equal(dispatches, attemptsBefore, "The tool does not retry or manufacture a first dispatch; registry owns that initial hook");
    assert.match(noEffectProofs.at(-1)!, /^publication-no-effect:[a-f0-9]{64}$/);
    const restored = conditionalS3ProtocolServer();
    await listen(restored.server, refusedPort);
    try {
      const resumedRegistry = new GovernedToolRegistry<ConversationToolKind, ConversationToolResult>();
      resumedRegistry.register(createProjectObjectPublicationTool());
      await assert.rejects(resumedRegistry.invoke(tool.id, args, signal, call), /review|approval|confirm/i);
      const freshCall = await approvedCall(args, call, resumedRegistry.get(tool.id)!);
      const resumed = projectObjectPublicationOutputSchema.parse(await resumedRegistry.invoke(tool.id, args, signal, freshCall));
      assert.equal(resumed.output.disposition, "created");
      assert.equal(restored.commits, 1);
      assert.equal(restored.objects.size, 1);
    } finally {
      await close(restored.server);
      process.env.LIOS_PUBLICATION_S3_ENDPOINT = previousEndpoint;
    }
  });

  // These two integration cases intentionally await the real production backoff against real sockets.
  // Fake clocks would not prove the platform's cancellable timer/native-connect boundary.
  await t.test("one real no-effect failure may retry once after backoff, never a third dispatch", async () => {
    const closedPortServer = http.createServer();
    const refusedPort = await listen(closedPortServer);
    await close(closedPortServer);
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = `http://127.0.0.1:${refusedPort}`;
    const before = dispatches;
    const proofCount = noEffectProofs.length;
    const start = Date.now();
    await assert.rejects(tool.invoke(args, signal, scopedCall()), /no request was transmitted/);
    assert.ok(Date.now() - start >= 1_900);
    assert.equal(dispatches - before, 1, "Only the single bounded retry calls beforeExternalDispatch from inside the tool");
    assert.equal(noEffectProofs.length - proofCount, 2);
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = endpoint;
  });

  await t.test("restoring the real socket during genuine backoff permits exactly one conditional retry", async () => {
    const reservation = http.createServer();
    const retryPort = await listen(reservation);
    await close(reservation);
    process.env.LIOS_PUBLICATION_S3_ENDPOINT = `http://127.0.0.1:${retryPort}`;
    const restored = conditionalS3ProtocolServer();
    const before = dispatches;
    const start = Date.now();
    const call = scopedCall(undefined, { reportExternalDispatchStatus: async () => { await listen(restored.server, retryPort); } });
    try {
      const result = projectObjectPublicationOutputSchema.parse(await tool.invoke(args, signal, call));
      assert.equal(result.output.disposition, "created");
      assert.ok(Date.now() - start >= 1_900);
      assert.equal(dispatches - before, 1);
      assert.equal(restored.commits, 1);
      assert.deepEqual(restored.seen.map((entry) => entry.method), ["PUT"]);
    } finally {
      await close(restored.server);
      process.env.LIOS_PUBLICATION_S3_ENDPOINT = endpoint;
    }
  });
});

test("immutable S3 adapter revalidates target at dispatch and refuses escaping model-shaped keys", async () => {
  const provider = new S3StorageProvider({ endpoint: "http://127.0.0.1:1", bucket: "publication-bucket", region: "us-east-1", accessKeyId: "a", secretAccessKey: "b" });
  await assert.rejects(provider.putImmutable("../escape", Buffer.from("x"), { signal: new AbortController().signal, beforeRequest: () => assert.fail("Invalid key reached dispatch") }), /Invalid storage key/);
  let checks = 0;
  await assert.rejects(provider.putImmutable("publications/valid.json", Buffer.from("x"), { signal: new AbortController().signal, beforeRequest: () => { checks += 1; throw new Error("stale target"); } }), /stale target/);
  assert.equal(checks, 1);
});
