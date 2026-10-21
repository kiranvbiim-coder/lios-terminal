import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-mapping-bootstrap-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb } = await import("./db");
const { dataMappingStore } = await import("./dataMappingStore");

test("fresh embedded database confirms and lists actual mapping revisions with tenant isolation", async () => {
  try {
    await initDb();
    const input = { ownerUserId: 17, organizationId: null, providerId: "source-connection:9", datasetKey: "main.measurements", providerField: "revenue_millions", targetFieldId: "financial_statements.revenue", targetKind: "canonical" as const, transform: "millions_to_units" as const };
    const first = await dataMappingStore.confirm(input);
    assert.equal(first.version, 1);
    const second = await dataMappingStore.confirm({ ...input, transform: "identity" });
    assert.equal(second.version, 2);
    const rows = await dataMappingStore.list({ ownerUserId: 17, organizationId: null });
    assert.equal(rows.find(row => row.active)?.id, second.id);
    assert.equal(rows.filter(row => row.active).length, 1);
    assert.deepEqual(await dataMappingStore.list({ ownerUserId: 18, organizationId: null }), []);
  } finally {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
