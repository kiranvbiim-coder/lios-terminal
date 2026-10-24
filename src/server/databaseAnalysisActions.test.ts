import assert from "node:assert/strict";
import test from "node:test";
import { suggestDatabaseAnalysisActions } from "./databaseAnalysisActions";
import type { DatabaseCatalogDiscovery } from "./databaseDiscovery";

function catalog(databaseType: DatabaseCatalogDiscovery["databaseType"] = "postgresql"): DatabaseCatalogDiscovery {
  return {
    databaseType, tableCount: 1, columnCount: 4, schemas: ["analytics"],
    tables: [{
      schema: "analytics", name: "orders", columns: [
        { schema: "analytics", table: "orders", name: "placed_at", dataType: "timestamp", nullable: true, ordinalPosition: 1 },
        { schema: "analytics", table: "orders", name: "region", dataType: "varchar", nullable: false, ordinalPosition: 2 },
        { schema: "analytics", table: "orders", name: "sales", dataType: "numeric(12,2)", nullable: true, ordinalPosition: 3 },
        { schema: "analytics", table: "orders", name: "order_id", dataType: "integer", nullable: false, ordinalPosition: 4 },
      ],
    }],
  };
}

test("P5 schema-only discovery produces runnable read-only actions without invented observations", () => {
  const result = suggestDatabaseAnalysisActions(catalog(), "analytics", "orders");
  assert.equal(result.ready, true);
  assert.equal(result.source, "discovered_schema");
  assert.deepEqual(result.dataset, { schema: "analytics", table: "orders", databaseType: "postgresql" });
  assert.ok(result.actions.some(action => action.kind === "time_metric"));
  assert.ok(result.actions.some(action => action.kind === "category_metric"));
  assert.ok(result.actions.some(action => action.kind === "missingness"));
  assert.ok(result.actions.some(action => action.kind === "numeric_summary"));
  assert.equal(result.actions.find(action => action.id === "count")?.sql,
    'SELECT COUNT(*) AS record_count FROM "analytics"."orders"');
  assert.equal(result.actions.find(action => action.id === "numeric:sales")?.sql,
    'SELECT COUNT("sales") AS observed_count, MIN("sales") AS minimum, MAX("sales") AS maximum, AVG("sales") AS average_value FROM "analytics"."orders"');
  for (const action of result.actions) {
    assert.match(action.sql, /^SELECT /);
    assert.doesNotMatch(action.sql, /;|UPDATE|DELETE|INSERT|DROP/);
  }
});

test("MySQL uses native identifier quotation and SQLite omits schema qualification", () => {
  const mysql = suggestDatabaseAnalysisActions(catalog("mysql"), "analytics", "orders");
  assert.equal(mysql.actions[0]?.sql, "SELECT * FROM " + String.fromCharCode(96) + "analytics"
    + String.fromCharCode(96) + "." + String.fromCharCode(96) + "orders" + String.fromCharCode(96) + " LIMIT 50");
  const sqlite = catalog("sqlite");
  sqlite.tables[0]!.schema = "main";
  sqlite.tables[0]!.columns.forEach(column => { column.schema = "main"; });
  const simple = suggestDatabaseAnalysisActions(sqlite, "main", "orders");
  assert.equal(simple.actions[0]?.sql, 'SELECT * FROM "orders" LIMIT 50');
});

test("Unknown table and unsupported identifiers never generate executable SQL", () => {
  assert.throws(() => suggestDatabaseAnalysisActions(catalog(), "other", "orders"), /authorized database catalog/);
  const hostile = catalog();
  hostile.tables[0]!.name = 'orders"; DROP TABLE users';
  const blocked = suggestDatabaseAnalysisActions(hostile, "analytics", hostile.tables[0]!.name);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.actions, []);
});

test("Never use unsafe or ambiguous column names in suggestions", () => {
  const data = catalog();
  data.tables[0]!.columns.push({
    schema: "analytics", table: "orders", name: "price; DROP TABLE users",
    dataType: "numeric", nullable: true, ordinalPosition: 5,
  });
  data.tables[0]!.columns.push({
    schema: "analytics", table: "orders", name: "REGION",
    dataType: "text", nullable: true, ordinalPosition: 6,
  });
  const actions = suggestDatabaseAnalysisActions(data, "analytics", "orders").actions;
  assert.ok(actions.every(action => !action.id.includes("DROP")));
  assert.equal(actions.filter(action => action.id.toLowerCase() === "category:region").length, 1);
  assert.ok(actions.every(action => action.sql.indexOf(";") === -1));
});

test("Non-financial tables with no recognized typed columns still allow real preview and count", () => {
  const c = catalog();
  c.tables[0]!.columns = [{ schema: "analytics", table: "orders", name: "payload", dataType: "blob", nullable: false, ordinalPosition: 1 }];
  const actions = suggestDatabaseAnalysisActions(c, "analytics", "orders").actions;
  assert.deepEqual(actions.map(action => action.id), ["preview", "count", "missing:payload"]);
});
