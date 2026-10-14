import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@shared/schema";
import type { DrizzleDb } from "./db";
import { databaseHealth, DatabaseTransferError, exportDatabase, importDatabase, readExportManifest } from "./databaseTransfer";

const migrationsFolder = path.resolve(process.cwd(), "migrations");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-db-transfer-"));
const clients: PGlite[] = [];

async function openDatabase(name: string): Promise<DrizzleDb> {
  const client = new PGlite(path.join(root, name));
  clients.push(client);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

async function scalar(db: DrizzleDb, query: SQL): Promise<number> {
  const result = (await db.execute(query)) as unknown as { rows: Array<Record<string, unknown>> };
  return Number(Object.values(result.rows[0] ?? {})[0]);
}

/** Every public table of the database itself, so adding a migration does not break this test. */
async function publicTableCount(db: DrizzleDb): Promise<number> {
  return scalar(db, sql`select count(*) from pg_tables where schemaname = 'public'`);
}

test.after(async () => {
  await Promise.all(clients.map((client) => client.close()));
  fs.rmSync(root, { recursive: true, force: true });
});

test("a full database round-trips exactly, keeps identity sequences usable and is health-checkable", async () => {
  const source = await openDatabase("source");
  await source.execute(sql`truncate table users cascade`);
  await source.execute(sql`insert into users (email, password_hash, role, name, active) values ('a@example.test', 'h1', 'internal_admin', 'Alpha', true), ('b@example.test', 'h2', 'internal_admin', 'Beta', true)`);
  const details = JSON.stringify({ nested: { ok: [1, 2, 3], text: 'quote " and \\ and ünïcode', nothing: null } });
  await source.execute(sql`insert into audit_events (user_id, event_type, details) values (1, 'login', ${details}::jsonb), (2, 'logout', null)`);

  const out = path.join(root, "export-1");
  const manifest = await exportDatabase(source, out, "pglite");
  assert.equal(manifest.tables.length, await publicTableCount(source));
  assert.equal(manifest.tables.find((table) => table.name === "audit_events")?.rows, 2);
  // Windows has no POSIX mode bits; the ACL-based protection is not expressible through stat().mode.
  if (process.platform !== "win32") assert.equal((fs.statSync(path.join(out, "manifest.json")).mode & 0o777), 0o600);

  const destination = await openDatabase("dest");
  const result = await importDatabase(destination, out);
  assert.equal(result.replaced, false);
  assert.equal(result.rows, manifest.tables.reduce((sum, table) => sum + table.rows, 0));

  // Re-export from the destination: every per-table content digest is identical.
  const again = await exportDatabase(destination, path.join(root, "export-2"), "pglite");
  assert.deepEqual(again.tables.map((t) => [t.name, t.rows, t.contentDigest]), manifest.tables.map((t) => [t.name, t.rows, t.contentDigest]));

  // `generated always` identity values were restored explicitly and the sequence continues after them.
  await destination.execute(sql`insert into audit_events (user_id, event_type) values (1, 'later')`);
  assert.equal(await scalar(destination, sql`select max(id) as m from audit_events`), 3);

  const health = await databaseHealth(destination, migrationsFolder);
  assert.equal(health.ok, true, health.problems.join("; "));
  assert.equal(health.tables, await publicTableCount(destination));
});

test("import refuses damaged exports, populated destinations and a different schema, and rolls back on failure", async () => {
  const source = await openDatabase("source2");
  const out = path.join(root, "export-3");
  await exportDatabase(source, out, "pglite");
  const manifest = readExportManifest(out);
  const populated = manifest.tables.find((table) => table.rows > 0 && table.name !== "users");
  assert.ok(populated, "migrations leave reference rows in at least one table");

  const destination = await openDatabase("dest2");
  await destination.execute(sql`insert into users (email, password_hash, role, name, active) values ('keep@example.test', 'h', 'internal_admin', 'Keep', true)`);
  await assert.rejects(importDatabase(destination, out), /user account/);
  assert.equal(await scalar(destination, sql`select count(*) as n from users where email = 'keep@example.test'`), 1, "a refused import changes nothing");
  assert.equal((await importDatabase(destination, out, { replace: true })).replaced, true);

  const file = path.join(out, "tables", `${populated.name}.ndjson`);
  fs.appendFileSync(file, "\n");
  await assert.rejects(importDatabase(destination, out, { replace: true }), /Checksum mismatch/);

  const other = path.join(root, "export-4");
  await exportDatabase(source, other, "pglite");
  const manifestFile = path.join(other, "manifest.json");
  const forged = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  forged.migrations = forged.migrations.slice(0, -1);
  fs.writeFileSync(manifestFile, JSON.stringify(forged));
  await assert.rejects(importDatabase(destination, other, { replace: true }), DatabaseTransferError);

  const unsafe = path.join(root, "export-5");
  await exportDatabase(source, unsafe, "pglite");
  const unsafeManifest = JSON.parse(fs.readFileSync(path.join(unsafe, "manifest.json"), "utf8"));
  unsafeManifest.tables[0].name = 'x"; drop table users; --';
  fs.writeFileSync(path.join(unsafe, "manifest.json"), JSON.stringify(unsafeManifest));
  assert.throws(() => readExportManifest(unsafe), /Unsupported or damaged/);

  // A row the destination rejects aborts the whole transaction and leaves previous data intact.
  const before = await scalar(destination, sql`select count(*) as n from ${sql.identifier(populated.name)}`);
  const tampered = path.join(root, "export-6");
  await exportDatabase(source, tampered, "pglite");
  const tamperedManifest = JSON.parse(fs.readFileSync(path.join(tampered, "manifest.json"), "utf8"));
  const entry = tamperedManifest.tables.find((table: { name: string }) => table.name === populated.name);
  const tamperedFile = path.join(tampered, "tables", `${populated.name}.ndjson`);
  fs.writeFileSync(tamperedFile, '{"definitely_not_a_column": 1}\n');
  entry.sha256 = (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(tamperedFile)).digest("hex");
  fs.writeFileSync(path.join(tampered, "manifest.json"), JSON.stringify(tamperedManifest));
  await assert.rejects(importDatabase(destination, tampered, { replace: true }));
  assert.equal(await scalar(destination, sql`select count(*) as n from ${sql.identifier(populated.name)}`), before);
});
