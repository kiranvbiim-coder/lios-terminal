import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import { assembleProfessionalWorkPackage, professionalWorkPackageRequestSchema } from "./professionalWorkPackage";
import { buildArtifactDocx } from "../client/src/lib/exportDocx";
import { readOfficeArtifactRoundtrip } from "@shared/officeArtifactRoundtrip";
const table = artifactContentSchema.parse({ kind: "table", columns: [{ key: "amount", label: "Amount", type: "string" }], rows: [{ amount: "9007199254740993.25" }] });
for (const workflow of ["ic_memo", "credit_memo", "deal_memo", "board_materials", "banking_pitch", "client_proposal", "client_report"] as const) test(`${workflow} publishes only selected exact evidence and authored analysis, retaining native source custody`, async () => {
  const input = professionalWorkPackageRequestSchema.parse({ projectId: 1, workflow, title: "Authored package", audience: "Committee", reportingPeriod: "FY2025", sources: [{ artifactId: "artifact:source", version: 2, contentHash: "a".repeat(64), role: "evidence" }], authoredSections: [{ title: "Executive recommendation", text: "Authored conditional recommendation" }] });
  const assembled = assembleProfessionalWorkPackage(input, [{ id: "artifact:source", version: 2, hash: "a".repeat(64), title: "Exact observations", role: "evidence", content: table, sourceRefs: ["source:owned"] }]);
  if (assembled.content.kind !== "report") throw new Error("Expected report.");
  assert.ok(assembled.content.blocks.some(block => block.text.includes("Not supplied:")));
  const captured = assembled.content.blocks.find(block => block.type === "table")!;
  assert.deepEqual(captured.attrs.table, table);
  assert.ok(assembled.sourceRefs.includes("artifact:source@v2"));
  const plan = { artifactId: "artifact:package", version: 1, contentHash: "b".repeat(64), kind: "report" as const, formats: ["docx" as const], filenameStem: "Package", sourceRefs: assembled.sourceRefs };
  assert.deepEqual((await readOfficeArtifactRoundtrip(buildArtifactDocx(plan, assembled.content).bytes, "docx")).content, assembled.content);
});

test("professional source appendices use semantic projection while retaining every exact source payload and dependency", () => {
  const sources = [
    artifactContentSchema.parse({
      kind: "valuation", symbol: "ABC", modelId: "recorded-only",
      assumptions: { exactDecimal: "9007199254740993.2500", formula: "=A1+B2" },
      outputs: { nested: { missing: null, observed: 0, cases: [{ name: "Downside", value: "-000.125" }] } },
      summary: { caveat: "Authored observations, not refreshed" },
    }),
    artifactContentSchema.parse({
      kind: "spreadsheet", activeSheetId: "authored", sheets: [{ id: "authored", name: "Authored", rowCount: 5, columnCount: 5,
        cells: { A1: { raw: "00012.50000", format: "0.00000" }, B1: { raw: "=SUM(A1:A5)", format: null } } }],
    }),
    artifactContentSchema.parse({
      kind: "report", templateId: "investment_memo",
      blocks: [{ id: "original", type: "paragraph", text: "Authored source explanation",
        attrs: { sourceRefs: ["source:exact"], custom: { decimals: ["000.125", null], nested: { retained: true } } } }],
      sections: [{ id: "native-section", title: "Native source order", blockIds: ["original"] }],
    }),
    artifactContentSchema.parse({
      kind: "chart", chartType: "line", series: [{ id: "exact", label: "Recorded", points: [{ x: "FY2025", y: 0 }] }],
      options: { authored: { color: "#123456", opaque: [null, true] } },
    }),
  ];
  const input = professionalWorkPackageRequestSchema.parse({
    projectId: 1, workflow: "ic_memo", title: "Recorded sources", audience: "Committee", reportingPeriod: "FY2025",
    sources: sources.map((_, index) => ({ artifactId: `artifact:source-${index}`, version: 2, contentHash: "a".repeat(64), role: "evidence" })),
    authoredSections: [{ title: "Executive recommendation", text: "Authored conditional recommendation" }],
  });
  const snapshots = sources.map((content, index) => ({
    id: `artifact:source-${index}`, version: 2, hash: "a".repeat(64), title: `Source ${index}`, role: "evidence",
    content, sourceRefs: ["source:exact"], dependencyRefs: [`entitlement-policy:source-${index}`], executionReceiptIds: [`receipt:source-${index}`],
  }));
  const assembled = assembleProfessionalWorkPackage(input, snapshots);
  if (assembled.content.kind !== "report") throw new Error("Expected report");
  const blocks = assembled.content.blocks;
  for (const [index, source] of sources.entries()) {
    const header = blocks.find(block => block.id === `source-heading-${index}`)!;
    assert.deepEqual(header.attrs.sourceContent, source);
    assert.deepEqual(header.attrs.executionReceiptIds, [`receipt:source-${index}`]);
    assert.ok(assembled.dependencyRefs.includes(`entitlement-policy:source-${index}`));
  }
  assert.ok(!blocks.some(block => block.type === "code"));
  assert.ok(blocks.some(block => block.type === "paragraph" && block.text === "Authored source explanation"));
  assert.ok(blocks.some(block => block.type === "chart_ref" && block.attrs.artifactRef === "artifact:source-3"));
  const tables = blocks.filter(block => block.type === "table").map(block => block.attrs.table);
  assert.ok(JSON.stringify(tables).includes("9007199254740993.2500"));
  assert.ok(JSON.stringify(tables).includes("=SUM(A1:A5)"));
  assert.ok(JSON.stringify(tables).includes("-000.125"));
});

