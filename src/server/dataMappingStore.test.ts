import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_DICTIONARY_VERSION,
  buildUniversalFieldDictionary,
  createExtendedFieldDescriptor,
} from "@shared/dataFieldDictionary";
import {
  confirmedMappingInputSchema,
  discoverProviderSchema,
  suggestDataMapping,
} from "@shared/dataMapping";
import {
  createDataMappingStore,
  type DataMappingIdentity,
  type DataMappingPersistence,
  type StoredDataMapping,
} from "./dataMappingStore";

class MemoryMappingPersistence implements DataMappingPersistence {
  rows: StoredDataMapping[] = [];

  async list() {
    return [...this.rows];
  }

  async replaceActive(scope: DataMappingIdentity, next: StoredDataMapping) {
    this.rows = this.rows.map((row) =>
      row.organizationId === scope.organizationId &&
      row.ownerUserId === scope.ownerUserId &&
      row.providerId === scope.providerId &&
      row.datasetKey === scope.datasetKey &&
      row.providerField === scope.providerField &&
      row.active
        ? { ...row, active: false }
        : row,
    );
    this.rows.push(next);
    return next;
  }
}

test("field dictionary is derived from canonical contract families with stable identities", () => {
  const dictionary = buildUniversalFieldDictionary();
  assert.equal(dictionary.version, FIELD_DICTIONARY_VERSION);
  assert.ok(dictionary.fields.find((field) => field.id === "financial_statements.revenue"));
  assert.ok(dictionary.fields.find((field) => field.id === "market_data.price"));
  assert.equal(new Set(dictionary.fields.map((field) => field.id)).size, dictionary.fields.length);
});

test("unknown provider fields survive discovery as namespaced extended fields", () => {
  const field = createExtendedFieldDescriptor({
    providerId: "sec_edgar",
    providerField: "EntityCommonStockSharesOutstanding",
    inferredType: "number",
  });
  assert.equal(field.id, "sec_edgar:EntityCommonStockSharesOutstanding");
  assert.equal(field.kind, "extended");
  assert.equal(field.providerField, "EntityCommonStockSharesOutstanding");
});

test("provider schema discovery returns canonical suggestions plus preserved extended fields", () => {
  const result = discoverProviderSchema({
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    contractFamily: "financial_statements",
    fields: [
      { providerField: "Revenue", inferredType: "currency_amount" },
      { providerField: "EntityCommonStockSharesOutstanding", inferredType: "number" },
    ],
  });
  assert.equal(result.dictionaryVersion, FIELD_DICTIONARY_VERSION);
  assert.equal(result.fields.length, 2);
  assert.equal(result.fields[0]?.suggestion.targetFieldId, "financial_statements.revenue");
  assert.equal(result.fields[0]?.suggestion.executable, false);
  assert.equal(result.fields[1]?.descriptor.kind, "extended");
  assert.equal(result.fields[1]?.descriptor.id, "sec_edgar:EntityCommonStockSharesOutstanding");
});

test("deterministic suggestions can recommend but can never execute", () => {
  const suggestion = suggestDataMapping({
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    contractFamily: "financial_statements",
    providerField: "Revenue",
    inferredType: "currency_amount",
  });
  assert.equal(suggestion.targetFieldId, "financial_statements.revenue");
  assert.equal(suggestion.source, "deterministic");
  assert.equal(suggestion.executable, false);
  assert.ok(suggestion.confidence > 0.8);
});

test("confirmed mapping input supports client-org and internal-user scope", () => {
  const client = confirmedMappingInputSchema.parse({
    organizationId: 7,
    ownerUserId: 11,
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    providerField: "Revenue",
    targetFieldId: "financial_statements.revenue",
    targetKind: "canonical",
    transform: "identity",
  });
  const internal = confirmedMappingInputSchema.parse({
    organizationId: null,
    ownerUserId: 99,
    providerId: "user_file",
    datasetKey: "uploaded.financials",
    providerField: "Sales",
    targetFieldId: "financial_statements.revenue",
    targetKind: "canonical",
    transform: "identity",
  });
  assert.equal(client.organizationId, 7);
  assert.equal(internal.organizationId, null);
});

test("mapping store versions replacements and isolates tenant/user scope", async () => {
  const persistence = new MemoryMappingPersistence();
  const store = createDataMappingStore(persistence);

  const first = await store.confirm({
    organizationId: 7,
    ownerUserId: 11,
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    providerField: "Revenue",
    targetFieldId: "financial_statements.revenue",
    targetKind: "canonical",
    transform: "identity",
  });
  const replacement = await store.confirm({
    organizationId: 7,
    ownerUserId: 11,
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    providerField: "Revenue",
    targetFieldId: "financial_statements.netIncome",
    targetKind: "canonical",
    transform: "identity",
  });
  await store.confirm({
    organizationId: 8,
    ownerUserId: 22,
    providerId: "sec_edgar",
    datasetKey: "company.financials",
    providerField: "Revenue",
    targetFieldId: "financial_statements.revenue",
    targetKind: "canonical",
    transform: "identity",
  });

  assert.equal(first.version, 1);
  assert.equal(first.executable, true);
  assert.equal(replacement.version, 2);
  assert.equal(replacement.active, true);
  assert.equal(replacement.executable, true);

  const tenantRows = await store.list({ organizationId: 7, ownerUserId: 11 });
  assert.equal(tenantRows.length, 2);
  assert.equal(tenantRows.filter((row) => row.active).length, 1);
  assert.equal(tenantRows.find((row) => row.version === 1)?.active, false);

  const otherTenantRows = await store.list({ organizationId: 8, ownerUserId: 22 });
  assert.equal(otherTenantRows.length, 1);
  assert.equal(otherTenantRows[0]?.targetFieldId, "financial_statements.revenue");
});

test("internal mappings remain isolated by owner even without an organization", async () => {
  const persistence = new MemoryMappingPersistence();
  const store = createDataMappingStore(persistence);
  await store.confirm({
    organizationId: null,
    ownerUserId: 41,
    providerId: "user_file",
    datasetKey: "uploaded.financials",
    providerField: "Sales",
    targetFieldId: "financial_statements.revenue",
    targetKind: "canonical",
    transform: "identity",
  });
  await store.confirm({
    organizationId: null,
    ownerUserId: 42,
    providerId: "user_file",
    datasetKey: "uploaded.financials",
    providerField: "Sales",
    targetFieldId: "financial_statements.netIncome",
    targetKind: "canonical",
    transform: "identity",
  });
  const rows = await store.list({ organizationId: null, ownerUserId: 41 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.targetFieldId, "financial_statements.revenue");
});

test("extended targets can be explicitly confirmed without being promoted into the canonical dictionary", async () => {
  const persistence = new MemoryMappingPersistence();
  const store = createDataMappingStore(persistence);
  const extended = createExtendedFieldDescriptor({
    providerId: "vendor_x",
    providerField: "VendorSpecificMetric42",
    inferredType: "number",
  });

  const mapping = await store.confirm({
    organizationId: 7,
    ownerUserId: 11,
    providerId: "vendor_x",
    datasetKey: "vendor.custom",
    providerField: "VendorSpecificMetric42",
    targetFieldId: extended.id,
    targetKind: "extended",
    transform: "identity",
  });

  assert.equal(mapping.executable, true);
  assert.equal(mapping.targetKind, "extended");
  assert.equal(mapping.targetFieldId, "vendor_x:VendorSpecificMetric42");
  assert.equal(buildUniversalFieldDictionary().fields.some((field) => field.id === mapping.targetFieldId), false);
});
