"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseCsv, normalizeRow, importDatabase, catalogFiles, run, verifyInstalled, rollback, runAsync } = require("./import_financedatabase.cjs");

test("RFC 4180 multiline names and escaped quotes remain one row", () => {
  assert.deepEqual(parseCsv('symbol,name,exchange\r\n"ABC","A ""quoted""\ncompany",NMS\r\n'), [
    ["symbol", "name", "exchange"], ["ABC", 'A "quoted"\ncompany', "NMS"],
  ]);
  assert.throws(() => parseCsv('symbol,name\nABC,"unfinished'), /Unterminated/);
  assert.throws(() => parseCsv('symbol,name\nABC,"Valid"x'), /Invalid trailing/);
});

test("catalog identity is provisional, exchange-preserving and rejects vendor footer", () => {
  assert.equal(normalizeRow({ symbol: "FILE CREATION TIME: 123", name: "metadata" }, "equities"), null);
  assert.equal(normalizeRow({ symbol: " ", name: "Empty" }, "equities"), null);
  const row = normalizeRow({
    symbol: "AAA", name: "A Company", exchange: "NMS", mic: "XNAS",
    isin: "US0378331005", figi: "BBG000B9XRY4", currency: "USD",
    country: "United States", delisted: "TRUE",
  }, "equities");
  assert.equal(row.symbol, "AAA");
  assert.equal(row.active, false);
  assert.equal(row.countryCode, null, "Never invent an ISO country code from a country name");
  assert.equal(row.currency, "USD");
  assert.equal(row.isin, "US0378331005");
  assert.equal(row.provider, "financedatabase");
  assert.equal(row.assetClass, "equities");
});

test("realistic exchange-split CSV layout imports distinct venues and source assets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-csv-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = path.join(root, "database");
  fs.mkdirSync(path.join(db, "equities"), { recursive: true });
  fs.mkdirSync(path.join(db, "etfs"), { recursive: true });
  fs.writeFileSync(path.join(db, "equities", "NMS.csv"), [
    "symbol,name,currency,sector,exchange,mic,isin,delisted",
    "DUP,Shared Company,USD,Technology,NMS,XNAS,US0378331005,False",
    "DUP,Shared Company,USD,Technology,NMS,XNAS,US0378331005,False",
    "FILE CREATION TIME: 12345,,USD,Technology,NMS,XNAS,,False",
  ].join("\n"));
  fs.writeFileSync(path.join(db, "equities", "NYQ.csv"), [
    "symbol,name,currency,exchange,mic,delisted",
    "DUP,Shared Company,USD,NYQ,XNYS,True",
  ].join("\n"));
  fs.writeFileSync(path.join(db, "etfs", "AMS.csv"), [
    "symbol,name,currency,exchange,mic,delisted",
    "DUP,Shared ETF,EUR,AMS,XAMS,False",
  ].join("\n"));
  assert.equal(catalogFiles(db, "equities").length, 2);
  const { rows, stats } = importDatabase(db, ["equities", "etfs"], 3);
  assert.equal(stats.accepted, 3);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.byCategory.equities, 2);
  assert.equal(stats.byCategory.etfs, 1);
  assert.equal(stats.files.length, 3);
  assert.equal(rows[1].active, false);
  assert.deepEqual(new Set(rows.map(r => r.exchange)), new Set(["NMS", "NYQ", "AMS"]));
  assert.throws(() => importDatabase(db, ["equities", "etfs"], 4), /below required/);
});

test("missing data and malformed quoted CSV fail rather than fabricate coverage", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => importDatabase(root, ["equities"], 1), /No CSV files/);
  fs.mkdirSync(path.join(root, "equities"));
  fs.writeFileSync(path.join(root, "equities", "NMS.csv"), "symbol,name\nABC,\"Unclosed");
  assert.throws(() => importDatabase(root, ["equities"], 1), /Unterminated/);
});

