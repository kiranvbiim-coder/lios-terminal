import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { DuckDBInstance } from "@duckdb/node-api";
import { assertDatabaseConnectorRuntime, executeReadOnlyQuery, mapColumnsToContract, discoverDatabaseSchema } from "./databaseConnector";

test("database column mapping uses exact, normalized, and alias matches", () => {
  const result = mapColumnsToContract(["period_end_date", "sales", "net_profit", "unused"], "financial_statements");
  assert.deepEqual(result.mappings, [
    { sourceColumn: "period_end_date", contractField: "periodEndDate", confidence: "normalized" },
    { sourceColumn: "sales", contractField: "revenue", confidence: "alias" },
    { sourceColumn: "net_profit", contractField: "netIncome", confidence: "alias" },
  ]);
  assert.deepEqual(result.unmappedColumns, ["unused"]);
  assert.ok(result.missingFields.includes("operatingIncome"));
});

test("database query guard rejects writes and multi-statement payloads before connection", async () => {
  await assert.rejects(
    () => executeReadOnlyQuery({ endpoint: "postgresql://db.example/lios" }, JSON.stringify({ username: "u", password: "p" }), "UPDATE users SET name = 'x'"),
    /read-only SELECT/i,
  );
  await assert.rejects(
    () => executeReadOnlyQuery({ endpoint: "postgresql://db.example/lios" }, JSON.stringify({ username: "u", password: "p" }), "SELECT 1; SELECT 2"),
    /read-only SELECT/i,
  );
});
test("SQLite and DuckDB adapters execute read-only queries and discovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-db-adapters-"));
  const sqlitePath = path.join(directory, "fixture.sqlite");
  const sqlite = new BetterSqlite3(sqlitePath);
  sqlite.exec("CREATE TABLE financials (period TEXT, revenue REAL); INSERT INTO financials VALUES ('FY2025', 42);");
  sqlite.close();
  const sqliteResult = await executeReadOnlyQuery({ endpoint: `sqlite://${sqlitePath}`, databaseType: "sqlite" }, null, "SELECT * FROM financials");
  assert.deepEqual(sqliteResult.rows, [{ period: "FY2025", revenue: 42 }]);
  assert.equal((await discoverDatabaseSchema({ endpoint: `sqlite://${sqlitePath}`, databaseType: "sqlite" }, null)).length, 2);

  const duckPath = path.join(directory, "fixture.duckdb");
  const instance = await DuckDBInstance.create(duckPath);
  const connection = await instance.connect();
  await connection.run("CREATE TABLE financials (period VARCHAR, revenue DOUBLE)");
  await connection.run("INSERT INTO financials VALUES ('FY2025', 42)");
  connection.closeSync();
  const duckResult = await executeReadOnlyQuery({ endpoint: `duckdb://${duckPath}`, databaseType: "duckdb" }, null, "SELECT * FROM financials");
  assert.equal(String(duckResult.rows[0].period), "FY2025");
  assert.equal(Number(duckResult.rows[0].revenue), 42);
  fs.rmSync(directory, { recursive: true, force: true });
});


test("database BYOD is rejected on hosted production before any network or file access", () => {
  assert.throws(
    () => assertDatabaseConnectorRuntime({ NODE_ENV: "production", DATABASE_URL: "postgresql://hosted.example/lios", HOST: "0.0.0.0" }),
    /local-desktop only/i,
  );
  assert.doesNotThrow(() => assertDatabaseConnectorRuntime({ NODE_ENV: "production", HOST: "127.0.0.1" }));
  assert.doesNotThrow(() => assertDatabaseConnectorRuntime({ NODE_ENV: "development", DATABASE_URL: "postgresql://dev.example/lios" }));
});
