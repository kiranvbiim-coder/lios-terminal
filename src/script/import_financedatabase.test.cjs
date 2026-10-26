"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseCsv, normalizeRow, importDatabase, catalogFiles, run, verifyInstalled, rollback } = require("./import_financedatabase.cjs");

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
