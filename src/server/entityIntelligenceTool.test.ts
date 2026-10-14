import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-entity-intelligence-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { companyListings, instrumentRelationships, users } = await import("@shared/schema");
const { upsertCompany, upsertEntity } = await import("./companyStore");
const { createProject } = await import("./projectStore");
const {
  entityIntelligenceInputSchema,
  entityIntelligenceOutputSchema,
  entityIntelligenceTool,
} = await import("./entityIntelligenceTool");

let actorUserId = 0;
let actorProjectId = 0;

function call(scope: "auto" | "my_data" | "web" = "my_data") {
  return {
    source: "agent" as const,
    userId: actorUserId,
    tenant: {
      userId: actorUserId,
      organizationId: null,
      role: "internal_analyst" as const,
    },
    projectId: actorProjectId,
    requestId: crypto.randomUUID(),
    sourceScope: scope,
  };
}

async function invoke(input: unknown, scope: "auto" | "my_data" | "web" = "my_data") {
  return entityIntelligenceOutputSchema.parse(
    await entityIntelligenceTool.invoke(input, new AbortController().signal, call(scope)),
  );
}

test("SI-03.14 exposes canonical P5 identity without guessing or provider fallback", async (t) => {
  await initDb();
  const [actor] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Entity intelligence owner",
  }).returning();
  actorUserId = actor.id;
  const project = await createProject(
    { userId: actor.id, organizationId: null, role: actor.role },
    { name: "Entity Intelligence Research" },
  );
  actorProjectId = project.id;

  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const acmeId = await upsertCompany({
    symbol: "ACME",
    name: "Acme Corporation",
    cik: "0000000123",
    exchange: "NASDAQ",
    mic: "XNAS",
    currency: "USD",
    country: "US",
    shareClass: "A",
    source: "test",
    identifiers: [
      { type: "isin", value: "US0000000123", primary: true },
      { type: "figi", value: "BBG000ACME01" },
    ],
  });
  await upsertCompany({
    symbol: "ACMEL",
    name: "Acme Corporation",
    cik: "0000000123",
    exchange: "LSE",
    mic: "XLON",
    currency: "GBP",
    country: "GB",
    shareClass: "A",
    source: "test",
  });

  const listings = await getDb().select().from(companyListings).where(eq(companyListings.companyId, acmeId));
  const nasdaq = listings.find((row) => row.symbol === "ACME");
  const lse = listings.find((row) => row.symbol === "ACMEL");
  assert.ok(nasdaq && lse);
  // upsertCompany marks each newly written listing primary. Model the intended
  // canonical hierarchy explicitly for this multi-listing entity: NASDAQ is
  // the primary listing and LSE is a secondary listing.
  await getDb().update(companyListings).set({ isPrimary: false }).where(eq(companyListings.id, lse.id));
  await getDb().insert(instrumentRelationships).values({
    relationshipType: "adr_gdr",
    sourceListingId: nasdaq.id,
    targetListingId: lse.id,
    sourceCompanyId: null,
    targetCompanyId: null,
    ratio: "2:1",
    note: "test relationship",
    source: "test",
    validFrom: null,
    validTo: null,
  });

  const privateId = await upsertEntity({
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
  const personId = await upsertEntity({
    name: "Alex Researcher",
    jurisdiction: "US",
    legalEntityKind: "individual",
    identityStatus: "verified",
    identifiers: [{ type: "lei", value: "549300TESTPERSON0001", primary: true }],
    source: "test",
  });

  await upsertCompany({
    symbol: "DUAL",
    name: "Dual One",
    exchange: "NYSE",
    mic: "XNYS",
    source: "test",
  });
  await upsertCompany({
    symbol: "DUAL",
    name: "Dual Two",
    exchange: "LSE",
    mic: "XLON",
    source: "test",
  });

  const historicalId = await upsertCompany({
    symbol: "OLDCO",
    name: "Old Company",
    exchange: "NYSE",
    mic: "XNYS",
    source: "test",
  });
  const [historicalListing] = await getDb().select().from(companyListings)
    .where(eq(companyListings.companyId, historicalId));
  assert.ok(historicalListing);
  await getDb().update(companyListings).set({
    validFrom: "2020-01-01",
    validTo: "2024-12-31",
  }).where(eq(companyListings.id, historicalListing.id));

  await t.test("descriptor is deterministic safe-auto read-only and scope cannot be forged in model input", () => {
    assert.equal(entityIntelligenceTool.permissionClass, "safe_auto");
    assert.equal(entityIntelligenceTool.access, "read");
    assert.equal(entityIntelligenceTool.sideEffect, "none");
    assert.equal(entityIntelligenceTool.replaySafe, true);
    assert.match(entityIntelligenceTool.planningHint ?? "", /Microsoft Corporation/);
    assert.match(entityIntelligenceTool.planningHint ?? "", /pronouns or incidental prose tokens such as I/);
    assert.match(entityIntelligenceTool.planningHint ?? "", /Use \{"ticker":"<symbol>"\} only when the goal explicitly provides a ticker\/symbol/);
    assert.match(entityIntelligenceTool.planningHint ?? "", /two primary fields/);
    assert.match(entityIntelligenceTool.planningHint ?? "", /\{"query":"Microsoft Corporation"\}/);
    assert.ok(actorProjectId > 0);
    assert.equal(entityIntelligenceInputSchema.safeParse({ ticker: "ACME" }).success, true);
    assert.equal(entityIntelligenceInputSchema.safeParse({ name: "Acme", ticker: "ACME" }).success, false);
    assert.equal(entityIntelligenceInputSchema.safeParse({
      identifier: { type: "registry_id", value: "00998877" },
    }).success, false);
    assert.equal(entityIntelligenceInputSchema.safeParse({
      ticker: "ACME",
      tenant: { userId: 999 },
    }).success, false);
  });

  await t.test("exact ticker returns stable entity security listing ids and relationship refs", async () => {
    const result = await invoke({ ticker: "ACME", exchange: "NASDAQ" });
    assert.equal(result.output.status, "resolved");
    assert.equal(result.output.providerFallbackUsed, false);
    assert.equal(result.output.source, "local");
    const match = result.output.match;
    assert.ok(match);
    assert.equal(match.entityId, `lios:entity:${acmeId}`);
    assert.match(match.securityId ?? "", /^lios:security:/);
    assert.equal(match.listingId, `lios:listing:${nasdaq.id}`);
    assert.equal(match.symbol, "ACME");
    assert.equal(match.exchange, "NASDAQ");
    assert.equal(match.mic, "XNAS");
    assert.equal(match.shareClass, "A");
    assert.ok(match.identifiers.some((item) => item.type === "isin" && item.value === "US0000000123"));
    assert.deepEqual(match.relatedInstruments, [{
      listingId: `lios:listing:${lse.id}`,
      relationshipType: "adr_gdr",
      ratio: "2:1",
    }]);
    assert.ok(result.sourceRefs.includes(`lios:entity:${acmeId}`));
    assert.ok(result.sourceRefs.includes(`lios:listing:${nasdaq.id}`));
    assert.ok(result.sourceRefs.includes(`lios:listing:${lse.id}`));
  });

  await t.test("exact identifier resolves through canonical identifier namespace", async () => {
    const result = await invoke({
      identifier: { type: "isin", value: "US0000000123" },
    });
    assert.equal(result.output.status, "resolved");
    assert.equal(result.output.match?.entityId, `lios:entity:${acmeId}`);
  });

  await t.test("ambiguous ticker remains ambiguous with ranked reasons and no guessed match", async () => {
    const result = await invoke({ ticker: "DUAL" });
    assert.equal(result.output.status, "ambiguous");
    assert.equal(result.output.match, null);
    assert.equal(result.output.candidates.length, 2);
    assert.deepEqual(new Set(result.output.candidates.map((item) => item.candidate.exchange)), new Set(["NYSE", "LSE"]));
    assert.ok(result.output.candidates.every((item) => item.reasons.includes("exact ticker")));
    assert.match(result.summary, /did not guess/);
  });

  await t.test("private no-ticker entity and persisted individual resolve without invented listings", async () => {
    const privateResult = await invoke({ name: "Northwind Private Research Ltd" });
    assert.equal(privateResult.output.status, "resolved");
    assert.equal(privateResult.output.match?.entityId, `lios:entity:${privateId}`);
    assert.equal(privateResult.output.match?.symbol, null);
    assert.equal(privateResult.output.match?.securityId, null);
    assert.equal(privateResult.output.match?.listingId, null);
    assert.equal(privateResult.output.match?.entity?.legalEntityKind, "corporation");

    const person = await invoke({ name: "Alex Researcher" });
    assert.equal(person.output.status, "resolved");
    assert.equal(person.output.match?.entityId, `lios:entity:${personId}`);
    assert.equal(person.output.match?.entity?.legalEntityKind, "individual");
    assert.equal(person.output.match?.symbol, null);
    assert.equal(person.output.match?.listingId, null);
  });

  await t.test("registry id requires namespace and resolves the no-ticker entity when explicit", async () => {
    const result = await invoke({
      identifier: {
        type: "registry_id",
        value: "00998877",
        registry: "UK_COMPANIES_HOUSE",
        jurisdiction: "GB",
      },
    });
    assert.equal(result.output.status, "resolved");
    assert.equal(result.output.match?.entityId, `lios:entity:${privateId}`);
  });

  await t.test("historical listing is excluded now but resolves for an explicit valid as-of date", async () => {
    const current = await invoke({ ticker: "OLDCO" });
    assert.equal(current.output.status, "not_found");

    const historical = await invoke({ ticker: "OLDCO", asOfDate: "2024-06-30" });
    assert.equal(historical.output.status, "resolved");
    assert.equal(historical.output.match?.entityId, `lios:entity:${historicalId}`);
    assert.equal(historical.output.match?.lifecycleStatus, "delisted");

    const tooEarly = await invoke({ ticker: "OLDCO", asOfDate: "2019-12-31" });
    assert.equal(tooEarly.output.status, "not_found");
  });

  await t.test("unresolved and disallowed-source queries fail truthfully without external lookup", async () => {
    const missing = await invoke({ ticker: "NO_SUCH_CANONICAL_IDENTITY" });
    assert.equal(missing.output.status, "not_found");
    assert.equal(missing.output.match, null);
    assert.deepEqual(missing.output.candidates, []);
    assert.equal(missing.output.providerFallbackUsed, false);
    assert.match(missing.summary, /did not fabricate/);

    await assert.rejects(
      () => invoke({ ticker: "ACME" }, "web"),
      /requires Auto or My Data scope/,
    );
    await assert.rejects(
      () => entityIntelligenceTool.invoke(
        { ticker: "ACME" },
        new AbortController().signal,
        { ...call("my_data"), projectId: null },
      ),
      /requires an active Project scope/,
    );
  });
});
