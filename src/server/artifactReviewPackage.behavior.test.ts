import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { TenantContext } from "./tenantContext";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-readable-review-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Intentional module-loading boundary: database users must load only after this
// isolated test data root is selected; static imports would capture owner state.
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectArtifactVersions, dataEntitlementPolicies } = await import("@shared/schema");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const store = await import("./artifactStore");
const { createArtifactReviewPackage } = await import("./artifactReviewPackage");
const { createProfessionalWorkPackage } = await import("./professionalWorkPackage");

test("review publication preserves exact snapshots, review diagnostics and existing tenant/hash/rights gates", async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [owner, other] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, name: "Review owner", passwordHash: "fixture", role: "internal_analyst" as const },
    { email: `${crypto.randomUUID()}@example.test`, name: "Other owner", passwordHash: "fixture", role: "internal_analyst" as const },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, organizationId: null, role: owner.role };
  const otherCtx: TenantContext = { userId: other.id, organizationId: null, role: other.role };
  const project = await createProject(ctx, { name: "Recorded review" });
  const { policy } = await createEntitlementPolicy({
    provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only",
    redistribution: "restricted", permittedUses: ["display", "derived_output", "export"], attribution: "Synthetic fixture",
    termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "Recorded only",
  }, owner.id);
  const dependency = `entitlement-policy:${policy.id}`;
  const content = artifactContentSchema.parse({
    kind: "valuation", symbol: "SYNTHETIC", modelId: "recorded",
    outputs: { nested: { exact: "9007199254740993.250000", missing: null, formula: "=A1+B1" } },
    assumptions: { growth: "0.050000" }, summary: { caveat: "Synthetic recorded values" },
  });
  const source = await store.createArtifact(ctx, { projectId: project.id, title: "Original", content,
    sourceRefs: ["source:synthetic"], dependencyRefs: [dependency], executionReceiptIds: ["receipt:synthetic"] });
  const request = { version: 1, contentHash: source.version.contentHash };
  const note = await store.appendArtifactReviewNote(ctx, source.artifact.id, { ...request, text: "Review exact decimals before relying on them", anchor: "outputs.nested.exact" });
  const pkg = await createArtifactReviewPackage(ctx, source.artifact.id, request);
  const report = artifactContentSchema.parse(pkg.version.content);
  assert.equal(report.kind, "report");
  if (report.kind !== "report") throw new Error("Expected report");
  assert.deepEqual(report.blocks.find(block => block.attrs.sourceContent)?.attrs.sourceContent, content);
  assert.ok(report.blocks.some(block => block.type === "table"));
  assert.ok(!report.blocks.some(block => block.type === "code" || /^\s*[{\[]/.test(block.text)));
  assert.ok(JSON.stringify(report.blocks).includes(note.id));
  assert.ok(pkg.version.dependencyRefs.includes(dependency));
  assert.ok(pkg.version.sourceRefs.includes(`${source.artifact.id}@v1`));
  assert.deepEqual((await store.getArtifactVersion(ctx, source.artifact.id, 1)).content, source.version.content);
  assert.equal((await store.getArtifact(ctx, source.artifact.id)).headVersion, 1);
  assert.equal((await createArtifactReviewPackage(ctx, source.artifact.id, request)).artifact.id, pkg.artifact.id);

  await t.test("new annotations make a new review snapshot rather than mutating or replaying the old package", async () => {
    const followup = await store.appendArtifactReviewNote(ctx, source.artifact.id, { ...request, text: "Recorded resolution, not approval", status: "resolved", supersedes: note.id });
    const updated = await createArtifactReviewPackage(ctx, source.artifact.id, request);
    assert.notEqual(updated.artifact.id, pkg.artifact.id);
    assert.ok(JSON.stringify(updated.version.content).includes(followup.id));
    assert.ok(!JSON.stringify((await store.getArtifactVersion(ctx, pkg.artifact.id, 1)).content).includes(followup.id));
  });
  await t.test("foreign owner, wrong hash and injected approval/composition are refused", async () => {
    await assert.rejects(createArtifactReviewPackage(otherCtx, source.artifact.id, request));
    await assert.rejects(createArtifactReviewPackage({ ...ctx, organizationId: 314159 }, source.artifact.id, request));
    await assert.rejects(createArtifactReviewPackage(ctx, source.artifact.id, { ...request, contentHash: "0".repeat(64) }), /hash/i);
    await assert.rejects(createArtifactReviewPackage(ctx, source.artifact.id, { ...request, approval: { state: "approved" } }));
  });
  await t.test("the stored immutable body is independently hash checked", async () => {
    const original = source.version.content;
    await getDb().update(projectArtifactVersions).set({ content: { ...content, symbol: "TAMPERED" } }).where(eq(projectArtifactVersions.id, source.version.id));
    try { await assert.rejects(createArtifactReviewPackage(ctx, source.artifact.id, request), /hash/i); }
    finally { await getDb().update(projectArtifactVersions).set({ content: original }).where(eq(projectArtifactVersions.id, source.version.id)); }
  });
  await t.test("revoked export rights still block the package and are not replaced by snapshot diagnostics", async () => {
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display", "derived_output"] }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(createArtifactReviewPackage(ctx, source.artifact.id, request), /rights/i);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display", "derived_output", "export"] }).where(eq(dataEntitlementPolicies.id, policy.id));
  });
  await t.test("archived sources and missing entitlement policies fail closed even for an existing review request", async () => {
    await store.setArtifactStatus(ctx, source.artifact.id, "archived");
    try { await assert.rejects(createArtifactReviewPackage(ctx, source.artifact.id, request), /active/i); }
    finally { await store.setArtifactStatus(ctx, source.artifact.id, "active"); }
    const missingPolicy = await store.createArtifact(ctx, { projectId: project.id, title: "Missing rights", content,
      dependencyRefs: [`entitlement-policy:${crypto.randomUUID()}`] });
    await assert.rejects(createArtifactReviewPackage(ctx, missingPolicy.artifact.id, { version: 1, contentHash: missingPolicy.version.contentHash }), /rights/i);
  });
  await t.test("Quick Chat review stays in the originating owned Chat with no hidden Project", async () => {
    const chat = await createProjectChat(ctx, { scope: "quick" });
    const otherChat = await createProjectChat(ctx, { scope: "quick" });
    const quickSource = await store.createArtifact(ctx, { projectId: null, owningChatId: chat.id, title: "Quick source", content, sourceRefs: ["source:synthetic"] });
    const quickReview = await createArtifactReviewPackage(ctx, quickSource.artifact.id, { version: 1, contentHash: quickSource.version.contentHash });
    assert.equal(quickReview.artifact.projectId, null);
    assert.equal(quickReview.artifact.owningChatId, chat.id);
    await assert.rejects(createArtifactReviewPackage(otherCtx, quickSource.artifact.id, { version: 1, contentHash: quickSource.version.contentHash }));
    await assert.rejects(createProfessionalWorkPackage(ctx, {
      projectId: null, workflow: "ic_memo", title: "Wrong Chat", audience: "Reviewer", reportingPeriod: "v1",
      sources: [{ artifactId: quickSource.artifact.id, version: 1, contentHash: quickSource.version.contentHash, role: "evidence" }],
      authoredSections: [{ title: "Scope", text: "Recorded" }],
    }, { owningChatId: otherChat.id }), /originating Chat/i);
  });
});
