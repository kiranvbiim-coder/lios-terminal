import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-artifact-composition-"));
process.env.LIMURIA_DATA_DIR = root;
process.env.LIOS_ATTACHMENT_STORAGE_DIR = path.join(root, "attachments");
// Database/storage imports must follow the isolated environment: their runtime configuration is captured on module load.
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectResources, projectArtifactVersions, dataEntitlementPolicies } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { loadProjectAttachment, uploadProjectChatAttachment } = await import("./projectAttachmentService");
const { writeProjectAttachmentBlob } = await import("./projectAttachmentStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const store = await import("./artifactStore");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { readArtifactImage } = await import("@shared/artifactImage");
const { artifactCompositionRequestSchema, proposeArtifactComposition } = await import("./artifactComposition");

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeAndData.copy(result, 4);
  result.writeUInt32BE(crc32(typeAndData), data.length + 8);
  return result;
}
function png(width = 1, height = 1, padding = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((1 + width * 4) * height);
  const chunks = [pngChunk("IHDR", header)];
  if (padding) chunks.push(pngChunk("tEXt", Buffer.concat([Buffer.from("comment\0"), Buffer.alloc(padding, 65)])));
  chunks.push(pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}
function jpeg(): Buffer {
  const segment = (marker: number, payload: Buffer) => {
    const prefix = Buffer.from([255, marker, 0, 0]); prefix.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([prefix, payload]);
  };
  const huffman = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(15), Buffer.from([0, 16, 1]), Buffer.alloc(15), Buffer.from([0])]);
  // Baseline grayscale 1x1: constant 128 pixel, DC category zero and AC end-of-block.
  return Buffer.concat([Buffer.from([255, 216]), segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 17, 0])), segment(0xc4, huffman),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([63, 255, 217])]);
}

