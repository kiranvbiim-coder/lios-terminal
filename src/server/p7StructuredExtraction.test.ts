import assert from "node:assert/strict";
import test from "node:test";
import { buildP7StructuredExtraction, extractStructuredDocument, explicitUnitHints } from "./p7StructuredExtraction";

test("SI-03.17 preserves headings, financial tables, explicit units and tabular relationships", () => {
  const source = [
    "Introductory source text.",
    "",
    "# Financial overview",
    "Amounts in USD million unless stated otherwise.",
    "",
    "| Metric | FY2025 | FY2026E |",
    "| --- | ---: | ---: |",
    "| Revenue | 1,200 | 1,450 |",
    "| EBITDA margin | 18% | 20% |",
    "",
    "## Relationships",
    "| Parent | Subsidiary | Relationship |",
    "| --- | --- | --- |",
    "| Alpha Holdings | Alpha Energy | owns |",
    "| Alpha Holdings | Alpha Services | owns |",
  ].join("\n");

  const result = extractStructuredDocument(source);

  assert.equal(result.schemaVersion, "1");
  assert.equal(result.incomplete, false);
  assert.deepEqual(result.sections.map((section) => [section.title, section.level]), [
    ["Preamble", 0],
    ["Financial overview", 1],
    ["Relationships", 2],
  ]);
  assert.equal(result.tables.length, 2);
  assert.ok(result.unitHints.includes("USD"));
  assert.ok(result.unitHints.includes("million"));

  const financial = result.tables[0];
  assert.equal(financial.sectionTitle, "Financial overview");
  assert.deepEqual(financial.headers, ["Metric", "FY2025", "FY2026E"]);
  assert.deepEqual(financial.financialRows.map((row) => ({
    metric: row.metric,
    period: row.period,
    value: row.value,
    currency: row.currency,
    unit: row.unit,
  })), [
    { metric: "Revenue", period: "FY2025", value: "1,200", currency: "USD", unit: "million" },
    { metric: "Revenue", period: "FY2026E", value: "1,450", currency: "USD", unit: "million" },
    { metric: "EBITDA margin", period: "FY2025", value: "18%", currency: null, unit: "%" },
    { metric: "EBITDA margin", period: "FY2026E", value: "20%", currency: null, unit: "%" },
  ]);

  const relationships = result.tables[1].relationships;
  assert.deepEqual(relationships.map((relation) => ({
    relation: relation.relation,
    from: relation.from,
    to: relation.to,
  })), [
    { relation: "owns", from: "Alpha Holdings", to: "Alpha Energy" },
    { relation: "owns", from: "Alpha Holdings", to: "Alpha Services" },
  ]);
  assert.equal(result.relationshipCount, 2);
  assert.equal(result.financialRowCount, 4);
});

test("SI-03.17 does not infer prose relationships or missing financial structure", () => {
  const source = [
    "# Notes",
    "Alpha Holdings owns Alpha Energy and revenue was 1,200 last year.",
    "No table identifies relationship columns, metric columns, periods, units or currency.",
  ].join("\n");

  const result = extractStructuredDocument(source);
  assert.equal(result.tables.length, 0);
  assert.equal(result.relationshipCount, 0);
  assert.equal(result.financialRowCount, 0);
});

test("SI-03.17 narrow financial tables preserve raw values and explicit unit/currency columns", () => {
  const source = [
    "# KPIs",
    "| Metric | Period | Value | Unit | Currency |",
    "| --- | --- | ---: | --- | --- |",
    "| Free cash flow | Q2 2026 | 125.5 | million | EUR |",
    "| Leverage | Q2 2026 | 2.4x | x | EUR |",
  ].join("\n");

  const result = extractStructuredDocument(source);
  const rows = result.tables[0].financialRows;
  assert.deepEqual(rows, [
    {
      metric: "Free cash flow",
      period: "Q2 2026",
      value: "125.5",
      unit: "million",
      currency: "EUR",
      rowIndex: 0,
      valueColumn: "Value",
    },
    {
      metric: "Leverage",
      period: "Q2 2026",
      value: "2.4x",
      unit: "x",
      currency: "EUR",
      rowIndex: 1,
      valueColumn: "Value",
    },
  ]);
});

