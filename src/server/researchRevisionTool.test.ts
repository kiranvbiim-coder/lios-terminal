import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { GovernedToolCall } from "./governedTools";
import type { ConversationToolKind, ConversationToolResult } from "./conversationRuntime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-research-refresh-"));
process.env.LIMURIA_DATA_DIR = root;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createArtifact, createArtifactVersion, getArtifactVersion, listArtifactVersions } = await import("./artifactStore");
const { researchArtifactContentSchema } = await import("@shared/artifactContracts");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { researchRevisionTool } = await import("./researchRevisionTool");
const { GovernedToolRegistry } = await import("./governedTools");
const grants = await import("./conversationGrantStore");

test("exact-approved refresh preserves history, source policy, no-op semantics and restart", async t => {
  await initDb();
  t.after(async () => { grants.clearOnceApprovals(); await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test", role: "internal_analyst", name: "Owner" }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Harbor research" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const content = researchArtifactContentSchema.parse({ kind: "research", question: "Harbor access", blocks: [], claims: [], evidence: [], sourcePolicy: { mode: "only_refs", allowedSourceRefs: ["document:survey"] } });
  const saved = await createArtifact(tenant, { projectId: project.id, title: "Harbor research", content });
  await indexProjectDocument(tenant, { projectId: project.id, sourceType: "document", sourceRef: "document:survey", title: "Harbor survey", body: "Harbor access has a ramp.", metadata: { sourceUrl: "https://example.test/survey" } });
  await indexProjectDocument(tenant, { projectId: project.id, sourceType: "document", sourceRef: "document:excluded", title: "Harbor other", body: "Harbor access PRIVATE_EXCLUDED_CONTENT" });
  const registry = new GovernedToolRegistry<ConversationToolKind, ConversationToolResult>();
  registry.register(researchRevisionTool);
  const descriptor = registry.get(researchRevisionTool.id)!;
  const signal = new AbortController().signal;
  const args = { artifactId: saved.artifact.id, expectedVersion: 1, query: "Harbor access" };
  function call(): GovernedToolCall {
    return { source: "agent", tenant, userId: owner.id, projectId: project.id, chatId: chat.id, requestId: crypto.randomUUID(), sourceScope: "my_data" };
  }
  async function invoke(input: typeof args, overrides: Partial<GovernedToolCall> = {}) {
    const context = { ...call(), ...overrides };
    const policy = { permissionClass: "user_confirm" as const, policyRevision: "b".repeat(64) };
    const proposal = await grants.proposeGovernedToolOperation({
      user: owner, requestId: context.requestId!, projectId: project.id, chatId: chat.id, stepId: "refresh",
      toolCallId: crypto.randomUUID(), toolId: descriptor.id, descriptor, input, planHash: "a".repeat(64), policy, runSignal: signal, currentPolicy: () => policy,
    });
    await grants.reviewGovernedToolOperation({ user: owner, requestId: context.requestId!, reviewId: proposal.reviewId, allow: true, scope: "once" });
    const authorization = await grants.resolveGovernedToolOperation({ user: owner, requestId: context.requestId!, reviewId: proposal.reviewId });
    return registry.invoke(descriptor.id, input, signal, { ...context, ...proposal.binding, authorization, runSignal: signal });
  }
  await assert.rejects(registry.invoke(descriptor.id, args, signal, call()), /approval|review|confirm/i);
  assert.equal((await listArtifactVersions(tenant, saved.artifact.id)).length, 1);
  await invoke(args);
  const v2 = researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id)).content);
  assert.equal(v2.evidence[0].url, "https://example.test/survey");
  assert.equal(v2.evidence[0].sourceRef, "document:survey");
  const savedQuote = v2.blocks.find(block => block.type === "quote");
  assert.ok(savedQuote);
  assert.equal(savedQuote.attrs.excerptSha256,
    crypto.createHash("sha256").update(savedQuote.text, "utf8").digest("hex"));
  assert.equal(savedQuote.attrs.excerptByteLength, Buffer.byteLength(savedQuote.text, "utf8"));

  assert.equal(v2.claims.length, 0);
  assert.doesNotMatch(JSON.stringify(v2), /PRIVATE_EXCLUDED_CONTENT/);
  await assert.rejects(invoke(args), /changed|version/i);
  await assert.rejects(invoke({ ...args, expectedVersion: 2 }, { sourceScope: "web" }), /Auto or My Data/);
  await assert.rejects(invoke({ ...args, expectedVersion: 2 }, { allowedSourceRefs: ["document:excluded"] }), /no permitted overlap/);
  await assert.rejects(invoke({ ...args, expectedVersion: 2 }, { resourceTransmissionAllowed: false }), /transmission is disabled/);
  const unchanged = await invoke({ ...args, expectedVersion: 2 });
  assert.equal((unchanged.output as { changed: boolean }).changed, false);
  assert.equal((await listArtifactVersions(tenant, saved.artifact.id)).length, 2);
  await indexProjectDocument(tenant, { projectId: project.id, sourceType: "document", sourceRef: "document:survey", title: "Harbor survey", body: "Harbor access ramp is closed.", metadata: { sourceUrl: "https://example.test/survey" } });
  await invoke({ ...args, expectedVersion: 2 });
  const v3 = researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id)).content);
  assert.deepEqual(v3.blocks.slice(0, v2.blocks.length), v2.blocks);
  assert.ok(v3.blocks.some(block => typeof block.attrs.previousEvidenceVersionRef === "string"));
  const { researchEvidenceLedgerProjection } = await import("./artifactStore");
  const projection = researchEvidenceLedgerProjection(v3, `${saved.artifact.id}@v3`);
  const quoted = v3.blocks.filter(block => block.type === "quote");
  assert.equal(quoted.length, 2);
  assert.notEqual(quoted[0].attrs.contentHash, quoted[1].attrs.contentHash);
  assert.deepEqual(projection.nodes.map(node => node.metadata.sourceContentHash), quoted.map(block => block.attrs.contentHash), "each repeated-source evidence node binds its own quoted source version");
  await closeDb(); await initDb();
  assert.deepEqual(researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id, 2)).content), v2);
  assert.deepEqual(researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id, 3)).content), v3);
  const providerRestricted = researchArtifactContentSchema.parse({
    ...v3,
    sourcePolicy: { ...v3.sourcePolicy, providerAllow: ["approved-provider"], providerDeny: [] },
  });
  await createArtifactVersion(tenant, { artifactId: saved.artifact.id, baseVersion: 3, content: providerRestricted });
  const providerMissing = await invoke({ ...args, expectedVersion: 4 });
  assert.equal((providerMissing.output as { changed: boolean }).changed, false, "untagged evidence does not satisfy a provider allow-list");
  assert.equal((await listArtifactVersions(tenant, saved.artifact.id)).length, 4);

  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "document",
    sourceRef: "document:survey",
    title: "Harbor survey",
    body: "Harbor access ramp reopened under approved provider evidence.",
    metadata: { sourceUrl: "https://example.test/survey", provider: "approved-provider" },
  });
  await invoke({ ...args, expectedVersion: 4 });
  const v5 = researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id)).content);
  assert.equal(v5.evidence.at(-1)?.sourceRef, "document:survey");
  assert.match(v5.evidence.at(-1)?.snippet ?? "", /approved provider evidence/);
  assert.equal((v5.blocks.filter((block)=>block.type==="quote").at(-1)?.attrs.provenance as any)?.provider, "approved-provider");

  const providerDenied = researchArtifactContentSchema.parse({
    ...v5,
    sourcePolicy: {
      ...v5.sourcePolicy,
      providerAllow: ["approved-provider"],
      providerDeny: ["approved-provider"],
    },
  });
  await createArtifactVersion(tenant, { artifactId: saved.artifact.id, baseVersion: 5, content: providerDenied });
  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "document",
    sourceRef: "document:survey",
    title: "Harbor survey",
    body: "Harbor access DENIED_PROVIDER_SECRET must never enter the Artifact.",
    metadata: { sourceUrl: "https://example.test/survey", provider: "approved-provider" },
  });
  const denied = await invoke({ ...args, expectedVersion: 6 });
  assert.equal((denied.output as { changed: boolean }).changed, false, "provider deny overrides provider allow");
  assert.equal((await listArtifactVersions(tenant, saved.artifact.id)).length, 6);
  const stillV6 = researchArtifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id)).content);
  assert.equal(JSON.stringify(stillV6).includes("DENIED_PROVIDER_SECRET"), false);

  const denyAll = researchArtifactContentSchema.parse({
    ...providerDenied,
    sourcePolicy: { ...providerDenied.sourcePolicy, providerAllow: [], providerDeny: [], mode: "only_refs", allowedSourceRefs: [] },
  });
  await createArtifactVersion(tenant, { artifactId: saved.artifact.id, baseVersion: 6, content: denyAll });
  await assert.rejects(invoke({ ...args, expectedVersion: 7 }), /permits no source/);
});
