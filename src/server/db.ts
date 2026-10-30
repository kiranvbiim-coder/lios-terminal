/**
 * Multi-tenant database client.
 *
 * Backed by PGlite (real Postgres compiled to run in-process) rather than a
 * system Postgres service: this app ships as a desktop terminal installed on
 * each employee's Mac, so a locally-running system database doesn't even
 * make sense here (client org data must live in ONE shared place every
 * employee's terminal reads, not scattered per-laptop). For actual
 * multi-employee use, set DATABASE_URL to a real hosted Postgres instance
 * (Supabase/RDS/Neon/etc) and this module transparently switches to it via
 * drizzle-orm's node-postgres driver -- same schema, same queries, same
 * migration files either way.
 *
 * Data directory: <data root>/pgdata, resolved by dataRoot.ts (GM-03). A missing database folder in a
 * root LiOS already initialized is refused, never recreated empty.
 */
import path from "path";
import fs from "fs";
import * as schema from "@shared/schema";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { acquirePgliteOwnership, PgliteOwnershipError, recoverStalePgliteLock, type PgliteOwnershipHandle } from "./pgliteLock";
import { markPgliteMigrationsApplied, preparePgliteMigrationBackup } from "./pgliteBackup";
import { DataRootUnavailableError, dataRoot, databaseDir, markDatabaseInitialized, prepareDataRoot } from "./dataRoot";
import { assertNoPendingHomeRestore } from "./backupRestoreState";
// PGlite's JavaScript Date adapter reads the process timezone before SQL is
// executed. Keep that boundary in UTC so timestamptz values are not shifted
// by the workstation's local offset during insert/read round-trips.
process.env.TZ = "UTC";
export type DrizzleDb = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;
let dbInstance: DrizzleDb | null = null;
let dbInitPromise: Promise<DrizzleDb> | null = null;
let usingPglite = false;
let closeDatabase: (() => Promise<void>) | null = null;
let pgliteOwnership: PgliteOwnershipHandle | null = null;
let exitReleaseInstalled = false;
let pgliteDir = "";

export async function initDb(options: { restoreRecovery?: boolean } = {}): Promise<DrizzleDb> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = initializeDb(options);
  try {
    return await dbInitPromise;
  } finally {
    dbInitPromise = null;
  }
}

