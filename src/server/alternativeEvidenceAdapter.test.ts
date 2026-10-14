import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-alt-private-evidence-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { captureAlternativeDataset } = await import("./alternativeDatasetStore");
const {
  alternativeEvidenceRightsFromPolicy,
  blockReasonForAlternativeEvidence,
  buildNormalizedAlternativeEvidence,
} = await import("./alternativeEvidenceAdapter");
const {
  alternativeEvidenceTool,
  alternativeEvidenceToolOutputSchema,
} = await import("./alternativeEvidenceTool");

test("SI-03.30 normalizes private and alternative evidence with fail-closed rights", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    name: "Alternative evidence owner",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(tenant, { name: "Alternative Evidence Project" });

  await t.test("reviewed model-input policy permits AI transmission while unreviewed policy stays unknown", () => {
    const reviewed = {
      id: "policy:reviewed",
      reviewedAt: new Date("2026-10-01T00:00:00.000Z"),
      permittedUses: ["display", "internal_research", "model_input", "derived_output"],
      accessScope: "internal_only",
      redistribution: "restricted",
      attribution: "Licensed internal dataset",
    } as any;
    const rights = alternativeEvidenceRightsFromPolicy(reviewed);
    assert.equal(rights.entitlement.decision, "allowed");
    assert.equal(rights.internalUse, "permitted");
    assert.equal(rights.aiTransmission, "permitted");
    assert.equal(rights.redistribution, "restricted");
    assert.equal(blockReasonForAlternativeEvidence(rights), null);

    const unreviewed = alternativeEvidenceRightsFromPolicy({ ...reviewed, reviewedAt: null } as any);
    assert.equal(unreviewed.entitlement.decision, "unknown");
    assert.equal(unreviewed.aiTransmission, "unknown");
    assert.equal(unreviewed.internalUse, "unknown");
    assert.equal(blockReasonForAlternativeEvidence(unreviewed), "entitlement_unknown");
  });

  await t.test("private-series snapshot preserves provenance and bounded preview without inventing market identity", () => {
    const snapshot = {
      id: "snap-private-1",
      datasetKey: "private_series:1:NORTHWIND PRIVATE LTD",
      entityKey: "NORTHWIND PRIVATE LTD",
      dataClass: "private_series",
      schemaVersion: "1.0.0",
      source: "user_upload",
      provider: "user_supplied",
      frequency: "monthly",
      currency: "USD",
      timezone: "UTC",
      observationStart: "2026-01-31",
      observationEnd: "2026-03-31",
      effectiveAt: "2026-03-31T00:00:00.000Z",
      publishedAt: null,
      retrievedAt: "2026-04-05T00:00:00.000Z",
      availableAt: "2026-04-05T00:00:00.000Z",
      contentHash: "a".repeat(64),
      parentSnapshotId: "snap-private-0",
      quality: { score: 1, recordCount: 3, missingOptionalFields: 0 },
      lineage: { uploadRef: "upload:1", sheet: "KPIs" },
      payload: {
        seriesId: "monthly-arr",
        name: "Monthly ARR",
        unit: "USD",
        frequency: "monthly",
        dimensions: { geography: "global" },
        observations: [
          { observationAt: "2026-01-31T00:00:00.000Z", value: 100, availableAt: "2026-02-05T00:00:00.000Z" },
          { observationAt: "2026-02-28T00:00:00.000Z", value: 110, availableAt: "2026-03-05T00:00:00.000Z" },
          { observationAt: "2026-03-31T00:00:00.000Z", value: 120, availableAt: "2026-04-05T00:00:00.000Z" },
        ],
      },
      entitlementPolicyId: "policy:reviewed",
      organizationId: 1,
      createdByUserId: user.id,
      createdAt: "2026-04-05T00:00:00.000Z",
      expiresAt: null,
    } as any;
    const policy = {
      id: "policy:reviewed",
      reviewedAt: new Date("2026-04-01T00:00:00.000Z"),
      permittedUses: ["internal_research", "model_input"],
      accessScope: "internal_only",
      redistribution: "restricted",
      attribution: "User-supplied private series",
    } as any;
    const evidence = buildNormalizedAlternativeEvidence({
      snapshot,
      policy,
      identity: {
        state: "resolved",
        queryKind: "name",
        entityKey: "NORTHWIND PRIVATE LTD",
        entityId: "lios:entity:42",
        securityId: null,
        listingId: null,
        name: "Northwind Private Ltd",
      },
      previewLimit: 2,
    });
    assert.equal(evidence.evidenceClass, "private_market");
    assert.equal(evidence.identity.entityId, "lios:entity:42");
    assert.equal(evidence.identity.securityId, null);
    assert.equal(evidence.identity.listingId, null);
    assert.equal(evidence.provenance.contentHash, "a".repeat(64));
    assert.equal(evidence.parentSnapshotRef, "snapshot:snap-private-0");
    assert.equal(evidence.preview.totalRecords, 3);
    assert.equal(evidence.preview.shownRecords, 2);
    assert.equal(evidence.preview.truncated, true);
    assert.match(evidence.preview.text, /Monthly ARR/);
    assert.match(evidence.preview.text, /2026-03-31T00:00:00.000Z \| 120 USD/);
    assert.equal(/ticker|valuation|price target/i.test(evidence.preview.text), false);
  });

  await t.test("model-facing tool returns only reviewed+model-input evidence and aggregates blocked sources", async () => {
    await createEntitlementPolicy({
      provider: "permitted_alt",
      dataClass: "commodity_curve",
      licenseType: "commercial",
      accessScope: "internal_only",
      redistribution: "restricted",
      permittedUses: ["display", "internal_research", "model_input", "derived_output"],
      attribution: "Licensed internal commodity data",
      termsUrl: null,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      reviewedAt: "2026-01-02T00:00:00.000Z",
      notes: "Reviewed for model input.",
    }, user.id);

    const permitted = await captureAlternativeDataset({
      dataClass: "commodity_curve",
      entityKey: "BRENT",
      source: "licensed_curve",
      provider: "permitted_alt",
      frequency: "daily",
      timezone: "UTC",
      currency: "USD",
      effectiveAt: "2026-10-01T00:00:00.000Z",
      publishedAt: "2026-10-01T00:00:00.000Z",
      retrievedAt: "2026-10-01T01:00:00.000Z",
      availableAt: "2026-10-01T01:00:00.000Z",
      organizationId: null,
      lineage: { endpoint: "/curve" },
      payload: {
        commodity: "Brent",
        points: [{
          contract: "BRZ6",
          deliveryStart: null,
          expiry: "2026-12-31",
          observationAt: "2026-10-01T00:00:00.000Z",
          price: 75,
          settlementType: "settlement",
          unit: "barrel",
          currency: "USD",
          exchange: "ICE",
          openInterest: 1000,
          volume: 100,
        }],
      },
    }, user.id);

    const blocked = await captureAlternativeDataset({
      dataClass: "commodity_curve",
      entityKey: "WTI",
      source: "pending_curve",
      provider: "pending_alt",
      frequency: "daily",
      timezone: "UTC",
      currency: "USD",
      effectiveAt: "2026-10-01T00:00:00.000Z",
      publishedAt: null,
      retrievedAt: "2026-10-01T01:00:00.000Z",
      availableAt: "2026-10-01T01:00:00.000Z",
      organizationId: null,
      lineage: { endpoint: "/pending" },
      payload: {
        commodity: "WTI",
        points: [{
          contract: "CLZ6",
          deliveryStart: null,
          expiry: "2026-12-20",
          observationAt: "2026-10-01T00:00:00.000Z",
          price: 70,
          settlementType: "settlement",
          unit: "barrel",
          currency: "USD",
          exchange: "NYMEX",
          openInterest: 900,
          volume: 90,
        }],
      },
    }, user.id);

    const result = alternativeEvidenceToolOutputSchema.parse(await alternativeEvidenceTool.invoke(
      {
        dataClasses: ["commodity_curve"],
        limitPerClass: 10,
        previewRecords: 5,
      },
      new AbortController().signal,
      {
        source: "agent",
        userId: user.id,
        tenant,
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "auto",
      },
    ));

    assert.equal(result.output.included.length, 1);
    assert.equal(result.output.included[0].snapshotRef, `snapshot:${permitted.snapshot.id}`);
    assert.equal(result.output.included[0].providerId, "permitted_alt");
    assert.equal(result.output.included[0].rights.aiTransmission, "permitted");
    assert.equal(result.output.counts.blocked, 1);
    assert.equal(result.output.counts.byBlockReason.entitlement_unknown, 1);
    assert.equal(JSON.stringify(result).includes(blocked.snapshot.id), false);
    assert.equal(JSON.stringify(result).includes("pending_alt"), false);
    assert.equal(JSON.stringify(result).includes("pending_curve"), false);
    assert.equal(result.output.dataFetchPerformed, false);
    assert.equal(result.output.providerNetworkUsed, false);
  });

  await t.test("server-owned source selection is enforced before model-visible output", async () => {
    const result = alternativeEvidenceToolOutputSchema.parse(await alternativeEvidenceTool.invoke(
      {
        dataClasses: ["commodity_curve"],
        limitPerClass: 10,
        previewRecords: 5,
      },
      new AbortController().signal,
      {
        source: "agent",
        userId: user.id,
        tenant,
        projectId: project.id,
        requestId: crypto.randomUUID(),
        sourceScope: "auto",
        allowedSourceRefs: ["snapshot:not-selected"],
      },
    ));
    assert.equal(result.output.included.length, 0);
    assert.ok((result.output.counts.byBlockReason.source_policy_denied ?? 0) >= 1);
    assert.deepEqual(result.sourceRefs, []);
  });
});
