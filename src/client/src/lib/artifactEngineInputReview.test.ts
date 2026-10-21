import test from "node:test";
import assert from "node:assert/strict";
import { ArtifactEngineInputReviewSession, initialEngineInputReviewState, isIntegratedModelWorkbook } from "./artifactEngineInputReview";
import type { EngineInputRevision, EngineInputReviewState } from "./artifactEngineInputReview";
import type { ArtifactDetail, IntegratedModelArtifactRunResult, IntegratedModelInputReview } from "./useArtifacts";

const revision: EngineInputRevision = { artifactId: "source-workbook", projectId: 7, version: 3, headVersion: 3, contentHash: "a".repeat(64) };
const preview: IntegratedModelInputReview = {
  artifactId: revision.artifactId, version: revision.version, contentHash: revision.contentHash,
  reviewHash: "b".repeat(64), engineRev: "2026-10-08",
  source: { runId: "recorded-run", runResultHash: "c".repeat(64), datasetSnapshotId: "frozen-dataset", datasetContentHash: "d".repeat(64), entitlementPolicyId: "recorded-policy", entitlementPolicyHash: "e".repeat(64) },
  assumptions: {
    projectionYears: 5, revenueGrowth: 0.08000000000001, usePriceVolumeDrivers: false, priceGrowth: 0.03, volumeGrowth: 0.02,
    cogsPercentRevenue: 0.6, sgaPercentRevenue: 0.15, taxRate: 0.21, openingNol: 0, nolUtilizationLimit: 0.8,
    dso: 40, dio: 30, dpo: 45, capexPercentRevenue: 0.04, depreciationPercentRevenue: 0.03, interestRate: 0.05,
    minimumCashPercentRevenue: 0.02, dividendPayout: 0.2, leaseAdditionsPercentRevenue: 0.01, leaseAssetAmortizationRate: 0.2,
    leaseInterestRate: 0.05, leasePrincipalRepaymentRate: 0.2, stockCompPercentRevenue: 0.01, stockCompDilutionPercent: 0.005,
    buybackPercentRevenue: 0.01, sharePrice: 125, sharePriceGrowth: 0.02, circularMaxIterations: 100, circularTolerance: 0.0000001,
  },
  schedules: { segments: [], pension: null, associates: [], minority: null, transaction: null },
  changedFields: [{ sheetId: "assumptions", cell: "B2", path: "revenueGrowth", before: 0.05, after: 0.08000000000001 }],
  sourceRefs: ["source:frozen-dataset"], inputHash: "f".repeat(64),
};
const output: ArtifactDetail = {
  artifact: {
    id: revision.artifactId, projectId: 7, ownerUserId: 11, organizationId: null, kind: "spreadsheet", title: "Reviewed scenario output",
    status: "active", origin: "engine", headVersion: revision.version + 1, forkedFromArtifactId: null, forkedFromVersion: null,
    createdAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z", archivedAt: null,
    trashedAt: null, trashedByProjectId: null, trashedFromStatus: null,
  },
  version: {
    id: "canonical-output-version", artifactId: revision.artifactId, version: revision.version + 1, parentVersionId: null, adapterId: "lios.spreadsheet",
    content: { kind: "spreadsheet", sheets: [{ id: "assumptions", name: "Assumptions", cells: {}, names: {}, rowCount: 40, columnCount: 2 }], activeSheetId: "assumptions", rendererPreference: "builtin", calculationMode: "automatic" },
    contentHash: "0".repeat(64), sourceRefs: preview.sourceRefs, executionReceiptIds: [], assumptionRefs: [], trustManifest: null, dependencyRefs: [],
    refreshSpec: { kind: "engine", sourceScope: "auto", executionMode: "deterministic_first", capabilityIds: [], message: null, selection: null, engineRef: "integrated_financial_model:2026-10-08:run:new-run" },
    note: null, createdByUserId: 11, createdAt: "2026-10-08T12:00:00.000Z",
  },
};
const result: IntegratedModelArtifactRunResult = {
  review: preview, outputArtifact: output.artifact, outputVersion: output.version,
  receipt: { runId: "new-run", resultHash: "1".repeat(64), datasetSnapshotId: preview.source.datasetSnapshotId, datasetContentHash: preview.source.datasetContentHash, inputHash: preview.inputHash, calculatedAt: "2026-10-08T12:00:00.000Z", deterministic: true },
  lineage: { modelInput: null },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function harness(transport: ConstructorParameters<typeof ArtifactEngineInputReviewSession>[1]) {
  let current = { ...revision };
  let state: EngineInputReviewState = initialEngineInputReviewState;
  const publications: EngineInputReviewState[] = [];
  const session = new ArtifactEngineInputReviewSession(() => current, transport, (next) => { state = next; publications.push(next); });
  return { session, publications, state: () => state, setRevision: (next: EngineInputRevision) => { current = next; } };
}

test("actual integrated spreadsheet engine provenance enables review, not templates or other refresh kinds", () => {
  assert.equal(isIntegratedModelWorkbook(output), true);
  assert.equal(isIntegratedModelWorkbook({ ...output, version: { ...output.version, refreshSpec: null } }), false);
  assert.equal(isIntegratedModelWorkbook({ ...output, version: { ...output.version, refreshSpec: { ...output.version.refreshSpec!, kind: "manual" } } }), false);
  assert.equal(isIntegratedModelWorkbook({ ...output, version: { ...output.version, refreshSpec: { ...output.version.refreshSpec!, engineRef: "integrated_financial_model:template" } } }), false);
  assert.equal(isIntegratedModelWorkbook({ ...output, version: { ...output.version, content: { kind: "table", columns: [], rows: [] } } }), false);
});

test("review and revision refresh do not execute; only explicit run submits captured version and both server hashes", async () => {
  const reviewRequests: Array<{ artifactId: string; version: number }> = [];
  const runRequests: Array<{ artifactId: string; input: { version: number; contentHash: string; reviewHash: string } }> = [];
  const h = harness({
    review: async (artifactId, version) => { reviewRequests.push({ artifactId, version }); return preview; },
    run: async (artifactId, input) => { runRequests.push({ artifactId, input }); return result; },
  });
  h.session.reconcileRevision();
  assert.equal(runRequests.length, 0);
  await h.session.run();
  assert.match(h.state().error!, /Review the current saved engine inputs/);
  assert.equal(runRequests.length, 0);
  await h.session.review();
  assert.deepEqual(reviewRequests, [{ artifactId: revision.artifactId, version: 3 }]);
  assert.equal(h.state().review?.assumptions.revenueGrowth, 0.08000000000001);
  assert.deepEqual(h.state().review?.changedFields, preview.changedFields);
  assert.equal(runRequests.length, 0);
  await h.session.run();
  assert.deepEqual(runRequests, [{ artifactId: revision.artifactId, input: { version: 3, contentHash: preview.contentHash, reviewHash: preview.reviewHash } }]);
  assert.equal(h.state().result?.outputArtifact.id, revision.artifactId);
  assert.equal(h.state().result?.receipt.runId, "new-run");
  assert.equal(h.state().review, null);
  await h.session.run();
  assert.equal(runRequests.length, 1, "completed review is consumed; another run needs an explicit review");
});

test("synchronous duplicate review and run clicks share no second transport request", async () => {
  const reviewing = deferred<IntegratedModelInputReview>();
  const running = deferred<IntegratedModelArtifactRunResult>();
  let reviews = 0, runs = 0;
  const h = harness({ review: () => { reviews++; return reviewing.promise; }, run: () => { runs++; return running.promise; } });
  const firstReview = h.session.review();
  await h.session.review();
  await h.session.run();
  assert.equal(reviews, 1);
  assert.equal(runs, 0);
  assert.equal(h.state().pending, "review");
  reviewing.resolve(preview);
  await firstReview;
  const firstRun = h.session.run();
  await h.session.run();
  await h.session.review();
  h.session.dismissReview();
  assert.equal(runs, 1);
  assert.equal(reviews, 1);
  assert.equal(h.state().pending, "run", "dismissing a review cannot claim to cancel server execution");
  running.resolve(result);
  await firstRun;
  assert.equal(h.state().result?.outputVersion.artifactId, revision.artifactId);
});

test("review response for a different version or content hash never becomes runnable", async () => {
  for (const bad of [{ ...preview, version: 2 }, { ...preview, contentHash: "changed" }, { ...preview, artifactId: "other" }]) {
    let runs = 0;
    const h = harness({ review: async () => bad, run: async () => { runs++; return result; } });
    await h.session.review();
    assert.match(h.state().error!, /does not match this saved revision/);
    assert.equal(h.state().review, null);
    await h.session.run();
    assert.equal(runs, 0);
  }
});

test("new head and same-version content changes invalidate reviewed inputs without auto-review or auto-run", async () => {
  for (const next of [{ ...revision, headVersion: 4 }, { ...revision, version: 4, headVersion: 4 }, { ...revision, contentHash: "changed-content" }]) {
    let reviews = 0, runs = 0;
    const h = harness({ review: async () => { reviews++; return preview; }, run: async () => { runs++; return result; } });
    await h.session.review();
    h.setRevision(next);
    h.session.reconcileRevision();
    assert.equal(h.state().review, null);
    assert.match(h.state().error!, /revision changed/);
    await h.session.run();
    assert.equal(reviews, 1);
    assert.equal(runs, 0);
  }
});

test("non-head saved version is denied before any preview or run request", async () => {
  let requests = 0;
  const h = harness({ review: async () => { requests++; return preview; }, run: async () => { requests++; return result; } });
  h.setRevision({ ...revision, headVersion: 4 });
  await h.session.review();
  assert.match(h.state().error!, /not the current Artifact head/);
  assert.equal(requests, 0);
});

test("pending previous Artifact preview cannot replace a new Artifact review or publish its late error", async () => {
  for (const fail of [false, true]) {
    const old = deferred<IntegratedModelInputReview>();
    const nextRevision = { ...revision, artifactId: "next-source", projectId: 8, contentHash: "new-source-hash" };
    const nextPreview = { ...preview, artifactId: nextRevision.artifactId, contentHash: nextRevision.contentHash, reviewHash: "next-review-hash" };
    const h = harness({ review: (id) => id === revision.artifactId ? old.promise : Promise.resolve(nextPreview), run: async () => result });
    const oldRequest = h.session.review();
    h.setRevision(nextRevision);
    h.session.reconcileRevision();
    await h.session.review();
    if (fail) old.reject(new Error("late previous Artifact failure")); else old.resolve(preview);
    await oldRequest;
    assert.equal(h.state().review?.artifactId, "next-source");
    assert.equal(h.state().review?.reviewHash, "next-review-hash");
    assert.equal(h.state().error, null);
  }
});

test("head change during preview decoding ignores that response even before the revision effect reconciles", async () => {
  const pending = deferred<IntegratedModelInputReview>();
  const h = harness({ review: () => pending.promise, run: async () => result });
  const request = h.session.review();
  h.setRevision({ ...revision, version: 4, headVersion: 4, contentHash: "next-hash" });
  pending.resolve(preview);
  await request;
  assert.equal(h.state().pending, null);
  assert.equal(h.state().review, null);
  assert.match(h.state().error!, /revision changed/);
});

test("dismissed preview cannot resurrect a review, and inspector disposal ignores a late completed run", async () => {
  const pending = deferred<IntegratedModelInputReview>();
  let runs = 0;
  const h = harness({ review: () => pending.promise, run: async () => { runs++; return result; } });
  const request = h.session.review();
  h.session.dismissReview();
  pending.resolve(preview);
  await request;
  assert.equal(h.state().review, null);
  assert.equal(h.state().pending, null);
  assert.equal(runs, 0);
  const running = deferred<IntegratedModelArtifactRunResult>();
  const other = harness({ review: async () => preview, run: () => running.promise });
  await other.session.review();
  const run = other.session.run();
  const publishedBeforeDisposal = other.publications.length;
  other.session.dispose();
  running.resolve(result);
  await run;
  assert.equal(other.publications.length, publishedBeforeDisposal);
  assert.equal(other.state().result, null, "detached response must not open an output in another inspector");
});

test("server stale-head or rights errors remain visible, consume review, and are never automatically retried", async () => {
  for (const message of ["409: Artifact head changed", "403: Source model_input permission was revoked"]) {
    let runs = 0;
    const h = harness({ review: async () => preview, run: async () => { runs++; throw new Error(message); } });
    await h.session.review();
    await h.session.run();
    assert.equal(h.state().error, message);
    assert.equal(h.state().review, null);
    assert.equal(h.state().result, null);
    h.session.reconcileRevision();
    assert.equal(h.state().error, message);
    assert.equal(runs, 1);
    await h.session.run();
    assert.equal(runs, 1);
  }
});

test("recomputed output must advance the same canonical Artifact within the captured Project and review", async () => {
  const invalid = [
    { ...result, review: { ...preview, reviewHash: "different-review" } },
    { ...result, outputArtifact: { ...output.artifact, projectId: 8 } },
    { ...result, outputArtifact: { ...output.artifact, id: "unrelated-artifact" } },
    { ...result, outputVersion: { ...output.version, artifactId: "unrelated-output" } },
    { ...result, receipt: { ...result.receipt, runId: preview.source.runId } },
  ];
  for (const response of invalid) {
    const h = harness({ review: async () => preview, run: async () => response });
    await h.session.review();
    await h.session.run();
    assert.equal(h.state().result, null);
  }
  assert.equal(revision.artifactId, "source-workbook");
  assert.equal(revision.version, 3);
});

test("late previous Artifact run cannot replace the next source's pending review or output target", async () => {
  const running = deferred<IntegratedModelArtifactRunResult>();
  const reviewing = deferred<IntegratedModelInputReview>();
  const h = harness({ review: (id) => id === revision.artifactId ? Promise.resolve(preview) : reviewing.promise, run: () => running.promise });
  await h.session.review();
  const oldRun = h.session.run();
  h.setRevision({ ...revision, artifactId: "next-source", contentHash: "next-content" });
  h.session.reconcileRevision();
  const nextReview = h.session.review();
  running.resolve(result);
  await oldRun;
  assert.equal(h.state().pending, "review");
  assert.equal(h.state().result, null);
  reviewing.resolve({ ...preview, artifactId: "next-source", contentHash: "next-content" });
  await nextReview;
  assert.equal(h.state().review?.artifactId, "next-source");
});

test("explicit re-review after saving binds the next version and never carries forward the prior review hash", async () => {
  const nextRevision = { ...revision, version: 4, headVersion: 4, contentHash: "next-content-hash" };
  const nextPreview = { ...preview, version: 4, contentHash: nextRevision.contentHash, reviewHash: "next-review-hash", inputHash: "next-input-hash" };
  const nextResult = { ...result, review: nextPreview, outputArtifact: { ...result.outputArtifact, headVersion: 5 }, outputVersion: { ...result.outputVersion, version: 5 }, receipt: { ...result.receipt, inputHash: nextPreview.inputHash } };
  const submitted: Array<{ version: number; contentHash: string; reviewHash: string }> = [];
  const h = harness({
    review: async (_id, version) => version === 3 ? preview : nextPreview,
    run: async (_id, input) => { submitted.push(input); return nextResult; },
  });
  await h.session.review();
  h.setRevision(nextRevision);
  h.session.reconcileRevision();
  assert.equal(h.state().review, null);
  assert.equal(submitted.length, 0);
  await h.session.review();
  assert.equal(h.state().review?.reviewHash, "next-review-hash");
  await h.session.run();
  assert.deepEqual(submitted, [{ version: 4, contentHash: "next-content-hash", reviewHash: "next-review-hash" }]);
  assert.equal(h.state().result?.review.version, 4);
});

test("projectless engine output remains bound to the reviewed owning Chat", async () => {
  for (const owningChatId of [42, 43]) {
    const h = harness({ review: async () => preview, run: async () => ({ ...result, outputArtifact: { ...result.outputArtifact, projectId: null, owningChatId } }) });
    h.setRevision({ ...revision, projectId: null, owningChatId: 42 });
    await h.session.review();
    await h.session.run();
    assert.equal(h.state().result?.outputArtifact.owningChatId ?? null, owningChatId === 42 ? 42 : null);
  }
});
