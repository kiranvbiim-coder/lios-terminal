import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import type { FinancialDatasetPayload } from "@shared/pointInTimeData";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { SpreadsheetContent } from "@shared/spreadsheetCellLineage";
import { deriveSpreadsheetCellLineageStatus } from "@shared/spreadsheetCellLineage";
import type { TenantContext } from "./tenantContext";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-model-maintenance-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Intentional module-loading boundary: DB singleton must initialize after isolated data-root selection.
const { initDb, getDb, closeDb } = await import("./db");
const { users, organizations, datasetSnapshots, financialModelRuns, dataEntitlementPolicies, artifactInteractionReceipts, projectArtifactVersions } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { stableSnapshotHash } = await import("./pointInTimeDatasetStore");
const { saveFinancialModelRun } = await import("./financialModelRunStore");
const { retainIntegratedModelArtifact } = await import("./integratedModelArtifact");
const { getArtifact, getArtifactVersion, createArtifactVersion, appendArtifactReviewNote, listArtifactInteractionReceipts } = await import("./artifactStore");
const { reviewArtifactIntegratedModelInputs, parseMaintenanceWorkbookInputs } = await import("./artifactIntegratedModelInput");
const { listArtifactModelMaintenanceOptions, reviewArtifactModelMaintenance, applyArtifactModelMaintenance, artifactModelMaintenanceApplySchema, compareMaintenanceSources } = await import("./artifactModelMaintenance");
const { createModelChangeReport } = await import("./artifactModelChangeReport");
const { createArtifactReviewPackage } = await import("./artifactReviewPackage");
const payload = financialDatasetPayloadSchema.parse({ symbol: "MAINT", periods: [{ fiscalYear: "2023", period: "FY", periodEnd: "2023-12-31", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [{ statementType: "income", provider: "user_supplied" }], income: { revenue: 1000.125, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100 }, balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 }, cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 } }] });

function findCell(book: SpreadsheetContent, sheetId: string, path: string, year?: string) {
  const sheet = book.sheets.find(item => item.id === sheetId)!;
  const entry = Object.entries(sheet.cells).find(([, cell]) => (cell.lineage?.sourcePath?.endsWith(path) || cell.lineage?.resultPath?.endsWith(path)) && (!year || cell.lineage?.fiscalYear === year));
  assert.ok(entry, `Fixture missing ${sheetId}:${year ?? ""}:${path}`);
  return { sheet, ref: entry[0], cell: entry[1] };
}