test("SI-03.17 only records explicit unit hints", () => {
  assert.deepEqual(explicitUnitHints("Values are in KWD million and margin is percent; debt spread 125 bps."), [
    "KWD",
    "%",
    "bps",
    "million",
  ]);
  assert.deepEqual(explicitUnitHints("Revenue grew strongly with no disclosed unit."), []);
});

test("SI-03.17 propagates upstream incompleteness", () => {
  const result = extractStructuredDocument("# Section\nText", { incomplete: true });
  assert.equal(result.incomplete, true);
});


const donorDocument = {
  name: "ACME FY2026",
  groups: [{
    self_ref: "#/groups/0",
    label: "section",
    name: "Financial statements",
    children: [
      { $ref: "#/texts/1" },
      { $ref: "#/texts/2" },
      { $ref: "#/tables/0" },
    ],
  }],
  texts: [
    {
      self_ref: "#/texts/0",
      label: "title",
      text: "ACME FY2026 Annual Report",
      prov: [{ page_no: 1, bbox: { l: 72, t: 700, r: 520, b: 660 } }],
    },
    {
      self_ref: "#/texts/1",
      label: "section_header",
      text: "Consolidated Income Statement",
      parent: { $ref: "#/groups/0" },
      prov: [{ page_no: 2, bbox: { l: 72, t: 710, r: 520, b: 680 } }],
    },
    {
      self_ref: "#/texts/2",
      label: "text",
      text: "Amounts in USD millions except per-share data; margin shown in percent.",
      parent: { $ref: "#/groups/0" },
      prov: [{ page_no: 2 }],
    },
  ],
  tables: [{
    self_ref: "#/tables/0",
    parent: { $ref: "#/groups/0" },
    prov: [{ page_no: 2, bbox: { l: 72, t: 650, r: 520, b: 220 } }],
    data: {
      num_rows: 4,
      num_cols: 3,
      table_cells: [
        { text: "USD millions", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, column_header: true },
        { text: "FY2026", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 1, end_col_offset_idx: 2, column_header: true },
        { text: "FY2025", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 2, end_col_offset_idx: 3, column_header: true },
        { text: "Revenue", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1, row_header: true },
        { text: "$1,250.4 million", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2 },
        { text: "$1,100.0 million", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 2, end_col_offset_idx: 3 },
        { text: "Operating margin", start_row_offset_idx: 2, end_row_offset_idx: 3, start_col_offset_idx: 0, end_col_offset_idx: 1, row_header: true },
        { text: "18.5%", start_row_offset_idx: 2, end_row_offset_idx: 3, start_col_offset_idx: 1, end_col_offset_idx: 2 },
        { text: "16.0%", start_row_offset_idx: 2, end_row_offset_idx: 3, start_col_offset_idx: 2, end_col_offset_idx: 3 },
        { text: "Net income", start_row_offset_idx: 3, end_row_offset_idx: 4, start_col_offset_idx: 0, end_col_offset_idx: 1, row_header: true },
        { text: "$220 million", start_row_offset_idx: 3, end_row_offset_idx: 4, start_col_offset_idx: 1, end_col_offset_idx: 2 },
        { text: "$180 million", start_row_offset_idx: 3, end_row_offset_idx: 4, start_col_offset_idx: 2, end_col_offset_idx: 3 },
      ],
    },
  }],
};

