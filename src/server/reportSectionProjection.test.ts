import assert from "node:assert/strict";
import test from "node:test";
import { reportArtifactContentSchema, tableArtifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { generateReportPack, REPORT_TEMPLATES } from "./reportEngine";
import { projectReportSections, reportSectionsFromArtifact, type ReportSectionProjection } from "./reportSectionProjection";

const recordedTable: Extract<ArtifactContent, { kind: "table" }> = {
  kind: "table",
  columns: [{ key: "period", label: "Recorded period", type: "string" }, { key: "revenue", label: "Recorded revenue", type: "currency" }],
  rows: [{ period: "2025", revenue: "9007199254740993.25" }, { period: "2026", revenue: "10000000000000000.5" }],
};

function tables(projection: ReportSectionProjection) {
  return projection.blocks.filter((block) => block.type === "table").map((block) => tableArtifactContentSchema.parse(block.attrs.table));
}

test("all eight report templates project semantic blocks and explicit missing sections in template order", () => {
  for (const template of REPORT_TEMPLATES) {
    const pack = generateReportPack({ templateId: template.id, title: `${template.name} fixture`, sectionData: {} });
    const projection = projectReportSections(pack);
    reportArtifactContentSchema.parse({ kind: "report", templateId: pack.templateId, ...projection });
    assert.deepEqual(projection.sections.map((section) => section.title), pack.sections.map((section) => section.title));
    assert.equal(projection.blocks[0].text, `${template.name} fixture`);
    assert.equal(projection.blocks.some((block) => block.type === "code"), false);
    for (const [index, section] of projection.sections.entries()) {
      assert.equal(section.id, `section-${index + 1}`);
      assert.equal(section.blockIds[0], `block-${index + 1}`);
      assert.ok(section.blockIds.every((id) => projection.blocks.some((block) => block.id === id)));
    }
    assert.ok(projection.blocks.some((block) => block.type === "callout" && block.attrs.missing === true));
  }
});

test("projection preserves canonical columns, exact decimal text, row order, source versions and receipts", () => {
  const pack = generateReportPack({ templateId: "company_tearsheet", title: "Recorded company data", sectionData: { table: recordedTable } });
  const sourceRef = "artifact:recorded-table@v3";
  const projection = projectReportSections(pack, {
    blockIdPrefix: "section",
    attrs: { sourceArtifactId: sourceRef, sourceRefs: [sourceRef], executionReceiptIds: ["receipt-recorded"] },
    firstBlockAttrs: { professionalReconciliation: { analyticalRecalculation: false }, professionalExport: { authority: "p4_artifact_export_plan" } },
  });
  assert.deepEqual(tables(projection), [recordedTable]);
  const table = projection.blocks.find((block) => block.type === "table")!;
  assert.equal(table.attrs.table, recordedTable);
  assert.equal(table.attrs.sourceArtifactId, sourceRef);
  assert.deepEqual(table.attrs.sourceRefs, [sourceRef]);
  assert.deepEqual(table.attrs.executionReceiptIds, ["receipt-recorded"]);
  assert.equal(table.attrs.reportOutputHash, pack.metadata.outputHash);
  assert.deepEqual(projection.blocks[0].attrs.professionalReconciliation, { analyticalRecalculation: false });
});

test("nested structured models retain named finite scalar fields and bounded tables without generated interpretation", () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ period: `P${index}`, value: `${index}.000000000000000001`, nested: { flag: index === 0 } }));
  const pack = generateReportPack({ templateId: "dcf_model_pack", title: "Recorded model", sectionData: {
    summary: { statement: "The author's existing statement.", confidence: "0.700000000000000001" },
    key_metrics: { scenarios: { base: { result: "9007199254740993.25", enabled: false, count: 0, unknown: null } }, rows },
    assumptions: { discountRate: "0.100000000000000001" },
    limitations: ["No external validation supplied."],
    sources: ["provider:recorded", "artifact:source@v7"],
  } });
  const projection = projectReportSections(pack);
  const payloads = tables(projection);
  assert.ok(payloads.every((table) => table.rows.length <= 100));
  const values = payloads.flatMap((table) => table.rows.flatMap((row) => Object.values(row)));
  for (const exact of ["9007199254740993.25", "0.700000000000000001", "0.100000000000000001", false, 0, null]) assert.ok(values.includes(exact));
  assert.equal(payloads.filter((table) => table.columns.some((column) => column.key === "period")).flatMap((table) => table.rows).length, 205);
  assert.ok(projection.blocks.some((block) => block.type === "heading" && /scenarios.*base/.test(block.text)));
  assert.ok(projection.blocks.some((block) => block.type === "paragraph" && block.text === "The author's existing statement."));
  assert.ok(projection.blocks.some((block) => block.type === "bullet_list" && block.text === "No external validation supplied."));
  assert.ok(projection.blocks.some((block) => block.type === "bullet_list" && block.text.includes("artifact:source@v7")));
  assert.equal(projection.blocks.some((block) => block.type === "code" || block.text.includes('"scenarios":')), false);
  assert.equal(projection.blocks.some((block) => /recommendation|upside|buy|sell/i.test(block.text)), false);
});

