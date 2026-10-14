import assert from "node:assert/strict";
import test from "node:test";
import {
  toEChartsOptionProjection,
  toPerspectiveProjection,
  toTiptapDocumentProjection,
  toUniverWorkbookProjection,
} from "./artifactBridges";

test("P4 optional renderer bridges project LiOS-owned state without transferring ownership", () => {
  const workbook = toUniverWorkbookProjection({
    kind: "spreadsheet",
    sheets: [{ id: "sheet-1", name: "Model", cells: { B4: { raw: "=1+1", format: null } }, names: {}, rowCount: 20, columnCount: 10 }],
    activeSheetId: "sheet-1",
    rendererPreference: "univer",
    calculationMode: "automatic",
  });
  assert.equal(workbook.sheets["sheet-1"]?.cellData?.[3]?.[1]?.f, "=1+1");

  const tiptap = toTiptapDocumentProjection({
    kind: "research",
    blocks: [{ id: "b1", type: "paragraph", text: "Evidence-linked note", attrs: {} }],
    claims: [],
    editorPreference: "tiptap",
  });
  assert.equal(tiptap.type, "doc");
  assert.equal(tiptap.content[0].content?.[0].text, "Evidence-linked note");

  const echarts = toEChartsOptionProjection({
    kind: "chart",
    rendererPreference: "echarts",
    chartType: "line",
    series: [{ id: "s1", label: "Price", points: [{ x: "2026-09-21", y: 100 }, { x: "2026-09-22", y: 101 }] }],
    options: {},
  });
  assert.deepEqual(echarts.series[0].data, [100, 101]);

  const perspective = toPerspectiveProjection({
    kind: "data",
    columns: [{ name: "price", type: "double" }],
    previewRows: [{ price: 100 }],
    rowCount: 1,
    columnarArtifactId: "columnar:1",
    rendererPreference: "perspective",
  });
  assert.equal(perspective.rowCount, 1);
  assert.equal(perspective.columnarArtifactId, "columnar:1");
});
