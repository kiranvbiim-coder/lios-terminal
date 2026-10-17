import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DrizzleDb } from "./db";

/**
 * Logical, engine-neutral database transfer (GM-04). The same export serves PGlite -> PostgreSQL,
 * PostgreSQL -> PGlite, relocation and restore: every public table is written as one JSON document
 * per row (`to_jsonb`) and loaded with `jsonb_populate_record`, so Postgres performs all type
 * conversion (enums, bytea, jsonb, timestamps) identically on both engines.
 *
 * Integrity: per-file SHA-256, per-table row counts, and an order-independent content digest that is
 * recomputed inside the destination before the import transaction commits.
 */

export const DATABASE_EXPORT_FORMAT = "lios-database-export/1";
const BATCH_ROWS = 1000;

const manifestSchema = z.object({
  format: z.literal(DATABASE_EXPORT_FORMAT),
  createdAt: z.string(),
  sourceEngine: z.enum(["pglite", "postgres"]),
  /** Hashes of applied drizzle migrations, in order. The destination must be at exactly this schema. */
  migrations: z.array(z.string()),
  tables: z.array(z.object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    rows: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative(),
    contentDigest: z.string(),
  })),
});
export type DatabaseExportManifest = z.infer<typeof manifestSchema>;

export class DatabaseTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseTransferError";
  }
}

type Executor = Pick<DrizzleDb, "execute">;

async function rows<T>(db: Executor, query: SQL): Promise<T[]> {
  return (await db.execute(query) as unknown as { rows: T[] }).rows;
}

async function publicTables(db: Executor): Promise<string[]> {
  const found = await rows<{ tablename: string }>(db, sql`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  return found.map((row) => row.tablename);
}

async function appliedMigrations(db: Executor): Promise<string[]> {
  const found = await rows<{ hash: string }>(db, sql`select hash from drizzle.__drizzle_migrations order by id`);
  return found.map((row) => row.hash);
}

/** Parents first. Self references are fine (each table loads in one statement); other cycles are refused. */
async function loadOrder(db: Executor, tables: string[]): Promise<string[]> {
  const edges = await rows<{ child: string; parent: string }>(db, sql`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'`);
  const wanted = new Set(tables);
  const pending = new Map<string, Set<string>>(tables.map((name) => [name, new Set<string>()]));
  for (const edge of edges) {
    const child = edge.child.replace(/^"|"$/g, "");
    const parent = edge.parent.replace(/^"|"$/g, "");
    if (child !== parent && wanted.has(child) && wanted.has(parent)) pending.get(child)?.add(parent);
  }
  const ordered: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter(([, parents]) => parents.size === 0).map(([name]) => name).sort();
    if (!ready.length) throw new DatabaseTransferError(`Foreign-key cycle between tables: ${[...pending.keys()].sort().join(", ")}`);
    for (const name of ready) {
      pending.delete(name);
      ordered.push(name);
    }
    for (const parents of pending.values()) for (const name of ready) parents.delete(name);
  }
  return ordered;
}

async function contentDigest(db: Executor, table: string): Promise<{ rows: number; digest: string }> {
  const [result] = await rows<{ n: number; digest: string }>(db, sql`
    select count(*)::int as n, coalesce(md5(string_agg(h, '' order by h)), '') as digest
    from (select md5(to_jsonb(t)::text) as h from ${sql.identifier(table)} t) s`);
  return { rows: result?.n ?? 0, digest: result?.digest ?? "" };
}

