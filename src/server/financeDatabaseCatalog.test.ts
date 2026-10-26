import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  financeDatabaseCatalogPath,
  loadFinanceDatabaseCatalog,
  resetFinanceDatabaseCatalogCache,
} from "./financeDatabaseCatalog";

test("user-root catalog preserves distinct exchange rows, FIGI/ISIN and delisted state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financedatabase-loader-"));
  const previous = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = dir;
  t.after(() => {
    resetFinanceDatabaseCatalogCache();
    if (previous === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  resetFinanceDatabaseCatalogCache();
  assert.deepEqual(loadFinanceDatabaseCatalog(), []);
  const destination = financeDatabaseCatalogPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify([
    { symbol: "DUP", name: "Example", exchange: "NMS", mic: "XNAS", isin: "US0378331005", figi: "BBG000B9XRY4", provider: "financedatabase", assetClass: "equities", active: true },
    { symbol: "DUP", name: "Example", exchange: "NYQ", mic: "XNYS", provider: "financedatabase", assetClass: "equities", active: false },
    { symbol: "FILE CREATION TIME: 12345", name: "metadata", provider: "financedatabase" },
  ]));
  resetFinanceDatabaseCatalogCache();
  const results = loadFinanceDatabaseCatalog();
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(v => v.exchange), ["NMS", "NYQ"]);
  assert.equal(results[0].canonical, false);
  assert.equal(results[0].entityId, null);
  assert.equal(results[0].identifiers.some(x => x.type === "isin" && x.value === "US0378331005"), true);
  assert.equal(results[0].identifiers.some(x => x.type === "figi"), true);
  assert.equal(results[1].lifecycleStatus, "delisted");
});
