import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { artifactExportPlanSchema, spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { SPREADSHEET_LINEAGE_APPENDIX_MARKER, SPREADSHEET_LINEAGE_APPENDIX_COLUMNS } from "@shared/spreadsheetCellLineage";
import { artifactSpreadsheetToXlsxBytes, artifactSpreadsheetToXlsxWorkbook, exportArtifactSpreadsheetToXlsx } from "./spreadsheetXlsx";

test("spreadsheet Artifact XLSX export preserves every sheet, formulas, formats, and edits", () => {
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet",
    sheets: [
      {
        id: "sheet-1",
        name: "Model",
        cells: {
          A1: { raw: "Revenue", format: null },
          A2: { raw: "120", format: "#,##0" },
          B1: { raw: "Growth", format: null },
          B2: { raw: "0.15", format: "0.00%" },
          C1: { raw: "Projected", format: null },
          C2: { raw: "=A2*(1+B2)", format: "#,##0.00" },
        },
        names: { Revenue: "A2", ModelInputs: "a2:b2" },
        rowCount: 2,
        columnCount: 3,
      },
      {
        id: "sheet-2",
        name: "Assumptions",
        cells: {
          A1: { raw: "WACC", format: null },
          A2: { raw: "0.1", format: "0.0%" },
        },
        names: { Revenue: "$A$2" },
        rowCount: 2,
        columnCount: 1,
      },
    ],
    activeSheetId: "sheet-2",
    rendererPreference: "univer",
    calculationMode: "automatic",
  });

  const bytes = artifactSpreadsheetToXlsxBytes(content);
  const reopened = XLSX.read(bytes, { type: "array", cellFormula: true, sheetStubs: true, cellNF: true, raw: true });

  assert.deepEqual(reopened.SheetNames, ["Model", "Assumptions"]);
  assert.equal(reopened.Sheets.Model?.A2?.v, 120);
  assert.equal(reopened.Sheets.Model?.A2?.z, "#,##0");
  assert.equal(reopened.Sheets.Model?.B2?.v, 0.15);
  assert.equal(reopened.Sheets.Model?.B2?.z, "0.00%");
  assert.equal(reopened.Sheets.Model?.C2?.f, "A2*(1+B2)");
  assert.notEqual(reopened.Sheets.Model?.C2?.t, "e", "an uncached formula must not become an Excel error cell");
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<c r="C2"[^>]*><f>A2\*\(1\+B2\)<\/f><\/c>/, "formula cache must be absent rather than invented");
  assert.equal(reopened.Sheets.Model?.C2?.z, "#,##0.00");
  assert.equal(reopened.Sheets.Assumptions?.A2?.v, 0.1);
  assert.equal(reopened.Sheets.Assumptions?.A2?.z, "0.0%");
  assert.deepEqual(reopened.Workbook?.Names, [
    { Name: "Revenue", Sheet: 0, Ref: "'Model'!$A$2" },
    { Name: "ModelInputs", Sheet: 0, Ref: "'Model'!$A$2:$B$2" },
    { Name: "Revenue", Sheet: 1, Ref: "'Assumptions'!$A$2" },
  ]);
  const workbookXml = strFromU8(unzipSync(bytes)["xl/workbook.xml"]);
  assert.match(workbookXml, /<workbookView activeTab="1" firstSheet="0"\/>/);
  assert.match(workbookXml, /<calcPr calcMode="auto"\/>/);
  assert.match(workbookXml, /<definedName name="Revenue" localSheetId="0">/);
  assert.match(workbookXml, /<definedName name="Revenue" localSheetId="1">/);
});

test("XLSX round trip preserves numeric-looking text and explicit text formats", () => {
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet",
    sheets: [{ id: "codes", name: "Codes", rowCount: 6, columnCount: 2, names: {}, cells: {
      A1: { raw: "007", format: null },
      A2: { raw: "0x1F", format: null },
      A3: { raw: "1e3", format: "General" },
      A4: { raw: "123", format: "@" },
      A5: { raw: "9007199254740993", format: null },
      A6: { raw: "-12.5", format: null },
      B1: { raw: "007", format: "000" },
      B2: { raw: "0.15", format: "0.00%" },
    } }],
    activeSheetId: "codes", rendererPreference: "univer", calculationMode: "automatic",
  });
  const bytes = artifactSpreadsheetToXlsxBytes(content);
  const sheet = XLSX.read(bytes, { type: "array", cellNF: true, raw: true }).Sheets.Codes;
  for (const [ref, value] of [["A1", "007"], ["A2", "0x1F"], ["A3", "1e3"], ["A4", "123"], ["A5", "9007199254740993"]]) {
    assert.equal(sheet[ref]?.t, "s", `${ref} must remain text`);
    assert.equal(sheet[ref]?.v, value);
  }
  assert.equal(sheet.A4?.z, "@");
  assert.equal(sheet.A6?.t, "n"); assert.equal(sheet.A6?.v, -12.5);
  assert.equal(sheet.B1?.t, "s"); assert.equal(sheet.B1?.v, "007"); assert.equal(sheet.B1?.z, "000");
  assert.equal(sheet.B2?.v, 0.15); assert.equal(sheet.B2?.z, "0.00%");
});