export async function exportDatabase(
  db: DrizzleDb,
  outDir: string,
  sourceEngine: DatabaseExportManifest["sourceEngine"],
  options: { existingTransaction?: boolean } = {},
): Promise<DatabaseExportManifest> {
  const target = path.resolve(outDir);
  if (fs.existsSync(target)) throw new DatabaseTransferError(`Export destination already exists: ${target}`);
  const partial = `${target}.partial-${process.pid}`;
  fs.mkdirSync(path.join(partial, "tables"), { recursive: true, mode: 0o700 });
  try {
    const snapshot = async (tx: Executor): Promise<DatabaseExportManifest> => {
      if (!options.existingTransaction) await tx.execute(sql`set transaction isolation level repeatable read read only`);
      const tables = await publicTables(tx);
      const entries: DatabaseExportManifest["tables"] = [];
      for (const table of tables) {
        const file = path.join(partial, "tables", `${table}.ndjson`);
        const fd = fs.openSync(file, "wx", 0o600);
        const hash = crypto.createHash("sha256");
        let bytes = 0;
        let count = 0;
        try {
          await tx.execute(sql`declare lios_export_cursor no scroll cursor for select to_jsonb(t)::text as doc from ${sql.identifier(table)} t`);
          for (;;) {
            const batch = await rows<{ doc: string }>(tx, sql.raw(`fetch ${BATCH_ROWS} from lios_export_cursor`));
            if (!batch.length) break;
            const chunk = Buffer.from(`${batch.map((row) => row.doc).join("\n")}\n`, "utf8");
            fs.writeSync(fd, chunk);
            hash.update(chunk);
            bytes += chunk.length;
            count += batch.length;
          }
          await tx.execute(sql`close lios_export_cursor`);
        } finally {
          fs.closeSync(fd);
        }
        const digest = await contentDigest(tx, table);
        if (digest.rows !== count) throw new DatabaseTransferError(`Table ${table} changed during export (${count} exported, ${digest.rows} counted).`);
        entries.push({ name: table, rows: count, sha256: hash.digest("hex"), bytes, contentDigest: digest.digest });
      }
      return {
        format: DATABASE_EXPORT_FORMAT,
        createdAt: new Date().toISOString(),
        sourceEngine,
        migrations: await appliedMigrations(tx),
        tables: entries,
      } satisfies DatabaseExportManifest;
    };
    const manifest = options.existingTransaction ? await snapshot(db) : await db.transaction(snapshot);
    fs.writeFileSync(path.join(partial, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(partial, target);
    return manifest;
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw error;
  }
}

export function readExportManifest(srcDir: string): DatabaseExportManifest {
  const file = path.join(path.resolve(srcDir), "manifest.json");
  if (!fs.existsSync(file)) throw new DatabaseTransferError(`No manifest.json in ${srcDir}; this is not a LiOS database export.`);
  const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) throw new DatabaseTransferError(`Unsupported or damaged export manifest: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function verifyTableFile(srcDir: string, table: DatabaseExportManifest["tables"][number]): string {
  const file = path.join(path.resolve(srcDir), "tables", `${table.name}.ndjson`);
  if (!fs.existsSync(file)) throw new DatabaseTransferError(`Export is missing ${table.name}.ndjson.`);
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  if (hash.digest("hex") !== table.sha256) throw new DatabaseTransferError(`Checksum mismatch for ${table.name}; the export is damaged.`);
  return file;
}

export interface DatabaseImportResult {
  tables: number;
  rows: number;
  replaced: boolean;
}

export async function importDatabase(
  db: DrizzleDb,
  srcDir: string,
  options: {
    replace?: boolean;
    /** Restore publishes Home files while DB locks/rollback are still held. */
    beforeCommit?: () => void | Promise<void>;
    existingTransaction?: boolean;
    /** Offline restore must refuse a concurrent writer, not wait behind one. */
    refuseConcurrentWrites?: boolean;
  } = {},
): Promise<DatabaseImportResult> {
  const manifest = readExportManifest(srcDir);
  // Verify every file before touching the destination.
  const files = new Map(manifest.tables.map((table) => [table.name, verifyTableFile(srcDir, table)]));

  const load = async (tx: Executor): Promise<DatabaseImportResult> => {
    const destMigrations = await appliedMigrations(tx);
    if (destMigrations.length !== manifest.migrations.length || destMigrations.some((hash, index) => hash !== manifest.migrations[index])) {
      throw new DatabaseTransferError(
        `Schema version differs (export has ${manifest.migrations.length} migrations, destination has ${destMigrations.length}). Run the same LiOS version against both sides.`,
      );
    }
    const destTables = await publicTables(tx);
    const exported = manifest.tables.map((table) => table.name).sort();
    if (destTables.join(",") !== exported.join(",")) {
      throw new DatabaseTransferError("The destination tables do not match the export.");
    }

    // Migrations and the bundled seed leave reference rows in every new database, so "empty" is defined
    // by accounts: a Home with no users holds no user data and may be loaded without --replace.
    const [accounts] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from users`);
    const hasUserData = (accounts?.n ?? 0) > 0;
    if (hasUserData && !options.replace) {
      throw new DatabaseTransferError(`The destination already has ${accounts?.n} user account(s). Re-run with --replace to overwrite it.`);
    }

    // Strictly inside the transaction: any failure below rolls the destination back untouched.
    const allTables = sql.join(destTables.map((name) => sql.identifier(name)), sql`, `);
    await tx.execute(sql`lock table ${allTables} in access exclusive mode${options.refuseConcurrentWrites ? sql` nowait` : sql``}`);
    await tx.execute(sql`truncate table ${allTables} restart identity cascade`);
    await tx.execute(sql`create temp table lios_transfer_stage (doc jsonb not null) on commit drop`);

    let total = 0;
    for (const table of await loadOrder(tx, destTables)) {
      const entry = manifest.tables.find((candidate) => candidate.name === table);
      if (!entry) throw new DatabaseTransferError(`Table ${table} is not in the export.`);
      await tx.execute(sql`truncate table lios_transfer_stage`);
      const lines = fs.readFileSync(files.get(table) as string, "utf8").split("\n").filter(Boolean);
      for (let offset = 0; offset < lines.length; offset += BATCH_ROWS) {
        const chunk = `[${lines.slice(offset, offset + BATCH_ROWS).join(",")}]`;
        await tx.execute(sql`insert into lios_transfer_stage (doc) select jsonb_array_elements(${chunk}::jsonb)`);
      }
      // One statement per table: foreign keys (including self references) are checked at its end.
      await tx.execute(sql`
        insert into ${sql.identifier(table)} overriding system value
        select r.* from lios_transfer_stage s, lateral jsonb_populate_record(null::${sql.identifier(table)}, s.doc) r`);
      const actual = await contentDigest(tx, table);
      if (actual.rows !== entry.rows || actual.digest !== entry.contentDigest) {
        throw new DatabaseTransferError(`Table ${table} did not round-trip exactly (rows ${actual.rows}/${entry.rows}).`);
      }
      total += actual.rows;
    }

    const sequenced = await rows<{ table_name: string; column_name: string }>(tx, sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and pg_get_serial_sequence(quote_ident(table_schema) || '.' || quote_ident(table_name), column_name) is not null`);
    for (const { table_name: table, column_name: column } of sequenced) {
      await tx.execute(sql`
        select setval(pg_get_serial_sequence(quote_ident(${table}), ${column}), coalesce(max(${sql.identifier(column)}), 1), max(${sql.identifier(column)}) is not null)
        from ${sql.identifier(table)}`);
    }
    await options.beforeCommit?.();
    return { tables: destTables.length, rows: total, replaced: hasUserData };
  };
  return options.existingTransaction ? load(db) : db.transaction(load);
}

/** Hold every canonical table across the prior snapshot, file publication and DB commit. */
export async function withExclusiveDatabaseRestore<T>(db: DrizzleDb, restore: (tx: DrizzleDb) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const tables = await publicTables(tx);
    const allTables = sql.join(tables.map((name) => sql.identifier(name)), sql`, `);
    await tx.execute(sql`lock table ${allTables} in access exclusive mode nowait`);
    return restore(tx as unknown as DrizzleDb);
  });
}

export interface DatabaseHealth {
  ok: boolean;
  tables: number;
  migrationsApplied: number;
  migrationsExpected: number;
  invalidConstraints: number;
  problems: string[];
}

export async function databaseHealth(db: DrizzleDb, migrationsFolder: string): Promise<DatabaseHealth> {
  const problems: string[] = [];
  const journalFile = path.join(migrationsFolder, "meta", "_journal.json");
  const expected = fs.existsSync(journalFile)
    ? z.object({ entries: z.array(z.unknown()) }).parse(JSON.parse(fs.readFileSync(journalFile, "utf8"))).entries.length
    : 0;
  const applied = (await appliedMigrations(db)).length;
  if (applied !== expected) problems.push(`Applied migrations (${applied}) differ from the bundled journal (${expected}).`);
  const tables = (await publicTables(db)).length;
  const [invalid] = await rows<{ n: number }>(db, sql`select count(*)::int as n from pg_constraint where not convalidated`);
  if (invalid?.n) problems.push(`${invalid.n} constraint(s) are not validated.`);
  return { ok: problems.length === 0, tables, migrationsApplied: applied, migrationsExpected: expected, invalidConstraints: invalid?.n ?? 0, problems };
}
