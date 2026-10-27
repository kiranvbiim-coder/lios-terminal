import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSpreadsheetImportField, SPREADSHEET_IMPORT_MAX_FILE_BYTES, validateProjectSpreadsheetFile } from "./ProjectSpreadsheetImportField";

test("source-pinned upload pattern only accepts server-supported spreadsheet extensions and size", () => {
  for (const name of ["workbook.xlsx", "model.XLSM", "data.csv"]) {
    assert.equal(validateProjectSpreadsheetFile({ name, size: 1024 }), null);
  }
  assert.match(validateProjectSpreadsheetFile({ name: "image.png", size: 200 }) ?? "", /XLSX/);
  assert.match(validateProjectSpreadsheetFile({ name: "workbook.xlsx", size: 0 }) ?? "", /non-empty/);
  assert.equal(validateProjectSpreadsheetFile({ name: "workbook.xlsx", size: SPREADSHEET_IMPORT_MAX_FILE_BYTES }), null);
  assert.match(validateProjectSpreadsheetFile({ name: "workbook.xlsx", size: SPREADSHEET_IMPORT_MAX_FILE_BYTES + 1 }) ?? "", /20 MB/);
  assert.match(validateProjectSpreadsheetFile({ name: "workbook.xlsx", size: Number.NaN }) ?? "", /non-empty/);
  assert.match(validateProjectSpreadsheetFile({ name: "workbook.xlsx", size: 1.25 }) ?? "", /non-empty/);
});

test("file drop is readable, keyboard browseable and does not import without explicit review", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectSpreadsheetImportField, { onImport: async () => true }));
  assert.match(html, /aria-label="Import a spreadsheet into this Project"/);
  assert.match(html, /Drag a spreadsheet here/);
  assert.match(html, /Choose spreadsheet/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="\.xlsx,\.xlsm,\.csv"/);
  assert.match(html, /Import reviewed spreadsheet/);
  assert.match(html, /Selecting a file never uploads it automatically/);
  assert.match(html, /disabled/);
  // Lucide inline SVG uses the standard xmlns="http://www.w3.org/2000/svg";
  // this namespace is not a network request, image, or uploaded file.
  assert.doesNotMatch(html, /<img\\b|<iframe\\b|previewUrl|createObjectURL/i);
  const source = readFileSync(new URL("./ProjectSpreadsheetImportField.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\\bfetch\\s*\\(|XMLHttpRequest|URL\\.createObjectURL/);
});

test("existing Project Library has one canonical upload route instead of a duplicate uploader", () => {
  const owner = readFileSync(new URL("./ProjectArtifactsPanel.tsx", import.meta.url), "utf8");
  assert.match(owner, /<ProjectSpreadsheetImportField/);
  assert.match(owner, /handleSpreadsheetImport/);
  assert.match(owner, /importSpreadsheetArtifact\(projectId, file\)/);
  assert.equal((owner.match(/type="file"/g) ?? []).length, 1); // package import only
  assert.match(owner, /Import package/);
});
