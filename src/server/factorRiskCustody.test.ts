import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { initialTerminalScreenState, readTerminalScreenState } from "@shared/terminalArtifact";
import type { QuantInputSourceBinding } from "@shared/quantModelRegistry";
import type { FactorRiskSnapshot } from "./factorRiskModel";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-original-factor-custody-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
// Database initialization is intentionally isolated before importing server stores.
const { initDb, closeDb, getDb } = await import("./db");
const { users, datasetSnapshots, dataEntitlementPolicies } = await import("@shared/schema");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { hashLedgerValue } = await import("./ledgerStore");
const { factorRiskSnapshotContentHash } = await import("./factorRiskModel");
const { executeOriginalFactorDecomposition } = await import("./advancedQuantExecution");
const { createFactorRiskRouteHandlers } = await import("./factorRiskRoutes");
const { createProjectChat } = await import("./projectChatStore");
const { openTerminalArtifact } = await import("./terminalArtifact");
const { createTerminalArtifactEngineVersion, getArtifactVersion } = await import("./artifactStore");

test("original factor attribution retains exact source-bound numbers on P4 and revalidates dependencies", { timeout: 90_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await initDb();
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Factor author", role: "internal_analyst" as const, organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Other factor author", role: "internal_analyst" as const, organizationId: null },
  ]).returning();
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const { policy: upstreamPolicy } = await createEntitlementPolicy({ provider: "custody-fixture", dataClass: "factor_inputs", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output"], attribution: "Synthetic unit fixture only; no runtime provider grant", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
  const { policy: modelPolicy } = await createEntitlementPolicy({ provider: "factor_risk_model", dataClass: "factor_risk", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output"], attribution: "Unit fixture derived model only", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
  const sourcePayload = { ohlcv: [{ date: "2026-01-01", close: 100 }], fundamentals: { sector: "Fixture", marketCap: 1000 } };
  const lineage = { sourceRefs: ["fixture:original-factor-custody"] };
  const sourceHash = hashLedgerValue({ payload: sourcePayload, provider: "custody-fixture", lineage });
  const [upstream] = await getDb().insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey: `factor-inputs:${crypto.randomUUID()}`, entityKey: "FIXTURE", dataClass: "factor_inputs", schemaVersion: "1", source: "unit_fixture", provider: "custody-fixture", frequency: "monthly", availableAt: new Date("2026-01-01"), retrievedAt: new Date("2026-01-01"), contentHash: sourceHash, quality: {}, lineage, payload: sourcePayload, organizationId: null, createdByUserId: owner.id, entitlementPolicyId: upstreamPolicy.id }).returning();
  const sourceBinding = (field: string): QuantInputSourceBinding => ({ field, contractFamily: "factor-risk-model", connectorId: "unit-fixture", provider: "custody-fixture", priority: "primary", sourceReference: `dataset-snapshot:${upstream.id}`, asOf: "2026-01-01T00:00:00.000Z", retrievedAt: "2026-01-01T00:00:00.000Z", freshness: "historical", snapshot: { id: upstream.id, contentHash: sourceHash }, transformations: [] });
  const metadata = { symbol: "AAA", provider: "custody-fixture", status: "available", source: "unit fixture", asOf: "2026-01-01", retrievedAt: "2026-01-01T00:00:00.000Z" };
  const estimation: FactorRiskSnapshot["estimation"] = {
    factorReturnSeries: [{ periodEnd: "2025-12-31", returns: { value: 0.01 } }, { periodEnd: "2026-01-31", returns: { value: 0.10 } }],
    factorCovariance: [[0.04]], specificVariances: { AAA: 0.01 }, factorCovarianceAnnualizationPeriodsPerYear: 12,
    excludedFromSpecificVariance: [], periodsUsed: 2, excludedPeriods: [], regressionRSquaredByPeriod: {},
  };
  const snapshot: FactorRiskSnapshot = {
    snapshotId: "", contentHash: "", request: { symbols: ["AAA"], benchmarkSymbol: "BENCH", range: "1Y", asOf: "2026-01-01", scope: "local" },
    capturedAt: "2026-01-01T00:00:00.000Z", retrievalStartedAt: "2026-01-01T00:00:00.000Z", retrievalCompletedAt: "2026-01-01T00:00:00.000Z", cache: "miss",
    sources: { benchmark: { ...metadata, symbol: "BENCH", sourceBindings: [sourceBinding("ohlcv")] }, securities: { AAA: { ...metadata, sourceBindings: [sourceBinding("ohlcv"), sourceBinding("fundamentals")] } } },
    provenance: { benchmark: metadata, securities: { AAA: metadata } },
    factors: [{ id: "value", label: "Value", source: "unit fixture", asOf: "2026-01-01", units: "z-score", status: "derived" }],
    securities: [{ securityId: "AAA", exposures: { value: 0.2 }, source: "unit fixture", asOf: "2026-01-01", units: "z-score" }],
    estimation, estimator: estimation, excluded: [], limitations: ["Synthetic unit fixture, not provider acceptance"],
  };
  snapshot.provenance = snapshot.sources;
  snapshot.contentHash = factorRiskSnapshotContentHash(snapshot);
  snapshot.snapshotId = `factor-risk-${snapshot.contentHash.slice(0, 24)}`;
  await getDb().insert(datasetSnapshots).values({ id: snapshot.snapshotId, datasetKey: `factor-fixture:${crypto.randomUUID()}`, entityKey: "AAA", dataClass: "factor_risk", schemaVersion: "factor-risk-v1", source: "factor_risk_model", provider: "factor_risk_model", frequency: "on_demand", availableAt: new Date("2026-01-01"), retrievedAt: new Date("2026-01-01"), contentHash: snapshot.contentHash, quality: {}, lineage: {}, payload: snapshot as unknown as Record<string, unknown>, organizationId: null, createdByUserId: owner.id, entitlementPolicyId: modelPolicy.id, expiresAt: new Date(Date.now() + 300_000) });
  const input = { snapshotId: snapshot.snapshotId, expectedSnapshotHash: snapshot.contentHash, portfolioWeights: { AAA: 1 } };
  await assert.rejects(executeOriginalFactorDecomposition(snapshot, { ...input, expectedSnapshotHash: "0".repeat(64) }, ctx), /hash changed/);
  await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, { ...ctx, userId: stranger.id }), /author|tenant|unavailable/);
  await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, { ...ctx, organizationId: 999 }), /tenant/);
  const execution = await executeOriginalFactorDecomposition(snapshot, input, ctx);
  const output = execution.response as { result: { expectedReturn: number; risk: { factorVariance: number } }; portfolioWeights: Record<string, number> };
  assert.ok(Math.abs(output.result.expectedReturn - 0.011) < 1e-12);
  assert.ok(Math.abs(output.result.risk.factorVariance - 0.0016) < 1e-12);
  assert.deepEqual(output.portfolioWeights, { AAA: 1 });
  assert.equal(execution.receipt.modelId, "factor-risk-model");
  const recordedInput = execution.receipt.parameters.modelInput;
  assert.ok(recordedInput && typeof recordedInput === "object" && "factorReturns" in recordedInput);
  assert.deepEqual(recordedInput.factorReturns, { value: 0.055 });
  assert.equal(execution.receipt.dataClassification, "model_derived");
  const chat = await createProjectChat(ctx, { scope: "quick" });
  const screen = await openTerminalArtifact(ctx, chat.id, { requestId: crypto.randomUUID(), view: "optimizer", title: "Original factor", symbol: "AAA", state: initialTerminalScreenState("AAA"), message: "open original optimizer" });
  assert.equal(screen.version.content.kind, "screen");
  if (screen.version.content.kind !== "screen") throw new Error("Expected terminal");
  const authoredState = readTerminalScreenState(screen.version.content.state)!;
  const target = { artifactId: screen.artifact.id, baseVersion: 1, baseHash: screen.version.contentHash, slot: "portfolio.AAA.provider-decomposition", authoredState };
  await assert.rejects(createTerminalArtifactEngineVersion(ctx, target, structuredClone(execution)), /actual native execution/);
  await assert.rejects(createTerminalArtifactEngineVersion({ ...ctx, userId: stranger.id }, target, execution), /actor/);
  const saved = await createTerminalArtifactEngineVersion(ctx, target, execution);
  assert.equal(saved.artifactId, screen.artifact.id);
  assert.equal(saved.version, 2);
  assert.ok(saved.sourceRefs.includes(`dataset-snapshot:${upstream.id}`));
  await assert.rejects(createTerminalArtifactEngineVersion(ctx, target, execution), /changed|current/);
  await closeDb(); await initDb();
  assert.deepEqual((await getArtifactVersion(ctx, saved.artifactId, 2)).content, saved.content, "Exact receipt, weights, sources and numerical output reopen without executing the model");

  await t.test("current upstream policy revocation blocks replay and execution", async () => {
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display"] }).where(eq(dataEntitlementPolicies.id, upstreamPolicy.id));
    await assert.rejects(getArtifactVersion(ctx, saved.artifactId, 2), /policy|licence/);
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /policy|licence/);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["display", "model_input", "derived_output"], effectiveTo: new Date("2020-01-01") }).where(eq(dataEntitlementPolicies.id, upstreamPolicy.id));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /policy|licence/);
    await getDb().update(dataEntitlementPolicies).set({ effectiveTo: null }).where(eq(dataEntitlementPolicies.id, upstreamPolicy.id));
  });
  await t.test("missing upstream policy and expired upstream snapshots fail closed", async () => {
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, upstream.id));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /authoritative entitlement policy/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: upstreamPolicy.id, expiresAt: new Date("2020-01-01") }).where(eq(datasetSnapshots.id, upstream.id));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /expired/);
    await getDb().update(datasetSnapshots).set({ expiresAt: null }).where(eq(datasetSnapshots.id, upstream.id));
  });
  await t.test("missing root policy and expired model cache fail closed", async () => {
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, snapshot.snapshotId));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /authoritative entitlement policy/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: modelPolicy.id, expiresAt: new Date("2020-01-01") }).where(eq(datasetSnapshots.id, snapshot.snapshotId));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /expired/);
    await getDb().update(datasetSnapshots).set({ expiresAt: new Date(Date.now() + 300_000) }).where(eq(datasetSnapshots.id, snapshot.snapshotId));
  });
  await t.test("upstream content tampering cannot keep the old hash", async () => {
    await getDb().update(datasetSnapshots).set({ payload: { ohlcv: [999] } }).where(eq(datasetSnapshots.id, upstream.id));
    await assert.rejects(executeOriginalFactorDecomposition(snapshot, input, ctx), /immutable content hash/);
    await getDb().update(datasetSnapshots).set({ payload: sourcePayload }).where(eq(datasetSnapshots.id, upstream.id));
  });
  await t.test("legacy captures with only provider labels cannot mint retained rights", async () => {
    const legacy = structuredClone(snapshot);
    delete legacy.sources.benchmark.sourceBindings;
    delete legacy.sources.securities.AAA.sourceBindings;
    legacy.contentHash = factorRiskSnapshotContentHash(legacy);
    legacy.snapshotId = `factor-risk-${legacy.contentHash.slice(0, 24)}`;
    const [base] = await getDb().select().from(datasetSnapshots).where(eq(datasetSnapshots.id, snapshot.snapshotId));
    await getDb().insert(datasetSnapshots).values({ ...base, id: legacy.snapshotId, datasetKey: `legacy-fixture:${crypto.randomUUID()}`, contentHash: legacy.contentHash, payload: legacy as unknown as Record<string, unknown> });
    await assert.rejects(executeOriginalFactorDecomposition(legacy, { ...input, snapshotId: legacy.snapshotId, expectedSnapshotHash: legacy.contentHash }, ctx), /lacks immutable upstream/);
  });
  await t.test("original standalone preview stays available without claiming P4 retention", async () => {
    const handlers = createFactorRiskRouteHandlers({ getFactorRiskSnapshot: async () => snapshot } as never);
    let status = 200;
    let response: Record<string, unknown> = {};
    const res = { status(code: number) { status = code; return this; }, json(body: Record<string, unknown>) { response = body; return this; } };
    await handlers.decomposeHandler({ body: input } as never, res as never);
    assert.equal(status, 200);
    assert.deepEqual(response.portfolioWeights, input.portfolioWeights);
    assert.equal(response.terminalArtifact, undefined);
    assert.equal(response.receipt, undefined);
    await handlers.decomposeHandler({ body: { ...input, expectedSnapshotHash: "0".repeat(64) } } as never, res as never);
    assert.equal(status, 409);
  });
  await t.test("original route writes the selected same-P4 target and rejects stale submissions", async () => {
    const handlers = createFactorRiskRouteHandlers({ getFactorRiskSnapshot: async () => snapshot } as never);
    let status = 200;
    let response: Record<string, unknown> = {};
    const res = { status(code: number) { status = code; return this; }, json(body: Record<string, unknown>) { response = body; return this; } };
    const currentTarget = { ...target, baseVersion: saved.version, baseHash: saved.contentHash };
    await handlers.decomposeHandler({ user: owner, body: { ...input, terminalArtifact: { ...currentTarget, baseHash: "0".repeat(64) } } } as never, res as never);
    assert.equal(status, 409);
    status = 200;
    await handlers.decomposeHandler({ user: owner, body: { ...input, terminalArtifact: currentTarget } } as never, res as never);
    assert.equal(status, 200, JSON.stringify(response));
    assert.deepEqual(response.portfolioWeights, input.portfolioWeights);
    const version = response.terminalArtifact;
    assert.ok(version && typeof version === "object" && "artifactId" in version && "version" in version);
    assert.equal(version.artifactId, saved.artifactId);
    assert.equal(version.version, 3);
    await handlers.decomposeHandler({ user: owner, body: { ...input, terminalArtifact: currentTarget } } as never, res as never);
    assert.equal(status, 409);
  });
});