test("selected Project sources capture immutable multimodal content into reviewed P4 proposals", { timeout: 60_000 }, async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner, foreign] = await getDb().insert(users).values(["owner", "foreign"].map(name => ({ email: `${crypto.randomUUID()}@test.invalid`, passwordHash: "test-only", name, role: "internal_analyst" as const, organizationId: null }))).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const foreignCtx = { userId: foreign.id, organizationId: null, role: foreign.role };
  const project = await createProject(ctx, { name: "Composition" });
  const otherProject = await createProject(ctx, { name: "Separate Project" });
  const foreignProject = await createProject(foreignCtx, { name: "Foreign" });
  const chat = await createProjectChat(ctx, { scope: "project", projectId: project.id });
  const otherChat = await createProjectChat(ctx, { scope: "project", projectId: otherProject.id });
  const foreignChat = await createProjectChat(foreignCtx, { scope: "project", projectId: foreignProject.id });
  const originalContent = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "authored", type: "paragraph", text: "Existing authored text" }], sections: [{ id: "existing", title: "Existing section", blockIds: ["authored"] }] });
  if (originalContent.kind !== "report") throw new Error("Expected report fixture.");
  const target = await store.createArtifact(ctx, { projectId: project.id, title: "Mixed report", content: originalContent, sourceRefs: ["source:authored"] });
  const upload = (bytes: Buffer, originalName = "selected.png") => uploadProjectChatAttachment(ctx, project.id, chat.id, { bytes, originalName });
  const attachment = await upload(png());
  const imageInput = { baseVersion: 1, kind: "image", sourceId: attachment.id, caption: "User caption, not source evidence" };
  const captured = await proposeArtifactComposition(ctx, target.artifact.id, imageInput);
  assert.equal(captured.proposal.status, "pending");
  assert.equal(captured.block.type, "image");
  assert.equal(captured.block.text, imageInput.caption);
  assert.equal(captured.block.attrs.captionProvenance, "user_asserted");
  assert.equal(captured.sourceHash, attachment.sha256);
  assert.deepEqual(captured.sourceRefs, [attachment.sourceRef]);
  const image = readArtifactImage(captured.block.attrs.image);
  assert.deepEqual(Buffer.from(image.dataBase64, "base64"), png());
  assert.equal(image.sourceRef, attachment.sourceRef);
  assert.equal(image.width, 1); assert.equal(image.height, 1);
  const patch = artifactContentSchema.parse(captured.proposal.patch);
  if (patch.kind !== "report") throw new Error("Expected report.");
  assert.deepEqual(patch.blocks[0], originalContent.blocks[0]);
  assert.deepEqual(patch.sections[0], originalContent.sections[0]);
  assert.equal(patch.sections[1].id, captured.sectionId);
  assert.deepEqual(patch.sections[1].blockIds, [captured.block.id]);
  assert.match(captured.proposal.summary, /source SHA-256 .*proposed content SHA-256/);
  assert.equal((await store.getArtifact(ctx, target.artifact.id)).headVersion, 1);
  assert.deepEqual(await store.getArtifactVersion(ctx, target.artifact.id, 1), target.version);
  assert.equal((await proposeArtifactComposition(ctx, target.artifact.id, imageInput)).proposal.id, captured.proposal.id);
  const selectedSection = await proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sectionId: "existing" });
  const sectionPatch = artifactContentSchema.parse(selectedSection.proposal.patch);
  if (sectionPatch.kind !== "report") throw new Error("Expected report.");
  assert.equal(sectionPatch.sections.length, 1);
  assert.deepEqual(sectionPatch.sections[0].blockIds, ["authored", selectedSection.block.id]);
  await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sectionId: "missing" }), /section/);

  await t.test("foreign sources, paths, remote URLs and unsupported formats fail closed", async () => {
    await assert.rejects(proposeArtifactComposition(foreignCtx, target.artifact.id, imageInput), /not found|owned/);
    const cross = await uploadProjectChatAttachment(ctx, otherProject.id, otherChat.id, { bytes: png(), originalName: "cross.png" });
    const foreignImage = await uploadProjectChatAttachment(foreignCtx, foreignProject.id, foreignChat.id, { bytes: png(), originalName: "foreign.png" });
    for (const sourceId of [cross.id, foreignImage.id]) await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId }), /not found|owned/);
    for (const sourceId of ["../selected.png", "file:///tmp/private.png", "https://host.invalid/image.png"]) assert.equal(artifactCompositionRequestSchema.safeParse({ ...imageInput, sourceId }).success, false);
    assert.equal(artifactCompositionRequestSchema.safeParse({ ...imageInput, image: { url: "https://host.invalid/image.png" } }).success, false);
    const text = await upload(Buffer.from("not an image"), "text.txt");
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: text.id }), /image metadata/);
    const webp = await upload(Buffer.from("RIFF1234WEBP"), "unsupported.webp");
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: webp.id }), /image metadata/);
    await assert.rejects(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "disguised.png"), /valid PNG/);
    await assert.rejects(upload(Buffer.from("GIF89a"), "disguised.jpeg"), /valid JPEG/);
  });

  await t.test("actual image bytes, metadata, dimensions and complete streams are checked", async () => {
    const jpg = await upload(jpeg(), "pixel.jpeg");
    const jpegCapture = await proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: jpg.id });
    assert.equal(readArtifactImage(jpegCapture.block.attrs.image).mimeType, "image/jpeg");
    const damaged = png(); damaged[damaged.length - 1] ^= 1;
    const corrupted = await upload(damaged);
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: corrupted.id }), /checksum/);
    const truncated = await upload(png().subarray(0, 33));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: truncated.id }), /incomplete/);
    const wide = await upload(png(4097));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: wide.id }), /dimension|bound|4096/i);
    const huge = await upload(png(1, 1, 1024 * 1024));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: huge.id }), /1 MiB/);
    const hashMismatch = await upload(png());
    await writeProjectAttachmentBlob(ctx.userId, project.id, hashMismatch.id, png(2));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: hashMismatch.id }), /metadata|hash|SHA|invalid|integrity/i);
    const metadataMismatch = await upload(png());
    const loaded = await loadProjectAttachment(ctx, project.id, metadataMismatch.id);
    await getDb().update(projectResources).set({ metadata: { ...loaded.resource.metadata, sha256: "a".repeat(64) } }).where(eq(projectResources.id, loaded.resource.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: metadataMismatch.id }), /hash|SHA|invalid|integrity/i);
    const oversized = await upload(png(1, 1, 900 * 1024));
    const largeCapture = await proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: oversized.id });
    const largeTarget = await store.createArtifact(ctx, { projectId: project.id, title: "Image bound", content: artifactContentSchema.parse({ kind: "report", blocks: [0, 1, 2].map(index => ({ ...largeCapture.block, id: `existing-image-${index}` })), sections: [] }) });
    await assert.rejects(proposeArtifactComposition(ctx, largeTarget.artifact.id, { ...imageInput, sourceId: oversized.id }), /3 MiB/);
  });

  const chartContent = artifactContentSchema.parse({ kind: "chart", chartType: "line", series: [{ id: "revenue", label: "Revenue", points: [{ x: "2025", y: 10 }, { x: "2026", y: 12 }] }] });
  const chart = await store.createArtifact(ctx, { projectId: project.id, title: "Actual chart", content: chartContent, sourceRefs: ["source:revenue"] });
  const tableContent = artifactContentSchema.parse({ kind: "table", columns: [{ key: "year", label: "Year" }, { key: "revenue", label: "Revenue", type: "number" }], rows: [{ year: "2026", revenue: 12 }] });
  const table = await store.createArtifact(ctx, { projectId: project.id, title: "Actual table", content: tableContent });
  await t.test("owned explicit versions retain actual chart/table data and pinned Artifact identities", async () => {
    const chartInput = { baseVersion: 1, kind: "chart", sourceId: chart.artifact.id, sourceVersion: 1, caption: "Selected chart" };
    const chartCapture = await proposeArtifactComposition(ctx, target.artifact.id, chartInput);
    assert.deepEqual(chartCapture.block.attrs.chart, chartContent);
    assert.equal(chartCapture.block.type, "chart_ref");
    assert.equal(chartCapture.block.attrs.sourceVersion, 1);
    assert.equal(chartCapture.block.attrs.sourceHash, chart.version.contentHash);
    assert.deepEqual(chartCapture.sourceRefs, [`${chart.artifact.id}@v1`, "source:revenue"]);
    await store.createArtifactVersion(ctx, { artifactId: chart.artifact.id, baseVersion: 1, content: artifactContentSchema.parse({ ...chartContent, chartType: "bar" }) });
    const pinned = await proposeArtifactComposition(ctx, target.artifact.id, chartInput);
    assert.equal(pinned.proposal.id, chartCapture.proposal.id);
    assert.deepEqual(pinned.block.attrs.chart, chartContent);
    const tableCapture = await proposeArtifactComposition(ctx, target.artifact.id, { baseVersion: 1, kind: "table", sourceId: table.artifact.id, sourceVersion: 1 });
    assert.deepEqual(tableCapture.block.attrs.table, tableContent);
    assert.equal(tableCapture.block.type, "table");
    const reference = await proposeArtifactComposition(ctx, target.artifact.id, { baseVersion: 1, kind: "artifact", sourceId: table.artifact.id, sourceVersion: 1 });
    assert.equal(reference.block.type, "artifact_ref");
    assert.equal(reference.block.attrs.artifactId, table.artifact.id);
    assert.equal(reference.block.attrs.version, 1);
    assert.equal(reference.block.attrs.contentHash, table.version.contentHash);
    assert.equal(reference.block.attrs.table, undefined);
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...chartInput, sourceId: table.artifact.id }), /must have chart/);
    assert.equal(artifactCompositionRequestSchema.safeParse({ ...chartInput, sourceVersion: undefined }).success, false);
    const cross = await store.createArtifact(ctx, { projectId: otherProject.id, title: "Other chart", content: chartContent });
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...chartInput, sourceId: cross.artifact.id }), /different Project/);
    const alien = await store.createArtifact(foreignCtx, { projectId: foreignProject.id, title: "Foreign chart", content: chartContent });
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...chartInput, sourceId: alien.artifact.id }), /not found|owned/);
    await getDb().update(projectArtifactVersions).set({ contentHash: "b".repeat(64) }).where(eq(projectArtifactVersions.id, table.version.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { baseVersion: 1, kind: "table", sourceId: table.artifact.id, sourceVersion: 1 }), /immutable content hash/);
  });

  await t.test("live linked source and target rights gate capture without trusting client claims", async () => {
    const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "composition", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "derived_output", "export"], attribution: null, termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
    const policyRef = `entitlement-policy:${policy.id}`;
    const protectedSource = await store.createArtifact(ctx, { projectId: project.id, title: "Rights-bound chart", content: chartContent, dependencyRefs: [policyRef] });
    const input = { baseVersion: 1, kind: "chart", sourceId: protectedSource.artifact.id, sourceVersion: 1 };
    const rightsProposal = await proposeArtifactComposition(ctx, target.artifact.id, input);
    assert.ok(rightsProposal.sourceRefs.includes(policyRef));
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display"] }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, input), /rights/);
    await assert.rejects(store.decideArtifactProposal(ctx, rightsProposal.proposal.id, "accept"), /rights/);
    assert.equal((await store.getArtifact(ctx, target.artifact.id)).headVersion, 1);
    assert.equal((await store.listArtifactProposals(ctx, target.artifact.id)).find(proposal => proposal.id === rightsProposal.proposal.id)?.status, "pending");
    const protectedTarget = await store.createArtifact(ctx, { projectId: project.id, title: "Rights-bound target", content: originalContent, sourceRefs: [policyRef] });
    await assert.rejects(proposeArtifactComposition(ctx, protectedTarget.artifact.id, imageInput), /rights/);
    const protectedImage = await upload(png());
    const loaded = await loadProjectAttachment(ctx, project.id, protectedImage.id);
    await getDb().update(projectResources).set({ metadata: { ...loaded.resource.metadata, dependencyRefs: [policyRef] } }).where(eq(projectResources.id, loaded.resource.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...imageInput, sourceId: protectedImage.id }), /rights/);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display", "derived_output", "export"], effectiveTo: new Date("2000-01-01") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, input), /rights/);
    await assert.rejects(store.decideArtifactProposal(ctx, rightsProposal.proposal.id, "accept"), /rights/);
    assert.equal((await store.getArtifact(ctx, target.artifact.id)).headVersion, 1);
    await getDb().update(dataEntitlementPolicies).set({ effectiveTo: null, effectiveFrom: new Date("2999-01-01") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, input), /rights/);
    const missingPolicySource = await store.createArtifact(ctx, { projectId: project.id, title: "Missing source rights", content: chartContent, sourceRefs: [`entitlement-policy:${crypto.randomUUID()}`] });
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, { ...input, sourceId: missingPolicySource.artifact.id }), /rights/);
  });

  await t.test("research preserves claims/evidence and accepted images no longer depend on mutable attachment storage", async () => {
    const research = await store.createArtifact(ctx, { projectId: project.id, title: "Research", content: artifactContentSchema.parse({ kind: "research", question: "Unchanged question", blocks: [], claims: [{ id: "claim", text: "User claim", provenance: "user_asserted" }], evidence: [] }) });
    const staged = await proposeArtifactComposition(ctx, research.artifact.id, imageInput);
    const proposed = artifactContentSchema.parse(staged.proposal.patch);
    const baseline = artifactContentSchema.parse(research.version.content);
    if (proposed.kind !== "research" || baseline.kind !== "research") throw new Error("Expected research.");
    assert.equal(proposed.question, baseline.question);
    assert.deepEqual(proposed.claims, baseline.claims);
    assert.deepEqual(proposed.evidence, baseline.evidence);
    await assert.rejects(proposeArtifactComposition(ctx, research.artifact.id, { ...imageInput, sectionId: "existing" }), /section/);
    const accepted = await store.decideArtifactProposal(ctx, captured.proposal.id, "accept");
    assert.equal(accepted.version?.version, 2);
    await writeProjectAttachmentBlob(ctx.userId, project.id, attachment.id, png(2));
    const persisted = artifactContentSchema.parse((await store.getArtifactVersion(ctx, target.artifact.id, 2)).content);
    if (persisted.kind !== "report") throw new Error("Expected report.");
    assert.deepEqual(Buffer.from(readArtifactImage(persisted.blocks.at(-1)!.attrs.image).dataBase64, "base64"), png());
    await assert.rejects(proposeArtifactComposition(ctx, target.artifact.id, imageInput), /stale/);
    assert.deepEqual(await store.getArtifactVersion(ctx, target.artifact.id, 1), target.version);
    await assert.rejects(proposeArtifactComposition(ctx, chart.artifact.id, { ...imageInput, baseVersion: 2 }), /Only report or research/);
  });
});
