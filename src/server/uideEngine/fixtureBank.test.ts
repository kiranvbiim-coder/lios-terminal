import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// fixtureBank reads its storage location from LIOS_DATA_ROOT at call
// time (not cached at import), so pointing LIOS_DATA_ROOT at a throwaway temp
// directory isolates these tests from a real machine's actual fixture
// bank -- important here specifically, since a real bug (see below) once
// nearly corrupted a genuine client upload sitting in that real directory.
let tempHome: string;
let originalRoot: string | undefined;

before(() => {
  originalRoot = process.env.LIOS_DATA_ROOT;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "uide-fixture-test-"));
  process.env.LIOS_DATA_ROOT = tempHome;
});

after(() => {
  if (originalRoot === undefined) delete process.env.LIOS_DATA_ROOT;
  else process.env.LIOS_DATA_ROOT = originalRoot;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

test("a fixture saved with the current WorkbookProfile shape round-trips cleanly", async () => {
  const { saveFixture, getFixture, listFixtures } = await import("./fixtureBank");
  const profile = {
    fileName: "test.csv",
    fileExt: "csv",
    sheetNames: ["Sheet1"],
    sheets: [{
      sheetName: "Sheet1",
      shape: "tabular" as const,
      tabular: { rowCount: 2, columnCount: 1, columns: [], duplicateOrBlankHeaderWarning: false },
      layout: null,
    }],
    crossSheetReferences: [],
    parsedAt: new Date().toISOString(),
  };
  const meta = saveFixture(profile, 1);
  assert.equal(meta.sheetCount, 1);
  assert.equal(meta.totalRows, 2);

  const record = getFixture(meta.id, 1);
  assert.equal(record?.profile.sheetNames[0], "Sheet1");
  assert.deepEqual(listFixtures(1).map((f) => f.id), [meta.id]);
});

test("a fixture saved before multi-sheet support (flat FileProfile shape) is migrated on read, not lost", async () => {
  const fixturesDir = path.join(tempHome, "uide-fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });

  const legacyId = "legacy-test-id";
  const legacyRecord = {
    id: legacyId,
    fileName: "old_upload.xlsx",
    fileExt: "xlsx",
    rowCount: 71,
    columnCount: 27,
    uploadedByUserId: 3,
    uploadedAt: "2026-07-22T10:57:12.853Z",
    profile: {
      fileName: "old_upload.xlsx",
      fileExt: "xlsx",
      rowCount: 71,
      columnCount: 27,
      columns: [{
        name: "ticker", inferredType: "text", totalCount: 71, nullCount: 0,
        uniqueCount: 71, isLikelyKey: true, sampleValues: ["AAPL"], min: null, max: null,
      }],
      parsedAt: "2026-07-22T10:57:12.853Z",
    },
  };
  fs.writeFileSync(path.join(fixturesDir, `${legacyId}.json`), JSON.stringify(legacyRecord));
  fs.writeFileSync(path.join(fixturesDir, "manifest.json"), JSON.stringify([{
    id: legacyId, fileName: legacyRecord.fileName, fileExt: legacyRecord.fileExt,
    rowCount: 71, columnCount: 27, uploadedByUserId: 3, uploadedAt: legacyRecord.uploadedAt,
  }]));

  // Re-import so the module's own file reads pick up the files just written
  // under the freshly-pointed data root rather than any cached state.
  const { getFixture, listFixtures } = await import(`./fixtureBank?t=${Date.now()}`);

  const listed = listFixtures(3);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].sheetCount, 1, "legacy meta must be upgraded with an inferred sheetCount");
  assert.equal(listed[0].totalRows, 71, "legacy rowCount must carry over as totalRows");

  const full = getFixture(legacyId, 3);
  assert.ok(full);
  assert.deepEqual(full!.profile.sheetNames, ["Sheet1"]);
  assert.equal(full!.profile.sheets[0].shape, "tabular");
  assert.equal(full!.profile.sheets[0].tabular!.columns[0].name, "ticker", "the original column data must survive the migration");

  // The migration must persist, not just patch the in-memory return value --
  // read the raw file back off disk to confirm.
  const rawOnDisk = JSON.parse(fs.readFileSync(path.join(fixturesDir, `${legacyId}.json`), "utf8"));
  assert.ok(Array.isArray(rawOnDisk.profile.sheets), "the upgraded shape must be written back to disk, not just returned once");
});
