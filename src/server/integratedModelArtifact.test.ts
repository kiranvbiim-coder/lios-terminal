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
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import type { TenantContext } from "./tenantContext";
import type { CreatedArtifact } from "./artifactStore";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";
import type { ArtifactContent } from "@shared/artifactContracts";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { deriveSpreadsheetCellLineageStatus } from "@shared/spreadsheetCellLineage";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-integrated-model-artifact-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Database-dependent modules must load after this isolated data-root selection; static imports would initialize the shared DB singleton first.
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, datasetSnapshots, financialModelRuns, projectArtifacts, projectArtifactVersions, artifactInteractionReceipts, projectLedgerEvents } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { saveFinancialModelRun } = await import("./financialModelRunStore");
const { stableSnapshotHash } = await import("./pointInTimeDatasetStore");
const { getArtifactVersion, createArtifact, createArtifactVersion, createArtifactProposal, decideArtifactProposal, persistConversationDraft } = await import("./artifactStore");
const { retainIntegratedModelArtifact, projectIntegratedModelWorkbook, readIntegratedModelRun } = await import("./integratedModelArtifact");
const { registerDataFabricRoutes } = await import("./dataFabricRoutes");

const payload = financialDatasetPayloadSchema.parse({ symbol: "TEST", periods: [{
  period: "FY", fiscalYear: "2023", periodEnd: "2023-12-31", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [{ statementType: "income", provider: "user_supplied" }],
  income: { revenue: 1000.125, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100 },
  balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 },
  cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 },
}] });

function hashResult(result: IntegratedFinancialModelResult, contentHash: string) {
  return stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
}

async function artifactCounts(id: string) {
  const artifacts = await getDb().select().from(projectArtifacts).where(eq(projectArtifacts.id, id));
  const versions = await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, id));
  const receipts = await getDb().select().from(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, id));
  const ledger = (await getDb().select().from(projectLedgerEvents)).filter(event => event.payload.artifactId === id);
  return { artifacts, versions, receipts, ledger };
}