test("public work-package requests cannot inject trusted review sections or projectless ownership", () => {
  const input = {
    projectId: 1, workflow: "ic_memo", title: "Review", audience: "Committee", reportingPeriod: "v1",
    sources: [{ artifactId: "artifact:source", version: 1, contentHash: "a".repeat(64), role: "evidence" }],
    authoredSections: [{ title: "Review scope", text: "Recorded" }],
  };
  assert.equal(professionalWorkPackageRequestSchema.safeParse({ ...input, reviewSections: [] }).success, false);
  assert.equal(professionalWorkPackageRequestSchema.safeParse({ ...input, projectId: null, owningChatId: 7 }).success, false);
});

test("large recorded workbooks retain every cell and exact lineage once without recursive per-cell block expansion", () => {
  const cells = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`A${index + 1}`, {
    raw: "0.050000", format: "0.000%",
    lineage: { kind: "user_assumption", custody: "user_authored", assumptionOrigin: "user_authored",
      capturedRaw: "0.050000", capturedFormat: "0.000%", sourceRefs: [] },
  }]));
  const workbook = artifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "assumptions",
    sheets: [{ id: "assumptions", name: "Assumptions", rowCount: 10_000, columnCount: 1, cells }],
  });
  const input = professionalWorkPackageRequestSchema.parse({
    projectId: 1, workflow: "ic_memo", title: "Large recorded review", audience: "Committee", reportingPeriod: "v1",
    sources: [{ artifactId: "artifact:large", version: 1, contentHash: "a".repeat(64), role: "financial_model" }],
    authoredSections: [{ title: "Review scope", text: "Recorded only" }],
  });
  const assembled = assembleProfessionalWorkPackage(input, [{
    id: "artifact:large", version: 1, hash: "a".repeat(64), title: "Large recorded model",
    role: "financial_model", content: workbook, sourceRefs: ["source:synthetic"],
  }]);
  if (assembled.content.kind !== "report") throw new Error("Expected report");
  const blocks = assembled.content.blocks;
  assert.deepEqual(blocks.find(block => block.id === "source-heading-0")!.attrs.sourceContent, workbook);
  assert.equal(blocks.filter(block => Object.hasOwn(block.attrs, "sourceContent")).length, 1);
  const tables = blocks.filter(block => block.type === "table");
  let rows = 0;
  for (const block of tables) {
    const table = artifactContentSchema.parse(block.attrs.table);
    assert.equal(table.kind, "table");
    if (table.kind !== "table") throw new Error("Expected table");
    rows += table.rows.length;
    assert.equal(block.attrs.sourceSnapshotBlockId, "source-heading-0");
    assert.ok(table.rows.every(row => row.raw === "0.050000" && row.format === "0.000%"));
  }
  assert.equal(rows, 10_000);
  assert.equal(tables.length, 10);
  assert.ok(blocks.length < 100);
  assert.ok(Buffer.byteLength(JSON.stringify(assembled.content), "utf8") < 4 * 1024 * 1024);
});