test("number formats never authorize losing precision or coercing textual spellings", () => {
  const exactText = [
    "1234567890123456", "9007199254740993", "1000000000000000",
    "0.1234567890123456", "0.10000000000000001", "-1234567890123456",
    "00123", "1e3", "0x1F", " 123 ", "2026-10-07",
    `0.${"0".repeat(323)}1`,
  ];
  const cells = Object.fromEntries(exactText.map((raw, index) => [`A${index + 1}`, { raw, format: "#,##0.0000000000000000" }]));
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "precision", calculationMode: "manual",
    sheets: [{ id: "precision", name: "Precision", rowCount: exactText.length, columnCount: 2, cells: {
      ...cells,
      B1: { raw: "123456789012345", format: "#,##0" },
      B2: { raw: "0.123456789012345", format: "0.000000000000000" },
      B3: { raw: "TRUE", format: "@" },
      B4: { raw: "FALSE", format: "@" },
      B5: { raw: "45292", format: "yyyy-mm-dd" },
    } }],
  });
  const bytes = artifactSpreadsheetToXlsxBytes(content);
  const sheet = XLSX.read(bytes, { type: "array", raw: true, cellNF: true }).Sheets.Precision;
  exactText.forEach((raw, index) => {
    const cell = sheet[`A${index + 1}`];
    assert.equal(cell?.t, "s");
    assert.equal(cell?.v, raw);
    assert.equal(cell?.z, "#,##0.0000000000000000");
  });
  assert.equal(sheet.B1?.t, "n"); assert.equal(sheet.B1?.v, 123456789012345);
  assert.equal(sheet.B2?.t, "n"); assert.equal(sheet.B2?.v, 0.123456789012345);
  assert.equal(sheet.B3?.t, "s"); assert.equal(sheet.B3?.v, "TRUE"); assert.equal(sheet.B3?.z, "@");
  assert.equal(sheet.B4?.t, "s"); assert.equal(sheet.B4?.v, "FALSE");
  assert.equal(sheet.B5?.t, "n"); assert.equal(sheet.B5?.v, 45292); assert.equal(sheet.B5?.z, "yyyy-mm-dd");
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<c r="A1"[^>]*t="str"[^>]*><v>1234567890123456<\/v><\/c>/);
  assert.match(strFromU8(unzipSync(bytes)["xl/workbook.xml"]), /<calcPr calcMode="manual"\/>/);
});

test("scoped names quote apostrophes, retain cross-sheet references, and leave formulas uncached", () => {
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "model", calculationMode: "manual",
    sheets: [
      { id: "model", name: "Owner's Model", rowCount: 2, columnCount: 2,
        names: { LocalInput: "a1", LocalRange: "$a$1:b2", OtherInput: "'Inputs & Rates'!A1" },
        cells: { A1: { raw: "10" }, B2: { raw: "=SUM(LocalRange)+'Inputs & Rates'!A1", format: "0.00" } } },
      { id: "inputs", name: "Inputs & Rates", rowCount: 1, columnCount: 1,
        names: { LocalInput: "A1" }, cells: { A1: { raw: "12" } } },
    ],
  });
  const workbook = artifactSpreadsheetToXlsxWorkbook(content);
  assert.deepEqual(workbook.Workbook?.Names, [
    { Name: "LocalInput", Sheet: 0, Ref: "'Owner''s Model'!$A$1" },
    { Name: "LocalRange", Sheet: 0, Ref: "'Owner''s Model'!$A$1:$B$2" },
    { Name: "OtherInput", Sheet: 0, Ref: "'Inputs & Rates'!$A$1" },
    { Name: "LocalInput", Sheet: 1, Ref: "'Inputs & Rates'!$A$1" },
  ]);
  const bytes = artifactSpreadsheetToXlsxBytes(content);
  const reopened = XLSX.read(bytes, { type: "array", cellFormula: true, sheetStubs: true });
  assert.deepEqual(reopened.Workbook?.Names, workbook.Workbook?.Names);
  assert.equal(reopened.Sheets["Owner's Model"].B2?.f, "SUM(LocalRange)+'Inputs & Rates'!A1");
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<c r="B2"[^>]*><f>[^<]+<\/f><\/c>/);
  assert.doesNotMatch(xml, /<c r="B2"[^>]*>[\s\S]*?<v>/);
});