async function initializeDb(options: { restoreRecovery?: boolean }): Promise<DrizzleDb> {
  let migrationFingerprint: string | null = null;
  try {
    if (!options.restoreRecovery) assertNoPendingHomeRestore(dataRoot());
    if (process.env.DATABASE_URL) {
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { Pool } = await import("pg");
      // Hosted database connections must keep TLS certificate verification enabled.
      // Environments with private CAs must install/configure the correct CA.
      if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false") {
        throw new Error("Hosted Postgres TLS certificate verification cannot be disabled.");
      }
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: "-c timezone=UTC" });
      dbInstance = drizzle(pool, { schema });
      closeDatabase = () => pool.end();
      console.log("Connected to hosted Postgres via DATABASE_URL.");
    } else {
      const { drizzle } = await import("drizzle-orm/pglite");
      const { PGlite } = await import("@electric-sql/pglite");
      // Throws DataRootUnavailableError instead of silently creating an empty database over a root that
      // LiOS already initialized (unmounted drive, deleted or moved database folder).
      prepareDataRoot({ localDatabase: true }, options.restoreRecovery === true);
      pgliteDir = databaseDir();
      const freshDatabase = !fs.existsSync(pgliteDir);
      if (freshDatabase && options.restoreRecovery) throw new Error("Restore recovery requires the existing Home database; refusing to create a fresh one.");
      if (freshDatabase) restoreSeedDbOrCreateEmpty(pgliteDir);

      pgliteOwnership = acquirePgliteOwnership(pgliteDir);
      if (!exitReleaseInstalled) {
        process.once("exit", () => pgliteOwnership?.release());
        exitReleaseInstalled = true;
      }

      const lockRecovery = recoverStalePgliteLock(pgliteDir);
      if (lockRecovery.action === "preserved_active") {
        throw new PgliteOwnershipError(lockRecovery.path, lockRecovery.pid, "PGlite's postmaster marker belongs to a live or unverifiable process");
      }
      if (lockRecovery.action === "removed_stale") {
        console.warn(`Removed stale PGlite lock marker at ${lockRecovery.path}; previous process is not running.`);
      }

      const backup = preparePgliteMigrationBackup({
        dataDir: pgliteDir,
        migrationsFolder: resolveMigrationsFolder(),
        freshDatabase,
      });
      migrationFingerprint = backup.fingerprint;
      if (backup.action === "backed_up") {
        console.log(`Created pre-migration PGlite backup at ${backup.backupPath}.`);
      }

      const client = new PGlite(pgliteDir);
      dbInstance = drizzle(client, { schema });
      closeDatabase = async () => { await client.close(); };
      usingPglite = true;
      console.log(`Using local embedded Postgres (PGlite) at ${pgliteDir}. Set DATABASE_URL for a real shared database.`);
    }

    // Recovery must reopen the exact interrupted schema, not migrate it before
    // the prior logical export has been checked and restored.
    if (!options.restoreRecovery) {
      await runMigrations(dbInstance);
      if (usingPglite && migrationFingerprint) markPgliteMigrationsApplied(pgliteDir, migrationFingerprint);
      if (usingPglite) markDatabaseInitialized();
    }
    return dbInstance;
  } catch (error) {
    await closeDb();
    if (error instanceof DataRootUnavailableError) throw error;
    throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function closeDb(): Promise<void> {
  const close = closeDatabase;
  closeDatabase = null;
  dbInstance = null;
  usingPglite = false;
  try {
    await close?.();
  } finally {
    pgliteOwnership?.release();
    pgliteOwnership = null;
  }
}

export function resolveMigrationsFolder(): string {
  const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  return resourcesBase
    ? path.join(resourcesBase, "migrations")
    : path.resolve(process.cwd(), "migrations");
}

// Bundled demo-data snapshot (server/data/seed-db/pgdata), shipped via
// electron-builder's extraResources so a fresh install boots with a
// populated terminal instead of an empty database. Same resourcesPath
// resolution as resolveMigrationsFolder() above.
function resolveSeedDbFolder(): string | null {
  const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  const seedDir = resourcesBase
    ? path.join(resourcesBase, "server", "data", "seed-db", "pgdata")
    : path.resolve(process.cwd(), "server", "data", "seed-db", "pgdata");
  return fs.existsSync(seedDir) ? seedDir : null;
}

function restoreSeedDbOrCreateEmpty(pgliteDir: string): void {
  const seedDir = resolveSeedDbFolder();
  if (!seedDir) {
    fs.mkdirSync(pgliteDir, { recursive: true });
    return;
  }
  fs.mkdirSync(path.dirname(pgliteDir), { recursive: true });
  fs.cpSync(seedDir, pgliteDir, { recursive: true });
  // The snapshot may carry a lock file from whatever process it was copied
  // from; drop it so PGlite doesn't mistake this fresh copy for one already
  // in use.
  fs.rmSync(path.join(pgliteDir, "postmaster.pid"), { force: true });
  fs.rmSync(path.join(pgliteDir, ".limuria-pglite-owner.json"), { force: true });
  // electron-builder's extraResources copy is glob/file-list based, so it
  // silently drops empty directories (there's no file inside them to match)
  // -- but Postgres requires these fixed system subdirectories to exist even
  // when empty (pg_wal/archive_status, pg_replslot, pg_stat_tmp, etc.), or it
  // fails deep inside single-user-mode startup with an opaque WASM error the
  // very first time a query runs. Recreate any that didn't survive the copy.
  for (const dir of PG_REQUIRED_EMPTY_DIRS) {
    fs.mkdirSync(path.join(pgliteDir, dir), { recursive: true });
  }
  console.log(`Restored bundled seed database into ${pgliteDir} (fresh install).`);
}

const PG_REQUIRED_EMPTY_DIRS = [
  "pg_commit_ts", "pg_dynshmem", "pg_logical/mappings", "pg_logical/snapshots",
  "pg_notify", "pg_replslot", "pg_serial", "pg_snapshots", "pg_stat",
  "pg_stat_tmp", "pg_tblspc", "pg_twophase", "pg_wal/archive_status", "pg_wal/summaries",
];

async function runMigrations(db: DrizzleDb): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  if (usingPglite) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as unknown as PgliteDatabase<typeof schema>, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as unknown as NodePgDatabase<typeof schema>, { migrationsFolder });
  }
}

/** True once `initDb()` has run. Lets code that must not throw before startup (and tests without a database) ask first. */
export function isDbInitialized(): boolean {
  return Boolean(dbInstance);
}

export function getDb(): DrizzleDb {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call initDb() at server startup before using getDb().");
  }
  return dbInstance;
}
