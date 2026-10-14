import test from "node:test";
import assert from "node:assert/strict";
import type { ArtifactModelMaintenanceReview, ArtifactModelMaintenanceResult, ArtifactModelMaintenanceTarget } from "@shared/artifactModelMaintenance";
import type { IntegratedModelAssumptions } from "@shared/integratedFinancialModel";
import { ArtifactModelMaintenanceReviewSession, initialModelMaintenanceReviewState } from "./artifactModelMaintenanceReview";
import type { ModelMaintenanceContext, ModelMaintenanceReviewState } from "./artifactModelMaintenanceReview";

const context: ModelMaintenanceContext = { artifactId: "model", projectId: 7, version: 3, headVersion: 3, contentHash: "a".repeat(64), available: true };
const target: ArtifactModelMaintenanceTarget = { id: "new-owned-snapshot", contentHash: "b".repeat(64), symbol: "ACME", currency: "USD", availableAt: "2026-10-08T12:00:00.000Z", provider: "owned-import", source: "reported", periods: [{ fiscalYear: "2026", period: "FY", periodEnd: "2026-09-30" }], entitlementPolicyId: "policy", entitlementPolicyHash: "c".repeat(64) };
const assumptions: IntegratedModelAssumptions = {
  projectionYears: 5, revenueGrowth: 0.08000000000001, usePriceVolumeDrivers: false, priceGrowth: 0.03, volumeGrowth: 0.02,
  cogsPercentRevenue: 0.6, sgaPercentRevenue: 0.15, taxRate: 0.21, openingNol: 0, nolUtilizationLimit: 0.8,
  dso: 40, dio: 30, dpo: 45, capexPercentRevenue: 0.04, depreciationPercentRevenue: 0.03, interestRate: 0.05,
  minimumCashPercentRevenue: 0.02, dividendPayout: 0.2, leaseAdditionsPercentRevenue: 0.01, leaseAssetAmortizationRate: 0.2,
  leaseInterestRate: 0.05, leasePrincipalRepaymentRate: 0.2, stockCompPercentRevenue: 0.01, stockCompDilutionPercent: 0.005,
  buybackPercentRevenue: 0.01, sharePrice: 125, sharePriceGrowth: 0.02, circularMaxIterations: 100, circularTolerance: 0.0000001,
};
const review: ArtifactModelMaintenanceReview = { artifactId: context.artifactId, version: context.version, contentHash: context.contentHash, targetDatasetSnapshotId: target.id, targetContentHash: target.contentHash,
  reviewHash: "d".repeat(64), engineRev: "2026-10-08", source: { runId: "old-run", datasetSnapshotId: "old-snapshot", datasetContentHash: "e".repeat(64), periods: [{ fiscalYear: "2025", period: "FY", periodEnd: "2025-09-30" }] }, target,
  assumptions, schedules: { segments: [], pension: null, associates: [], minority: null, transaction: null }, inputHash: "f".repeat(64),
  changes: [{ kind: "added", periodKey: "2026:FY", path: "revenue", before: null, after: 123.0000000000001, oldSourceHash: "", newSourceHash: "g".repeat(64) }],
  preservedCells: [{ sheetId: "assumptions", cell: "B2", raw: "=0.08000000000001", format: "0.00%", reason: "formula" }], sourceRefs: ["dataset:new-owned-snapshot"],
};
const date = new Date("2026-10-08T12:00:00.000Z");
const result: ArtifactModelMaintenanceResult = {
  review,
  artifact: { id: context.artifactId, projectId: context.projectId, ownerUserId: 11, organizationId: null, kind: "spreadsheet", title: "Existing model", status: "active", origin: "engine", headVersion: 4, forkedFromArtifactId: null, forkedFromVersion: null, createdAt: date, updatedAt: date, archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null },
  version: { id: "new-model-version", artifactId: context.artifactId, version: 4, parentVersionId: "old-model-version", adapterId: "lios.spreadsheet", content: { kind: "spreadsheet", sheets: [{ id: "assumptions", name: "Assumptions", cells: {}, names: {}, rowCount: 40, columnCount: 2 }], activeSheetId: "assumptions", rendererPreference: "builtin", calculationMode: "automatic" }, contentHash: "h".repeat(64), sourceRefs: review.sourceRefs, executionReceiptIds: [], assumptionRefs: [], trustManifest: null, dependencyRefs: [], refreshSpec: null, note: null, createdByUserId: 11, createdAt: date },
  receipt: { runId: "new-run", resultHash: "i".repeat(64), datasetSnapshotId: target.id, datasetContentHash: target.contentHash, reviewHash: review.reviewHash, replayed: false },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function harness(transport: ConstructorParameters<typeof ArtifactModelMaintenanceReviewSession>[1]) {
  let current = { ...context }, state: ModelMaintenanceReviewState = initialModelMaintenanceReviewState;
  const publications: ModelMaintenanceReviewState[] = [];
  const session = new ArtifactModelMaintenanceReviewSession(() => current, transport, next => { state = next; publications.push(next); });
  return { session, state: () => state, publications, setContext: (next: ModelMaintenanceContext) => { current = next; } };
}

test("explicit snapshot selection and exact review are required; apply updates only the existing model", async () => {
  const requests: unknown[] = [];
  const h = harness({ review: async (id, input) => { requests.push({ review: id, input }); return review; }, apply: async (id, input) => { requests.push({ apply: id, input }); return result; } });
  h.session.reconcile();
  await h.session.review();
  await h.session.apply();
  assert.equal(requests.length, 0);
  h.session.select(target);
  assert.equal(requests.length, 0);
  await h.session.review();
  assert.equal(h.state().review?.changes[0].after, 123.0000000000001);
  assert.equal(h.state().review?.preservedCells[0].raw, "=0.08000000000001");
  assert.equal(requests.length, 1);
  await h.session.apply();
  assert.deepEqual(requests[1], { apply: "model", input: { version: 3, contentHash: context.contentHash, targetDatasetSnapshotId: target.id, targetContentHash: target.contentHash, reviewHash: review.reviewHash } });
  assert.equal(h.state().result?.artifact.id, "model");
  assert.equal(h.state().result?.version.version, 4);
  await h.session.apply();
  assert.equal(requests.length, 2, "successful review is consumed, not automatically resumed");
});

test("snapshot selection changes invalidate pending and completed reviews, including same id with different hash", async () => {
  const pending = deferred<ArtifactModelMaintenanceReview>();
  let applies = 0;
  const h = harness({ review: () => pending.promise, apply: async () => { applies++; return result; } });
  h.session.select(target);
  const request = h.session.review();
  h.session.select({ ...target, contentHash: "replacement-hash" });
  pending.resolve(review);
  await request;
  assert.equal(h.state().review, null);
  assert.equal(h.state().selected?.contentHash, "replacement-hash");
  await h.session.apply();
  assert.equal(applies, 0);
});

test("head, content, author availability and local draft changes block stale apply even before effect reconciliation", async () => {
  for (const changed of [{ ...context, headVersion: 4 }, { ...context, contentHash: "changed" }, { ...context, available: false }]) {
    let applies = 0;
    const h = harness({ review: async () => review, apply: async () => { applies++; return result; } });
    h.session.select(target);
    await h.session.review();
    h.setContext(changed);
    await h.session.apply();
    assert.equal(h.state().review, null);
    assert.equal(applies, 0);
  }
});

test("wrong target or head response never becomes applicable", async () => {
  for (const invalid of [{ ...review, contentHash: "wrong-head" }, { ...review, targetContentHash: "wrong-target" }, { ...review, target: { ...target, id: "other" } }]) {
    let applies = 0;
    const h = harness({ review: async () => invalid, apply: async () => { applies++; return result; } });
    h.session.select(target);
    await h.session.review();
    assert.match(h.state().error!, /does not match/);
    await h.session.apply();
    assert.equal(applies, 0);
  }
});

test("in-flight apply stays locked after a revision change and cannot be resumed or duplicated", async () => {
  const pending = deferred<ArtifactModelMaintenanceResult>();
  let applies = 0;
  const h = harness({ review: async () => review, apply: () => { applies++; return pending.promise; } });
  h.session.select(target);
  await h.session.review();
  const request = h.session.apply();
  h.setContext({ ...context, headVersion: 4 });
  h.session.reconcile();
  h.session.select(target);
  await h.session.apply();
  await h.session.review();
  assert.equal(h.state().pending, "apply");
  assert.equal(applies, 1);
  pending.resolve(result);
  await request;
  assert.equal(h.state().pending, null);
  assert.equal(h.state().review, null);
  assert.equal(h.state().result, null);
});

test("unmounted inspector never publishes late review or apply responses", async () => {
  for (const phase of ["review", "apply"] as const) {
    const pendingReview = deferred<ArtifactModelMaintenanceReview>(), pendingApply = deferred<ArtifactModelMaintenanceResult>();
    const h = harness({ review: () => phase === "review" ? pendingReview.promise : Promise.resolve(review), apply: () => pendingApply.promise });
    h.session.select(target);
    const reviewing = h.session.review();
    if (phase === "apply") await reviewing;
    const request = phase === "apply" ? h.session.apply() : reviewing;
    h.session.dispose();
    const count = h.publications.length;
    if (phase === "review") pendingReview.resolve(review); else pendingApply.resolve(result);
    await request;
    assert.equal(h.publications.length, count);
  }
});

test("uncertain apply failure consumes review without automatic retry", async () => {
  let applies = 0;
  const h = harness({ review: async () => review, apply: async () => { applies++; throw new Error("Connection lost after submission; inspect saved history."); } });
  h.session.select(target);
  await h.session.review();
  await h.session.apply();
  assert.match(h.state().error!, /Connection lost/);
  assert.equal(h.state().review, null);
  await h.session.apply();
  assert.equal(applies, 1);
});

test("a new Artifact, wrong version, changed engine inputs or mismatched receipt cannot claim a same-model update", async () => {
  for (const invalid of [
    { ...result, artifact: { ...result.artifact, id: "another-artifact" } },
    { ...result, version: { ...result.version, version: 5 } },
    { ...result, review: { ...review, inputHash: "unreviewed-inputs" } },
    { ...result, receipt: { ...result.receipt, datasetContentHash: "another-snapshot" } },
  ]) {
    const h = harness({ review: async () => review, apply: async () => invalid });
    h.session.select(target);
    await h.session.review();
    await h.session.apply();
    assert.equal(h.state().result, null);
    assert.equal(h.state().review, null);
    assert.match(h.state().error!, /one new version of this existing model/);
  }
});