test("provenance is plan-only, clearly marked, collision-safe, and appended without changing active sheet", () => {
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "model", calculationMode: "manual",
    sheets: [
      { id: "reserved", name: "__LiOS Provenance", cells: { A1: { raw: "User analysis" } } },
      { id: "reserved2", name: "__lios provenance (2)", cells: { A1: { raw: "Other analysis" } } },
      { id: "model", name: "Model", cells: { A1: { raw: "=1+2", format: "0.00" } } },
    ],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "p4:project/artifact", version: 7, kind: "spreadsheet", formats: ["xlsx"],
    filenameStem: "Model", contentHash: "a".repeat(64),
    sourceRefs: ["citation:source-1", "receipt:execution-2", "=not-an-excel-formula"],
  });
  const before = structuredClone(content);
  const bytes = artifactSpreadsheetToXlsxBytes(content, plan);
  const reopened = XLSX.read(bytes, { type: "array", raw: true, cellFormula: true, sheetStubs: true });
  assert.deepEqual(reopened.SheetNames, ["__LiOS Provenance", "__lios provenance (2)", "Model", "__LiOS Provenance (3)"]);
  const metadata = reopened.Sheets["__LiOS Provenance (3)"];
  assert.equal(metadata.A1?.v, "LiOS P4 export provenance");
  assert.equal(metadata.B1?.v, "Metadata only; not an analytical sheet");
  assert.equal(metadata.B2?.v, plan.artifactId);
  assert.equal(metadata.B3?.v, String(plan.version));
  assert.equal(metadata.B4?.v, plan.contentHash);
  assert.deepEqual([metadata.B6?.v, metadata.B7?.v, metadata.B8?.v], plan.sourceRefs);
  assert.equal(metadata.B8?.t, "s"); assert.equal(metadata.B8?.f, undefined);
  assert.equal(reopened.Sheets["__LiOS Provenance"].A1?.v, "User analysis");
  assert.equal(reopened.Sheets.Model.A1?.f, "1+2");
  assert.match(strFromU8(unzipSync(bytes)["xl/workbook.xml"]), /<workbookView activeTab="2" firstSheet="0"\/>/);
  assert.deepEqual(content, before, "export must not mutate canonical P4 content");
  const withoutPlan = XLSX.read(artifactSpreadsheetToXlsxBytes(content), { type: "array" });
  assert.deepEqual(withoutPlan.SheetNames, content.sheets.map((sheet) => sheet.name));
});

