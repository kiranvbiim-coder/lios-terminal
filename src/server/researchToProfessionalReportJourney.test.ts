/**
 * Source-level SP03/SP04 professional-work journey:
 * indexed owned evidence → governed comparison → saved Research v1 →
 * editable Report v1 → real native Office/PDF bytes → edit Report v2 →
 * reopen current output and preserve immutable v1 / exact source rights.
 *
 * Desktop Electron glyph-shaping print acceptance remains an installed-app
 * validation and is NOT claimed by this server-side integration test.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFParse } from "pdf-parse";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-research-to-work-"));
process.env.LIMURIA_DATA_DIR = root;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { getArtifact, getArtifactVersion, createArtifactVersion } = await import("./artifactStore");
const { researchArtifactContentSchema, reportArtifactContentSchema } = await import("@shared/artifactContracts");
const { saveResearchComparisonTool, saveResearchComparisonOutputSchema } = await import("./researchComparisonArtifactTool");
const { researchReportFromArtifactTool, researchReportFromArtifactOutputSchema } = await import("./researchReportFromArtifactTool");
const { prepareReportDocxDownload } = await import("./reportDocxDownload");
const { prepareReportPdfDownload } = await import("./reportPdfDownload");
const { readOfficeArtifactRoundtrip } = await import("@shared/officeArtifactRoundtrip");

const metadata = (providerId: string, aiTransmission: "permitted" | "restricted") => ({
  researchSource: {
    class: "internal_research",
    identity: {
      sourceId: providerId, providerId, organization: null,
      author: null, analystId: null, expertId: null, url: null,
    },
    rights: {
      entitlement: {
        decision: "allowed" as const,
        policyId: "owner-reviewed-field-data",
        permittedUses: ["internal_research"],
        reasons: ["Explicit owner consent for local test data."],
      },
      aiTransmission,
      internalUse: "permitted",
      redistribution: "restricted",
    },
  },
});

test("SP03/P4 journey: permitted Project research reaches editable, versioned Word and PDF", { timeout: 90_000 }, async t => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [owner] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@test.invalid",
    passwordHash: "test-only",
    name: "Report test owner",
    role: "internal_analyst",
    organizationId: null,
  }).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Irrigation research" });
  const permittedRef = "internal:survey:water-2026";
  const blockedRef = "expert:restricted:private-2026";
  await indexProjectDocument(ctx, {
    projectId: project.id, sourceType: "research_evidence",
    sourceRef: permittedRef, title: "Irrigation interviews",
    body: "Water availability improved in two villages. Farmers reported water availability lasting longer.",
    metadata: metadata("owner-field-study", "permitted"),
  });
  await indexProjectDocument(ctx, {
    projectId: project.id, sourceType: "research_evidence",
    sourceRef: blockedRef, title: "Private supplier assessment",
    body: "Water availability confidential source data SECRET_DO_NOT_EXPORT.",
    metadata: metadata("restricted-provider", "restricted"),
  });
  const call = {
    source: "agent" as const,
    userId: owner.id,
    tenant: ctx, projectId: project.id, requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
  };
  const signal = new AbortController().signal;
  const researchReceipt = saveResearchComparisonOutputSchema.parse(
    await saveResearchComparisonTool.invoke({
      query: "water availability", title: "Village irrigation evidence",
      facets: ["water availability", "missing fertilizer cost"],
    }, signal, call),
  );
  assert.equal(researchReceipt.output.sourceCount, 1);
  assert.equal(researchReceipt.output.version, 1);
  const research = await getArtifact(ctx, researchReceipt.output.artifactId);
  assert.equal(research.kind, "research");
  const researchV1 = await getArtifactVersion(ctx, research.id, 1);
  const researchData = researchArtifactContentSchema.parse(researchV1.content);
  assert.ok(researchData.blocks.some(block => block.type === "quote"
    && block.text.toLowerCase().includes("water availability")));
  assert.ok(researchData.blocks.some(block => block.id === "gap-1"));
  assert.deepEqual(researchV1.sourceRefs, [permittedRef]);
  assert.equal(JSON.stringify(researchData).includes(blockedRef), false);
  assert.equal(JSON.stringify(researchData).includes("SECRET_DO_NOT_EXPORT"), false);

  const reportReceipt = researchReportFromArtifactOutputSchema.parse(
    await researchReportFromArtifactTool.invoke({
      artifactId: research.id, expectedVersion: 1,
      title: "Village water availability evidence report",
    }, signal, { ...call, requestId: crypto.randomUUID() }),
  );
  assert.equal(reportReceipt.output.researchArtifactId, research.id);
  assert.equal(reportReceipt.output.researchVersion, 1);
  assert.equal(reportReceipt.output.citedSourceCount, 1);
  assert.equal(reportReceipt.output.unicodePdfDesktopRequired, false);
  const reportId = reportReceipt.output.artifactId;
  const reportV1 = await getArtifactVersion(ctx, reportId, 1);
  const document = reportArtifactContentSchema.parse(reportV1.content);
  assert.equal(document.templateId, "research_evidence_report");
  assert.ok(document.blocks.some(block => block.type === "quote"
    && block.attrs.sourceRef === permittedRef && block.attrs.excerptSha256));
  assert.ok(document.blocks.some(block => block.text.includes("missing fertilizer cost")));
  assert.deepEqual(reportV1.sourceRefs, [research.id + "@v1", permittedRef]);

  // Test the actual Word ZIP, its native Office-return metadata and the same
  // typed text/P4 source revision after read-back, not a renamed JSON file.
  const word = await prepareReportDocxDownload(ctx, reportId, 1);
  assert.equal(new TextDecoder().decode(word.bytes.slice(0, 2)), "PK");
  const reopenedOffice = await readOfficeArtifactRoundtrip(word.bytes, "docx");
  assert.equal(reopenedOffice.sourceArtifactId, reportId);
  assert.equal(reopenedOffice.sourceVersion, 1);
  assert.equal(reopenedOffice.sourceHash, reportV1.contentHash);
  assert.deepEqual(reopenedOffice.content, document);

  const pdf = await prepareReportPdfDownload(ctx, reportId, 1);
  assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 5)), "%PDF-");
  const parser = new PDFParse({ data: new Uint8Array(pdf.bytes) });
  try {
    const text = (await parser.getText()).text;
    assert.match(text, /Village water availability evidence report/);
    assert.match(text, /Water availability improved in two villages/);
    assert.match(text, /missing fertilizer cost/);
    assert.match(text, /internal:survey:water-2026/);
    assert.equal(text.includes("SECRET_DO_NOT_EXPORT"), false);
  } finally {
    await parser.destroy();
  }

  // Saved reports reopen in the same P4 editor and add user-authored revisions,
  // leaving the original output and source provenance untouched.
  const v2 = await createArtifactVersion(ctx, {
    artifactId: reportId, baseVersion: 1,
    content: reportArtifactContentSchema.parse({
      ...document,
      blocks: [...document.blocks,
        { id: "owner-followup", type: "paragraph",
          text: "Owner follow-up: interview a second crop cycle." }],
    }),
    sourceRefs: reportV1.sourceRefs,
    dependencyRefs: reportV1.dependencyRefs,
    actorType: "user",
    note: "Edited professional report after the research delivery.",
  });
  assert.equal(v2.version, 2);
  assert.ok(reportArtifactContentSchema.parse((await getArtifactVersion(ctx, reportId, 2)).content)
    .blocks.some(block => block.id === "owner-followup"));
  assert.equal(reportArtifactContentSchema.parse((await getArtifactVersion(ctx, reportId, 1)).content)
    .blocks.some(block => block.id === "owner-followup"), false);
  await assert.rejects(() => prepareReportDocxDownload(ctx, reportId, 1), /revision changed/);
  await assert.rejects(() => prepareReportPdfDownload(ctx, reportId, 1), /revision changed/);
  const updatedWord = await prepareReportDocxDownload(ctx, reportId, 2);
  const reopenedV2 = await readOfficeArtifactRoundtrip(updatedWord.bytes, "docx");
  assert.equal(reopenedV2.sourceVersion, 2);
  assert.ok(reopenedV2.content.kind === "report");
  assert.ok(reopenedV2.content.blocks.some(block => block.id === "owner-followup"));
});
