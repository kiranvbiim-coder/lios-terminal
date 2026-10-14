import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-si03-project-knowledge-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIOS_ATTACHMENT_STORAGE_DIR = path.join(dataDir, "blobs");

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { setProjectResourceContextMode } = await import("./projectResourceStore");
const { uploadProjectChatAttachment, loadProjectAttachment } = await import("./projectAttachmentService");
const { PROJECT_ATTACHMENT_MAX_TEXT_CHARS } = await import("./projectAttachmentStore");
const {
  rebuildProjectIntelligence,
  searchProjectIntelligence,
  listProjectIntelligenceDocuments,
} = await import("./p7ProjectIntelligenceStore");

test("SI-03.04 Project knowledge makes permitted attachment text retrievable without creating a second knowledge authority", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: `si03-project-knowledge-${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Project knowledge owner",
  }).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Project knowledge" });
  const chat = await createProjectChat(ctx, { scope: "project", projectId: project.id, title: "Knowledge chat" });

  const searchableToken = "nebulaattachmentalpha";
  const reference = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from(`Quarterly operating note. ${searchableToken} indicates the signed supplier covenant.`, "utf8"),
    originalName: "supplier-note.txt",
  });

  const excludedToken = "excludedattachmentomega";
  const excluded = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from(`This content must never enter Project Intelligence: ${excludedToken}`, "utf8"),
    originalName: "excluded-note.txt",
  });
  const excludedLoaded = await loadProjectAttachment(ctx, project.id, excluded.id);
  await setProjectResourceContextMode(ctx, excludedLoaded.resource.id, "excluded");

  const longToken = "boundedattachmentstart";
  const long = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from(`${longToken}:${"x".repeat(PROJECT_ATTACHMENT_MAX_TEXT_CHARS + 64)}`, "utf8"),
    originalName: "bounded-note.txt",
  });

  const image = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    originalName: "chart.png",
  });

  const structured = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from([
      "# Financial overview",
      "Amounts in USD million unless stated otherwise.",
      "",
      "| Metric | FY2025 | FY2026E |",
      "| --- | ---: | ---: |",
      "| structuredrevenuealpha | 1,200 | 1,450 |",
      "| EBITDA margin | 18% | 20% |",
      "",
      "## Relationships",
      "| Parent | Subsidiary | Relationship |",
      "| --- | --- | --- |",
      "| Alpha Holdings | Alpha Energy | owns |",
    ].join("\n"), "utf8"),
    originalName: "structured-report.md",
  });

  const excludedStructured = await uploadProjectChatAttachment(ctx, project.id, chat.id, {
    bytes: Buffer.from([
      "# Forbidden",
      "| Parent | Subsidiary | Relationship |",
      "| --- | --- | --- |",
      "| forbiddenrelationshipbeta | Hidden Child | owns |",
    ].join("\n"), "utf8"),
    originalName: "excluded-structured.md",
  });
  const excludedStructuredLoaded = await loadProjectAttachment(ctx, project.id, excludedStructured.id);
  await setProjectResourceContextMode(ctx, excludedStructuredLoaded.resource.id, "excluded");

  await rebuildProjectIntelligence(ctx, project.id);

  const hits = await searchProjectIntelligence(ctx, project.id, { query: searchableToken, limit: 10 });
  assert.equal(hits.length, 1, "a token present only inside a permitted attachment must be retrievable after P7 rebuild");
  assert.ok(hits[0].sourceRefs.includes(reference.sourceRef));

  const excludedHits = await searchProjectIntelligence(ctx, project.id, { query: excludedToken, limit: 10 });
  assert.equal(excludedHits.length, 0, "excluded attachment content must not enter Project Intelligence");

  const documents = await listProjectIntelligenceDocuments(ctx, project.id);
  const textDoc = documents.find((doc) => doc.sourceRefs.includes(reference.sourceRef));
  assert.ok(textDoc);
  assert.equal(textDoc.metadata.attachmentSha256, reference.sha256);
  assert.deepEqual(textDoc.metadata.attachmentExtraction, {
    kind: "bounded_text",
    incomplete: false,
  });
  assert.equal(textDoc.metadata.originClass, "untrusted");

  const longDoc = documents.find((doc) => doc.sourceRefs.includes(long.sourceRef));
  assert.ok(longDoc);
  assert.equal(longDoc.metadata.attachmentSha256, long.sha256);
  assert.deepEqual(longDoc.metadata.attachmentExtraction, {
    kind: "bounded_text",
    incomplete: true,
    truncation: {
      reasons: ["character_limit"],
      maxCharacters: PROJECT_ATTACHMENT_MAX_TEXT_CHARS,
    },
  });
  assert.ok(longDoc.body.includes(longToken));
  assert.equal(longDoc.body.length <= PROJECT_ATTACHMENT_MAX_TEXT_CHARS + longDoc.title.length + 2, true);

  const imageDoc = documents.find((doc) => doc.sourceRefs.includes(image.sourceRef));
  assert.ok(imageDoc);
  assert.equal(imageDoc.metadata.attachmentExtraction, "metadata_only_image");
  assert.equal(imageDoc.body.includes("iVBOR"), false, "P7 must not encode image bytes or invent OCR text");

  const structuredParent = documents.find((doc) =>
    doc.sourceType === "resource" && doc.sourceRefs.includes(structured.sourceRef)
  );
  assert.ok(structuredParent);
  assert.deepEqual(structuredParent.metadata.structuredExtraction, {
    schemaVersion: "1",
    version: "1.0",
    sourceMode: "text_fallback",
    incomplete: false,
    sectionCount: 2,
    tableCount: 2,
    unitHints: ["USD", "%", "million"],
    relationshipCount: 1,
    documentRelationshipCount: 0,
    financialRowCount: 4,
    truncation: {
      truncated: false,
      omitted: {
        sections: 0,
        tables: 0,
        cells: 0,
        relationships: 0,
        units: 0,
        financialRows: 0,
      },
    },
  });

  const structuredSections = documents.filter((doc) =>
    doc.sourceType === "document"
    && doc.sourceRefs.includes(structured.sourceRef)
    && doc.metadata.structureKind === "section"
  );
  assert.equal(structuredSections.length, 2);
  assert.ok(structuredSections.some((doc) => doc.title.includes("Financial overview")));
  assert.ok(structuredSections.every((doc) =>
    Array.isArray(doc.metadata.relations)
    && (doc.metadata.relations as Array<{ type?: string; targetRef?: string }>).some(
      (relation) => relation.type === "derived_from" && relation.targetRef === structuredParent.sourceRef,
    )
  ));

  const structuredTables = documents.filter((doc) =>
    doc.sourceType === "document"
    && doc.sourceRefs.includes(structured.sourceRef)
    && doc.metadata.structureKind === "table"
  );
  assert.equal(structuredTables.length, 2);
  const financialTable = structuredTables.find((doc) => doc.body.includes("structuredrevenuealpha"));
  assert.ok(financialTable);
  assert.deepEqual(financialTable.contextRefs.period, ["FY2025", "FY2026E"]);
  assert.deepEqual(financialTable.contextRefs.currency, ["USD"]);
  assert.ok(financialTable.contextRefs.metric.includes("structuredrevenuealpha"));
  const relationshipTable = structuredTables.find((doc) => doc.body.includes("Alpha Energy"));
  assert.ok(relationshipTable);
  assert.deepEqual(relationshipTable.metadata.relationships, [{
    kind: "explicit_tabular",
    relation: "owns",
    from: "Alpha Holdings",
    to: "Alpha Energy",
    rowIndex: 0,
    fromColumn: "Parent",
    toColumn: "Subsidiary",
    relationColumn: "Relationship",
  }]);

  const structuredHits = await searchProjectIntelligence(ctx, project.id, {
    query: "FY2026E",
    limit: 20,
    allowedSourceRefs: [structured.sourceRef],
  });
  assert.ok(structuredHits.some((hit) => hit.sourceRef.includes("#table:")));
  assert.ok(structuredHits.every((hit) => hit.sourceRefs.includes(structured.sourceRef)));

  const forbiddenStructuredHits = await searchProjectIntelligence(ctx, project.id, {
    query: "forbiddenrelationshipbeta",
    limit: 20,
  });
  assert.equal(forbiddenStructuredHits.length, 0);
  assert.equal(documents.some((doc) => doc.sourceRefs.includes(excludedStructured.sourceRef)), false);

  const longStructuredProjection = longDoc.metadata.structuredExtraction as { incomplete?: boolean } | undefined;
  assert.equal(longStructuredProjection?.incomplete, true, "structured extraction must inherit attachment truncation");

  await closeDb();
  await initDb();
  const reopenedHits = await searchProjectIntelligence(ctx, project.id, { query: searchableToken, limit: 10 });
  assert.equal(reopenedHits.length, 1, "derived Project knowledge must remain retrievable after database reopen");
  const reopenedStructuredHits = await searchProjectIntelligence(ctx, project.id, {
    query: "FY2026E",
    limit: 20,
    allowedSourceRefs: [structured.sourceRef],
  });
  assert.ok(reopenedStructuredHits.some((hit) => hit.sourceRef.includes("#table:")), "structured P7 children persist across reopen");
});
