import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-report-from-research-"));
process.env.LIMURIA_DATA_DIR = dataDir;

// Source indexes, P4 work and version history live in an isolated user-owned test data root.
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { createArtifact, getArtifact, getArtifactVersion, createArtifactVersion, listProjectArtifacts } = await import("./artifactStore");
const { researchArtifactContentSchema, reportArtifactContentSchema } = await import("@shared/artifactContracts");
const { fingerprintRecordedExcerpt } = await import("./langalphaExcerptProvenance");
const { researchReportFromArtifactTool, researchReportFromArtifactInputSchema,
  researchReportFromArtifactOutputSchema, buildReportFromResearchArtifact } = await import("./researchReportFromArtifactTool");
const { getArtifactExportPlan } = await import("./artifactExport");
const { prepareReportDocxDownload } = await import("./reportDocxDownload");
const { readOfficeArtifactRoundtrip } = await import("@shared/officeArtifactRoundtrip");
const { proposeOfficeArtifactReturn } = await import("./officeArtifactReturn");
const { getReportTemplate, defaultArtifactReportTemplate } = await import("./reportEngine");

const allowed = {
  entitlement: {
    decision: "allowed" as const,
    policyId: "policy:internal-study",
    permittedUses: ["internal_research"],
    reasons: ["Owner-approved test evidence."],
  },
  aiTransmission: "permitted" as const,
  internalUse: "permitted" as const,
  redistribution: "restricted" as const,
};
const metadata = (transmission: "permitted" | "restricted") => ({
  researchSource: {
    class: "internal_research",
    identity: {
      sourceId: "study-2026", providerId: "survey-owner", organization: null,
      author: null, analystId: null, expertId: null, url: null,
    },
    rights: { ...allowed, aiTransmission: transmission },
  },
});

