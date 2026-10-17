import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exact-inspection-"));
process.env.LIMURIA_DATA_DIR = root;
// Database modules capture the isolated Home path during loading; static imports would bind the real Home before this fixture sets it.
const { initDb, closeDb, getDb } = await import("./db");
const { users, dataEntitlementPolicies } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, createArtifactVersion, setArtifactStatus } = await import("./artifactStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { inspectArtifact } = await import("./artifactInspection");

test("exact saved Artifact inspection resolves custody and fails closed without fuzzy fallback", { timeout: 60_000 }, async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner, foreign] = await getDb().insert(users).values(["owner", "foreign"].map(name => ({ email: `${crypto.randomUUID()}@test.invalid`, name, passwordHash: "test-only", role: "internal_analyst" as const, organizationId: null }))).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Exact provenance" });
  const receiptId = crypto.randomUUID();
  const saved = await createArtifact(ctx, { projectId: project.id, title: "Same label", sourceRefs: ["source:original"], executionReceiptIds: [receiptId], content: artifactContentSchema.parse({ kind: "spreadsheet", sheets: [{ id: "inputs", name: "Inputs", cells: { A1: { raw: "00012.5000", format: "0.00", lineage: { kind: "user_assumption", assumptionOrigin: "user_authored", custody: "user_authored", capturedRaw: "00012.5000", capturedFormat: "0.00", sourceRefs: ["source:authored"] } } } }], activeSheetId: "inputs" }) });
  const target = { artifactId: saved.artifact.id, version: 1, contentHash: saved.version.contentHash, cell: { kind: "spreadsheet" as const, sheetId: "inputs", ref: "A1" }, sourceRef: "source:authored", receiptId };
  const exact = await inspectArtifact(ctx, target);
  assert.equal(exact.cell?.value.raw, "00012.5000");
  assert.equal(exact.cell?.value.lineage?.custody, "user_authored");
  assert.deepEqual(exact.target, target);
  assert.deepEqual(exact.numericalEvidence, []);
  assert.equal(exact.trustManifest, null);
  await assert.rejects(inspectArtifact({ userId: foreign.id, organizationId: null, role: foreign.role }, target), /not found|owned/);
  await assert.rejects(inspectArtifact(ctx, { ...target, artifactId: "unknown" }), /not found|owned/);
  await assert.rejects(inspectArtifact(ctx, { ...target, contentHash: "0".repeat(64) }), /Stale/);
  await assert.rejects(inspectArtifact(ctx, { ...target, version: 99 }), /version not found/);
  await assert.rejects(inspectArtifact(ctx, { ...target, sourceRef: "source:same-label" }), /source not found/);
  await assert.rejects(inspectArtifact(ctx, { ...target, receiptId: crypto.randomUUID() }), /receipt not found/);
  await assert.rejects(inspectArtifact(ctx, { ...target, cell: { ...target.cell, sheetId: "other" } }), /cell not found/);
  await assert.rejects(inspectArtifact(ctx, { ...target, numericalEvidenceId: "unknown" }), /numerical evidence not found/);
  const nextContent = artifactContentSchema.parse(saved.version.content);
  if (nextContent.kind !== "spreadsheet") throw new Error("Fixture kind mismatch.");
  nextContent.sheets[0].cells.A1.raw = "99";
  const next = await createArtifactVersion(ctx, { artifactId: saved.artifact.id, baseVersion: 1, content: nextContent });
  assert.equal((await inspectArtifact(ctx, target)).cell?.value.raw, "00012.5000", "explicit immutable history is not silently replaced by the head");
  await assert.rejects(inspectArtifact(ctx, { ...target, version: next.version }), /Stale/);
  await setArtifactStatus(ctx, saved.artifact.id, "archived");
  await assert.rejects(inspectArtifact(ctx, target), /active Artifact/);

  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "inspection", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display"], attribution: null, termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
  const protectedArtifact = await createArtifact(ctx, { projectId: project.id, title: "Rights-bound", content: artifactContentSchema.parse({ kind: "table", columns: [{ key: "amount", label: "Amount" }], rows: [{ amount: "12.5" }] }), sourceRefs: [`entitlement-policy:${policy.id}`] });
  const protectedTarget = { artifactId: protectedArtifact.artifact.id, version: 1, contentHash: protectedArtifact.version.contentHash, cell: { kind: "table" as const, row: 0, column: "amount" } };
  assert.equal((await inspectArtifact(ctx, protectedTarget)).tableValue, "12.5");
  await getDb().update(dataEntitlementPolicies).set({ permittedUses: [] }).where(eq(dataEntitlementPolicies.id, policy.id));
  await assert.rejects(inspectArtifact(ctx, protectedTarget), /rights/);
});
