import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { artifactContentSchema } from "@shared/artifactContracts";
import type { GovernedToolCall } from "./governedTools";
import type { TenantContext } from "./tenantContext";
import type { TrustManifest } from "@shared/trustContracts";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-artifact-maintenance-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
// These imports intentionally follow the isolated data-root environment: DB/AI modules capture configuration on load.
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectArtifacts, projectArtifactVersions, projectArtifactProposals, artifactInteractionReceipts, projectLedgerEvents, dataEntitlementPolicies } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, getArtifact, getArtifactVersion, listArtifactProposals, decideArtifactProposal } = await import("./artifactStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { artifactInspectTool, artifactMaintenanceTool, buildArtifactMaintenancePrompt } = await import("./artifactMaintenance");
const signal = new AbortController().signal;
const proposalOutput = z.object({ artifactId: z.string(), proposalId: z.string().nullable(), status: z.enum(["pending", "accepted", "rejected", "cancelled", "no_change"]), changed: z.boolean(), proposedContentHash: z.string(), changedFields: z.array(z.string()), headVersion: z.number() });
const inspectOutput = z.object({ contentHash: z.string(), version: z.number(), snapshot: z.unknown(), completeness: z.string(), structure: z.array(z.object({ path: z.array(z.string()), entries: z.number().nullable(), bytes: z.number() })), snapshotBytes: z.number(), omittedPaths: z.array(z.array(z.union([z.string(), z.number()]))) });

function capturedPng(): Buffer {
  function chunk(type: string, bytes: Buffer) {
    const payload = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length, 0);
    payload.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length + 8);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(5))), chunk("IEND", Buffer.alloc(0))]);
}

function trust(requestId: string): TrustManifest {
  return {
    schemaVersion: "1", trustId: crypto.randomUUID(), requestId, generatedAt: "2026-10-08T12:00:00.000Z", sourceScope: "my_data",
    summary: { freshness: "current", quality: "high", confidence: "high", conflictState: "not_evaluated_single_source", evidenceCoveragePct: 100, sourceCount: 1, receiptCount: 1, missingCount: 0 },
    evidence: [{ evidenceId: crypto.randomUUID(), sourceRef: "https://example.test/filing", providerId: null, providerLabel: "Owned source", kind: "project", observedAt: "2026-10-08T12:00:00.000Z", asOf: null, freshness: "current", quality: "high", confidence: "high", connectorState: "live_verified", isFallback: false, access: null, fields: ["revenue"], valueHash: null, notes: [] }],
    claims: [{ claimId: crypto.randomUUID(), label: "Revenue", path: "claims.0.text", status: "supported", sourceRefs: ["https://example.test/filing"], receiptIds: [], formulaRefs: [], assumptionRefs: [], confidence: "high", explanation: "Original captured filing statement." }],
    conflicts: [], methodology: [], assumptions: [], missing: [], warnings: [],
  };
}

