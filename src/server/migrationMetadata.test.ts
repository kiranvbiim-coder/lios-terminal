import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "@shared/schema";

const migrations = path.resolve(process.cwd(), "migrations");

interface SnapshotTable { columns: Record<string, { notNull?: boolean }> }
interface Snapshot { id: string; prevId: string; tables: Record<string, SnapshotTable>; enums: Record<string, { values: string[] }> }

function readSnapshot(file: string): Snapshot {
  return JSON.parse(fs.readFileSync(path.join(migrations, "meta", file), "utf8")) as Snapshot;
}
const bare = (qualified: string): string => qualified.split(".").pop() as string;

function inventory(snapshot: Snapshot): Record<string, string[]> {
  return Object.fromEntries(Object.entries(snapshot.tables).map(([table, value]) => [bare(table), Object.keys(value.columns).sort()]));
}

/**
 * Objects that the SQL migrations create but the TypeScript schema barrel deliberately does not describe. They are
 * listed so that drift in either direction fails this test instead of being silently absorbed:
 *  - consulting_requests.pricing_tier and enum request_pricing_tier: dropped from the TS model, kept by migration 0005/0006;
 *  - organization_licenses entitlement/lease signature columns (migration 0044): superseded by the file-based licence;
 *  - data_field_mappings: defined in server/dataMappingStore.ts (created there with IF NOT EXISTS and by migration 0069).
 */
const SQL_ONLY_COLUMNS: Record<string, string[]> = {
  consulting_requests: ["pricing_tier"],
  organization_licenses: ["entitlement_expires_at", "entitlement_issued_at", "entitlement_public_key_id", "entitlement_signature", "entitlement_version", "offline_lease_signature", "signed_entitlement_hash"],
};
const SQL_ONLY_TABLES = ["data_field_mappings"];
const SQL_ONLY_ENUMS = ["request_pricing_tier"];

test("the newest snapshot belongs to the newest journal entry and chains to an earlier snapshot", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  const last = journal.entries[journal.entries.length - 1] as { idx: number; tag: string };
  assert.ok(fs.existsSync(path.join(migrations, `${last.tag}.sql`)), "journal entry has its SQL file");
  const file = `${String(last.idx).padStart(4, "0")}_snapshot.json`;
  assert.ok(fs.existsSync(path.join(migrations, "meta", file)), `${file} is missing: run drizzle-kit generate (or add a snapshot) with the migration`);
  const snapshots = fs.readdirSync(path.join(migrations, "meta")).filter((name) => name.endsWith("_snapshot.json")).sort();
  const ids = new Map(snapshots.map((name) => [readSnapshot(name).id, name]));
  const newest = readSnapshot(file);
  assert.ok(ids.has(newest.prevId), "prevId points at an existing snapshot");
  assert.notEqual(newest.prevId, newest.id);
});

test("the newest snapshot is exactly what drizzle-kit derives from shared/schema.ts, so generate proposes nothing", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number }> };
  const idx = (journal.entries[journal.entries.length - 1] as { idx: number }).idx;
  const snapshot = readSnapshot(`${String(idx).padStart(4, "0")}_snapshot.json`);
  const derived = generateDrizzleJson(schema as Record<string, unknown>, snapshot.prevId) as unknown as Snapshot;
  assert.deepEqual(inventory(derived), inventory(snapshot));
  assert.deepEqual(Object.fromEntries(Object.entries(derived.enums).map(([name, value]) => [bare(name), [...value.values].sort()])),
    Object.fromEntries(Object.entries(snapshot.enums).map(([name, value]) => [bare(name), [...value.values].sort()])));
  for (const [table, value] of Object.entries(derived.tables)) {
    const recorded = snapshot.tables[table];
    assert.ok(recorded, `${table} missing from snapshot`);
    for (const [column, definition] of Object.entries(value.columns)) {
      assert.equal(Boolean(recorded.columns[column]?.notNull), Boolean(definition.notNull), `${table}.${column} nullability`);
    }
  }
});

test("a database built only from the SQL migrations has exactly the snapshot's tables, columns and enums plus the documented SQL-only objects", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-migration-metadata-"));
  const client = new PGlite(path.join(root, "pg"));
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await migrate(drizzle(client, { schema }), { migrationsFolder: migrations });

  const columns = (await client.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  )).rows;
  const actual: Record<string, string[]> = {};
  for (const row of columns) (actual[row.table_name] ??= []).push(row.column_name);
  for (const list of Object.values(actual)) list.sort();

  const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number }> };
  const snapshot = readSnapshot(`${String((journal.entries[journal.entries.length - 1] as { idx: number }).idx).padStart(4, "0")}_snapshot.json`);
  const expected = inventory(snapshot);
  for (const table of SQL_ONLY_TABLES) expected[table] = actual[table] ?? [];
  for (const [table, extra] of Object.entries(SQL_ONLY_COLUMNS)) expected[table] = [...(expected[table] ?? []), ...extra].sort();
  assert.deepEqual(actual, Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b))) as Record<string, string[]>);

  const enumNames = (await client.query<{ typname: string }>(
    "select distinct t.typname from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'",
  )).rows.map((row) => row.typname).sort();
  assert.deepEqual(enumNames, [...Object.keys(snapshot.enums).map(bare), ...SQL_ONLY_ENUMS].sort());
});