test("An owned saved research comparison becomes an editable P4 report, and only cites current rights", async t => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [user] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Research report owner",
  }).returning();
  const ctx = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(ctx, { name: "2026 field research" });
  const other = await createProject(ctx, { name: "Unrelated Project" });

  const ref = "internal:study:respondent-feedback";
  const quoteText = "Survey interviews recorded improved attendance following weekly outreach.";
  const sourceBody = quoteText + " Local teams also recorded transport delays.";
  const document = await indexProjectDocument(ctx, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: ref,
    title: "Field interviews",
    body: sourceBody,
    occurredAt: "2026-10-16T09:00:00.000Z",
    sourceRefs: [ref],
    metadata: metadata("permitted"),
  });
  const researchContent = researchArtifactContentSchema.parse({
    kind: "research",
    question: "Did attendance improve following outreach?",
    plan: { status: "completed", steps: [] },
    blocks: [
      { id: "question", type: "heading", text: "Attendance evidence comparison" },
      { id: "quote-0", type: "quote", text: quoteText, attrs: {
        sourceRef: ref, documentId: document.id, contentHash: document.contentHash,
        evidenceClass: "source", evidenceVersionRef: ref + "@" + document.contentHash,
        ...fingerprintRecordedExcerpt(quoteText),
      } },
      { id: "citation-0", type: "paragraph", text: "Source: " + ref },
      { id: "gap-1", type: "paragraph",
        text: "No exact matching passage was retrieved for absenteeism costs." },
    ],
    claims: [],
    evidence: [{
      id: "evidence-0", title: "Field interviews", snippet: quoteText,
      sourceRef: ref, observedAt: document.occurredAt,
    }],
    sourcePolicy: {
      mode: "only_refs", allowedSourceRefs: [ref],
      providerAllow: ["survey-owner"], providerDeny: [],
    },
  });
  const source = await createArtifact(ctx, {
    projectId: project.id,
    title: "Outreach comparison",
    content: researchContent,
    sourceRefs: [ref], dependencyRefs: [ref],
  });
  const call = {
    source: "agent" as const,
    userId: user.id,
    tenant: ctx,
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
    allowedSourceRefs: [ref],
  };
  const input = {
    artifactId: source.artifact.id,
    expectedVersion: 1,
    title: "Outreach impact evidence report",
  };
  let createdId = "";

  await t.test("research-specific template is generic and available without finance/tickers", () => {
    assert.equal(defaultArtifactReportTemplate("research"), "research_evidence_report");
    assert.deepEqual(getReportTemplate("research_evidence_report")?.sectionOrder,
      ["title", "summary", "text", "limitations", "sources"]);
    assert.equal(researchReportFromArtifactTool.id, "lios.research.to_report");
    assert.equal(researchReportFromArtifactTool.access, "write");
    assert.equal(researchReportFromArtifactTool.sideEffect, "internal_write");
    assert.equal(researchReportFromArtifactTool.replaySafe, false);
    assert.equal(researchReportFromArtifactInputSchema.safeParse(input).success, true);
    assert.equal(researchReportFromArtifactInputSchema.safeParse({ ...input, sources: ["invented"] }).success, false);
  });

  await t.test("saved output is a real editable Report Artifact preserving quotes, gaps, timestamps and source version", async () => {
    const response = researchReportFromArtifactOutputSchema.parse(
      await researchReportFromArtifactTool.invoke(input, new AbortController().signal, call),
    );
    createdId = response.output.artifactId;
    assert.equal(response.output.version, 1);
    assert.equal(response.output.researchArtifactId, source.artifact.id);
    assert.equal(response.output.researchVersion, 1);
    assert.equal(response.output.citedSourceCount, 1);
    assert.equal(response.output.excerptCount, 1);
    assert.equal(response.output.editorPreference, "tiptap");
    assert.equal(response.output.docxDownloadPath,
      "/api/artifacts/" + encodeURIComponent(createdId) + "/report.docx?version=1");
    const artifact = await getArtifact(ctx, createdId);
    assert.equal(artifact.kind, "report");
    assert.equal(artifact.projectId, project.id);
    const version = await getArtifactVersion(ctx, createdId);
    const report = reportArtifactContentSchema.parse(version.content);
    assert.equal(report.templateId, "research_evidence_report");
    assert.equal(report.editorPreference, "tiptap");
    assert.ok(report.sections.some(section => section.title === "Sources & References"));
    assert.ok(report.sections.some(section => section.title === "Limitations & Caveats"));
    const quote = report.blocks.find(block => block.type === "quote" && block.text === quoteText);
    assert.ok(quote, "source quote remains editable text rather than a JSON blob");
    assert.equal(quote.attrs.sourceRef, ref);
    assert.equal(quote.attrs.contentHash, document.contentHash);
    assert.equal(quote.attrs.excerptSha256, fingerprintRecordedExcerpt(quoteText).excerptSha256);
    assert.equal(quote.attrs.researchArtifactRef, source.artifact.id + "@v1");
    assert.equal(quote.attrs.researchArtifactContentHash, source.version.contentHash);
    assert.ok(report.blocks.some(block => block.text.includes("absenteeism costs")));
    assert.deepEqual(version.sourceRefs, [source.artifact.id + "@v1", ref]);
    assert.deepEqual(version.dependencyRefs, [source.artifact.id + "@v1", ref]);
    assert.equal(JSON.stringify(report).includes("unverified-source-secret"), false);

    // The normal Artifact export plan uses the report kind without any
    // extra renderer or undocumented finance-only export path.
    const exportPlan = await getArtifactExportPlan(ctx, createdId);
    assert.equal(exportPlan.kind, "report");
    assert.equal(exportPlan.artifactId, createdId);
    assert.equal(exportPlan.contentHash, version.contentHash);

    // Real native Word ZIP, not a JSON report labelled ".docx".
    const word = await prepareReportDocxDownload(ctx, createdId, 1);
    assert.match(word.filename, /\.docx$/);
    assert.equal(word.contentHash, version.contentHash);
    assert.equal(word.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.ok(word.bytes.length > 500);
    const roundtrip = await readOfficeArtifactRoundtrip(word.bytes, "docx");
    assert.equal(roundtrip.sourceArtifactId, createdId);
    assert.equal(roundtrip.sourceVersion, 1);
    assert.equal(roundtrip.sourceHash, version.contentHash);
    assert.deepEqual(roundtrip.content, report);
    assert.ok(roundtrip.content.kind === "report");
    assert.equal(roundtrip.content.blocks.find(block => block.type === "quote")?.attrs.excerptSha256,
      fingerprintRecordedExcerpt(quoteText).excerptSha256);
    // No native edits means no proposal. The existing Office return contract
    // remains responsible for reviewing any Word edits.
    const returnResult = await proposeOfficeArtifactReturn(ctx, createdId, roundtrip);
    assert.equal(returnResult.changed, false);
    assert.equal(returnResult.proposal, null);

    const edited = reportArtifactContentSchema.parse({
      ...report,
      blocks: [...report.blocks, { id: "analyst-addendum", type: "paragraph",
        text: "Analyst follow-up: compare the baseline attendance register." }],
    });
    const newVersion = await createArtifactVersion(ctx, {
      artifactId: createdId, baseVersion: 1, content: edited,
      sourceRefs: version.sourceRefs, dependencyRefs: version.dependencyRefs,
      actorType: "user",
      note: "Analyst added follow-up to editable report.",
    });
    assert.equal(newVersion.version, 2);
    const reopened = reportArtifactContentSchema.parse(
      (await getArtifactVersion(ctx, createdId)).content,
    );
    assert.ok(reopened.blocks.some(block => block.id === "analyst-addendum"));
    const old = reportArtifactContentSchema.parse(
      (await getArtifactVersion(ctx, createdId, 1)).content,
    );
    assert.equal(old.blocks.some(block => block.id === "analyst-addendum"), false);
    await assert.rejects(prepareReportDocxDownload(ctx, createdId, 1), /revision changed/);
    const latestWord = await prepareReportDocxDownload(ctx, createdId, 2);
    const reopenedWord = await readOfficeArtifactRoundtrip(latestWord.bytes, "docx");
    assert.equal(reopenedWord.sourceVersion, 2);
    assert.ok(reopenedWord.content.kind === "report");
    assert.ok(reopenedWord.content.blocks.some(block => block.id === "analyst-addendum"));
  });

  await t.test("refuses cross-Project, revoked, stale, read-only and unapproved-source report attempts", async () => {
    const count = (await listProjectArtifacts(ctx, project.id)).length;
    await assert.rejects(prepareReportDocxDownload(ctx, source.artifact.id), /requires an active saved Report Artifact/);
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, { ...call, projectId: other.id }),
      /not active in the authorized Project/,
    );
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, { ...call, sourceScope: "web" as const }),
      /Auto or My Data/,
    );
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, { ...call, researchReadOnly: true }),
      /writable authorized Project/,
    );
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, { ...call, allowedSourceRefs: ["different:ref"] }),
      /excluded by the current request/,
    );
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke({ ...input, expectedVersion: 2 },
        new AbortController().signal, call),
      /version changed/,
    );
    await indexProjectDocument(ctx, {
      projectId: project.id,
      sourceType: "research_evidence",
      sourceRef: ref, title: "Field interviews", body: sourceBody,
      metadata: metadata("restricted"),
    });
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, call),
      /rights no longer permit AI assistance/,
    );
    await indexProjectDocument(ctx, {
      projectId: project.id,
      sourceType: "research_evidence",
      sourceRef: ref, title: "Revised interviews",
      body: sourceBody + " Additional data was received.",
      metadata: metadata("permitted"),
    });
    await assert.rejects(
      () => researchReportFromArtifactTool.invoke(input, new AbortController().signal, call),
      /quote source revision changed/,
    );
    assert.equal((await listProjectArtifacts(ctx, project.id)).length, count);
  });
});