test("SI-04.22 selected owned Artifact maintenance remains reviewed, source-safe and durable", { timeout: 120_000 }, async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const [owner, foreign] = await getDb().insert(users).values(["owner", "foreign"].map(name => ({ email: `${crypto.randomUUID()}@test.invalid`, passwordHash: "test", role: "internal_analyst" as const, name, organizationId: null }))).returning();
  const ctx: TenantContext = { userId: owner.id, role: owner.role, organizationId: null };
  const foreignCtx: TenantContext = { userId: foreign.id, role: foreign.role, organizationId: null };
  const project = await createProject(ctx, { name: "Agent maintenance" });
  const otherProject = await createProject(ctx, { name: "Different owned Project" });
  const foreignProject = await createProject(foreignCtx, { name: "Foreign Project" });
  function call(artifactId: string, overrides: Partial<GovernedToolCall> = {}): GovernedToolCall {
    return { source: "agent", userId: owner.id, tenant: ctx, projectId: project.id, requestId: crypto.randomUUID(), stepId: "maintain-selected", activeArtifactRefs: [artifactId], resourceTransmissionAllowed: true, sourceScope: "my_data", ...overrides };
  }
  const reportContent = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "first", type: "paragraph", text: "Original text", attrs: {} }, { id: "untouched", type: "paragraph", text: "Keep this text", attrs: { sourceRef: "https://example.test/filing" } }], sections: [{ id: "section", title: "Overview", blockIds: ["first", "untouched"] }] });
  const retained = await createArtifact(ctx, { projectId: project.id, title: "Existing report", content: reportContent, sourceRefs: ["https://example.test/filing"] });
  const edit = { artifactId: retained.artifact.id, baseVersion: 1, baseHash: retained.version.contentHash, summary: "Revise selected paragraph", edits: [{ op: "set", path: ["blocks", 0, "text"], value: "Agent revised paragraph" }] };

  await t.test("descriptors and schemas do not expose server authority", async () => {
    assert.equal(artifactInspectTool.id, "lios.artifact.inspect");
    assert.equal(artifactInspectTool.permissionClass, "safe_auto");
    assert.equal(artifactInspectTool.replaySafe, true);
    assert.equal(artifactMaintenanceTool.permissionClass, "safe_auto");
    assert.equal(artifactMaintenanceTool.sideEffect, "internal_write");
    assert.equal(artifactMaintenanceTool.replaySafe, false);
    for (const metadata of ["tenant", "activeArtifactRefs", "sourceRefs", "grants", "sourcePolicy"]) {
      assert.equal(artifactMaintenanceTool.inputSchema.safeParse({ ...edit, [metadata]: {} }).success, false);
      assert.equal(artifactInspectTool.inputSchema.safeParse({ artifactId: retained.artifact.id, [metadata]: {} }).success, false);
    }
    const inspected = await artifactInspectTool.invoke({ artifactId: retained.artifact.id }, signal, call(retained.artifact.id));
    const result = inspectOutput.parse(inspected.output);
    assert.equal(result.contentHash, retained.version.contentHash);
    assert.equal(result.version, 1);
    assert.equal(result.completeness, "complete");
    assert.deepEqual(result.snapshot, reportContent);
    assert.match(inspected.summary, /Original text/);
    assert.ok((await buildArtifactMaintenancePrompt(call(retained.artifact.id), signal))?.includes(retained.version.contentHash));
    assert.equal(await buildArtifactMaintenancePrompt(call(retained.artifact.id, { resourceTransmissionAllowed: false }), signal), null);
  });

  await t.test("missing authority, foreign targets, wrong Project and source-scope restrictions fail closed", async () => {
    const alien = await createArtifact(foreignCtx, { projectId: foreignProject.id, title: "Foreign", content: reportContent });
    const cross = await createArtifact(ctx, { projectId: otherProject.id, title: "Other", content: reportContent });
    for (const overrides of [{ activeArtifactRefs: [] }, { resourceTransmissionAllowed: false }, { resourceTransmissionAllowed: undefined }, { sourceScope: "web" as const }, { sourceScope: "files" as const }, { sourceScope: undefined }, { requestId: undefined }, { userId: foreign.id }, { tenant: foreignCtx }]) {
      await assert.rejects(artifactInspectTool.invoke({ artifactId: retained.artifact.id }, signal, call(retained.artifact.id, overrides)));
    }
    for (const artifactId of [alien.artifact.id, cross.artifact.id]) await assert.rejects(artifactInspectTool.invoke({ artifactId }, signal, call(artifactId)), /not owned|foreign|unavailable/);
    await assert.rejects(artifactInspectTool.invoke({ artifactId: retained.artifact.id }, signal, call(retained.artifact.id, { allowedSourceRefs: ["https://different.test/source"] })), /source policy/);
    await assert.rejects(artifactMaintenanceTool.invoke(edit, signal, call(retained.artifact.id, { stepId: undefined })), /step identity/);
    await getDb().update(projectArtifactVersions).set({ contentHash: "f".repeat(64) }).where(eq(projectArtifactVersions.id, retained.version.id));
    await assert.rejects(artifactInspectTool.invoke({ artifactId: retained.artifact.id }, signal, call(retained.artifact.id)), /immutable version hash/);
    await getDb().update(projectArtifactVersions).set({ contentHash: retained.version.contentHash }).where(eq(projectArtifactVersions.id, retained.version.id));
  });

  await t.test("prototype, credentials, missing indices, root replacement and no-op guards precede writes", async () => {
    const before = (await listArtifactProposals(ctx, retained.artifact.id)).length;
    for (const edits of [
      [{ op: "set", path: ["kind"], value: "research" }],
      [{ op: "set", path: ["blocks", 0, "id"], value: "forged" }],
      [{ op: "set", path: ["blocks", 999, "text"], value: "missing" }],
      [{ op: "set", path: ["blocks", 0, "attrs", "constructor"], value: {} }],
      [{ op: "set", path: ["blocks"], value: [] }],
      [{ op: "set", path: ["blocks", 0, "text"], value: "Authorization: Bearer secret-value-123" }],
      [{ op: "append", path: ["blocks"], value: { id: "forged", type: "quote", text: "Fake source quote", attrs: { sourceRef: "https://forged.test" } } }],
    ]) await assert.rejects(artifactMaintenanceTool.invoke({ ...edit, edits }, signal, call(retained.artifact.id)));
    const noChange = proposalOutput.parse((await artifactMaintenanceTool.invoke({ ...edit, edits: [{ op: "set", path: ["blocks", 0, "text"], value: "Original text" }] }, signal, call(retained.artifact.id))).output);
    assert.equal(noChange.status, "no_change");
    assert.equal(noChange.proposalId, null);
    assert.equal(noChange.changed, false);
    assert.equal((await listArtifactProposals(ctx, retained.artifact.id)).length, before);
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id, 1), retained.version);
  });

  let durableProposalId = "";
  const durableCall = call(retained.artifact.id);
  await t.test("concurrent same request/step/target uses one P4 proposal and one receipt pair", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => artifactMaintenanceTool.invoke(structuredClone(edit), signal, durableCall)));
    const outputs = results.map(result => proposalOutput.parse(result.output));
    durableProposalId = outputs[0].proposalId!;
    assert.ok(outputs.every(output => output.proposalId === durableProposalId && output.status === "pending"));
    assert.equal((await getDb().select().from(projectArtifactProposals).where(eq(projectArtifactProposals.artifactId, retained.artifact.id))).length, 1);
    const receipts = await getDb().select().from(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, retained.artifact.id));
    assert.equal(receipts.filter(receipt => receipt.action === "propose_change").length, 1);
    const ledger = await getDb().select().from(projectLedgerEvents);
    assert.equal(ledger.filter(event => event.eventType === "artifact.proposal.created" && event.payload.proposalId === durableProposalId).length, 1);
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, 1);
    await assert.rejects(artifactMaintenanceTool.invoke({ ...edit, summary: "Changed identity payload" }, signal, durableCall), /different content/);
    await assert.rejects(artifactMaintenanceTool.invoke({ ...edit, edits: [{ op: "set", path: ["blocks", 0, "text"], value: "Changed replay payload" }] }, signal, durableCall), /different content/);
  });

  await t.test("explicit acceptance advances the existing ID; replay after head change and DB reopen is durable", async () => {
    const accepted = await decideArtifactProposal(ctx, durableProposalId, "accept");
    assert.equal(accepted.version?.artifactId, retained.artifact.id);
    assert.equal(accepted.version?.version, 2);
    const content = artifactContentSchema.parse(accepted.version?.content);
    if (content.kind !== "report") throw new Error("Expected report.");
    assert.equal(content.blocks[0].text, "Agent revised paragraph");
    assert.deepEqual(content.blocks[1], reportContent.kind === "report" ? reportContent.blocks[1] : null);
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id, 1), retained.version);
    assert.equal(proposalOutput.parse((await artifactMaintenanceTool.invoke(edit, signal, durableCall)).output).status, "accepted");
    await assert.rejects(artifactMaintenanceTool.invoke(edit, signal, call(retained.artifact.id)), /stale/);
    await assert.rejects(artifactMaintenanceTool.invoke({ ...edit, baseVersion: 2, baseHash: "0".repeat(64) }, signal, call(retained.artifact.id)), /base hash/);
    await closeDb();
    await initDb();
    const replay = proposalOutput.parse((await artifactMaintenanceTool.invoke(structuredClone(edit), signal, durableCall)).output);
    assert.equal(replay.proposalId, durableProposalId);
    assert.equal(replay.status, "accepted");
    assert.equal(replay.headVersion, 2);
    assert.equal((await getDb().select().from(projectArtifacts).where(eq(projectArtifacts.id, retained.artifact.id))).length, 1);
    assert.equal((await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, retained.artifact.id))).length, 2);
    await assert.rejects(artifactMaintenanceTool.invoke({ ...edit, summary: "Reopened changed payload" }, signal, durableCall), /different content/);
  });

  await t.test("quote and cited claim changes become inference without altering evidence or retaining verified trust", async () => {
    const requestId = crypto.randomUUID();
    const manifest = trust(requestId);
    const sourceRef = "https://example.test/filing";
    const research = await createArtifact(ctx, { projectId: project.id, title: "Cited research", content: artifactContentSchema.parse({ kind: "research", question: "Revenue?", blocks: [{ id: "quote", type: "quote", text: "Revenue rose 10%", attrs: { sourceRef, evidenceId: "filing", contentHash: "a".repeat(64), provenance: { evidenceKind: "captured_quote", retrievedAt: "2026-10-08T12:00:00.000Z" }, truth: { confidence: "high", status: "supported" } } }], claims: [{ id: "claim", text: "Revenue rose 10%", sourceRefs: [sourceRef], provenance: "source_backed" }], evidence: [{ id: "filing", title: "Filing", snippet: "Revenue rose 10%", sourceRef, sourceType: "filing" }], sourcePolicy: { mode: "only_refs", allowedSourceRefs: [sourceRef] } }), sourceRefs: [sourceRef], executionReceiptIds: [crypto.randomUUID()], trustManifest: manifest });
    const result = proposalOutput.parse((await artifactMaintenanceTool.invoke({ artifactId: research.artifact.id, baseVersion: 1, baseHash: research.version.contentHash, summary: "Revise claims", edits: [{ op: "set", path: ["blocks", 0, "text"], value: "Revenue may rise further" }, { op: "set", path: ["claims", 0, "text"], value: "Revenue may rise further" }] }, signal, call(research.artifact.id))).output);
    const accepted = await decideArtifactProposal(ctx, result.proposalId!, "accept");
    const content = artifactContentSchema.parse(accepted.version?.content);
    const base = artifactContentSchema.parse(research.version.content);
    if (content.kind !== "research" || base.kind !== "research") throw new Error("Expected research.");
    assert.equal(content.blocks[0].type, "paragraph");
    assert.equal(z.object({ evidenceKind: z.string(), retrievedAt: z.string() }).parse(content.blocks[0].attrs.provenance).evidenceKind, "model_inference");
    assert.equal(z.object({ status: z.string(), confidence: z.string() }).parse(content.blocks[0].attrs.truth).status, "open");
    assert.equal(content.claims[0].provenance, "explicit_inference");
    assert.deepEqual(content.claims[0].sourceRefs, [sourceRef]);
    assert.deepEqual(content.evidence, base.evidence);
    assert.deepEqual(content.sourcePolicy, base.sourcePolicy);
    assert.deepEqual(accepted.version?.sourceRefs, research.version.sourceRefs);
    assert.deepEqual(accepted.version?.executionReceiptIds, research.version.executionReceiptIds);
    assert.equal(accepted.version?.trustManifest, null);
    assert.match(accepted.version?.note ?? "", /historical source custody/);
    assert.deepEqual((await getArtifactVersion(ctx, research.artifact.id, 1)).trustManifest, research.version.trustManifest);
  });

  await t.test("spreadsheet narrow patch preserves untouched formulas, cells, names and sheets", async () => {
    const workbook = await createArtifact(ctx, { projectId: project.id, title: "Workbook", content: artifactContentSchema.parse({ kind: "spreadsheet", activeSheetId: "main", sheets: [{ id: "main", name: "Model", cells: { A1: { raw: "10", format: "0" }, B1: { raw: "=A1*2", format: "0.00" }, C1: { raw: "Untouched", format: null } }, names: { Input: "A1" } }, { id: "second", name: "Sources", cells: { A1: { raw: "Exact source", format: null } } }] }), trustManifest: trust(crypto.randomUUID()) });
    const request = { artifactId: workbook.artifact.id, baseVersion: 1, baseHash: workbook.version.contentHash, summary: "Update input", edits: [{ op: "set", path: ["sheets", 0, "cells", "A1", "raw"], value: "25" }] };
    const proposed = proposalOutput.parse((await artifactMaintenanceTool.invoke(request, signal, call(workbook.artifact.id))).output);
    const accepted = await decideArtifactProposal(ctx, proposed.proposalId!, "accept");
    const changed = artifactContentSchema.parse(accepted.version?.content);
    const base = artifactContentSchema.parse(workbook.version.content);
    if (changed.kind !== "spreadsheet" || base.kind !== "spreadsheet") throw new Error("Expected spreadsheet.");
    assert.equal(changed.sheets[0].cells.A1.raw, "25");
    assert.deepEqual(changed.sheets[0].cells.B1, base.sheets[0].cells.B1);
    assert.deepEqual(changed.sheets[0].cells.C1, base.sheets[0].cells.C1);
    assert.deepEqual(changed.sheets[0].names, base.sheets[0].names);
    assert.deepEqual(changed.sheets[1], base.sheets[1]);
    assert.equal(accepted.version?.trustManifest, null);
    const formulaEdit = proposalOutput.parse((await artifactMaintenanceTool.invoke({
      ...request, baseVersion: 2, baseHash: accepted.version!.contentHash, summary: "Explicitly revise workbook formula",
      edits: [{ op: "set", path: ["sheets", 0, "cells", "B1", "raw"], value: "=A1*3" }],
    }, signal, call(workbook.artifact.id))).output);
    const formulaAccepted = await decideArtifactProposal(ctx, formulaEdit.proposalId!, "accept");
    const formulaContent = artifactContentSchema.parse(formulaAccepted.version?.content);
    if (formulaContent.kind !== "spreadsheet") throw new Error("Expected spreadsheet.");
    assert.equal(formulaContent.sheets[0].cells.B1.raw, "=A1*3");
    assert.equal(formulaContent.sheets[0].cells.A1.raw, "25");
    assert.deepEqual(formulaContent.sheets[1], base.sheets[1]);
    const engine = await createArtifact(ctx, { projectId: project.id, title: "Engine result", origin: "engine", content: base });
    await assert.rejects(artifactMaintenanceTool.invoke({ ...request, artifactId: engine.artifact.id, baseHash: engine.version.contentHash }, signal, call(engine.artifact.id)), /Deterministic engine/);
  });

  await t.test("current model-input rights are revalidated without requiring export permission", async () => {
    const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input"], attribution: "Owned source", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
    const restricted = await createArtifact(ctx, { projectId: project.id, title: "Read but not export", content: reportContent, sourceRefs: [`entitlement-policy:${policy.id}`] });
    await artifactInspectTool.invoke({ artifactId: restricted.artifact.id }, signal, call(restricted.artifact.id));
    const request = { ...edit, artifactId: restricted.artifact.id, baseHash: restricted.version.contentHash };
    await artifactMaintenanceTool.invoke(request, signal, call(restricted.artifact.id));
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display"] }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(artifactInspectTool.invoke({ artifactId: restricted.artifact.id }, signal, call(restricted.artifact.id)), /Current linked source rights/);
    await assert.rejects(artifactMaintenanceTool.invoke(request, signal, call(restricted.artifact.id)), /Current linked source rights/);
  });

  await t.test("captured table/image payload and source attrs cannot be changed or forged; captions are model provenance", async () => {
    const source = await createArtifact(ctx, { projectId: project.id, title: "Source table", content: artifactContentSchema.parse({ kind: "table", columns: [{ key: "revenue", label: "Revenue", type: "number" }], rows: [{ revenue: 100 }] }) });
    const sourceRef = `${source.artifact.id}@v1`;
    const tableAttrs = { sourceRef, sourceRefs: [sourceRef], sourceArtifactId: source.artifact.id, sourceVersion: 1, sourceHash: source.version.contentHash, table: source.version.content, captionProvenance: "user_asserted" };
    const bytes = capturedPng();
    const image = { mimeType: "image/png", dataBase64: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, width: 1, height: 1, sourceRef: "project-attachment:owned-capture" };
    const captured = await createArtifact(ctx, { projectId: project.id, title: "Captured sources", content: artifactContentSchema.parse({ kind: "report", blocks: [{ id: "captured-table", type: "table", text: "Original caption", attrs: tableAttrs }, { id: "captured-image", type: "image", text: "Image caption", attrs: { image, sourceAttachmentId: "owned-capture", sourceRef: image.sourceRef } }], sections: [] }), sourceRefs: [sourceRef, image.sourceRef] });
    const inspected = await artifactInspectTool.invoke({ artifactId: captured.artifact.id }, signal, call(captured.artifact.id));
    const inspection = inspectOutput.parse(inspected.output);
    assert.equal(inspection.completeness, "payload_omitted");
    assert.deepEqual(inspection.omittedPaths, [["blocks", 1, "attrs", "image", "dataBase64"]]);
    assert.equal(inspected.summary.includes(image.dataBase64), false);
    assert.equal((await buildArtifactMaintenancePrompt(call(captured.artifact.id), signal))?.includes(image.dataBase64), false);
    const request = { artifactId: captured.artifact.id, baseVersion: 1, baseHash: captured.version.contentHash, summary: "Revise caption", edits: [{ op: "set", path: ["blocks", 0, "text"], value: "Model caption" }] };
    for (const path of [["blocks", 0, "attrs", "table", "rows", 0, "revenue"], ["blocks", 1, "attrs", "image", "dataBase64"], ["blocks", 0, "attrs"], ["blocks", 0]]) {
      await assert.rejects(artifactMaintenanceTool.invoke({ ...request, edits: [{ op: "set", path, value: "forged" }] }, signal, call(captured.artifact.id)), /immutable|protected|text\/caption/);
    }
    await assert.rejects(artifactMaintenanceTool.invoke({ ...request, edits: [{ op: "append", path: ["blocks"], value: { id: "fake-image", type: "image", text: "fake", attrs: { image } } }] }, signal, call(captured.artifact.id)), /forge|JSON|metadata/);
    const output = proposalOutput.parse((await artifactMaintenanceTool.invoke(request, signal, call(captured.artifact.id))).output);
    const accepted = await decideArtifactProposal(ctx, output.proposalId!, "accept");
    const changed = artifactContentSchema.parse(accepted.version?.content);
    if (changed.kind !== "report") throw new Error("Expected report.");
    assert.equal(changed.blocks[0].text, "Model caption");
    for (const [key, value] of Object.entries(tableAttrs)) if (key !== "captionProvenance") assert.deepEqual(changed.blocks[0].attrs[key], value);
    assert.equal(z.object({ evidenceKind: z.string() }).parse(changed.blocks[0].attrs.captionProvenance).evidenceKind, "model_inference");
    assert.deepEqual(changed.blocks[1].attrs.image, image);
    await getDb().update(projectArtifacts).set({ ownerUserId: foreign.id }).where(eq(projectArtifacts.id, source.artifact.id));
    await assert.rejects(artifactInspectTool.invoke({ artifactId: captured.artifact.id }, signal, call(captured.artifact.id)), /not owned/);
  });

  await t.test("large snapshots are honestly metadata-only and partial inspection reaches model summary", async () => {
    const large = await createArtifact(ctx, { projectId: project.id, title: "Large report", content: artifactContentSchema.parse({ kind: "report", blocks: Array.from({ length: 100 }, (_, index) => ({ id: `block-${index}`, type: "paragraph", text: `${index}: ${"x".repeat(500)}`, attrs: {} })), sections: [] }) });
    const full = await artifactInspectTool.invoke({ artifactId: large.artifact.id }, signal, call(large.artifact.id));
    const output = inspectOutput.parse(full.output);
    assert.equal(output.completeness, "metadata_only");
    assert.equal(output.snapshot, null);
    assert.equal(output.structure.find(field => field.path[0] === "blocks")?.entries, 100);
    assert.match(full.summary, /NOT included/);
    const partial = await artifactInspectTool.invoke({ artifactId: large.artifact.id, paths: [["blocks", 99, "text"]] }, signal, call(large.artifact.id));
    const partialOutput = inspectOutput.parse(partial.output);
    assert.equal(partialOutput.completeness, "selected_paths");
    assert.match(partial.summary, /99:/);
    assert.ok(partial.summary.length < 16_000);
    await assert.rejects(artifactInspectTool.invoke({ artifactId: large.artifact.id, paths: [["blocks"]] }, signal, call(large.artifact.id)), /narrower existing paths/);
    assert.match(await buildArtifactMaintenancePrompt(call(large.artifact.id), signal) ?? "", /metadata_only/);
    const append = proposalOutput.parse((await artifactMaintenanceTool.invoke({ artifactId: large.artifact.id, baseVersion: 1, baseHash: large.version.contentHash, summary: "Append authored conclusion", edits: [{ op: "append", path: ["blocks"], value: { id: "conclusion", type: "paragraph", text: "Model-authored conclusion" } }] }, signal, call(large.artifact.id))).output);
    assert.equal(append.status, "pending");
    assert.equal((await getArtifact(ctx, large.artifact.id)).headVersion, 1);
  });

  await t.test("multi-target prompts preserve every selected identity within the aggregate bound", async () => {
    const selectedIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const target = await createArtifact(ctx, { projectId: project.id, title: `Selected ${index}`, content: artifactContentSchema.parse({ kind: "report", blocks: [{ id: "text", type: "paragraph", text: "x".repeat(10_000), attrs: {} }], sections: [] }) });
      selectedIds.push(target.artifact.id);
    }
    const prompt = await buildArtifactMaintenancePrompt(call(selectedIds[0], { activeArtifactRefs: selectedIds }), signal);
    assert.ok(prompt);
    assert.ok(Buffer.byteLength(prompt) < 26 * 1024);
    for (const artifactId of selectedIds) assert.ok(prompt.includes(artifactId));
    assert.match(prompt, /metadata_only/);
  });
});