test("Artifact XLSX download delivers the metadata-adapted bytes with the actual plan", async () => {
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "second", calculationMode: "manual",
    sheets: [{ id: "first", name: "First", cells: { A1: { raw: "1234567890123456" } } },
      { id: "second", name: "Second", cells: { A1: { raw: "=First!A1", format: "@" } } }],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "p4:download", version: 2, kind: "spreadsheet", formats: ["xlsx"],
    filenameStem: "Download", contentHash: "b".repeat(64), sourceRefs: [],
  });
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalCreateObjectURL = URL.createObjectURL;
  const captured: { blob?: Blob } = {};
  let clicked = false;
  const anchor = { href: "", download: "", click() { clicked = true; } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement(tag: string) {
    assert.equal(tag, "a");
    return anchor;
  } } });
  URL.createObjectURL = (blob: Blob) => {
    captured.blob = blob;
    return originalCreateObjectURL(blob);
  };
  try {
    exportArtifactSpreadsheetToXlsx(content, "Download-v2.xlsx", plan);
    assert.equal(clicked, true);
    assert.equal(anchor.download, "Download-v2.xlsx");
    const download = captured.blob;
    assert.ok(download);
    assert.equal(download.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = new Uint8Array(await download.arrayBuffer());
    const reopened = XLSX.read(bytes, { type: "array", cellFormula: true, sheetStubs: true });
    assert.equal(reopened.Sheets.First.A1?.v, "1234567890123456");
    assert.equal(reopened.Sheets.Second.A1?.f, "First!A1");
    assert.equal(reopened.Sheets["__LiOS Provenance"].B2?.v, plan.artifactId);
    const xml = strFromU8(unzipSync(bytes)["xl/workbook.xml"]);
    assert.match(xml, /activeTab="1"/);
    assert.match(xml, /calcMode="manual"/);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("real XLSX keeps exact per-cell source, period, run and edited lineage visibly without changing formulas", () => {
  const actual = {
    kind: "reported_actual", custody: "server_projection", capturedRaw: "100", capturedFormat: "#,##0",
    datasetSnapshotId: "12345678-1234-4123-8123-123456789012", contentHash: "a".repeat(64),
    statement: "income_statement", canonicalKey: "revenue", sourcePath: "/annual/2025/revenue",
    period: "FY2025", fiscalYear: "2025", periodEnd: "2025-12-31", availableAt: "2026-02-01T00:00:00Z",
    currency: "USD", sourceUnit: "USD millions", entitlementPolicyRef: "policy:financials",
    sourceRefs: ["citation:revenue", "=not-a-formula", "receipt:dataset"],
  };
  const longCapture = `${"x".repeat(31_998)}😀${"y".repeat(40_000)}`;
  const content = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "model", calculationMode: "manual",
    sheets: [
      { id: "collision", name: "__LiOS Provenance", cells: { A1: { raw: "User analysis" } } },
      { id: "collision-2", name: "__lios provenance (2)", cells: { A1: { raw: "User inputs" } } },
      { id: "model", name: "Owner's Model", rowCount: 5, columnCount: 1, cells: {
        A1: { raw: "100", format: "#,##0", lineage: actual },
        A2: { raw: "120", format: "#,##0", lineage: actual },
        A3: { raw: "=A1*(1+0.1)", format: "0.00", lineage: {
          kind: "engine_output", custody: "server_projection", capturedRaw: "=A1*(1+0.1)", capturedFormat: "0.00",
          modelRunId: "12345678-1234-4123-8123-123456789013", resultHash: "b".repeat(64),
          resultPath: "/valuation/enterpriseValue", period: "FY2026", sourceRefs: ["receipt:engine", "citation:assumption"],
        } },
        A4: { raw: "0.1", format: "0.0%", lineage: {
          kind: "user_assumption", custody: "user_authored", capturedRaw: "0.1", capturedFormat: "0.0%",
          assumptionOrigin: "user_authored", sourceRefs: [],
        } },
        A5: { raw: "edited", lineage: { ...actual, capturedRaw: longCapture, capturedFormat: null } },
      } },
    ],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "p4:source-model", version: 4, kind: "spreadsheet", formats: ["xlsx"], filenameStem: "Model",
    contentHash: "c".repeat(64), sourceRefs: ["citation:artifact"],
  });
  const before = structuredClone(content);
  for (const exportPlan of [plan, undefined]) {
    const bytes = artifactSpreadsheetToXlsxBytes(content, exportPlan);
    const reopened = XLSX.read(bytes, { type: "array", raw: true, cellFormula: true, sheetStubs: true, cellNF: true });
    const appendixName = "__LiOS Provenance (3)";
    assert.deepEqual(reopened.SheetNames, [...content.sheets.map((sheet) => sheet.name), appendixName]);
    assert.equal(reopened.Workbook?.Sheets?.[3]?.Hidden ?? 0, 0, "lineage appendix must be visible");
    assert.equal(reopened.Sheets["__LiOS Provenance"].A1.v, "User analysis");
    assert.equal(reopened.Sheets["Owner's Model"].A1.v, 100);
    assert.equal(reopened.Sheets["Owner's Model"].A2.v, 120);
    assert.equal(reopened.Sheets["Owner's Model"].A3.f, "A1*(1+0.1)");
    assert.equal(reopened.Sheets["Owner's Model"].A3.z, "0.00");
    assert.match(strFromU8(unzipSync(bytes)["xl/workbook.xml"]), /activeTab="2"/);
    const metadata = reopened.Sheets[appendixName];
    const rows = XLSX.utils.sheet_to_json<string[]>(metadata, { header: 1, raw: true });
    const marker = rows.findIndex((row) => row[0] === SPREADSHEET_LINEAGE_APPENDIX_MARKER);
    assert.ok(marker >= 0);
    assert.deepEqual(rows[marker + 1], [...SPREADSHEET_LINEAGE_APPENDIX_COLUMNS]);
    for (const [ref, cell] of Object.entries(content.sheets[2].cells)) {
      const cellRows = rows.slice(marker + 2).filter((row) => row[0] === "model" && row[1] === "Owner's Model" && row[2] === ref);
      assert.ok(cellRows.length);
      const status = ref === "A2" || ref === "A5" ? "edited_unverified" : ref === "A4" ? "authored_unverified" : "current";
      assert.ok(cellRows.every((row) => row[3] === status));
      const fields: Record<string, string> = {};
      for (const row of cellRows) {
        assert.ok(row[7].length <= 32_000);
        fields[row[4]] = (fields[row[4]] ?? "") + row[7];
      }
      const restored = Object.fromEntries(Object.entries(fields).map(([field, json]) => [field, JSON.parse(json)]));
      assert.deepEqual(restored, { ...cell.lineage, currentRaw: cell.raw, currentFormat: cell.format });
    }
    for (const [ref, cell] of Object.entries(metadata)) {
      if (!ref.startsWith("!")) assert.equal((cell as XLSX.CellObject).f, undefined, "metadata must never turn source refs or captured formulas into executable cells");
    }
  }
  assert.deepEqual(content, before, "export must retain immutable lineage and captures");
});
