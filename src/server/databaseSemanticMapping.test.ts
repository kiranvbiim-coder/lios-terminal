import assert from "node:assert/strict";
import test from "node:test";
import { mapConfirmedDatabaseRecords } from "./databaseSemanticMapping";
import { createDataMappingStore, type StoredDataMapping } from "./dataMappingStore";

const scope = { ownerUserId: 11, organizationId: 7 };
function fixture() {
  let rows: StoredDataMapping[] = [];
  const store = createDataMappingStore({
    list: async () => rows,
    replaceActive: async (identity, next) => {
      rows = rows.map(row => row.ownerUserId === identity.ownerUserId && row.organizationId === identity.organizationId &&
        row.providerId === identity.providerId && row.datasetKey === identity.datasetKey && row.providerField === identity.providerField
        ? { ...row, active: false } : row);
      rows.push(next);
      return next;
    },
  });
  const confirm = (overrides: Partial<Parameters<typeof store.confirm>[0]> = {}) => store.confirm({
    ...scope, providerId: "source-connection:3", datasetKey: "public.accounts", providerField: "gross_sales",
    targetFieldId: "financial_statements.revenue", targetKind: "canonical", transform: "millions_to_units", ...overrides,
  });
  return { store, confirm };
}

test("database semantic execution requires exact owner-confirmed connection and dataset mappings", async () => {
  const { store, confirm } = fixture();
  const records = [{ gross_sales: "2.5", unconfirmed: 9 }];
  await assert.rejects(mapConfirmedDatabaseRecords(scope, 3, "public.accounts", records, store), /No confirmed/);
  await confirm();
  const result = await mapConfirmedDatabaseRecords(scope, 3, "public.accounts", records, store);
  assert.equal(result.semanticRecords[0]["financial_statements.revenue"], 2_500_000);
  assert.deepEqual(Object.keys(result.semanticRecords[0]), ["financial_statements.revenue"]);
  assert.equal(result.mappings[0].version, 1);
  assert.deepEqual(records, [{ gross_sales: "2.5", unconfirmed: 9 }]);
  for (const [otherScope, connection, dataset] of [
    [{ ...scope, ownerUserId: 12 }, 3, "public.accounts"],
    [{ ...scope, organizationId: 8 }, 3, "public.accounts"],
    [scope, 4, "public.accounts"], [scope, 3, "private.accounts"],
  ] as const) {
    await assert.rejects(mapConfirmedDatabaseRecords(otherScope, connection, dataset, records, store), /No confirmed/);
  }
});

test("database mapping uses only the active confirmed revision and refuses missing or invalid fields", async () => {
  const { store, confirm } = fixture();
  await confirm();
  await confirm({ transform: "thousands_to_units" });
  const result = await mapConfirmedDatabaseRecords(scope, 3, "public.accounts", [{ gross_sales: 2 }], store);
  assert.equal(result.semanticRecords[0]["financial_statements.revenue"], 2_000);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].version, 2);
  await assert.rejects(mapConfirmedDatabaseRecords(scope, 3, "public.accounts", [{ other: 2 }], store), /missing confirmed field/);
  await assert.rejects(mapConfirmedDatabaseRecords(scope, 3, "public.accounts", [{ gross_sales: "unknown" }], store), /finite number/);
  await assert.rejects(confirm({ providerField: "net_sales" }));
  const unchanged = await mapConfirmedDatabaseRecords(scope, 3, "public.accounts", [{ gross_sales: 2, net_sales: 1 }], store);
  assert.equal(unchanged.semanticRecords[0]["financial_statements.revenue"], 2_000);
  assert.equal(unchanged.mappings.length, 1);
});

test("confirmed transforms execute explicitly without inferring unmapped columns", async () => {
  const { store, confirm } = fixture();
  for (const [transform, input, expected] of [
    ["identity", "unchanged", "unchanged"],
    ["percentage_to_decimal", "25", 0.25],
    ["decimal_to_percentage", 0.25, 25],
    ["uppercase", "abc", "ABC"],
    ["lowercase", "ABC", "abc"],
    ["date_iso", "2026-10-20", "2026-10-20T00:00:00.000Z"],
  ] as const) {
    await confirm({ transform });
    const result = await mapConfirmedDatabaseRecords(scope, 3, "public.accounts", [{ gross_sales: input, revenue: 999 }], store);
    assert.equal(result.semanticRecords[0]["financial_statements.revenue"], expected);
    assert.equal(Object.keys(result.semanticRecords[0]).length, 1);
  }
});
