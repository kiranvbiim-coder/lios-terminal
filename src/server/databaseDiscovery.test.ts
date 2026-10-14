import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseTypeNeedsCredential,
  groupDatabaseColumns,
  normalizedDatabaseType,
} from "./databaseDiscovery";
import type { DatabaseSourceConfig, DatabaseColumn } from "./databaseConnector";

const columns: DatabaseColumn[] = [
  { schema: "public", table: "quotes", name: "price", dataType: "numeric", nullable: true, ordinalPosition: 2 },
  { schema: "public", table: "quotes", name: "symbol", dataType: "text", nullable: false, ordinalPosition: 1 },
  { schema: "analytics", table: "fundamentals", name: "revenue", dataType: "double", nullable: true, ordinalPosition: 2 },
  { schema: "analytics", table: "fundamentals", name: "symbol", dataType: "varchar", nullable: false, ordinalPosition: 1 },
];

test("groups database discovery by schema/table and preserves ordinal column order", () => {
  const config: DatabaseSourceConfig = { endpoint: "postgresql://db.example.test/liOS", databaseType: "postgresql" };
  const catalog = groupDatabaseColumns(config, columns);
  assert.equal(catalog.databaseType, "postgresql");
  assert.equal(catalog.tableCount, 2);
  assert.equal(catalog.columnCount, 4);
  assert.deepEqual(catalog.schemas, ["analytics", "public"]);
  assert.deepEqual(catalog.tables.map(table => `${table.schema}.${table.name}`), ["analytics.fundamentals", "public.quotes"]);
  assert.deepEqual(catalog.tables[1].columns.map(column => column.name), ["symbol", "price"]);
});

test("database discovery requires credentials only for network database engines", () => {
  assert.equal(databaseTypeNeedsCredential({ endpoint: "postgresql://db.example.test/app", databaseType: "postgresql" }), true);
  assert.equal(databaseTypeNeedsCredential({ endpoint: "mysql://db.example.test/app", databaseType: "mysql" }), true);
  assert.equal(databaseTypeNeedsCredential({ endpoint: "sqlite:///tmp/local.db", databaseType: "sqlite" }), false);
  assert.equal(databaseTypeNeedsCredential({ endpoint: "duckdb:///tmp/local.duckdb", databaseType: "duckdb" }), false);
});

test("normalizes postgres aliases and infers supported protocols", () => {
  assert.equal(normalizedDatabaseType({ endpoint: "postgres://db.example.test/app", databaseType: "postgres" }), "postgresql");
  assert.equal(normalizedDatabaseType({ endpoint: "mysql://db.example.test/app" }), "mysql");
  assert.equal(normalizedDatabaseType({ endpoint: "sqlite:///tmp/local.db" }), "sqlite");
  assert.equal(normalizedDatabaseType({ endpoint: "duckdb:///tmp/local.duckdb" }), "duckdb");
});