test("projection is deterministic under reordered structured object keys", () => {
  const first = generateReportPack({ templateId: "risk_report", title: "Recorded risk", sectionData: { key_metrics: { z: "3.000", a: { y: false, x: 0 } } } });
  const second = generateReportPack({ templateId: "risk_report", title: "Recorded risk", sectionData: { key_metrics: { a: { x: 0, y: false }, z: "3.000" } } });
  assert.deepEqual(projectReportSections(first), projectReportSections(second));
});

test("charts are explicitly unavailable unless a recorded chart reference exists", () => {
  const pack = generateReportPack({ templateId: "company_tearsheet", title: "No fabricated chart", sectionData: { chart_placeholder: { description: "Recorded chart is unavailable.", series: [] } } });
  const unavailable = projectReportSections(pack);
  assert.equal(unavailable.blocks.some((block) => block.type === "chart_ref"), false);
  assert.ok(unavailable.blocks.some((block) => block.attrs.chartUnavailable === true));
  assert.ok(unavailable.blocks.some((block) => block.text === "Recorded chart is unavailable."));
  const referenced = projectReportSections(generateReportPack({ templateId: "company_tearsheet", title: "Recorded chart", sectionData: { chart_placeholder: { artifactRef: "artifact:chart@v4", title: "Recorded series" } } }));
  assert.equal(referenced.blocks.find((block) => block.type === "chart_ref")?.attrs.artifactRef, "artifact:chart@v4");
  assert.equal(referenced.blocks.some((block) => block.attrs.chartUnavailable === true), false);
});

test("canonical data uses exact preview rows and declared columns, explicitly distinguishing full row count", () => {
  const data: Extract<ArtifactContent, { kind: "data" }> = {
    kind: "data", columns: [{ name: "revenue", type: "decimal128" }],
    previewRows: [{ revenue: "9007199254740993.25" }], rowCount: 1000, columnarArtifactId: "artifact:columnar@v2", rendererPreference: "virtual_table",
  };
  const projection = projectReportSections(generateReportPack({ templateId: "company_tearsheet", title: "Recorded preview", sectionData: reportSectionsFromArtifact(data) }));
  assert.deepEqual(tables(projection)[0].rows, data.previewRows);
  const table = projection.blocks.find((block) => block.type === "table")!;
  assert.deepEqual(table.attrs.dataColumns, data.columns);
  assert.equal(table.attrs.columnarArtifactId, data.columnarArtifactId);
  assert.equal(table.attrs.rowCount, 1000);
  assert.ok(projection.blocks.some((block) => /1 recorded preview rows; recorded row count: 1000/.test(block.text)));
});

test("selected rich reports preserve authored prose and opaque canonical table payloads", () => {
  const source: Extract<ArtifactContent, { kind: "report" }> = {
    kind: "report", templateId: null, editorPreference: "tiptap", sections: [], blocks: [
      { id: "author-paragraph", type: "paragraph", text: "Author explicitly recommends further diligence.", attrs: { sourceRefs: ["source:author"] } },
      { id: "author-table", type: "table", text: "Recorded source data", attrs: { table: recordedTable } },
    ],
  };
  const projection = projectReportSections(generateReportPack({ templateId: "investment_memo", title: "Source report", sectionData: reportSectionsFromArtifact(source) }));
  assert.ok(projection.blocks.some((block) => block.text === source.blocks[0].text && block.attrs.sourceBlockId === "author-paragraph"));
  assert.deepEqual(tables(projection), [recordedTable]);
});

test("optional projection metadata is JSON-stable without inventing absent engine or receipt custody", () => {
  const pack = generateReportPack({
    templateId: "company_tearsheet", title: "Recorded without engine metadata",
    sectionData: { table: recordedTable },
  });
  const projection = projectReportSections({ ...pack, metadata: { outputHash: pack.metadata.outputHash, passportIds: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(projection)), projection);
  for (const block of projection.blocks) {
    assert.equal(Object.hasOwn(block.attrs, "engineId"), false);
    assert.equal(Object.hasOwn(block.attrs, "engineVersion"), false);
    assert.equal(Object.hasOwn(block.attrs, "receiptId"), false);
  }
  const withCustody = projectReportSections({
    ...pack, metadata: { outputHash: pack.metadata.outputHash, passportIds: ["passport:recorded"],
      engineId: "recorded-engine", engineVersion: "2.0", receiptId: "receipt:recorded" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(withCustody)), withCustody);
  for (const block of withCustody.blocks) {
    assert.equal(block.attrs.engineId, "recorded-engine");
    assert.equal(block.attrs.engineVersion, "2.0");
    assert.equal(block.attrs.receiptId, "receipt:recorded");
    assert.deepEqual(block.attrs.passportIds, ["passport:recorded"]);
  }
});
