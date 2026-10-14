import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TenantContext } from "./tenantContext";
import type { GovernedToolCall } from "./governedTools";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-web-research-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { getArtifact, getArtifactVersion, listProjectArtifacts } = await import("./artifactStore");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { p7ProjectDocumentSchema } = await import("@shared/p7ResearchContracts");
const {
  webResearchArtifactContent,
  webResearchArtifactTool,
  webResearchArtifactOutputSchema,
} = await import("./webResearchArtifactTool");

test("SI-03.07 exact governed web captures become durable citation-ready ResearchArtifacts", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Web research owner",
  }).returning();
  const tenant: TenantContext = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(tenant, { name: "Public evidence review" });

  const urlARequested = "https://example.com/source-a";
  const urlA = "https://example.com/archive/source-a";
  const urlB = "https://example.org/source-b";
  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: urlA,
    title: "Public source A",
    body: "Source A reports a bounded public observation.",
    sourceRefs: [urlA, urlARequested],
    metadata: {
      provider: "lios.playwright.optional",
      sourceUrl: urlA,
      requestedUrl: urlARequested,
      resolvedUrl: urlA,
      retrievedAt: "2026-10-06T10:10:00.000Z",
      publishedAt: null,
      effectiveAt: null,
      originClass: "untrusted",
      evidenceKind: "claim",
      extraction: { kind: "text" },
      extractionCompleteness: "bounded_not_verified",
      acquisitionRef: "acq:a",
      acquisitionOutputHash: "a".repeat(64),
    },
  });
  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: urlB,
    title: "Public source B",
    body: "Source B independently reports another bounded observation.",
    sourceRefs: [urlB],
    metadata: {
      provider: "lios.playwright.optional",
      sourceUrl: urlB,
      retrievedAt: "2026-10-06T10:11:00.000Z",
      publishedAt: "2026-10-05T08:00:00.000Z",
      effectiveAt: null,
      originClass: "untrusted",
      evidenceKind: "claim",
      extraction: { kind: "text", selector: "main" },
      extractionCompleteness: "bounded_not_verified",
      acquisitionRef: "acq:b",
      acquisitionOutputHash: "b".repeat(64),
    },
  });
  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "research_evidence",
    sourceRef: "project:not-web",
    title: "Project evidence masquerade",
    body: "This is not a governed browser URL capture.",
    metadata: {
      sourceUrl: "https://example.net/not-browser",
      retrievedAt: "2026-10-06T10:12:00.000Z",
      originClass: "owner",
      acquisitionRef: "fake",
      acquisitionOutputHash: "c".repeat(64),
    },
  });

  const call: GovernedToolCall = {
    source: "agent",
    userId: tenant.userId,
    tenant,
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "auto",
    allowedSourceRefs: [urlARequested, urlB],
  };
  const signal = new AbortController().signal;

  await t.test("tool policy is internal-only and input cannot forge trusted scope", () => {
    assert.equal(webResearchArtifactTool.permissionClass, "safe_auto");
    assert.equal(webResearchArtifactTool.sideEffect, "internal_write");
    assert.equal(webResearchArtifactTool.replaySafe, false);
    const input = { query: "public evidence", title: "Web evidence", sourceUrls: [urlARequested, urlB] };
    assert.ok(webResearchArtifactTool.inputSchema.safeParse(input).success);
    for (const reserved of ["projectId", "tenant", "allowedSourceRefs", "sourceScope"]) {
      assert.equal(webResearchArtifactTool.inputSchema.safeParse({ ...input, [reserved]: "forged" }).success, false);
    }
  });

  let artifactId = "";
  await t.test("exact web sources preserve URL, hash, acquisition provenance and explicit truth posture", async () => {
    const result = webResearchArtifactOutputSchema.parse(await webResearchArtifactTool.invoke(
      { query: "public evidence", title: "Web evidence digest", sourceUrls: [urlARequested, urlB] },
      signal,
      call,
    ));
    artifactId = result.output.artifactId;
    assert.equal(result.output.sourceCount, 2);
    assert.deepEqual(result.sourceRefs, [urlA, urlB]);

    const version = await getArtifactVersion(tenant, artifactId);
    const content = artifactContentSchema.parse(version.content);
    assert.equal(content.kind, "research");
    if (content.kind !== "research") assert.fail("Research Artifact expected");
    assert.deepEqual(content.claims, []);
    assert.deepEqual(content.contradictions, []);
    assert.deepEqual(content.evidence.map((item) => item.sourceRef), [urlA, urlB]);
    assert.deepEqual(content.evidence.map((item) => item.sourceType), ["web", "web"]);
    assert.deepEqual(content.evidence.map((item) => item.url), [urlA, urlB]);
    assert.deepEqual(content.sourcePolicy, {
      mode: "only_refs",
      allowedSourceRefs: [urlA, urlB],
      providerAllow: [],
      providerDeny: [],
    });
    assert.deepEqual(version.sourceRefs, [urlA, urlB]);
    assert.deepEqual(version.dependencyRefs, [urlA, urlARequested, urlB]);

    const quotes = content.blocks.filter((block) => block.type === "quote");
    assert.equal(quotes.length, 2);
    const firstAttrs = quotes[0].attrs as Record<string, any>;
    const secondAttrs = quotes[1].attrs as Record<string, any>;
    assert.equal(firstAttrs.provenance.acquisitionRef, "acq:a");
    assert.equal(firstAttrs.provenance.requestedUrl, urlARequested);
    assert.equal(firstAttrs.provenance.resolvedUrl, urlA);
    assert.equal(secondAttrs.provenance.acquisitionRef, "acq:b");
    assert.equal(firstAttrs.provenance.extractionCompleteness, "bounded_not_verified");
    assert.match(String(firstAttrs.contentHash), /^[a-f0-9]{64}$/);
    for (const [quote, attrs] of [[quotes[0], firstAttrs], [quotes[1], secondAttrs]] as const) {
      assert.equal(attrs.excerptSha256, crypto.createHash("sha256").update(quote.text, "utf8").digest("hex"));
      assert.equal(attrs.excerptByteLength, Buffer.byteLength(quote.text, "utf8"));
      assert.equal(attrs.sourceRef, quote.attrs.sourceRef);
    }
    assert.equal(firstAttrs.truth.temporal.asOfBasis, "unknown");
    assert.equal(secondAttrs.truth.temporal.asOfBasis, "published_at");
    assert.equal(firstAttrs.truth.sourceQuality.claimVerification, "not_verified_by_digest");

    const comparison = content.blocks.find((block) => block.id === "comparison-boundary");
    assert.ok(comparison);
    assert.match(comparison.text, /not automatically treated as contradictions/);
  });

  await t.test("missing, out-of-policy, duplicate and non-browser sources fail before Artifact creation", async () => {
    const before = (await listProjectArtifacts(tenant, project.id)).length;
    await assert.rejects(
      () => webResearchArtifactTool.invoke(
        { query: "x", title: "Missing", sourceUrls: ["https://missing.example/source"] },
        signal,
        { ...call, allowedSourceRefs: [] },
      ),
      /not captured through the governed browser/,
    );
    await assert.rejects(
      () => webResearchArtifactTool.invoke(
        { query: "x", title: "Denied", sourceUrls: [urlB] },
        signal,
        { ...call, allowedSourceRefs: [urlARequested] },
      ),
      /not captured through the governed browser/,
    );
    await assert.rejects(
      () => webResearchArtifactTool.invoke(
        { query: "x", title: "Duplicate", sourceUrls: [urlARequested, urlA] },
        signal,
        call,
      ),
      /must resolve to distinct captured sources/,
    );
    await assert.rejects(
      () => webResearchArtifactTool.invoke(
        { query: "x", title: "Masquerade", sourceUrls: ["https://example.net/not-browser"] },
        signal,
        { ...call, allowedSourceRefs: [] },
      ),
      /not captured through the governed browser/,
    );
    await assert.rejects(
      () => webResearchArtifactTool.invoke(
        { query: "x", title: "Web-only", sourceUrls: [urlARequested] },
        signal,
        { ...call, sourceScope: "web" },
      ),
      /requires Auto scope/,
    );
    assert.equal((await listProjectArtifacts(tenant, project.id)).length, before);
  });

  await t.test("pure assembly refuses uncaptured provenance even if sourceRef is an HTTPS URL", () => {
    assert.throws(
      () => webResearchArtifactContent({
        query: "x",
        sourceUrls: ["https://fake.example/source"],
        documents: [p7ProjectDocumentSchema.parse({
          schemaVersion: "1",
          id: "p7doc:fake",
          projectId: project.id,
          sourceType: "research_evidence",
          sourceRef: "https://fake.example/source",
          title: "Fake",
          body: "Fake source",
          contentHash: "d".repeat(64),
          occurredAt: null,
          sourceRefs: [],
          entityRefs: [],
          contextRefs: {},
          metadata: { sourceUrl: "https://fake.example/source", originClass: "untrusted" },
          embedding: null,
        })],
      }),
      /not captured through the governed browser/,
    );
  });

  await t.test("P4 web citations and provenance survive database close/reopen", async () => {
    const before = await getArtifactVersion(tenant, artifactId);
    await closeDb();
    await initDb();
    assert.equal((await getArtifact(tenant, artifactId)).projectId, project.id);
    const reopened = await getArtifactVersion(tenant, artifactId);
    assert.deepEqual(reopened.content, before.content);
    assert.deepEqual(reopened.sourceRefs, [urlA, urlB]);
    assert.deepEqual(reopened.dependencyRefs, [urlA, urlARequested, urlB]);
  });
});