test("SI-04.25 explicit source maintenance keeps one P4 identity, all user work and current verified native lineage", { timeout: 120_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [org, otherOrg] = await getDb().insert(organizations).values([{ name: "Maintenance", slug: crypto.randomUUID() }, { name: "Other", slug: crypto.randomUUID() }]).returning();
  const [owner, foreign, reader] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, name: "Owner", passwordHash: "fixture", role: "internal_analyst" as const, organizationId: org.id },
    { email: `${crypto.randomUUID()}@example.test`, name: "Foreign", passwordHash: "fixture", role: "internal_analyst" as const, organizationId: otherOrg.id },
    { email: `${crypto.randomUUID()}@example.test`, name: "Reader", passwordHash: "fixture", role: "internal_compliance" as const, organizationId: org.id },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, organizationId: org.id, role: owner.role };
  const otherCtx: TenantContext = { userId: foreign.id, organizationId: otherOrg.id, role: foreign.role };
  const project = await createProject(ctx, { name: "Maintained existing model" });
  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["model_input", "display", "derived_output", "export"], attribution: "Owner supplied", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "Native units only" }, owner.id);
  async function snapshot(data: FinancialDatasetPayload, actor = owner, available = "2025-02-15T00:00:00.000Z") {
    const lineage = { sourceRefs: [`https://example.test/maintenance/${crypto.randomUUID()}`] };
    const contentHash = stableSnapshotHash({ payload: data, provider: "user_supplied", lineage });
    const [created] = await getDb().insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey: `financials:MAINT:FY:${crypto.randomUUID()}`, entityKey: "MAINT", dataClass: "financial_statements", schemaVersion: "1.0.0", source: "user_import", provider: "user_supplied", frequency: "annual", currency: "USD", availableAt: new Date(available), retrievedAt: new Date(available), contentHash, quality: { warnings: [] }, lineage, payload: data, createdByUserId: actor.id, organizationId: actor.organizationId, entitlementPolicyId: policy.id }).returning();
    return created;
  }
  const original = await snapshot(payload, owner, "2024-02-15T00:00:00.000Z");
  const targetPayload = structuredClone(payload);
  targetPayload.periods[0].income.revenue = 1010.25;
  targetPayload.periods.push({ ...structuredClone(targetPayload.periods[0]), fiscalYear: "2024", periodEnd: "2024-12-31", filingDate: "2025-02-15", availableAt: "2025-02-15T00:00:00.000Z", income: { ...targetPayload.periods[0].income, revenue: 1120.5 } });
  const target = await snapshot(targetPayload), foreignTarget = await snapshot(targetPayload, foreign), noOp = await snapshot(payload);
  const initialResult = runIntegratedFinancialModel({ datasetSnapshotId: original.id, payload, assumptions: { projectionYears: 2, revenueGrowth: 0.1 }, schedules: { segments: [{ name: "Core", openingRevenue: 1000.125, revenueGrowth: 0.1, cogsPercentRevenue: 0.6, sgaPercentRevenue: 0.2 }] } });
  const initialHash = stableSnapshotHash({ modelVersion: initialResult.modelVersion, datasetContentHash: original.contentHash, assumptions: initialResult.assumptions, specializedSchedules: initialResult.specializedSchedules, forecast: initialResult.forecast });
  const initialRun = await saveFinancialModelRun({ result: initialResult, resultHash: initialHash, createdByUserId: owner.id }); assert.ok(initialRun);
  const retained = await retainIntegratedModelArtifact(ctx, initialRun.id, project.id);
  const baseline = retained.version.content as unknown as SpreadsheetContent;
  const edited = structuredClone(baseline);
  const assumption = findCell(edited, "assumptions", "assumptions.revenueGrowth"); assumption.cell.raw = "0.075"; assumption.cell.format = "0.000%";
  const schedule = findCell(edited, "schedule-inputs", "specializedSchedules.segments.0.revenueGrowth"); schedule.cell.raw = "0.09";
  const formula = findCell(edited, "forecast-income", ".income.revenue", "2025"); formula.cell.raw = "=B2*1.075"; formula.cell.format = "$#,##0.000";
  const actualOverride = findCell(edited, "actuals", ".income.costOfRevenue", "2023"); actualOverride.cell.raw = "650.375";
  const revenue = findCell(edited, "actuals", ".income.revenue", "2023"); revenue.cell.format = "$#,##0.000";
  edited.sheets.find(sheet => sheet.id === "actuals")!.name = "My actuals";
  edited.sheets.find(sheet => sheet.id === "actuals")!.names = { ReportedRevenue: revenue.ref };
  edited.sheets.push({ id: "analyst-work", name: "My sensitivities", rowCount: 20, columnCount: 10, names: { UserCase: "B2" }, cells: { A1: { raw: "Scenario", format: null }, B2: { raw: "=SUM('My actuals'!C6:C8)", format: "0.00" }, C3: { raw: "0.18750000000000001", format: "0.000%" } } });
  edited.activeSheetId = "analyst-work"; edited.rendererPreference = "univer"; edited.calculationMode = "manual";
  const editedVersion = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: 1, content: edited });
  const request = { version: editedVersion.version, contentHash: editedVersion.contentHash, targetDatasetSnapshotId: target.id, targetContentHash: target.contentHash };

  await t.test("complete options expose only compatible currently authorized immutable sources", async () => {
    const options = await listArtifactModelMaintenanceOptions(ctx, retained.artifact.id, { version: request.version, contentHash: request.contentHash });
    assert.equal(options.canApply, true); assert.equal(options.source.runId, initialRun.id);
    assert.ok(options.targets.some(item => item.id === target.id));
    assert.ok(!options.targets.some(item => item.id === foreignTarget.id || item.id === noOp.id));
    assert.deepEqual(options.targets.find(item => item.id === target.id)!.periods.map(item => item.fiscalYear), ["2023", "2024"]);
  });
  const review = await reviewArtifactModelMaintenance(ctx, retained.artifact.id, request);
  await t.test("review binds edited native inputs, every added/restated reported path, formulas and raw overrides", () => {
    assert.equal(review.assumptions.revenueGrowth, 0.075); assert.equal(review.schedules.segments[0].revenueGrowth, 0.09);
    assert.ok(review.changes.some(item => item.kind === "changed" && item.path === "income.revenue" && item.before === 1000.125 && item.after === 1010.25));
    assert.ok(review.changes.some(item => item.kind === "added" && item.periodKey === "2024:FY:2024-12-31" && item.path === "income.revenue" && item.after === 1120.5));
    assert.ok(review.changes.every(item => item.oldSourceHash === original.contentHash && item.newSourceHash === target.contentHash));
    assert.ok(review.preservedCells.some(item => item.cell === formula.ref && item.reason === "formula" && item.raw === "=B2*1.075"));
    assert.ok(review.preservedCells.some(item => item.sheetId === "actuals" && item.cell === actualOverride.ref && item.reason === "user_override"));
    assert.ok(review.preservedCells.some(item => item.sheetId === "analyst-work" && item.raw === "0.18750000000000001"));
  });
  await t.test("foreign actors/snapshots, stale head/content/review hashes and fabricated proof fields fail closed", async () => {
    await assert.rejects(reviewArtifactModelMaintenance(otherCtx, retained.artifact.id, request));
    await assert.rejects(listArtifactModelMaintenanceOptions({ userId: reader.id, organizationId: org.id, role: reader.role }, retained.artifact.id, { version: editedVersion.version, contentHash: editedVersion.contentHash }));
    await assert.rejects(reviewArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, targetDatasetSnapshotId: foreignTarget.id, targetContentHash: foreignTarget.contentHash }), /active tenant/);
    await assert.rejects(reviewArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, version: 1 }), /head moved/);
    await assert.rejects(reviewArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, contentHash: "0".repeat(64) }), /content changed/);
    await assert.rejects(applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: "0".repeat(64) }), /changed/);
    assert.equal(artifactModelMaintenanceApplySchema.safeParse({ ...request, reviewHash: review.reviewHash, verified: true, runId: initialRun.id }).success, false);
  });
  await t.test("revoked uses, unavailable periods, changed immutable payload and incompatible/no-op sources cannot apply", async () => {
    for (const use of ["model_input", "display", "derived_output", "export"]) {
      await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses.filter(item => item !== use) }).where(eq(dataEntitlementPolicies.id, policy.id));
      await assert.rejects(applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash }));
      await getDb().update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses }).where(eq(dataEntitlementPolicies.id, policy.id));
    }
    const corrupt = structuredClone(targetPayload); corrupt.periods[0].income.revenue = 9999;
    await getDb().update(datasetSnapshots).set({ payload: corrupt }).where(eq(datasetSnapshots.id, target.id));
    await assert.rejects(applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash }), /immutable content hash/);
    await getDb().update(datasetSnapshots).set({ payload: targetPayload }).where(eq(datasetSnapshots.id, target.id));
    await assert.rejects(reviewArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, targetDatasetSnapshotId: noOp.id, targetContentHash: noOp.contentHash }), /no-op/);
    assert.throws(() => compareMaintenanceSources(original, { ...target, currency: "EUR" }), /same entity/);
    const future = await snapshot(targetPayload, owner, "2099-01-01T00:00:00.000Z");
    await assert.rejects(reviewArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, targetDatasetSnapshotId: future.id, targetContentHash: future.contentHash }), /not currently available/);
  });
  await t.test("formula engine inputs are an explicit gap, never replaced with persisted old assumptions", () => {
    const formulaInput = structuredClone(edited); findCell(formulaInput, "assumptions", "assumptions.revenueGrowth").cell.raw = "=0.075";
    assert.throws(() => parseMaintenanceWorkbookInputs(formulaInput, baseline, { assumptions: initialResult.assumptions, specializedSchedules: initialResult.specializedSchedules }), /formula/);
  });
  await t.test("engine/source identity revision changes invalidate review before any retained write", async () => {
    await getDb().update(financialModelRuns).set({ modelVersion: "changed-revision" }).where(eq(financialModelRuns.id, initialRun.id));
    await assert.rejects(applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash }));
    await getDb().update(financialModelRuns).set({ modelVersion: initialRun.modelVersion }).where(eq(financialModelRuns.id, initialRun.id));
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, editedVersion.version);
  });
  const applied = await applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash });
  await t.test("one new same-Artifact version refreshes untouched actuals semantically and retains formula/custom/native work", async () => {
    assert.equal(applied.artifact.id, retained.artifact.id); assert.equal(applied.version.version, editedVersion.version + 1); assert.equal(applied.receipt.replayed, false);
    const workbook = applied.version.content as unknown as SpreadsheetContent;
    const refreshed = findCell(workbook, "actuals", ".income.revenue", "2023"); assert.equal(refreshed.cell.raw, "1010.25"); assert.equal(refreshed.ref, revenue.ref); assert.equal(refreshed.cell.format, "$#,##0.000");
    assert.equal(refreshed.cell.lineage?.modelRunId, applied.receipt.runId); assert.equal(deriveSpreadsheetCellLineageStatus(refreshed.cell), "current");
    const added = findCell(workbook, "actuals", ".income.revenue", "2024"); assert.equal(added.cell.raw, "1120.5"); assert.equal(added.cell.lineage?.datasetSnapshotId, target.id);
    const maintainedFormula = workbook.sheets.find(sheet => sheet.id === "forecast-income")!.cells[formula.ref]; assert.equal(maintainedFormula.raw, "=B2*1.075"); assert.equal(maintainedFormula.lineage?.custody, "imported_history"); assert.notEqual(deriveSpreadsheetCellLineageStatus(maintainedFormula), "current");
    assert.equal(workbook.sheets.find(sheet => sheet.id === "actuals")!.cells[actualOverride.ref].raw, "650.375");
    assert.deepEqual(workbook.sheets.find(sheet => sheet.id === "analyst-work"), edited.sheets.find(sheet => sheet.id === "analyst-work"));
    assert.equal(workbook.activeSheetId, edited.activeSheetId); assert.equal(workbook.rendererPreference, edited.rendererPreference); assert.equal(workbook.calculationMode, edited.calculationMode);
    assert.deepEqual(workbook.sheets.find(sheet => sheet.id === "actuals")!.names, { ReportedRevenue: revenue.ref });
    assert.equal(workbook.sheets.find(sheet => sheet.id === "actuals")!.name, "My actuals");
    assert.ok(applied.version.refreshSpec?.engineRef?.endsWith(applied.receipt.runId)); assert.equal(applied.version.trustManifest, null); assert.deepEqual(applied.version.executionReceiptIds, []);
    assert.ok(applied.version.sourceRefs.includes(`dataset-snapshot:${target.id}`)); assert.ok(!applied.version.sourceRefs.includes(`dataset-snapshot:${original.id}`)); assert.ok(applied.version.dependencyRefs.includes(`dataset-snapshot:${original.id}`));
    const nextInputs = await reviewArtifactIntegratedModelInputs(ctx, retained.artifact.id, { version: applied.version.version }); assert.equal(nextInputs.assumptions.revenueGrowth, 0.075); assert.equal(nextInputs.source.datasetSnapshotId, target.id);
    assert.deepEqual((await getArtifactVersion(ctx, retained.artifact.id, applied.version.version)).content, applied.version.content);
  });
  await t.test("recorded restatement report retains exact source changes and downstream paths without rerunning the model", async () => {
    const input = { fromVersion: editedVersion.version, toVersion: applied.version.version, toContentHash: applied.version.contentHash };
    const saved = await createModelChangeReport(ctx, retained.artifact.id, input);
    const replay = await createModelChangeReport(ctx, retained.artifact.id, input);
    assert.equal(replay.artifact.id, saved.artifact.id);
    const report = saved.version.content as { blocks: { attrs: { table?: { rows: Record<string, string>[] } } }[] };
    const rows = report.blocks.find(block => block.attrs.table)?.attrs.table?.rows ?? [];
    assert.ok(rows.some(row => row.category === "reported_actual" && row.before === "1000.125" && row.after === "1010.25"));
    assert.ok(rows.some(row => row.category === "engine_output" && row.metric.includes("forecast")));
    assert.ok(saved.version.sourceRefs.includes(`${retained.artifact.id}@v${editedVersion.version}`));
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, applied.version.version);
    await assert.rejects(createModelChangeReport(otherCtx, retained.artifact.id, input));
    await assert.rejects(createModelChangeReport(ctx, retained.artifact.id, { ...input, toContentHash: "0".repeat(64) }));
  });
  await t.test("version-bound annotations and resolutions retain append-only review custody without approving or rewriting work", async () => {
    const input = { version: applied.version.version, contentHash: applied.version.contentHash, text: "Review revenue restatement before decision", anchor: "actuals:revenue" };
    const first = await appendArtifactReviewNote(ctx, retained.artifact.id, input);
    const resolved = await appendArtifactReviewNote(ctx, retained.artifact.id, { ...input, text: "Source review completed; decision approval remains separate", status: "resolved", supersedes: first.id });
    const receipts = await listArtifactInteractionReceipts(ctx, retained.artifact.id);
    assert.ok(receipts.some(receipt => receipt.id === first.id && receipt.detail.reviewNote));
    assert.ok(receipts.some(receipt => receipt.id === resolved.id && receipt.detail.reviewNote));
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, applied.version.version);
    await assert.rejects(appendArtifactReviewNote(otherCtx, retained.artifact.id, input));
    await assert.rejects(appendArtifactReviewNote(ctx, retained.artifact.id, { ...input, contentHash: "0".repeat(64) }));
    const pkg = await createArtifactReviewPackage(ctx, retained.artifact.id, { version: input.version, contentHash: input.contentHash });
    assert.ok(JSON.stringify(pkg.version.content).includes(first.id));
    assert.ok(JSON.stringify(pkg.version.content).includes("decision approval remains separate"));
    assert.ok(pkg.version.sourceRefs.includes(`${retained.artifact.id}@v${input.version}`));
  });
  await t.test("durable replay after subsequent head advance/reopen returns the exact already committed version", async () => {
    const post = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: applied.version.version, content: applied.version.content as unknown as SpreadsheetContent, note: "Later saved view" });
    const replay = await applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash });
    assert.equal(replay.receipt.replayed, true); assert.equal(replay.version.id, applied.version.id); assert.equal(replay.version.version, applied.version.version); assert.equal(replay.artifact.headVersion, post.version);
    const receipts = await getDb().select().from(artifactInteractionReceipts).where(and(eq(artifactInteractionReceipts.artifactId, retained.artifact.id), eq(artifactInteractionReceipts.toVersion, applied.version.version)));
    assert.equal(receipts.filter(receipt => receipt.detail.modelMaintenance).length, 1);
    const versions = await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, retained.artifact.id)); assert.equal(versions.length, 4);
    await closeDb(); await initDb();
    assert.equal((await applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...request, reviewHash: review.reviewHash })).version.id, applied.version.id);
  });
  await t.test("foreign global native result deduplication is never retained under owner authority", async () => {
    const head = await getArtifactVersion(ctx, retained.artifact.id), nextPayload = structuredClone(targetPayload); nextPayload.periods[1].income.revenue = 1222;
    const next = await snapshot(nextPayload);
    const nextRequest = { version: head.version, contentHash: head.contentHash, targetDatasetSnapshotId: next.id, targetContentHash: next.contentHash };
    const nextReview = await reviewArtifactModelMaintenance(ctx, retained.artifact.id, nextRequest);
    const result = runIntegratedFinancialModel({ datasetSnapshotId: next.id, payload: nextPayload, assumptions: nextReview.assumptions, schedules: nextReview.schedules });
    const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: next.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
    const foreignRun = await saveFinancialModelRun({ result, resultHash, createdByUserId: foreign.id }); assert.equal(foreignRun?.createdByUserId, foreign.id);
    await assert.rejects(applyArtifactModelMaintenance(ctx, retained.artifact.id, { ...nextRequest, reviewHash: nextReview.reviewHash }), /another actor/);
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, head.version);
  });
});