test("local import writes verified snapshot, detects tampering, and rolls back to last version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-roundtrip-"));
  const previousRoot = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = path.join(root, "data-root");
  t.after(() => {
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const checkout = path.join(root, "donor");
  const db = path.join(checkout, "database", "equities");
  fs.mkdirSync(db, { recursive: true });
  const source = path.join(db, "NMS.csv");
  fs.writeFileSync(source, "symbol,name,exchange,mic,delisted\nONE,Original,NMS,XNAS,False\n");
  const original = run(["--from-dir", checkout, "--categories", "equities", "--min", "1"]);
  assert.equal(original.verified, true);
  assert.equal(original.count, 1);
  const destination = path.join(process.env.LIOS_DATA_ROOT, "instrument-catalogs");
  fs.writeFileSync(source, "symbol,name,exchange,mic,delisted\nONE,Updated,NMS,XNAS,False\nTWO,Additional,NMS,XNAS,False\n");
  const updated = run(["--from-dir", checkout, "--categories", "equities", "--min", "1"]);
  assert.equal(updated.count, 2);
  assert.equal(verifyInstalled(destination).count, 2);
  const report = rollback(destination);
  assert.equal(report.count, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, "financedatabase_universe.json"), "utf8"))[0].name, "Original");
  fs.appendFileSync(path.join(destination, "financedatabase_universe.json"), " ");
  assert.throws(() => verifyInstalled(destination), /SHA256 does not match/);
});

test("oversized CSV is refused before allocating its contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-csv-bound-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "equities"));
  const file = path.join(root, "equities", "NMS.csv");
  fs.writeFileSync(file, "");
  fs.truncateSync(file, 128 * 1024 * 1024 + 1);
  const read = fs.readFileSync;
  fs.readFileSync = (...args) => {
    if (args[0] === file) assert.fail("Oversized CSV must not be read");
    return read(...args);
  };
  try { assert.throws(() => importDatabase(root, ["equities"], 1), /Oversized donor CSV/); }
  finally { fs.readFileSync = read; }
});

function writeDonor(root, rows) {
  const dir = path.join(root, "donor", "database", "equities");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "NMS.csv"),
    "symbol,name,exchange,mic,delisted\n" + rows.map(([s, n]) => `${s},${n},NMS,XNAS,False`).join("\n") + "\n");
  return path.join(root, "donor");
}

test("async import yields to the event loop and writes byte-identical output to the sync import", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-async-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const many = Array.from({ length: 12000 }, (_, i) => ["S" + i, "Company " + i]);
  const donor = writeDonor(root, many);
  const syncDest = path.join(root, "sync"), asyncDest = path.join(root, "async");
  const syncReport = run(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", syncDest]);
  let ticks = 0, stages = new Set();
  const timer = setInterval(() => { ticks++; }, 0);
  const asyncReport = await runAsync(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", asyncDest],
    s => stages.add(s.stage));
  clearInterval(timer);
  assert.equal(asyncReport.count, 12000);
  assert.ok(ticks >= 3, "event loop must get turns during the import, saw " + ticks);
  assert.deepEqual([...stages].sort(), ["check", "read", "write"]);
  assert.equal(asyncReport.sha256, syncReport.sha256);
  assert.equal(verifyInstalled(asyncDest).count, 12000);
});

test("a write failure after the swap restores the previous verified catalog", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-restore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, "dest");
  const donor = writeDonor(root, [["ONE", "Original"]]);
  run(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", dest]);
  const before = fs.readFileSync(path.join(dest, "financedatabase_universe.json"));
  writeDonor(root, [["ONE", "Updated"], ["TWO", "More"]]);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("financedatabase_manifest.json")) {
      const error = new Error("ENOSPC: no space left on device"); error.code = "ENOSPC"; throw error;
    }
    return rename(from, to);
  };
  try {
    assert.throws(() => run(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", dest]), /no space left/);
  } finally { fs.renameSync = rename; }
  // Catalog and manifest still agree and are the ORIGINAL snapshot, not a mismatched pair.
  const report = verifyInstalled(dest);
  assert.equal(report.count, 1);
  assert.ok(before.equals(fs.readFileSync(path.join(dest, "financedatabase_universe.json"))));
});

test("a failed first install leaves no partial catalog behind", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-first-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, "dest");
  const donor = writeDonor(root, [["ONE", "Original"]]);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("financedatabase_manifest.json")) throw new Error("disk went away");
    return rename(from, to);
  };
  try {
    assert.throws(() => run(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", dest]), /disk went away/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readdirSync(dest).sort(), []);
});

test("insufficient free disk space is refused before anything is written", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-space-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, "dest");
  const donor = writeDonor(root, [["ONE", "Original"]]);
  const statfs = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 1, bsize: 1024 });
  try {
    assert.throws(() => run(["--from-dir", donor, "--categories", "equities", "--min", "1", "--dest", dest]),
      error => error.code === "ENOSPC" && /Not enough free disk space/.test(error.message));
  } finally { fs.statfsSync = statfs; }
  assert.deepEqual(fs.readdirSync(dest), []);
});
