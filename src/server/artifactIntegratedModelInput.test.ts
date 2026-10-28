import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { TenantContext } from "./tenantContext";
import type { ArtifactIntegratedModelReview, ArtifactIntegratedModelRun } from "./artifactIntegratedModelInput";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-artifact-engine-input-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Database modules must load after the isolated data-root selection; static imports initialize the shared DB singleton first.
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, datasetSnapshots, financialModelRuns, projectArtifacts, projectArtifactVersions, artifactInteractionReceipts, projectLedgerEvents, dataEntitlementPolicies } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { saveFinancialModelRun } = await import("./financialModelRunStore");
const { stableSnapshotHash } = await import("./pointInTimeDatasetStore");
const { hashLedgerValue } = await import("./ledgerStore");
const { getArtifact, getArtifactVersion, createArtifact, createArtifactVersion, createArtifactProposal, decideArtifactProposal } = await import("./artifactStore");
const { retainIntegratedModelArtifact } = await import("./integratedModelArtifact");
const { parseIntegratedModelWorkbookInputs, reviewArtifactIntegratedModelInputs, runArtifactIntegratedModelInputs } = await import("./artifactIntegratedModelInput");
const { registerArtifactRoutes } = await import("./artifactRoutes");
const { getArtifactExportPlan } = await import("./artifactExport");
type Workbook = Extract<ArtifactContent, { kind: "spreadsheet" }>;

function cellFor(workbook: Workbook, sheetId: string, label: string) {
  const sheet = workbook.sheets.find(item => item.id === sheetId)!;
  const address = Object.entries(sheet.cells).find(([ref, cell]) => ref.startsWith("A") && cell.raw === label)?.[0];
  assert.ok(address, `Missing declared fixture input ${label}`);
  return { sheet, cell: `B${address.slice(1)}` };
}
function edit(workbook: Workbook, sheetId: string, label: string, raw: string) {
  const { sheet, cell } = cellFor(workbook, sheetId, label);
  sheet.cells[cell].raw = raw;
  return cell;
}

const payload = financialDatasetPayloadSchema.parse({ symbol: "TEST", periods: [{
  period: "FY", fiscalYear: "2023", periodEnd: "2023-12-31", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [{ statementType: "income", provider: "user_supplied" }],
  income: { revenue: 1000, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100 },
  balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 },
  cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 },
}] });