test("Pure report projection rejects forged quote fingerprints and invented missing-source evidence", () => {
  const ref = "internal:study:a";
  const text = "Observed source text.";
  const validContent = researchArtifactContentSchema.parse({
    kind: "research",
    question: "What changed?",
    evidence: [{ id: "e", title: "Source", snippet: text, sourceRef: ref }],
    blocks: [{
      id: "quote", type: "quote", text,
      attrs: { sourceRef: ref, contentHash: "a".repeat(64), ...fingerprintRecordedExcerpt(text) },
    }],
    sourcePolicy: { mode: "only_refs", allowedSourceRefs: [ref] },
  });
  const args = { source: validContent, title: "Evidence report",
    artifactId: "artifact:" + crypto.randomUUID(), version: 1,
    contentHash: "b".repeat(64) };
  const built = buildReportFromResearchArtifact(args);
  assert.equal(built.excerptCount, 1);
  assert.equal(built.content.kind, "report");
  assert.equal(built.content.editorPreference, "tiptap");
  assert.throws(
    () => buildReportFromResearchArtifact({ ...args,
      source: { ...validContent, blocks: validContent.blocks.map(block => ({
        ...block, text: "Forged excerpt.",
      })) },
    }),
    /exact excerpt fingerprint/,
  );
  assert.throws(
    () => buildReportFromResearchArtifact({ ...args,
      source: { ...validContent, evidence: [] },
    }),
    /no reportable source evidence/,
  );
});