test("SI-04.16 persisted engine run becomes one tenant-owned canonical P4 workbook", { timeout: 120_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [orgA, orgB] = await getDb().insert(organizations).values([
    { name: "Model organization A", slug: `model-a-${crypto.randomUUID()}` },
    { name: "Model organization B", slug: `model-b-${crypto.randomUUID()}` },
  ]).returning();
  const [owner, stranger, compliance, client] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Model owner", role: "internal_analyst" as const, organizationId: orgA.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Other model owner", role: "internal_analyst" as const, organizationId: orgB.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Compliance reader", role: "internal_compliance" as const, organizationId: orgA.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Client", role: "client_user" as const, organizationId: orgA.id },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, organizationId: orgA.id, role: owner.role };
  const otherCtx: TenantContext = { userId: stranger.id, organizationId: orgB.id, role: stranger.role };
  const project = await createProject(ctx, { name: "Persisted model outputs" });
  const otherProject = await createProject(otherCtx, { name: "Other tenant model outputs" });
  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output", "export"], attribution: "Owner-supplied fixture", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "No source decimal evidence is asserted." }, owner.id);
  const lineage = { sourceRefs: ["https://example.test/fixture/2023"], normalization: "Fixture contains canonical parsed numbers" };
  const contentHash = stableSnapshotHash({ payload, provider: "user_supplied", lineage });
  const [snapshot] = await getDb().insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey: `financials:TEST:FY:${crypto.randomUUID()}`, entityKey: "TEST", dataClass: "financial_statements", schemaVersion: "1.0.0", source: "user_import", provider: "user_supplied", frequency: "annual", currency: "USD", retrievedAt: new Date("2024-02-15T00:00:00.000Z"), availableAt: new Date("2024-02-15T00:00:00.000Z"), contentHash, quality: { score: 1, statementCoverage: { income: 1, balance: 1, cashflow: 1 }, criticalFieldsPresent: 1, criticalFieldsExpected: 1, missingCriticalFields: [], warnings: [] }, lineage, payload, organizationId: null, createdByUserId: owner.id, entitlementPolicyId: policy.id }).returning();
  const result = runIntegratedFinancialModel({ datasetSnapshotId: snapshot.id, payload, assumptions: { projectionYears: 2, revenueGrowth: 0.1234567890123456 } });
  const run = await saveFinancialModelRun({ result, resultHash: hashResult(result, snapshot.contentHash), createdByUserId: owner.id });
  assert.ok(run);
  let retained: CreatedArtifact;

  await t.test("reopening an owned run restores exact engine values and source inputs but rejects foreign, revoked and tampered runs", async () => {
    const reopened = await readIntegratedModelRun(ctx, run.id);
    assert.deepEqual(reopened.result, result);
    assert.deepEqual(reopened.snapshot.payload, payload);
    assert.equal(reopened.receipt.resultHash, run.resultHash);
    await assert.rejects(readIntegratedModelRun(otherCtx, run.id), /Owned integrated model run not found/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(readIntegratedModelRun(ctx, run.id), /linked source entitlement policy/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: policy.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await getDb().update(financialModelRuns).set({ resultHash: "0".repeat(64) }).where(eq(financialModelRuns.id, run.id));
    await assert.rejects(readIntegratedModelRun(ctx, run.id), /result hash/);
    await getDb().update(financialModelRuns).set({ resultHash: run.resultHash }).where(eq(financialModelRuns.id, run.id));
    assert.deepEqual((await readIntegratedModelRun(ctx, run.id)).result, result);
    const { policy: readOnlyPolicy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output"], attribution: null, termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "Reading a model does not grant export" }, owner.id);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: readOnlyPolicy.id }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.deepEqual((await readIntegratedModelRun(ctx, run.id)).result, result);
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /does not currently permit/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: policy.id }).where(eq(datasetSnapshots.id, snapshot.id));
  });

  await t.test("actual engine outputs, history, schedules, assumptions and checks retain native values without formulas or fabricated receipts", async () => {
    retained = await retainIntegratedModelArtifact(ctx, run.id, project.id);
    assert.equal(retained.artifact.kind, "spreadsheet");
    assert.equal(retained.artifact.projectId, project.id);
    assert.equal(retained.artifact.ownerUserId, owner.id);
    assert.equal(retained.artifact.organizationId, orgA.id);
    assert.equal(retained.version.refreshSpec?.kind, "engine");
    assert.equal(retained.version.refreshSpec?.engineRef, `integrated_financial_model:${run.modelVersion}:run:${run.id}`);
    assert.deepEqual(retained.version.executionReceiptIds, []);
    assert.ok(retained.version.sourceRefs.includes(`financial-model-run:${run.id}`));
    assert.ok(retained.version.sourceRefs.includes(`dataset-content-sha256:${snapshot.contentHash}`));
    assert.ok(retained.version.sourceRefs.includes(`entitlement-policy:${policy.id}`));
    const workbook = retained.version.content as Extract<ArtifactContent, { kind: "spreadsheet" }>;
    assert.equal(workbook.calculationMode, "manual");
    assert.deepEqual(workbook.sheets.map(sheet => sheet.id), ["provenance", "assumptions", "actuals", "forecast-income", "forecast-balance", "forecast-cashflow", "forecast-schedules", "schedule-inputs", "validation"]);
    const income = workbook.sheets.find(sheet => sheet.id === "forecast-income")!;
    const revenueLabel = Object.entries(income.cells).find(([, cell]) => cell.raw === "Revenue [revenue]")![0];
    const row = revenueLabel.slice(1);
    assert.equal(income.cells[`B${row}`].raw, String(result.forecast[0].income.revenue));
    assert.equal(income.cells[`C${row}`].raw, String(result.forecast[1].income.revenue));
    const assumptions = workbook.sheets.find(sheet => sheet.id === "assumptions")!;
    assert.ok(Object.values(assumptions.cells).some(cell => cell.raw === String(result.assumptions.revenueGrowth)));
    assert.ok(Object.values(workbook.sheets.find(sheet => sheet.id === "actuals")!.cells).some(cell => cell.raw === "1000.125"));
    const actuals = workbook.sheets.find(sheet => sheet.id === "actuals")!;
    const actualRevenue = Object.values(actuals.cells).find(cell => cell.raw === "1000.125")!;
    assert.equal(actualRevenue.lineage?.kind, "reported_actual");
    assert.equal(actualRevenue.lineage?.sourcePath, "periods.0.income.revenue");
    assert.equal(actualRevenue.lineage?.statement, "income");
    assert.equal(actualRevenue.lineage?.canonicalKey, "revenue");
    assert.equal(actualRevenue.lineage?.period, "FY");
    assert.equal(actualRevenue.lineage?.fiscalYear, "2023");
    assert.equal(actualRevenue.lineage?.periodEnd, "2023-12-31");
    assert.equal(actualRevenue.lineage?.availableAt, payload.periods[0].availableAt);
    assert.equal(actualRevenue.lineage?.currency, "USD");
    assert.equal(actualRevenue.lineage?.datasetSnapshotId, snapshot.id);
    assert.equal(actualRevenue.lineage?.contentHash, snapshot.contentHash);
    assert.equal(actualRevenue.lineage?.entitlementPolicyRef, `entitlement-policy:${policy.id}`);
    assert.equal(actualRevenue.lineage?.capturedValueHash, stableSnapshotHash("1000.125"));
    assert.equal(actualRevenue.lineage?.numericRepresentation, "js_number_roundtrip");
    assert.equal(actualRevenue.lineage?.sourceUnit, undefined, "Native units are not a fabricated source scale.");
    assert.equal(deriveSpreadsheetCellLineageStatus(actualRevenue), "current");
    const forecastRevenue = income.cells[`B${row}`];
    assert.equal(forecastRevenue.lineage?.kind, "engine_output");
    assert.equal(forecastRevenue.lineage?.resultPath, "forecast.0.income.revenue");
    assert.equal(forecastRevenue.lineage?.modelRunId, run.id);
    assert.equal(forecastRevenue.lineage?.resultHash, run.resultHash);
    assert.equal(forecastRevenue.lineage?.fiscalYear, result.forecast[0].fiscalYear);
    assert.equal(forecastRevenue.lineage?.periodEnd, undefined);
    assert.equal(forecastRevenue.lineage?.availableAt, undefined, "Forecast availability is not a source-reported timestamp.");
    for (const sheet of [actuals, income]) for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (cell.raw === "" || /^[AB]1$/.test(ref) || cell.raw === "Revenue [revenue]") assert.equal(cell.lineage, undefined);
    }
    const growth = Object.values(assumptions.cells).find(cell => cell.lineage?.resultPath === "assumptions.revenueGrowth")!;
    assert.equal(growth.lineage?.kind, "user_assumption");
    const driver = Object.values(assumptions.cells).find(cell => cell.lineage?.resultPath === "assumptions.usePriceVolumeDrivers")!;
    assert.ok(driver.lineage);
    assert.equal("numericRepresentation" in driver.lineage, false, "Boolean resolved inputs must not introduce undefined numerical metadata keys.");
    assert.deepEqual(driver.lineage, JSON.parse(JSON.stringify(driver.lineage)), "Binding metadata is unchanged across canonical JSON storage.");
    if (growth.lineage?.kind === "user_assumption") assert.equal(growth.lineage.assumptionOrigin, "persisted_run_input");
    assert.ok(Object.values(workbook.sheets.find(sheet => sheet.id === "provenance")!.cells).some(cell => cell.raw.includes("not original source decimal evidence")));
    for (const sheet of workbook.sheets) for (const cell of Object.values(sheet.cells)) assert.equal(cell.raw.startsWith("="), false);
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id, 1), retained.version);
  });

  await t.test("concurrent duplicate retain creates one Artifact/version/P4 receipt/Ledger and durable reopen returns the same identity", async () => {
    const calls = await Promise.all(Array.from({ length: 8 }, () => retainIntegratedModelArtifact(ctx, run.id, project.id)));
    assert.equal(new Set(calls.map(call => call.artifact.id)).size, 1);
    assert.equal(new Set(calls.map(call => call.version.id)).size, 1);
    const rows = await artifactCounts(retained.artifact.id);
    assert.deepEqual([rows.artifacts.length, rows.versions.length, rows.receipts.length, rows.ledger.length], [1, 1, 1, 1]);
    assert.equal(rows.receipts[0].requestId, run.id);
    assert.equal(rows.ledger[0].requestId, run.id);
    await closeDb();
    await initDb();
    assert.deepEqual(await retainIntegratedModelArtifact(ctx, run.id, project.id), retained);
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id, 1), retained.version);
  });

  await t.test("missing historical values and report labels have no numeric binding; capture paths follow actual payload indexes", () => {
    const previous = { ...payload.periods[0], fiscalYear: "2022", periodEnd: "2022-12-31", income: { revenue: 900 } };
    const multi = { ...snapshot, payload: { ...payload, periods: [previous, payload.periods[0]] } };
    multi.contentHash = stableSnapshotHash({ payload: multi.payload, provider: multi.provider, lineage: multi.lineage });
    const linkedRun = { ...run, resultHash: hashResult(result, multi.contentHash) };
    const workbook = projectIntegratedModelWorkbook(linkedRun, multi, policy).content;
    const actuals = workbook.sheets.find(sheet => sheet.id === "actuals")!;
    const costLabel = Object.entries(actuals.cells).find(([, cell]) => cell.raw === "Cost Of Revenue [costOfRevenue]")!;
    const row = costLabel[0].slice(1);
    assert.deepEqual(actuals.cells[`C${row}`], { raw: "", format: null });
    assert.equal(costLabel[1].lineage, undefined);
    assert.equal(actuals.cells[`D${row}`].lineage?.sourcePath, "periods.1.income.costOfRevenue");
    assert.equal(actuals.cells[`D${row}`].lineage?.fiscalYear, "2023");
    assert.equal(actuals.cells.C1.lineage, undefined);
    assert.equal(actuals.cells.C2.lineage, undefined, "Period labels are not reported numerical values.");
    const repeated = projectIntegratedModelWorkbook(linkedRun, multi, policy).content;
    assert.equal(stableSnapshotHash(workbook), stableSnapshotHash(repeated));
    assert.deepEqual(Object.keys(workbook.sheets[2].cells), Object.keys(repeated.sheets[2].cells));
    assert.throws(() => projectIntegratedModelWorkbook(linkedRun, { ...multi, contentHash: "f".repeat(64) }, policy), /result hash/);
  });

  await t.test("canonical version and proposal edits keep historical lineage and cannot forge a new source binding", async () => {
    const editProject = await createProject(ctx, { name: "Source-linked edits" });
    const original = await retainIntegratedModelArtifact(ctx, run.id, editProject.id);
    const base = spreadsheetArtifactContentSchema.parse(original.version.content);
    const actuals = base.sheets.find(sheet => sheet.id === "actuals")!;
    const [ref, sourceCell] = Object.entries(actuals.cells).find(([, cell]) => cell.lineage?.canonicalKey === "revenue")!;
    const edited = structuredClone(base);
    edited.sheets.find(sheet => sheet.id === "actuals")!.cells[ref] = { raw: "=1000+1", format: null };
    const version = await createArtifactVersion(ctx, { artifactId: original.artifact.id, baseVersion: 1, content: edited });
    const saved = spreadsheetArtifactContentSchema.parse(version.content).sheets.find(sheet => sheet.id === "actuals")!.cells[ref];
    assert.deepEqual(saved.lineage, sourceCell.lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved), "edited_unverified");
    assert.equal(saved.raw, "=1000+1", "No formula recalculation is performed.");
    assert.deepEqual(await getArtifactVersion(ctx, original.artifact.id, 1), original.version);
    const forged = structuredClone(base);
    forged.sheets.find(sheet => sheet.id === "actuals")!.cells.Z99 = sourceCell;
    await assert.rejects(createArtifactVersion(ctx, { artifactId: original.artifact.id, baseVersion: 2, content: forged }), /verified persisted model projection/);
    await assert.rejects(createArtifact(ctx, { projectId: editProject.id, title: "Forged cell", content: forged }), /exact verified source/);
    await assert.rejects(createArtifactProposal(ctx, { artifactId: original.artifact.id, baseVersion: 2, type: "spreadsheet_ai_diff", summary: "Forged binding", diffs: [{ sheetId: "actuals", ref: "Z99", before: null, after: sourceCell }] }), /verified persisted model projection/);
    const proposal = await createArtifactProposal(ctx, { artifactId: original.artifact.id, baseVersion: 2, type: "spreadsheet_ai_diff", summary: "Edit without recalculation", diffs: [{ sheetId: "actuals", ref, before: saved, after: { raw: "1002", format: "0.00" } }] });
    const accepted = await decideArtifactProposal(ctx, proposal.id, "accept");
    assert.ok("version" in accepted);
    if ("version" in accepted) {
      const cell = spreadsheetArtifactContentSchema.parse(accepted.version.content).sheets.find(sheet => sheet.id === "actuals")!.cells[ref];
      assert.deepEqual(cell.lineage, sourceCell.lineage);
      assert.equal(deriveSpreadsheetCellLineageStatus(cell), "edited_unverified");
    }
  });

  await t.test("retaining a prior raw/format-only exact run returns historical content and hash without backfill", async () => {
    const historicalProject = await createProject(ctx, { name: "Historical undecorated model" });
    const projection = projectIntegratedModelWorkbook(run, snapshot, policy);
    const historical = structuredClone(projection.content);
    for (const sheet of historical.sheets) for (const cell of Object.values(sheet.cells)) delete cell.lineage;
    const old = await persistConversationDraft(ctx, {
      projectId: historicalProject.id, requestId: run.id,
      draft: { schemaVersion: "1", artifactId: run.id, artifactType: "financial.integrated.spreadsheet", title: `${run.symbol} integrated model · ${run.modelVersion}`, projectId: historicalProject.id, sourceRefs: projection.sourceRefs, executionReceiptIds: [], data: historical, persistence: "project_candidate" },
      dependencyRefs: projection.sourceRefs,
      refreshSpec: { kind: "engine", sourceScope: "my_data", executionMode: "deterministic_first", capabilityIds: [], message: "Immutable projection of a persisted integrated financial model run. Recompute only through an explicit new engine run.", selection: null, engineRef: `integrated_financial_model:${run.modelVersion}:run:${run.id}` },
    });
    assert.deepEqual(await retainIntegratedModelArtifact(ctx, run.id, historicalProject.id), old);
    assert.deepEqual(await getArtifactVersion(ctx, old.artifact.id, 1), old.version);
    assert.equal(old.version.contentHash, stableSnapshotHash(historical));
    assert.equal((await artifactCounts(old.artifact.id)).versions.length, 1);
  });

  await t.test("stable owner/project/run identity rejects changed persisted payload instead of creating a new initial version", async () => {
    const changed = structuredClone(result);
    changed.checks.warnings.push("Changed persisted run metadata");
    await getDb().update(financialModelRuns).set({ result: changed as unknown as Record<string, unknown> }).where(eq(financialModelRuns.id, run.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /already contains different content/);
    await getDb().update(financialModelRuns).set({ result: result as unknown as Record<string, unknown> }).where(eq(financialModelRuns.id, run.id));
    assert.deepEqual((await artifactCounts(retained.artifact.id)).versions.length, 1);
    assert.deepEqual(await retainIntegratedModelArtifact(ctx, run.id, project.id), retained);
  });

  await t.test("foreign run, foreign Project, private/global source ownership and current role/org boundaries fail closed", async () => {
    await assert.rejects(retainIntegratedModelArtifact(otherCtx, run.id, otherProject.id), /Owned integrated model run not found/);
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, otherProject.id), /Project not found/);
    await assert.rejects(getArtifactVersion(otherCtx, retained.artifact.id, 1));
    await assert.rejects(retainIntegratedModelArtifact({ ...ctx, organizationId: orgB.id }, run.id, project.id), /Current tenant access changed/);
    await assert.rejects(retainIntegratedModelArtifact({ ...ctx, role: "internal_admin" }, run.id, project.id), /Current tenant access changed/);
    await assert.rejects(retainIntegratedModelArtifact({ userId: compliance.id, organizationId: orgA.id, role: compliance.role }, run.id, project.id), /author role/);
    await assert.rejects(retainIntegratedModelArtifact({ userId: client.id, organizationId: orgA.id, role: client.role }, run.id, project.id), /author role/);
    // Existing run-store dedup is global; a foreign saver receives the old owner's run. Retention must not trust that return as ownership.
    const foreignDedup = await saveFinancialModelRun({ result, resultHash: run.resultHash, createdByUserId: stranger.id });
    assert.equal(foreignDedup.id, run.id);
    await assert.rejects(retainIntegratedModelArtifact(otherCtx, foreignDedup.id, otherProject.id), /Owned integrated model run not found/);
    await getDb().update(datasetSnapshots).set({ createdByUserId: stranger.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /active tenant/);
    await getDb().update(datasetSnapshots).set({ organizationId: orgB.id, createdByUserId: owner.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /active tenant/);
    await getDb().update(datasetSnapshots).set({ organizationId: null, createdByUserId: owner.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await getDb().update(datasetSnapshots).set({ createdByUserId: null }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.deepEqual(await retainIntegratedModelArtifact(ctx, run.id, project.id), retained, "Shared owner-null global sources remain eligible when their linked rights allow export.");
    await getDb().update(datasetSnapshots).set({ createdByUserId: owner.id }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.deepEqual(await retainIntegratedModelArtifact(ctx, run.id, project.id), retained);
  });

  await t.test("rights are linked and current; no implicit policy is manufactured", async () => {
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /linked source entitlement policy/);
    const { policy: restricted } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input"], attribution: null, termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "No export" }, owner.id);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: restricted.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /does not currently permit/);
    const { policy: expired } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "derived_output", "export"], attribution: null, termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: "2020-01-01T00:00:00.000Z", reviewedAt: null, notes: "Expired rights" }, owner.id);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: expired.id }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(retainIntegratedModelArtifact(ctx, run.id, project.id), /does not currently permit/);
    await getDb().update(datasetSnapshots).set({ entitlementPolicyId: policy.id }).where(eq(datasetSnapshots.id, snapshot.id));
  });

  await t.test("explicit second Project gets its own canonical identity and concurrent first retain writes once", async () => {
    const nextProject = await createProject(ctx, { name: "Another chosen Project" });
    const calls = await Promise.all(Array.from({ length: 8 }, () => retainIntegratedModelArtifact(ctx, run.id, nextProject.id)));
    assert.equal(new Set(calls.map(call => call.artifact.id)).size, 1);
    assert.notEqual(calls[0].artifact.id, retained.artifact.id);
    const rows = await artifactCounts(calls[0].artifact.id);
    assert.deepEqual([rows.artifacts.length, rows.versions.length, rows.receipts.length, rows.ledger.length], [1, 1, 1, 1]);
  });

  await t.test("oversized projections and hash tampering are rejected without truncation", () => {
    const tooWide = structuredClone(snapshot);
    tooWide.payload = { ...payload, periods: Array.from({ length: 31 }, () => payload.periods[0]) };
    assert.throws(() => projectIntegratedModelWorkbook(run, tooWide, policy), /row\/column limits/);
    const tooLong = structuredClone(snapshot);
    tooLong.lineage = { sourceRef: "x".repeat(4_001) };
    assert.throws(() => projectIntegratedModelWorkbook(run, tooLong, policy), /4000 characters/);
    const tooLarge = structuredClone(snapshot);
    tooLarge.lineage = { values: "x".repeat(2 * 1024 * 1024) };
    assert.throws(() => projectIntegratedModelWorkbook(run, tooLarge, policy), /2 MiB/);
    assert.throws(() => projectIntegratedModelWorkbook({ ...run, resultHash: "0".repeat(64) }, snapshot, policy), /result hash/);
    const numericTampering = structuredClone(run);
    numericTampering.result = { ...run.result, forecast: [{ ...result.forecast[0], income: { revenue: "not a native number" } }] };
    assert.throws(() => projectIntegratedModelWorkbook(numericTampering, snapshot, policy));
  });

  await t.test("real HTTP retention requires explicit Project and author role; replay returns canonical artifact/version", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const actors = [owner, stranger, compliance, client];
      const actor = actors.find(user => String(user.id) === req.get("x-test-user"));
      req.isAuthenticated = (() => actor !== undefined) as typeof req.isAuthenticated;
      if (actor) req.user = actor;
      next();
    });
    registerDataFabricRoutes(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/api/financial-models/integrated/runs/${run.id}/artifact`;
      const readUrl = url.replace(/\/artifact$/, "");
      for (const [actor, status] of [[owner, 200], [stranger, 404], [compliance, 403], [client, 403]] as const) {
        const read = await fetch(readUrl, { headers: { "x-test-user": String(actor.id) } });
        assert.equal(read.status, status);
        if (read.ok) {
          const body = await read.json() as { result: IntegratedFinancialModelResult; receipt: { runId: string; resultHash: string } };
          assert.deepEqual(body.result, result);
          assert.equal(body.receipt.runId, run.id);
          assert.equal(body.receipt.resultHash, run.resultHash);
        }
      }
      for (const [actor, body, status] of [
        [owner, {}, 400], [owner, { projectId: project.id, result: {} }, 400], [stranger, { projectId: otherProject.id }, 404],
        [owner, { projectId: otherProject.id }, 404], [compliance, { projectId: project.id }, 403], [client, { projectId: project.id }, 403],
      ] as const) {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-test-user": String(actor.id) }, body: JSON.stringify(body) });
        assert.equal(response.status, status, await response.text());
      }
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-test-user": String(owner.id) }, body: JSON.stringify({ projectId: project.id }) });
      assert.equal(response.status, 200);
      const saved = await response.json() as { artifact: { id: string }; version: { id: string } };
      assert.equal(saved.artifact.id, retained.artifact.id);
      assert.equal(saved.version.id, retained.version.id);
      const unauthorized = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id }) });
      assert.equal(unauthorized.status, 403);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