test("SI-04.17 canonical workbook cells are reviewed, hash-bound and explicitly executed by the existing P11/P4 authorities", { timeout: 120_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [org, foreignOrg] = await getDb().insert(organizations).values([{ name: "Input owner", slug: `inputs-${crypto.randomUUID()}` }, { name: "Foreign", slug: `foreign-${crypto.randomUUID()}` }]).returning();
  const [owner, foreign, reader] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Author", role: "internal_analyst" as const, organizationId: org.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Foreign author", role: "internal_analyst" as const, organizationId: foreignOrg.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Reader", role: "internal_compliance" as const, organizationId: org.id },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, organizationId: org.id, role: owner.role };
  const foreignCtx: TenantContext = { userId: foreign.id, organizationId: foreignOrg.id, role: foreign.role };
  const project = await createProject(ctx, { name: "Workbook inputs" });
  const foreignProject = await createProject(foreignCtx, { name: "Foreign workbook" });
  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output", "export"], attribution: "Owner supplied", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "Exact JS round-trip parameters" }, owner.id);
  const lineage = { sourceRefs: ["https://example.test/model-inputs/2023"] };
  const contentHash = stableSnapshotHash({ payload, provider: "user_supplied", lineage });
  const [snapshot] = await getDb().insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey: `financials:TEST:FY:${crypto.randomUUID()}`, entityKey: "TEST", dataClass: "financial_statements", schemaVersion: "1.0.0", source: "user_import", provider: "user_supplied", frequency: "annual", currency: "USD", retrievedAt: new Date("2024-02-15T00:00:00.000Z"), availableAt: new Date("2024-02-15T00:00:00.000Z"), contentHash, quality: { warnings: [] }, lineage, payload, organizationId: org.id, createdByUserId: owner.id, entitlementPolicyId: policy.id }).returning();
  const result = runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload, assumptions: { projectionYears: 2, revenueGrowth: 0.1234567890123456 }, schedules: {
    segments: [{ name: "Core", openingRevenue: 1000, revenueGrowth: 0.1, cogsPercentRevenue: 0.6, sgaPercentRevenue: 0.15 }],
    pension: { openingObligation: 100, openingPlanAssets: 80, serviceCost: 5, discountRate: 0.05, expectedReturn: 0.1, cashContribution: 7, benefitsPaid: 3 },
    associates: [{ name: "JV", openingCarryingValue: 40, ownershipPercent: 0.25, annualInvesteeIncome: 20, annualDividends: 8 }],
    minority: { openingNonControllingInterest: 25, shareOfConsolidatedIncome: 0.1 },
    transaction: { closeProjectionYear: 1, purchasePrice: 200, acquiredCash: 20, identifiableNetAssets: 120, intangibleAssets: 30, intangibleLifeYears: 10, acquiredRevenue: 100, acquiredRevenueGrowth: 0.1, acquiredEbitMargin: 0.2, cashConsiderationPercent: 0.5, debtConsiderationPercent: 0.5 },
  } });
  const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
  const originalRun = await saveFinancialModelRun({ result, resultHash, createdByUserId: owner.id });
  assert.ok(originalRun);
  const retained = await retainIntegratedModelArtifact(ctx, originalRun.id, project.id);
  const baseline = retained.version.content as unknown as Workbook;
  const originalInputs = { assumptions: result.assumptions, specializedSchedules: result.specializedSchedules };
  let reviewed: ArtifactIntegratedModelReview;
  let editedVersion = 1;
  let output: ArtifactIntegratedModelRun;

  await t.test("unchanged native JS round-trip assumptions, booleans and complete nested/array schedules survive without any defaults", async () => {
    const parsed = parseIntegratedModelWorkbookInputs(baseline, baseline, originalInputs);
    assert.deepEqual(parsed.assumptions, result.assumptions);
    assert.deepEqual(parsed.schedules, result.specializedSchedules);
    assert.deepEqual(parsed.changedFields, []);
    const shuffled = structuredClone(originalInputs);
    shuffled.assumptions = Object.fromEntries(Object.entries(shuffled.assumptions).reverse()) as typeof shuffled.assumptions;
    shuffled.specializedSchedules = Object.fromEntries(Object.entries(shuffled.specializedSchedules).reverse()) as typeof shuffled.specializedSchedules;
    assert.deepEqual(parseIntegratedModelWorkbookInputs(baseline, baseline, shuffled), parsed, "JSONB key order never remaps declared rows");
    for (const name of ["-Literal name", "'-Literal name", "=Literal name", "'=Literal name"]) {
      const namedInputs = structuredClone(originalInputs), namedBook = structuredClone(baseline);
      namedInputs.specializedSchedules.segments[0].name = name;
      edit(namedBook, "schedule-inputs", "segments.0.name", /^[=+@-]/.test(name) ? `'${name}` : name);
      assert.equal(parseIntegratedModelWorkbookInputs(namedBook, namedBook, namedInputs).schedules.segments[0].name, name, "native literal quoting is not stripped twice");
    }
    const preview = await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: 1 });
    assert.equal(preview.engineRev, result.modelVersion);
    assert.deepEqual(preview.assumptions, result.assumptions);
    assert.deepEqual(preview.schedules, result.specializedSchedules);
    assert.deepEqual(preview.source, { runId: originalRun.id, runResultHash: resultHash, datasetSnapshotId: snapshot.id, datasetContentHash: snapshot.contentHash, entitlementPolicyId: policy.id, entitlementPolicyHash: policy.contentHash });
    assert.deepEqual(await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: 1 }), preview);
  });

  await t.test("blank/formula/fraction/inexact/unsafe/coerced boolean and fractional integer inputs are visibly refused", () => {
    for (const raw of ["", " ", "=1/2", "+0.2", "@SUM(A1)", "1/2", "NaN", "Infinity", "0.20000000000000000001", "9007199254740993", "1e-999", "0.2%", " 0.2"]) {
      const candidate = structuredClone(baseline);
      edit(candidate, "assumptions", "Revenue Growth [revenueGrowth]", raw);
      assert.throws(() => parseIntegratedModelWorkbookInputs(candidate, baseline, originalInputs), undefined, raw);
    }
    const fractional = structuredClone(baseline);
    edit(fractional, "assumptions", "Projection Years [projectionYears]", "2.5");
    assert.throws(() => parseIntegratedModelWorkbookInputs(fractional, baseline, originalInputs), /parameter schema/);
    const boolean = structuredClone(baseline);
    edit(boolean, "assumptions", "Use Price Volume Drivers [usePriceVolumeDrivers]", "1");
    assert.throws(() => parseIntegratedModelWorkbookInputs(boolean, baseline, originalInputs), /boolean/);
    const decimal = structuredClone(baseline);
    edit(decimal, "assumptions", "Revenue Growth [revenueGrowth]", "0.20");
    assert.equal(parseIntegratedModelWorkbookInputs(decimal, baseline, originalInputs).assumptions.revenueGrowth, 0.2);
  });

  await t.test("missing, unknown, duplicate keys/paths/sheets and altered provenance cannot feed the engine", () => {
    const mutations: Array<(book: Workbook) => void> = [
      book => { book.sheets.pop(); },
      book => { book.sheets.push(structuredClone(book.sheets[1])); },
      book => { book.sheets[2].id = "unknown"; },
      book => { delete book.sheets[1].cells.B2; },
      book => { book.sheets[1].cells.A3.raw = book.sheets[1].cells.A2.raw; },
      book => { book.sheets[1].cells.A2.raw = "Unknown [invented]"; },
      book => { book.sheets[1].cells.C2 = { raw: "0.1", format: null }; },
      book => { book.sheets[7].cells.A3.raw = book.sheets[7].cells.A2.raw; },
      book => { book.sheets[0].cells.B1.raw = "FORGED"; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(baseline); mutate(candidate);
      assert.throws(() => parseIntegratedModelWorkbookInputs(candidate, baseline, originalInputs));
    }
    const noDefaults = structuredClone(originalInputs);
    delete (noDefaults.assumptions as Partial<typeof noDefaults.assumptions>).projectionYears;
    assert.throws(() => parseIntegratedModelWorkbookInputs(baseline, baseline, noDefaults), /no defaults/);
  });

  await t.test("real P4 workbook edit previews only declared changed input paths; historical/forecast edits never become source inputs", async () => {
    const candidate = structuredClone(baseline);
    const growthCell = edit(candidate, "assumptions", "Revenue Growth [revenueGrowth]", "0.2");
    const booleanCell = edit(candidate, "assumptions", "Use Price Volume Drivers [usePriceVolumeDrivers]", "true");
    const scheduleCell = edit(candidate, "schedule-inputs", "segments.0.revenueGrowth", "0.25");
    edit(candidate, "schedule-inputs", "associates.0.annualInvesteeIncome", "-2.5");
    edit(candidate, "schedule-inputs", "segments.0.name", "Reviewed Core");
    candidate.sheets.find(sheet => sheet.id === "forecast-income")!.cells.B2.raw = "999999";
    candidate.sheets.find(sheet => sheet.id === "actuals")!.cells.C2.raw = "2099-01-01";
    const version = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: 1, content: candidate, actorType: "user", note: "Explicit native fixture edit" });
    editedVersion = version.version;
    reviewed = await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion });
    assert.equal(reviewed.contentHash, version.contentHash);
    assert.deepEqual(reviewed.changedFields.slice(0, 3), [
      { sheetId: "assumptions", cell: growthCell, path: "assumptions.revenueGrowth", before: result.assumptions.revenueGrowth, after: 0.2 },
      { sheetId: "assumptions", cell: booleanCell, path: "assumptions.usePriceVolumeDrivers", before: false, after: true },
      { sheetId: "schedule-inputs", cell: cellFor(candidate, "schedule-inputs", "segments.0.name").cell, path: "segments.0.name", before: "Core", after: "Reviewed Core" },
    ]);
    assert.ok(reviewed.changedFields.some(change => change.path === "segments.0.revenueGrowth" && change.cell === scheduleCell));
    assert.equal(reviewed.changedFields.length, 5);
    assert.ok(reviewed.changedFields.every(change => ["assumptions", "schedule-inputs"].includes(change.sheetId)));
    assert.equal((await getDb().select().from(financialModelRuns)).length, 1, "review never executes the engine or saves a run");
  });

  await t.test("explicit execution advances the same canonical Artifact, preserves authored overrides and replays only once", async () => {
    const isolated = await retainIntegratedModelArtifact(ctx, originalRun.id, project.id, { requestId: crypto.randomUUID(), sourceRefs: [] });
    const edited = await createArtifactVersion(ctx, { artifactId: isolated.artifact.id, baseVersion: 1, content: (await getArtifactVersion(ctx, retained.artifact.id, editedVersion)).content as unknown as ArtifactContent });
    const isolatedReview = await reviewArtifactIntegratedModelInputs(ctx, isolated.artifact.id, { version: edited.version });
    const request = { version: isolatedReview.version, contentHash: isolatedReview.contentHash, reviewHash: isolatedReview.reviewHash };
    output = await runArtifactIntegratedModelInputs(ctx, isolated.artifact.id, request);
    assert.equal(output.outputArtifact.id, isolated.artifact.id);
    assert.equal(output.outputArtifact.projectId, project.id);
    assert.equal(output.outputArtifact.ownerUserId, owner.id);
    assert.equal(output.outputVersion.version, 3);
    assert.notEqual(output.receipt.runId, originalRun.id);
    assert.deepEqual(output.outputVersion.executionReceiptIds, []);
    const [persisted] = await getDb().select().from(financialModelRuns).where(eq(financialModelRuns.id, output.receipt.runId));
    assert.equal(persisted.createdByUserId, owner.id);
    assert.deepEqual(persisted.result, runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload, assumptions: reviewed.assumptions, schedules: reviewed.schedules }));
    assert.deepEqual(persisted.assumptions, reviewed.assumptions);
    const outBook = output.outputVersion.content as unknown as Workbook;
    const newRevenue = cellFor(outBook, "forecast-income", "Revenue [revenue]");
    const expected = persisted.result as unknown as IntegratedFinancialModelResult;
    assert.equal(newRevenue.sheet.cells[newRevenue.cell].raw, String(expected.forecast[0].income.revenue));
    assert.equal(outBook.sheets.find(sheet => sheet.id === "forecast-income")!.cells.B2.raw, "999999", "authored output override is preserved, not labelled a new engine result");
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, editedVersion);
    assert.equal((await getArtifactVersion(ctx, retained.artifact.id, editedVersion)).contentHash, reviewed.contentHash);
    const artifactRef = `${isolated.artifact.id}@v${edited.version}`;
    assert.ok(output.outputVersion.sourceRefs.includes(`model-recompute-run:${output.receipt.runId}`));
    assert.ok(output.outputVersion.dependencyRefs.includes(artifactRef));
    assert.ok(output.lineage.modelInput?.sourceCellRefs.includes(artifactRef));
    const ledger = (await getDb().select().from(projectLedgerEvents)).find(row => row.payload.artifactId === output.outputArtifact.id && JSON.stringify(row).includes(artifactRef));
    assert.ok(ledger);
    assert.ok(JSON.stringify(ledger).includes(artifactRef), "existing P3 Ledger carries original version lineage");
    const repeated = await Promise.all(Array.from({ length: 3 }, () => runArtifactIntegratedModelInputs(ctx, isolated.artifact.id, request)));
    assert.ok(repeated.every(item => item.outputArtifact.id === output.outputArtifact.id && item.outputVersion.id === output.outputVersion.id));
    assert.equal((await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, output.outputArtifact.id))).length, 3);
    assert.equal((await getDb().select().from(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, output.outputArtifact.id))).length, 3);
    assert.equal((await getDb().select().from(projectLedgerEvents)).filter(row => row.payload.artifactId === output.outputArtifact.id).length, 3);
    assert.equal((await getDb().select().from(financialModelRuns)).length, 2);
  });

  await t.test("stale version/content/review hashes, missing identity, foreign run/source/Project and changed live actors fail closed", async () => {
    const request = { version: reviewed.version, contentHash: reviewed.contentHash, reviewHash: reviewed.reviewHash };
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, { ...request, reviewHash: "0".repeat(64) }), /review again/);
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, { ...request, contentHash: "0".repeat(64) }), /review again/);
    await assert.rejects(reviewArtifactIntegratedModelInputs(foreignCtx, retained.artifact.id, { version: editedVersion }), /not found/);
    await assert.rejects(reviewArtifactIntegratedModelInputs({ ...ctx, organizationId: foreignOrg.id }, retained.artifact.id, { version: editedVersion }));
    await getDb().update(users).set({ role: "internal_compliance" }).where(eq(users.id, owner.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /Current tenant access changed/);
    await getDb().update(users).set({ role: owner.role }).where(eq(users.id, owner.id));
    await getDb().update(financialModelRuns).set({ createdByUserId: foreign.id }).where(eq(financialModelRuns.id, originalRun.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /Owned integrated model run/);
    await getDb().update(financialModelRuns).set({ createdByUserId: owner.id }).where(eq(financialModelRuns.id, originalRun.id));
    await getDb().update(datasetSnapshots).set({ organizationId: foreignOrg.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /active tenant/);
    await getDb().update(datasetSnapshots).set({ organizationId: org.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await getDb().update(projectArtifacts).set({ projectId: foreignProject.id }).where(eq(projectArtifacts.id, retained.artifact.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /Project not found/);
    await getDb().update(projectArtifacts).set({ projectId: project.id }).where(eq(projectArtifacts.id, retained.artifact.id));
    const anotherOwnedProject = await createProject(ctx, { name: "Changed destination Project" });
    await getDb().update(projectArtifacts).set({ projectId: anotherOwnedProject.id }).where(eq(projectArtifacts.id, retained.artifact.id));
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, request), /review again/);
    await getDb().update(projectArtifacts).set({ projectId: project.id }).where(eq(projectArtifacts.id, retained.artifact.id));
    const direct = await createArtifact(ctx, { projectId: project.id, title: "Unrecognized workbook", content: baseline });
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, direct.artifact.id, { version: 1 }), /recognized integrated engine/);
    const current = await getArtifactVersion(ctx, retained.artifact.id, editedVersion);
    const next = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: editedVersion, content: current.content as unknown as ArtifactContent, actorType: "user" });
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, request), /head moved/);
    editedVersion = next.version;
    reviewed = await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion });
  });

  await t.test("current linked model_input/display/derived/export rights gate both preview and execution before workbook payload validation", async () => {
    const current = await getArtifactVersion(ctx, retained.artifact.id, editedVersion);
    for (const use of ["display", "model_input", "derived_output", "export"] as const) {
      await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses.filter(item => item !== use) }).where(eq(dataEntitlementPolicies.id, policy.id));
      await getDb().update(projectArtifactVersions).set({ content: { kind: "malformed" } }).where(eq(projectArtifactVersions.id, current.id));
      await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /does not currently permit/);
      await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion, contentHash: reviewed.contentHash, reviewHash: reviewed.reviewHash }), /does not currently permit/);
      await getDb().update(projectArtifactVersions).set({ content: current.content }).where(eq(projectArtifactVersions.id, current.id));
      await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses }).where(eq(dataEntitlementPolicies.id, policy.id));
    }
    await getDb().update(dataEntitlementPolicies).set({ effectiveFrom: new Date("2099-01-01T00:00:00Z") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /does not currently permit/);
    await getDb().update(dataEntitlementPolicies).set({ effectiveFrom: policy.effectiveFrom }).where(eq(dataEntitlementPolicies.id, policy.id));
    // Same recorded policy hash, valid rights, altered effective date: full current policy still binds reviewHash.
    await getDb().update(dataEntitlementPolicies).set({ effectiveFrom: new Date("1980-01-01T00:00:00Z") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion, contentHash: reviewed.contentHash, reviewHash: reviewed.reviewHash }), /review again/);
    await getDb().update(dataEntitlementPolicies).set({ effectiveFrom: policy.effectiveFrom }).where(eq(dataEntitlementPolicies.id, policy.id));
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion }), /linked source entitlement/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: policy.id }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.equal((await getDb().select().from(financialModelRuns)).length, 2, "refused requests create no run");
  });

  await t.test("null and empty schedule markers cannot be coerced to invented context", async () => {
    const emptyResult = runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload, assumptions: { projectionYears: 1 } });
    const emptyHash = stableSnapshotHash({ modelVersion: emptyResult.modelVersion, datasetContentHash: snapshot.contentHash, assumptions: emptyResult.assumptions, specializedSchedules: emptyResult.specializedSchedules, forecast: emptyResult.forecast });
    const emptyRun = await saveFinancialModelRun({ result: emptyResult, resultHash: emptyHash, createdByUserId: owner.id });
    assert.ok(emptyRun);
    const empty = await retainIntegratedModelArtifact(ctx, emptyRun.id, project.id);
    const book = empty.version.content as unknown as Workbook;
    assert.deepEqual(parseIntegratedModelWorkbookInputs(book, book, emptyResult).schedules, emptyResult.specializedSchedules);
    const invented = structuredClone(book);
    edit(invented, "schedule-inputs", "pension", "0");
    assert.throws(() => parseIntegratedModelWorkbookInputs(invented, book, emptyResult), /missing schedule/);
    const newArray = structuredClone(book);
    edit(newArray, "schedule-inputs", "segments", "[]");
    assert.throws(() => parseIntegratedModelWorkbookInputs(newArray, book, emptyResult), /empty schedule/);
  });

  await t.test("actual HTTP review/run requires deterministic-model author role and passes precise status/errors/canonical output", async () => {
    const retained = await retainIntegratedModelArtifact(ctx, originalRun.id, project.id, { requestId: crypto.randomUUID(), sourceRefs: [] });
    const httpBook = structuredClone(baseline);
    edit(httpBook, "assumptions", "Revenue Growth [revenueGrowth]", "0.27");
    const httpEdited = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: 1, content: httpBook });
    let editedVersion = httpEdited.version;
    const reviewed = await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: editedVersion });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      const actor = [owner, foreign, reader].find(item => String(item.id) === req.get("x-test-user"));
      req.isAuthenticated = (() => actor !== undefined) as typeof req.isAuthenticated;
      if (actor) req.user = actor;
      next();
    });
    registerArtifactRoutes(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/api/artifacts/${retained.artifact.id}`;
      async function post(suffix: string, userId: number, body: unknown) { return fetch(`${url}/${suffix}`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": String(userId) }, body: JSON.stringify(body) }); }
      assert.equal((await post("integrated-model-review", reader.id, { version: editedVersion })).status, 403);
      assert.equal((await post("integrated-model-run", reader.id, { version: editedVersion, contentHash: reviewed.contentHash, reviewHash: reviewed.reviewHash })).status, 403);
      assert.equal((await post("integrated-model-review", foreign.id, { version: editedVersion })).status, 404);
      assert.equal((await post("integrated-model-review", owner.id, { version: editedVersion, unexpected: true })).status, 400);
      const response = await post("integrated-model-review", owner.id, { version: editedVersion });
      assert.equal(response.status, 200); const preview = await response.json();
      assert.equal(preview.reviewHash, reviewed.reviewHash);
      assert.equal((await post("integrated-model-run", owner.id, { version: editedVersion, contentHash: reviewed.contentHash, reviewHash: "0".repeat(64) })).status, 409);
      const executed = await post("integrated-model-run", owner.id, { version: editedVersion, contentHash: preview.contentHash, reviewHash: preview.reviewHash });
      assert.equal(executed.status, 200); const body = await executed.json();
      assert.equal(body.outputArtifact.projectId, project.id);
      assert.equal(body.outputArtifact.id, retained.artifact.id);
      editedVersion = body.outputVersion.version;
      const badBook = structuredClone((await getArtifactVersion(ctx, retained.artifact.id, editedVersion)).content) as unknown as Workbook;
      edit(badBook, "assumptions", "Revenue Growth [revenueGrowth]", "=SUM(A1)");
      const badVersion = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: editedVersion, content: badBook, actorType: "user" });
      const badReview = await post("integrated-model-review", owner.id, { version: badVersion.version });
      assert.equal(badReview.status, 422);
      assert.match((await badReview.json()).error, /formula/);
      assert.equal(hashLedgerValue(badBook), badVersion.contentHash);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  await t.test("legacy global result dedup cannot adopt a foreign owner's otherwise identical real run", async () => {
    const candidate = structuredClone(baseline);
    edit(candidate, "assumptions", "Revenue Growth [revenueGrowth]", "0.333");
    edit(candidate, "schedule-inputs", "segments.0.revenueGrowth", "0.35");
    const inputs = parseIntegratedModelWorkbookInputs(candidate, baseline, originalInputs);
    const foreignResult = runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload, assumptions: inputs.assumptions, schedules: inputs.schedules });
    const foreignHash = stableSnapshotHash({ modelVersion: foreignResult.modelVersion, datasetContentHash: snapshot.contentHash, assumptions: foreignResult.assumptions, specializedSchedules: foreignResult.specializedSchedules, forecast: foreignResult.forecast });
    const foreignRun = await saveFinancialModelRun({ result: foreignResult, resultHash: foreignHash, createdByUserId: foreign.id });
    assert.ok(foreignRun);
    assert.equal(foreignRun.createdByUserId, foreign.id);
    const artifact = await getArtifact(ctx, retained.artifact.id);
    const version = await createArtifactVersion(ctx, { artifactId: artifact.id, baseVersion: artifact.headVersion, content: candidate, actorType: "user" });
    const preview = await reviewArtifactIntegratedModelInputs(ctx, artifact.id, { version: version.version });
    const beforeArtifacts = await getDb().select().from(projectArtifacts);
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, artifact.id, { version: preview.version, contentHash: preview.contentHash, reviewHash: preview.reviewHash }), /not owned by the current actor/);
    assert.equal((await getDb().select().from(projectArtifacts)).length, beforeArtifacts.length);
    assert.equal((await getArtifact(ctx, artifact.id)).headVersion, version.version);
    const [unchangedOwner] = await getDb().select().from(financialModelRuns).where(eq(financialModelRuns.id, foreignRun.id));
    assert.equal(unchangedOwner.createdByUserId, foreign.id);
  });

  await t.test("real current P4 revisions with missing/unrecognized cells, keys, schedules and sheets are refused without saving a run", async () => {
    const mutations: Array<(book: Workbook) => void> = [
      book => { delete book.sheets[1].cells.B2; },
      book => { book.sheets[1].cells.A3.raw = "Unrecognized [notAnAssumption]"; },
      book => { book.sheets[7].cells.A3.raw = book.sheets[7].cells.A2.raw; },
      book => { book.sheets[2].id = "foreign-derived-sheet"; },
      book => { edit(book, "assumptions", "Revenue Growth [revenueGrowth]", "0.20000000000000000001"); },
    ];
    const runsBefore = (await getDb().select().from(financialModelRuns)).length;
    const before = await getArtifact(ctx, retained.artifact.id);
    const forgedIdentity = structuredClone(baseline);
    forgedIdentity.sheets[2].id = "foreign-derived-sheet";
    await assert.rejects(createArtifactVersion(ctx, {
      artifactId: before.id, baseVersion: before.headVersion, content: forgedIdentity, actorType: "user",
    }), /New source-linked cell bindings require a verified persisted model projection/);
    assert.equal((await getArtifact(ctx, before.id)).headVersion, before.headVersion);
    for (const mutate of mutations) {
      const candidate = structuredClone(baseline);
      mutate(candidate);
      // These fixtures exercise input shape validation, not source-custody minting.
      // Sequential malformed revisions may remove identities; restoring their values must not reassert a trusted binding.
      for (const sheet of candidate.sheets) for (const cell of Object.values(sheet.cells)) delete cell.lineage;
      const artifact = await getArtifact(ctx, retained.artifact.id);
      const version = await createArtifactVersion(ctx, { artifactId: artifact.id, baseVersion: artifact.headVersion, content: candidate, actorType: "user" });
      await assert.rejects(reviewArtifactIntegratedModelInputs(ctx, artifact.id, { version: version.version }));
      await assert.rejects(runArtifactIntegratedModelInputs(ctx, artifact.id, { version: version.version, contentHash: version.contentHash, reviewHash: "0".repeat(64) }));
    }
    assert.equal((await getDb().select().from(financialModelRuns)).length, runsBefore);
  });
  await t.test("Quick Chat proposal acceptance, direct edits, reviewed recompute, export and reopen share immutable P4 custody", async () => {
    const chat = await createProjectChat(ctx, { scope: "quick" });
    const foreignChat = await createProjectChat(foreignCtx, { scope: "quick" });
    await assert.rejects(retainIntegratedModelArtifact(ctx, originalRun.id, null, undefined, foreignChat.id), /persistent Chat/);
    const saved = await retainIntegratedModelArtifact(ctx, originalRun.id, null, undefined, chat.id);
    const workbook = saved.version.content as unknown as Workbook;
    const { sheet, cell } = cellFor(workbook, "assumptions", "Revenue Growth [revenueGrowth]");
    const proposal = await createArtifactProposal(ctx, {
      artifactId: saved.artifact.id, baseVersion: 1, type: "spreadsheet_ai_diff", actorType: "conversation",
      summary: "Explicitly propose owned growth assumption",
      diffs: [{ sheetId: sheet.id, ref: cell, before: sheet.cells[cell], after: { raw: "0.24", format: null } }],
    });
    assert.equal((await getArtifact(ctx, saved.artifact.id)).headVersion, 1, "a conversation proposal does not apply or calculate");
    await decideArtifactProposal(ctx, proposal.id, "accept");
    const accepted = await getArtifactVersion(ctx, saved.artifact.id, 2);
    const authored = structuredClone(accepted.content) as unknown as Workbook;
    authored.sheets.find(item => item.id === "assumptions")!.cells[cell].raw = "0.26";
    const direct = await createArtifactVersion(ctx, { artifactId: saved.artifact.id, baseVersion: 2, content: authored });
    const review = await reviewArtifactIntegratedModelInputs(ctx, saved.artifact.id, { version: direct.version });
    await assert.rejects(runArtifactIntegratedModelInputs(ctx, saved.artifact.id, { version: direct.version, contentHash: direct.contentHash, reviewHash: "0".repeat(64) }), /review again/);
    const calculated = await runArtifactIntegratedModelInputs(ctx, saved.artifact.id, { version: review.version, contentHash: review.contentHash, reviewHash: review.reviewHash });
    assert.equal(calculated.outputArtifact.id, saved.artifact.id);
    assert.equal(calculated.outputArtifact.projectId, null);
    assert.equal(calculated.outputArtifact.owningChatId, chat.id);
    assert.equal(calculated.outputVersion.version, 4);
    assert.deepEqual(await getArtifactVersion(ctx, saved.artifact.id, 1), saved.version);
    assert.deepEqual(await getArtifactVersion(ctx, saved.artifact.id, 2), accepted);
    const reopened = await getArtifactVersion(ctx, saved.artifact.id);
    assert.equal(reopened.id, calculated.outputVersion.id);
    const nextReview = await reviewArtifactIntegratedModelInputs(ctx, saved.artifact.id, { version: 4 });
    assert.equal(nextReview.assumptions.revenueGrowth, 0.26);
    const plan = await getArtifactExportPlan(ctx, saved.artifact.id, 4);
    assert.equal(plan.contentHash, reopened.contentHash);
    assert.ok(plan.formats.includes("xlsx"));
    await assert.rejects(getArtifactExportPlan(foreignCtx, saved.artifact.id, 4), /not found/);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses.filter(use => use !== "export") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(getArtifactExportPlan(ctx, saved.artifact.id, 4), /do not permit|does not currently permit/);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses }).where(eq(dataEntitlementPolicies.id, policy.id));
  });
});
