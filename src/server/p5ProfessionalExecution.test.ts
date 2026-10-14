import assert from "node:assert/strict";
import test from "node:test";
import { p5AdvancedModelPathSchema, p5ReconciliationSchema } from "@shared/p5ProfessionalContracts";
import { reportArtifactContentSchema, tableArtifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { ADVANCED_QUANT_PATHS, executeAdvancedQuant } from "./advancedQuantExecution";
import {
  buildP5AdvancedArtifact,
  buildP5ReportFromArtifact,
  p5ArtifactTypeForModelPath,
} from "./p5ProfessionalExecution";
import { REPORT_TEMPLATES } from "./reportEngine";

test("P5 professional model registry only exposes executable advanced-quant paths", () => {
  const executable = new Set<string>(ADVANCED_QUANT_PATHS);
  for (const path of p5AdvancedModelPathSchema.options) {
    assert.equal(executable.has(path), true, path);
  }
});

test("P5 advanced execution becomes a versionable Valuation Artifact with deterministic receipt lineage", async () => {
  const run = await executeAdvancedQuant(
    "valuation/reverse-dcf",
    { revenue: 100, margin: 0.2 },
    {
      callEngine: async () => ({ impliedGrowth: 0.07, status: "complete" }),
      runId: "p5_reverse_dcf_test",
      calculatedAt: "2026-09-26T12:00:00.000Z",
    },
  );
  const artifact = buildP5AdvancedArtifact({
    projectId: 21,
    symbol: "AAPL",
    modelPath: "valuation/reverse-dcf",
    parameters: { revenue: 100, margin: 0.2 },
    run,
    runtimeReceiptId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(artifact.artifactType, "valuation");
  assert.equal(artifact.data.kind, "valuation");
  if (artifact.data.kind !== "valuation") throw new Error("Expected valuation Artifact.");
  assert.equal(artifact.data.summary.modelPath, "valuation/reverse-dcf");
  assert.equal(artifact.data.summary.modelVersion, run.receipt.modelVersion);
  assert.equal(artifact.data.summary.inputSnapshotHash, run.receipt.inputSnapshotHash);
  assert.equal(artifact.data.summary.outputSnapshotHash, run.receipt.outputSnapshotHash);
  const reconciliation = p5ReconciliationSchema.parse(artifact.data.summary.professionalReconciliation);
  assert.equal(reconciliation.inputHash, run.receipt.inputSnapshotHash);
  assert.equal(reconciliation.outputHash, run.receipt.outputSnapshotHash);
  assert.equal(reconciliation.calculatorOfRecord, `${run.receipt.modelId}@${run.receipt.modelVersion}`);
  const exportProfile = artifact.data.summary.professionalExport as { authority: string; formats: string[] };
  assert.equal(exportProfile.authority, "p4_artifact_export_plan");
  assert.equal(exportProfile.formats.includes("xlsx"), true);
  assert.equal(exportProfile.formats.includes("pdf"), true);
  assert.equal(exportProfile.formats.includes("pptx"), true);
  assert.equal(artifact.sourceRefs.includes(`model:${run.receipt.modelId}@${run.receipt.modelVersion}`), true);
});

test("P5 maps cross-asset advanced models to the canonical Artifact families", () => {
  assert.equal(p5ArtifactTypeForModelPath("valuation/eva"), "valuation");
  assert.equal(p5ArtifactTypeForModelPath("portfolio/black-litterman"), "portfolio");
  assert.equal(p5ArtifactTypeForModelPath("risk/tail-report"), "portfolio");
  assert.equal(p5ArtifactTypeForModelPath("fixed-income/key-rate-risk"), "report");
  assert.equal(p5ArtifactTypeForModelPath("derivatives/black-scholes-greeks"), "report");
  assert.equal(p5ArtifactTypeForModelPath("macro/recession-probability"), "report");
  assert.equal(p5ArtifactTypeForModelPath("research/filing-diff"), "report");
});

test("P5 professional report assembly preserves a source Artifact without analytical recalculation", () => {
  const report = buildP5ReportFromArtifact({
    projectId: 21,
    sourceArtifactId: "artifact:11111111-1111-4111-8111-111111111111@v3",
    sourceTitle: "AAPL Reverse DCF",
    sourceContent: {
      kind: "valuation",
      symbol: "AAPL",
      modelId: "python.advanced.valuation.reverse-dcf",
      assumptions: { revenue: 100, margin: 0.2 },
      outputs: { impliedGrowth: 0.07, recordedDecimal: "9007199254740993.25", sensitivity: { recordedValues: ["0.100000000000000001", "0.200000000000000001"] } },
      summary: { modelPath: "valuation/reverse-dcf" },
    },
    sourceRefs: ["model:python.advanced.valuation.reverse-dcf@1.0.0"],
    receiptId: "22222222-2222-4222-8222-222222222222",
    reconciliation: {
      calculatorOfRecord: "lios.p5.report-assembler",
      deterministic: true,
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      validationLevel: null,
      sourceArtifactRef: "artifact:11111111-1111-4111-8111-111111111111@v3",
      analyticalRecalculation: false,
    },
  });
  assert.equal(report.artifactType, "report");
  assert.equal(report.sourceRefs.includes("artifact:11111111-1111-4111-8111-111111111111@v3"), true);
  assert.equal(report.data.kind, "report");
  if (report.data.kind !== "report") throw new Error("Expected report Artifact.");
  const rendered = report.data.blocks.map((block) => block.text).join("\n");
  assert.match(rendered, /does not recalculate or reinterpret deterministic outputs/i);
  const metadata = report.data.blocks[0]?.attrs as Record<string, any>;
  const reconciliation = p5ReconciliationSchema.parse(metadata.professionalReconciliation);
  assert.equal(reconciliation.analyticalRecalculation, false);
  assert.equal(reconciliation.sourceArtifactRef, "artifact:11111111-1111-4111-8111-111111111111@v3");
  assert.equal(metadata.professionalExport.authority, "p4_artifact_export_plan");
  assert.equal(metadata.professionalExport.formats.includes("pdf"), true);
  assert.equal(metadata.professionalExport.formats.includes("pptx"), true);
  assert.equal(report.data.blocks.some((block) => block.type === "code"), false);
  const values = report.data.blocks.filter((block) => block.type === "table")
    .flatMap((block) => tableArtifactContentSchema.parse(block.attrs.table).rows.flatMap((row) => Object.values(row)));
  assert.ok(values.includes(0.07));
  assert.ok(values.includes("9007199254740993.25"));
  assert.ok(report.data.blocks.some((block) => block.type === "bullet_list" && block.text.includes("0.100000000000000001")));
  assert.ok(report.data.blocks.every((block) => block.attrs.sourceArtifactId === "artifact:11111111-1111-4111-8111-111111111111@v3"));
  assert.deepEqual(report.executionReceiptIds, ["22222222-2222-4222-8222-222222222222"]);
  reportArtifactContentSchema.parse(report.data);
});

test("P5 three-statement modeling remains a valuation/model Artifact family", () => {
  assert.equal(p5ArtifactTypeForModelPath("financial-modeling/three-statement"), "valuation");
});

test("DCF sensitivity receipt becomes a canonical Valuation Artifact with matching hashes", async () => {
  const parameters = {
    freeCashFlows: [100, 110, 120],
    waccPct: 10,
    terminalMethod: "gordon_growth",
    terminalGrowthPct: 3,
    netDebt: 50,
    sharesOutstanding: 10,
    waccGridPct: [9, 10, 11],
    terminalGrowthGridPct: [2, 3, 4],
    bearCase: { freeCashFlows: [90, 95, 100], waccPct: 11, terminalMethod: "gordon_growth", terminalGrowthPct: 2 },
    bullCase: { freeCashFlows: [110, 125, 140], waccPct: 9, terminalMethod: "gordon_growth", terminalGrowthPct: 4 },
  };
  const run = await executeAdvancedQuant("valuation/dcf-sensitivity", parameters, {
    callEngine: async () => ({
      base: { valuePerShare: 154.85832349468714 },
      sensitivity: { waccPct: [9, 10, 11], terminalGrowthPct: [2, 3, 4], valuePerShareMatrix: [] },
      scenarios: {},
    }),
    runId: "p5_dcf_sensitivity_test",
    calculatedAt: "2026-10-03T12:00:00.000Z",
  });
  const artifact = buildP5AdvancedArtifact({
    projectId: 21,
    symbol: "AAPL",
    modelPath: "valuation/dcf-sensitivity",
    parameters,
    run,
    runtimeReceiptId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(artifact.artifactType, "valuation");
  if (artifact.data.kind !== "valuation") throw new Error("Expected valuation Artifact.");
  assert.equal(artifact.data.summary.modelPath, "valuation/dcf-sensitivity");
  assert.equal(artifact.data.summary.validationLevel, "known_answer");
  assert.equal(artifact.data.summary.inputSnapshotHash, run.receipt.inputSnapshotHash);
  assert.equal(artifact.data.summary.outputSnapshotHash, run.receipt.outputSnapshotHash);
  const reconciliation = p5ReconciliationSchema.parse(artifact.data.summary.professionalReconciliation);
  assert.equal(reconciliation.inputHash, run.receipt.inputSnapshotHash);
  assert.equal(reconciliation.outputHash, run.receipt.outputSnapshotHash);
  assert.equal(artifact.executionReceiptIds[0], "33333333-3333-4333-8333-333333333333");
});

test("P5 source report assembly preserves canonical Table values and version lineage without numeric coercion", () => {
  const source: Extract<ArtifactContent, { kind: "table" }> = {
    kind: "table",
    columns: [
      { key: "period", label: "Recorded period", type: "string" },
      { key: "revenue", label: "Recorded revenue", type: "currency" },
    ],
    rows: [
      { period: "2025", revenue: "9007199254740993.25" },
      { period: "2026", revenue: "10000000000000000.5" },
    ],
  };
  const input = {
    projectId: 21,
    sourceArtifactId: "artifact:11111111-1111-4111-8111-111111111111@v7",
    sourceTitle: "Recorded Revenue",
    sourceContent: source,
    sourceRefs: ["provider:recorded"],
    receiptId: "22222222-2222-4222-8222-222222222222",
  };
  const report = buildP5ReportFromArtifact(input);
  const repeated = buildP5ReportFromArtifact(input);
  assert.equal(report.data.kind, "report");
  assert.equal(repeated.data.kind, "report");
  if (report.data.kind !== "report" || repeated.data.kind !== "report") throw new Error("Expected report Artifact.");
  assert.deepEqual(report.data.blocks, repeated.data.blocks);
  const tableBlocks = report.data.blocks.filter((block) => block.type === "table");
  const sourceTable = tableBlocks.find((block) => tableArtifactContentSchema.parse(block.attrs.table).columns.some((column) => column.key === "revenue"));
  assert.ok(sourceTable);
  assert.deepEqual(sourceTable.attrs.table, source);
  assert.equal(sourceTable.attrs.sourceArtifactId, input.sourceArtifactId);
  assert.deepEqual(sourceTable.attrs.sourceRefs, [input.sourceArtifactId, "provider:recorded"]);
  assert.deepEqual(sourceTable.attrs.executionReceiptIds, [input.receiptId]);
  assert.equal(report.data.blocks.some((block) => block.type === "code" || block.type === "chart_ref"), false);
  assert.ok(report.data.blocks.some((block) => block.attrs.chartUnavailable === true));
  assert.ok(report.data.blocks.some((block) => block.attrs.sectionType === "key_metrics" && block.attrs.missing === true));
  assert.ok(report.data.sections.every((section) => section.blockIds.every((id) => report.data.kind === "report" && report.data.blocks.some((block) => block.id === id))));
  reportArtifactContentSchema.parse(report.data);
});

test("explicit templates control report title, section order, exact recorded values and report identity", () => {
  const source: Extract<ArtifactContent, { kind: "table" }> = {
    kind: "table",
    columns: [{ key: "recorded", label: "Recorded amount", type: "currency" }],
    rows: [{ recorded: "9007199254740993.250000001" }],
  };
  const sourceArtifactId = "artifact:11111111-1111-4111-8111-111111111111@v7";
  const hashes = new Set<unknown>();
  for (const template of REPORT_TEMPLATES) {
    const report = buildP5ReportFromArtifact({
      projectId: 21, sourceArtifactId, sourceTitle: "Recorded source",
      sourceContent: source, sourceRefs: ["user:recorded"], receiptId: "22222222-2222-4222-8222-222222222222",
      templateId: template.id,
    });
    assert.equal(report.title, `Recorded source · ${template.name}`);
    if (report.data.kind !== "report") throw new Error("Expected report.");
    assert.equal(report.data.templateId, template.id);
    reportArtifactContentSchema.parse(report.data);
    assert.deepEqual(report.data.sections.map((section) =>
      report.data.kind === "report" ? report.data.blocks.find((block) => block.id === section.blockIds[0])?.attrs.sectionType : null),
    template.sectionOrder);
    assert.ok(report.data.blocks.every((block) => block.attrs.sourceArtifactId === sourceArtifactId && block.attrs.templateId === template.id));
    if (template.sectionOrder.includes("table")) {
      assert.ok(report.data.blocks.some((block) => block.type === "table" && JSON.stringify(block.attrs.table) === JSON.stringify(source)));
    }
    if (template.sectionOrder.includes("key_metrics")) {
      assert.ok(report.data.blocks.some((block) => block.attrs.sectionType === "key_metrics" && block.attrs.missing === true));
    }
    assert.equal(report.data.blocks.some((block) => block.type === "chart_ref" || block.type === "code"), false);
    hashes.add(report.data.blocks[0].attrs.reportOutputHash);
  }
  assert.equal(hashes.size, REPORT_TEMPLATES.length);
});
