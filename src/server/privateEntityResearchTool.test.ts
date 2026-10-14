import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-private-entity-research-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { upsertCompany, upsertEntity } = await import("./companyStore");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const {
  privateEntityResearchInputSchema,
  privateEntityResearchOutputSchema,
  privateEntityResearchTool,
} = await import("./privateEntityResearchTool");

test("SI-03.15 researches private/no-ticker entities without fabricated market identity", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [owner, other] = await Promise.all([
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Private research owner",
    }).returning().then((rows) => rows[0]),
    getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "test-hash",
      role: "internal_analyst",
      name: "Other owner",
    }).returning().then((rows) => rows[0]),
  ]);
  const project = await createProject(
    { userId: owner.id, organizationId: null, role: owner.role },
    { name: "Private Entity Project" },
  );

  const entityDbId = await upsertEntity({
    name: "Northwind Private Research Ltd",
    jurisdiction: "GB",
    legalEntityKind: "corporation",
    identityStatus: "verified",
    identifiers: [{
      type: "registry_id",
      value: "00998877",
      registry: "UK_COMPANIES_HOUSE",
      jurisdiction: "GB",
      primary: true,
    }],
    source: "test",
  });
  const entityRef = `lios:entity:${entityDbId}`;

  await upsertCompany({
    symbol: "PUB",
    name: "Public Company Plc",
    exchange: "LSE",
    mic: "XLON",
    currency: "GBP",
    country: "GB",
    source: "test",
  });

  await indexProjectDocument(
    { userId: owner.id, organizationId: null, role: owner.role },
    {
      projectId: project.id,
      sourceType: "document",
      sourceRef: "document:registry-note",
      title: "Registry ownership note",
      body: "Ownership changed after the most recent registry filing.",
      entityRefs: [entityRef],
      metadata: {
        originClass: "owner",
        evidenceKind: "document",
        retrievedAt: "2026-10-05T10:00:00.000Z",
        publishedAt: "2026-10-04T10:00:00.000Z",
        freshnessState: "fresh",
        availabilityState: "available",
        entitlementState: "entitled",
        certaintyState: "verified",
      },
      occurredAt: "2026-10-04T10:00:00.000Z",
    },
  );
  await indexProjectDocument(
    { userId: owner.id, organizationId: null, role: owner.role },
    {
      projectId: project.id,
      sourceType: "research_evidence",
      sourceRef: "research:name-fallback",
      title: "Supplier diligence",
      body: "Northwind Private Research Ltd renewed its primary supplier agreement.",
      metadata: {
        originClass: "owner",
        evidenceKind: "claim",
        availabilityState: "available",
        entitlementState: "entitled",
      },
      occurredAt: "2026-09-30T09:00:00.000Z",
    },
  );
  await indexProjectDocument(
    { userId: owner.id, organizationId: null, role: owner.role },
    {
      projectId: project.id,
      sourceType: "document",
      sourceRef: "document:denied",
      title: "Restricted private evidence",
      body: "Restricted ownership evidence.",
      entityRefs: [entityRef],
      metadata: { originClass: "owner", evidenceKind: "document" },
      occurredAt: "2026-10-03T09:00:00.000Z",
    },
  );
  await indexProjectDocument(
    { userId: owner.id, organizationId: null, role: owner.role },
    {
      projectId: project.id,
      sourceType: "document",
      sourceRef: "document:unrelated",
      title: "Northwind sector note",
      body: "A different Northwind business is discussed here.",
      metadata: { originClass: "owner", evidenceKind: "document" },
      occurredAt: "2026-10-02T09:00:00.000Z",
    },
  );

  const baseCall = {
    source: "agent" as const,
    userId: owner.id,
    tenant: { userId: owner.id, organizationId: null, role: "internal_analyst" as const },
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
    allowedSourceRefs: ["document:registry-note", "research:name-fallback"],
  };

  await t.test("descriptor is deterministic read-only and input cannot smuggle ticker or scope", () => {
    assert.equal(privateEntityResearchTool.permissionClass, "safe_auto");
    assert.equal(privateEntityResearchTool.access, "read");
    assert.equal(privateEntityResearchTool.sideEffect, "none");
    assert.equal(privateEntityResearchTool.replaySafe, true);
    assert.equal(privateEntityResearchInputSchema.safeParse({ name: "Northwind Private Research Ltd" }).success, true);
    assert.equal(privateEntityResearchInputSchema.safeParse({ name: "Northwind", ticker: "FAKE" }).success, false);
    assert.equal(privateEntityResearchInputSchema.safeParse({
      identifier: { type: "registry_id", value: "00998877" },
    }).success, false);
  });

  await t.test("canonical private identity returns permitted entity-bound evidence first and exact-name fallback second", async () => {
    const result = privateEntityResearchOutputSchema.parse(await privateEntityResearchTool.invoke(
      {
        identifier: {
          type: "registry_id",
          value: "00998877",
          registry: "UK_COMPANIES_HOUSE",
          jurisdiction: "GB",
        },
        question: "ownership supplier",
        limit: 10,
      },
      new AbortController().signal,
      baseCall,
    ));

    assert.equal(result.output.status, "researched");
    assert.equal(result.output.identity?.entityId, entityRef);
    assert.equal(result.output.identity?.name, "Northwind Private Research Ltd");
    assert.equal(result.output.identity?.legalEntityKind, "corporation");
    assert.equal(result.output.providerFallbackUsed, false);
    assert.deepEqual(result.output.marketIdentity, {
      status: "unavailable_no_listing",
      ticker: null,
      listingId: null,
      securityId: null,
      quote: null,
      reason: "Canonical P5 entity has no listing/security identity. LiOS did not request or fabricate a public-market quote.",
    });
    assert.deepEqual(result.output.evidence.map((item) => [item.sourceRef, item.binding]), [
      ["document:registry-note", "exact_entity_ref"],
      ["research:name-fallback", "exact_name"],
    ]);
    assert.equal(result.output.evidence.some((item) => item.sourceRef === "document:denied"), false);
    assert.equal(result.output.evidence.some((item) => item.sourceRef === "document:unrelated"), false);
    assert.equal(result.output.evidence[0].truth.temporal.asOfBasis, "published_at");
    assert.equal(result.output.evidence[0].truth.freshness.state, "fresh");
    assert.equal(result.output.evidence[0].truth.access.entitlement, "entitled");
    assert.ok(result.sourceRefs.includes(entityRef));
    assert.ok(result.sourceRefs.includes("document:registry-note"));
    assert.ok(result.sourceRefs.includes("research:name-fallback"));
    assert.match(result.summary, /no ticker or market quote was invented/i);
  });

  await t.test("resolved listed entity is refused by the private research path without fetching evidence", async () => {
    const result = privateEntityResearchOutputSchema.parse(await privateEntityResearchTool.invoke(
      { name: "Public Company Plc" },
      new AbortController().signal,
      { ...baseCall, allowedSourceRefs: [] },
    ));
    assert.equal(result.output.status, "listed_entity");
    assert.equal(result.output.evidence.length, 0);
    assert.equal(result.output.marketIdentity.status, "listed_entity");
    assert.equal(result.output.marketIdentity.quote, null);
    assert.match(result.summary, /listed\/security identity/i);
  });

  await t.test("unknown entity fails closed with no Project evidence or fabricated identity", async () => {
    const result = privateEntityResearchOutputSchema.parse(await privateEntityResearchTool.invoke(
      { name: "Definitely Missing Private Entity 892347" },
      new AbortController().signal,
      { ...baseCall, allowedSourceRefs: [] },
    ));
    assert.equal(result.output.status, "not_found");
    assert.equal(result.output.identity, null);
    assert.deepEqual(result.output.evidence, []);
    assert.equal(result.output.marketIdentity.status, "unresolved");
    assert.equal(result.output.marketIdentity.quote, null);
    assert.equal(result.sourceRefs.length, 0);
  });

  await t.test("Project/owner and source-scope boundaries fail before evidence disclosure", async () => {
    await assert.rejects(
      () => privateEntityResearchTool.invoke(
        { name: "Northwind Private Research Ltd" },
        new AbortController().signal,
        { ...baseCall, sourceScope: "web" },
      ),
      /requires Auto or My Data/,
    );
    await assert.rejects(
      () => privateEntityResearchTool.invoke(
        { name: "Northwind Private Research Ltd" },
        new AbortController().signal,
        {
          ...baseCall,
          userId: other.id,
          tenant: { userId: other.id, organizationId: null, role: "internal_analyst" as const },
        },
      ),
      /not owned|does not exist|not found/i,
    );
  });
});