test("SI-03.17 projects Docling hierarchy, anchors and cell spans into bounded LiOS structure", () => {
  const first = buildP7StructuredExtraction(donorDocument);
  const second = buildP7StructuredExtraction(donorDocument);
  assert.deepEqual(first, second);
  assert.equal(first.sourceMode, "docling");
  assert.equal(first.version, "1.0");
  assert.deepEqual(first.sections.map((section) => [section.kind, section.text]), [
    ["title", "ACME FY2026 Annual Report"],
    ["section_header", "Consolidated Income Statement"],
  ]);
  assert.equal(first.sections[1].anchor.pageNumber, 2);
  assert.deepEqual(first.sections[1].anchor.bbox, { left: 72, top: 710, right: 520, bottom: 680 });

  assert.equal(first.tables.length, 1);
  assert.equal(first.tables[0].rowCount, 4);
  assert.equal(first.tables[0].columnCount, 3);
  assert.equal(first.tables[0].cells[0].columnHeader, true);
  assert.equal(first.tables[0].cells[3].rowHeader, true);
  assert.equal(first.tables[0].cells[4].text, "$1,250.4 million");
  assert.equal(first.tables[0].financialStructure, "income_statement");
  assert.equal(first.tables[0].anchor.pageNumber, 2);
  assert.ok(first.unitHints.includes("USD"));
  assert.ok(first.unitHints.includes("million"));
  assert.ok(first.unitHints.includes("%"));

  const revenueValue = first.tables[0].financialRows.find((value) => value.value === "$1,250.4 million");
  assert.ok(revenueValue);
  assert.equal(revenueValue.metric, "Revenue");
  assert.equal(revenueValue.period, "FY2026");
  assert.equal(revenueValue.currency, "USD");
  assert.equal(revenueValue.unit, "million");

  assert.ok(first.documentRelationships.some((edge) =>
    edge.from === "#/groups/0" && edge.to === "#/tables/0" && edge.kind === "contains"
  ));
  assert.ok(first.documentRelationships.some((edge) =>
    edge.from === "#/tables/0" && edge.to === "#/groups/0" && edge.kind === "parent"
  ));
  assert.equal(first.truncation.truncated, false);
});

test("SI-03.17 donor projection fails closed to unknown financial structure without observable labels", () => {
  const result = buildP7StructuredExtraction({
    texts: [{ self_ref: "#/texts/0", label: "section_header", text: "People" }],
    tables: [{
      self_ref: "#/tables/0",
      data: {
        num_rows: 2,
        num_cols: 2,
        table_cells: [
          { text: "Employee", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, column_header: true },
          { text: "Count", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 1, end_col_offset_idx: 2, column_header: true },
          { text: "Engineering", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1 },
          { text: "250", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2 },
        ],
      },
    }],
  });
  assert.equal(result.tables[0].financialStructure, "unknown");
  assert.equal(result.tables[0].financialRows.length, 0);
  assert.equal(result.units.length, 0);
});

test("SI-03.17 donor projection exposes bounded truncation", () => {
  const result = buildP7StructuredExtraction(donorDocument, {
    maxSections: 1,
    maxTables: 1,
    maxCells: 4,
    maxRelationships: 2,
    maxUnits: 2,
    maxFinancialValues: 2,
  });
  assert.equal(result.truncation.truncated, true);
  assert.equal(result.sections.length, 1);
  assert.equal(result.tables[0].cells.length, 4);
  assert.equal(result.documentRelationships.length, 2);
  assert.ok(result.truncation.omitted.sections > 0);
  assert.ok(result.truncation.omitted.cells > 0);
  assert.ok(result.truncation.omitted.relationships > 0);
});


test("SI-03.17 financial classification stays unknown when source labels are ambiguous", () => {
  const result = extractStructuredDocument([
    "# Mixed summary",
    "| Metric | FY2026 |",
    "| --- | ---: |",
    "| Revenue | 100 |",
    "| Net income | 20 |",
    "| Assets | 500 |",
    "| Liabilities | 300 |",
  ].join("\n"));
  assert.equal(result.tables[0].financialStructure, "unknown");
});
