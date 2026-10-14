import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFixture, getFixture } from "./fixtureBank";

const profile = {
  fileName: "provenance-test.csv",
  fileExt: "csv",
  sheetNames: ["Sheet1"],
  sheets: [{ sheetName: "Sheet1", shape: "tabular", tabular: { rowCount: 1, columnCount: 1, columns: ["Revenue"], duplicateOrBlankHeaderWarning: false }, layout: null }],
  crossSheetReferences: [],
  parsedAt: new Date().toISOString(),
} as any;

test("persists source provenance metadata on UIDE fixtures", () => {
  const sha = "f".repeat(64);
  const meta = saveFixture(profile, 900001, { provenanceId: "prov-test", sourceSha256: sha, sourceSizeBytes: 12, organizationId: 77 });
  const record = getFixture(meta.id, 900001);
  assert.equal(record?.provenanceId, "prov-test");
  assert.equal(record?.sourceSha256, sha);
  assert.equal(record?.sourceSizeBytes, 12);
  assert.equal(record?.organizationId, 77);
});
