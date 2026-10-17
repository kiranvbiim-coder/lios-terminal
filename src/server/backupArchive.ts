import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { z } from "zod";
import type { DrizzleDb } from "./db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import os from "node:os";
import * as schema from "@shared/schema";
import { resolveMigrationsFolder } from "./db";
import { databaseDir, dataRoot } from "./dataRoot";
import { BackupDecryptStream, BackupEncryptStream, isEncryptedBackupHeader } from "./backupCrypto";
import { exportDatabase, importDatabase, readExportManifest, withExclusiveDatabaseRestore, type DatabaseExportManifest } from "./databaseTransfer";
import { createVaultMigrationEnvelope } from "./credentialVault";
import { normalizeArchivePath, padTo512, TAR_END, TarFormatError, TarReader, tarFileHeader } from "./tarFormat";
import { assertHomeRestoreOffline, RESTORE_STATE_DIRECTORY, restoreRecoveryMessage } from "./backupRestoreState";
import { HomeRestoreRecovery, syncRestorePath, syncRestoreTree } from "./backupRestoreRecovery";

/**
 * GM-06: one portable, verified backup of everything a Home owns.
 *
 *   <dest>/lios-backup-<UTC stamp>.tar.gz   (unencrypted: secret keys and execution transcripts are left out)
 *   <dest>/lios-backup-<UTC stamp>.liosbak  (passphrase-encrypted tar.gz: includes vault.key and storage.key)
 *
 * Entries: `db/**` (the GM-04 logical export), `files/**` (the data root, minus the live PGlite directory and
 * regenerable/transient files), and a final `lios-backup.json` listing every entry with SHA-256 and size.
 */

export const BACKUP_FORMAT = "lios-backup/1";
export const BACKUP_MANIFEST_ENTRY = "lios-backup.json";
export const BACKUP_VAULT_MIGRATION_ENTRY = "files/data/credential-vault-portable.bin";
const DEFAULT_MAX_EXPANDED_BYTES = 64 * 1024 ** 3;

const SECRET_KEY_FILES: Readonly<Record<string, true>> = {
  "vault.key": true,
  "data/storage.key": true,
  "data/device-tls/identity.json": true,
};
/** Never archived: regenerated per Home, or tied to one running process. */
const NEVER_ARCHIVED: Array<[RegExp, string]> = [
  [/^\.lios-root\.json$/, "data-root marker (recreated on restore)"],
  [/^\.pgdata-migration-fingerprint$/, "regenerable"],
  [/^pgdata-backups(\/|$)/, "local pre-migration snapshots"],
  [/^data\/session-secret$/, "Home session secret (a restored Home signs in again)"],
  [/^owner-setup\.token$/, "one-time setup token"],
  [/^data\/owner-setup\.token$/, "one-time setup token"],
  [/^data\/observability(\/|$)/, "diagnostic logs"],
  [/^data\/credential-vault-portable\.bin$/, "ephemeral credential migration envelope"],
  [/^restore-previous-/, "previous restore leftovers"],
  [/(^|\/)\.lios-(restore|backup)-/, "in-progress staging"],
  [/(\.lock|\.pid|\.tmp|\.partial)$/, "transient"],
];

const entrySchema = z.object({
  path: z.string(),
  kind: z.enum(["db", "file"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});
const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  createdAt: z.string(),
  liosVersion: z.string(),
  encrypted: z.boolean(),
  sourceEngine: z.enum(["pglite", "postgres"]),
  database: z.object({ tables: z.number().int(), rows: z.number().int(), migrations: z.number().int() }),
  entries: z.array(entrySchema),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  notes: z.array(z.string()),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

interface PlannedFile {
  relative: string;
  absolute: string;
  size: number;
}

function walk(root: string, dbDir: string, encrypted: boolean): { files: PlannedFile[]; skipped: BackupManifest["skipped"] } {
  const files: PlannedFile[] = [];
  const skipped: BackupManifest["skipped"] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (absolute === dbDir) {
        skipped.push({ path: relative, reason: "live database directory (exported logically under db/)" });
        continue;
      }
      if (!encrypted && relative === "execution-journal") {
        skipped.push({ path: relative, reason: "private execution transcripts; only included in an encrypted backup" });
        continue;
      }
      const never = NEVER_ARCHIVED.find(([pattern]) => pattern.test(relative));
      if (never) {
        skipped.push({ path: relative, reason: never[1] });
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.push({ path: relative, reason: "symbolic link" });
      } else if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push({ relative, absolute, size: fs.statSync(absolute).size });
      } else {
        skipped.push({ path: relative, reason: "not a regular file" });
      }
    }
  };
  visit(root);
  return { files, skipped };
}

async function* fileChunks(file: string, size: number): AsyncGenerator<Buffer> {
  if (size === 0) return;
  let read = 0;
  for await (const chunk of fs.createReadStream(file, { start: 0, end: size - 1 })) {
    read += (chunk as Buffer).length;
    yield chunk as Buffer;
  }
  if (read !== size) throw new BackupError(`${path.basename(file)} changed while it was being backed up. Run the backup again.`);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const ARCHIVE_NAME = /^lios-backup-\d{8}T\d{6}Z\.(tar\.gz|liosbak)$/;

/**
 * Reserve an exclusive, per-restore directory for overwritten Home files.
 * Timestamp-only names can collide during repeated restores in the same
 * second and cause renameSync to overwrite the *earlier* recovery copy.
 * Never reuse an existing directory, including a dangling symlink.
 */
export function reserveRestorePreviousDirectory(root: string, now = new Date()): string {
  const entry = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new BackupError("Previous-file preservation requires a real Home directory.");
  }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = path.join(root, `restore-previous-${stamp(now)}-${crypto.randomUUID()}`);
    try {
      // Atomic and non-recursive: this invocation owns only a fresh slot.
      fs.mkdirSync(candidate, { mode: 0o700 });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new BackupError("Unable to reserve an unused directory for prior restore files.");
}


export interface CreateBackupOptions {
  destination: string;
  engine: DatabaseExportManifest["sourceEngine"];
  liosVersion: string;
  /** Present: encrypted archive that includes the key files. Absent: plain tar.gz without them. */
  passphrase?: string;
  /** Keep this many archives in the destination (newest first) after a successful, verified backup. */
  keep?: number;
  now?: Date;
}

export interface BackupResult {
  file: string;
  manifest: BackupManifest;
  pruned: string[];
}

/** Resolve a proposed backup path through existing ancestors without creating it. */
function physicalBackupDestination(destination: string): string {
  let existing = destination;
  const tail: string[] = [];
  for (;;) {
    const entry = fs.lstatSync(existing, { throwIfNoEntry: false });
    if (entry) {
      if (tail.length && !entry.isDirectory() && !entry.isSymbolicLink()) {
        throw new BackupError("Backup destination must have an existing directory ancestor.");
      }
      return path.resolve(fs.realpathSync(existing), ...tail);
    }
    const parent = path.dirname(existing);
    if (parent === existing) throw new BackupError("Backup destination has no accessible directory ancestor.");
    tail.unshift(path.basename(existing));
    existing = parent;
  }
}

export async function createBackup(db: DrizzleDb, options: CreateBackupOptions): Promise<BackupResult> {
  const root = dataRoot();
  const destination = path.resolve(options.destination);
  if (destination === root || destination.startsWith(`${root}${path.sep}`)) {
    throw new BackupError("Choose a backup destination outside the LiOS data folder.");
  }
  const dbDir = databaseDir();
  if (dbDir === root) throw new BackupError("This data root stores the database at its top level; move it into a pgdata folder first.");
  const physicalRoot = fs.realpathSync(root);
  const plannedDestination = physicalBackupDestination(destination);
  if (plannedDestination === physicalRoot || plannedDestination.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new BackupError("Choose a backup destination outside the LiOS data folder.");
  }
  const priorDestination = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (priorDestination && (!priorDestination.isDirectory() || priorDestination.isSymbolicLink())) {
    throw new BackupError("Backup destination must be a real directory, not a symbolic link.");
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const destinationEntry = fs.lstatSync(destination);
  if (!destinationEntry.isDirectory() || destinationEntry.isSymbolicLink()) {
    throw new BackupError("Backup destination must be a real directory, not a symbolic link.");
  }
  // A path can be lexically outside Home but physically inside it through an
  // existing parent alias. Refuse that physical overlap before any staging.
  const physicalDestination = fs.realpathSync(destination);
  if (physicalDestination === physicalRoot || physicalDestination.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new BackupError("Choose a backup destination outside the LiOS data folder.");
  }

  const now = options.now ?? new Date();
  const encrypted = options.passphrase !== undefined;
  const file = path.join(destination, `lios-backup-${stamp(now)}.${encrypted ? "liosbak" : "tar.gz"}`);
  if (fs.lstatSync(file, { throwIfNoEntry: false })) throw new BackupError(`${path.basename(file)} already exists.`);
  const staging = path.join(destination, `.lios-backup-${process.pid}-${crypto.randomUUID()}`);
  // Non-recursive mkdir is an atomic reservation. Never adopt an existing
  // staging directory, even an abandoned one from an earlier invocation.
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BackupError("Backup staging directory is already occupied.");
    }
    throw error;
  }
  const partial = path.join(staging, "archive.partial");
  let published = false;
  let vaultMigrationEnvelope: Buffer | null = null;

  try {
    const dbOut = path.join(staging, "db");
    const dbManifest = await exportDatabase(db, dbOut, options.engine);

    const planned = walk(root, dbDir, encrypted);
    vaultMigrationEnvelope = encrypted
      ? createVaultMigrationEnvelope(options.passphrase as string)
      : null;
    const files = planned.files.filter((candidate) => {
      if (!encrypted && SECRET_KEY_FILES[candidate.relative]) {
        planned.skipped.push({ path: candidate.relative, reason: "secret key; only included in an encrypted backup" });
        return false;
      }
      return true;
    });

    const notes = [
      encrypted
        ? "Saved credentials include a passphrase-sealed portable migration envelope so a restored Home can re-key them under destination secret custody."
        : "Credential ciphertext is included, but portable credential migration material is NOT included in an unencrypted backup.",
      ...(encrypted ? [] : ["Object-storage blobs encrypted with storage.key cannot be decrypted from this backup because the key is not included."]),
      ...(encrypted ? [] : ["Private execution transcripts are omitted from unencrypted backups."]),
    ];

    const entries: BackupManifest["entries"] = [];
    async function* archive(): AsyncGenerator<Buffer> {
      const emit = async function* (name: string, kind: "db" | "file", size: number, source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        const safe = normalizeArchivePath(name);
        const hash = crypto.createHash("sha256");
        yield tarFileHeader(safe, size, now);
        for await (const chunk of source) {
          hash.update(chunk);
          yield chunk;
        }
        yield padTo512(size);
        entries.push({ path: safe, kind, sha256: hash.digest("hex"), bytes: size });
      };
      for (const table of ["manifest.json", ...dbManifest.tables.map((entry) => `tables/${entry.name}.ndjson`)]) {
        const absolute = path.join(dbOut, table);
        const size = fs.statSync(absolute).size;
        yield* emit(`db/${table}`, "db", size, fileChunks(absolute, size));
      }
      for (const candidate of files) {
        yield* emit(`files/${candidate.relative}`, "file", candidate.size, fileChunks(candidate.absolute, candidate.size));
      }
      if (vaultMigrationEnvelope) {
        yield* emit(
          BACKUP_VAULT_MIGRATION_ENTRY,
          "file",
          vaultMigrationEnvelope.length,
          Readable.from([vaultMigrationEnvelope]),
        );
      }
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        createdAt: now.toISOString(),
        liosVersion: options.liosVersion,
        encrypted,
        sourceEngine: options.engine,
        database: {
          tables: dbManifest.tables.length,
          rows: dbManifest.tables.reduce((sum, entry) => sum + entry.rows, 0),
          migrations: dbManifest.migrations.length,
        },
        entries,
        skipped: planned.skipped,
        notes,
      };
      const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      yield tarFileHeader(BACKUP_MANIFEST_ENTRY, body.length, now);
      yield body;
      yield padTo512(body.length);
      yield TAR_END;
    }

    const sink = fs.createWriteStream(partial, { flags: "wx", mode: 0o600 });
    await pipeline([Readable.from(archive()), zlib.createGzip({ level: 6 }), ...(encrypted ? [new BackupEncryptStream(options.passphrase as string)] : []), sink]);
    const handle = fs.openSync(partial, "r+");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }

    // Verify the completed private staging file before publishing. A hard
    // link publishes only when the final pathname is unoccupied; unlike
    // renameSync this cannot replace a backup another process just created.
    const manifest = await verifyBackup(partial, { passphrase: options.passphrase });
    fs.linkSync(partial, file);
    published = true;
    const pruned = options.keep === undefined ? [] : pruneBackups(destination, Math.max(1, options.keep));
    return { file, manifest, pruned };
  } catch (error) {
    // Only this invocation's successfully linked final archive can be
    // removed. Never delete another writer's same-name archive on EEXIST.
    if (published) fs.rmSync(file, { force: true });
    throw error;
  } finally {
    vaultMigrationEnvelope?.fill(0);
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function pruneBackups(destination: string, keep: number): string[] {
  const archives = fs.readdirSync(destination).filter((name) => ARCHIVE_NAME.test(name)).sort().reverse();
  const removed = archives.slice(keep);
  for (const name of removed) fs.rmSync(path.join(destination, name));
  return removed;
}

interface ReadOptions {
  passphrase?: string | undefined;
  /** Extract into this directory (created 0700) instead of only hashing. */
  extractTo?: string;
  maxExpandedBytes?: number;
}

/** Streams the archive once: authenticates (if encrypted), validates every path, hashes every entry, checks the manifest. */
async function readArchive(file: string, options: ReadOptions): Promise<BackupManifest> {
  const head = Buffer.alloc(8);
  const descriptor = fs.openSync(file, "r");
  try {
    fs.readSync(descriptor, head, 0, 8, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const encrypted = isEncryptedBackupHeader(head);
  if (encrypted && options.passphrase === undefined) throw new BackupError("This backup is encrypted. Provide the passphrase file.");
  if (!encrypted && options.passphrase !== undefined) throw new BackupError("This backup is not encrypted; remove the passphrase option.");

  const limit = options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;
  const seen = new Map<string, { sha256: string; bytes: number }>();
  let manifestBody: Buffer[] = [];
  let current: { name: string; hash: crypto.Hash; bytes: number; fd: number | null } | null = null;
  let expanded = 0;
  let afterManifest = false;
  // Only extractBackup() may reserve an extraction directory. Never
  // create/assume ownership of an arbitrary caller-supplied path here.
  const extractRoot = options.extractTo ? path.resolve(options.extractTo) : null;

  const reader = new TarReader({
    onEntry(rawName, size) {
      if (afterManifest) throw new BackupError("Unexpected data after the backup manifest.");
      const name = normalizeArchivePath(rawName);
      if (name !== BACKUP_MANIFEST_ENTRY && !name.startsWith("db/") && !name.startsWith("files/")) throw new BackupError(`Unexpected entry in backup: ${name}`);
      if (seen.has(name)) throw new BackupError(`Duplicate entry in backup: ${name}`);
      expanded += size;
      if (expanded > limit) throw new BackupError("The backup expands beyond the allowed size.");
      let fd: number | null = null;
      if (extractRoot && name !== BACKUP_MANIFEST_ENTRY) {
        const target = path.resolve(extractRoot, name);
        if (!target.startsWith(`${extractRoot}${path.sep}`)) throw new BackupError(`Unsafe path in backup: ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fd = fs.openSync(target, "wx", 0o600);
      }
      current = { name, hash: crypto.createHash("sha256"), bytes: 0, fd };
      if (name === BACKUP_MANIFEST_ENTRY) manifestBody = [];
    },
    onData(chunk) {
      if (!current) return;
      current.hash.update(chunk);
      current.bytes += chunk.length;
      if (current.name === BACKUP_MANIFEST_ENTRY) manifestBody.push(Buffer.from(chunk));
      if (current.fd !== null) fs.writeSync(current.fd, chunk);
    },
    onEntryEnd() {
      if (!current) return;
      if (current.fd !== null) fs.closeSync(current.fd);
      seen.set(current.name, { sha256: current.hash.digest("hex"), bytes: current.bytes });
      if (current.name === BACKUP_MANIFEST_ENTRY) afterManifest = true;
      current = null;
    },
  });

  try {
    await pipeline([
      fs.createReadStream(file),
      ...(encrypted ? [new BackupDecryptStream(options.passphrase as string)] : []),
      zlib.createGunzip(),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          try {
            reader.push(chunk);
            callback();
          } catch (error) {
            callback(error as Error);
          }
        },
      }),
    ]);
    reader.finish();
  } catch (error) {
    const open = current as { fd: number | null } | null;
    if (open?.fd !== null && open?.fd !== undefined) fs.closeSync(open.fd);
    if (extractRoot) fs.rmSync(extractRoot, { recursive: true, force: true });
    if (error instanceof TarFormatError) throw new BackupError(error.message);
    throw error;
  }

  const recorded = seen.get(BACKUP_MANIFEST_ENTRY);
  if (!recorded) throw new BackupError("The backup has no manifest; it is incomplete.");
  const parsed = manifestSchema.safeParse(JSON.parse(Buffer.concat(manifestBody).toString("utf8")));
  if (!parsed.success) throw new BackupError("The backup manifest is unsupported or damaged.");
  const manifest = parsed.data;
  if (manifest.encrypted !== encrypted) {
    if (extractRoot) fs.rmSync(extractRoot, { recursive: true, force: true });
    throw new BackupError("Backup manifest encryption disagrees with the actual archive envelope.");
  }
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const entry of manifest.entries) {
    listed.add(entry.path);
    const actual = seen.get(entry.path);
    if (!actual) problems.push(`missing ${entry.path}`);
    else if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) problems.push(`changed ${entry.path}`);
  }
  for (const name of seen.keys()) if (name !== BACKUP_MANIFEST_ENTRY && !listed.has(name)) problems.push(`unlisted ${name}`);
  if (problems.length) {
    if (extractRoot) fs.rmSync(extractRoot, { recursive: true, force: true });
    throw new BackupError(`Backup failed verification: ${problems.slice(0, 5).join(", ")}${problems.length > 5 ? ` and ${problems.length - 5} more` : ""}.`);
  }
  return manifest;
}

export function verifyBackup(file: string, options: { passphrase?: string | undefined } = {}): Promise<BackupManifest> {
  return readArchive(file, options);
}

/** Decrypts/verifies and writes the archive's contents to a freshly owned directory. */
export function extractBackup(file: string, directory: string, options: { passphrase?: string | undefined } = {}): Promise<BackupManifest> {
  const destination = path.resolve(directory);
  // lstat also detects dangling symlinks (existsSync does not). Reserve the
  // new directory with an atomic, non-recursive mkdir so this invocation
  // never writes into or deletes a pre-existing Home directory.
  if (fs.lstatSync(destination, { throwIfNoEntry: false })) {
    throw new BackupError(`Extraction target already exists: ${destination}`);
  }
  const parent = fs.lstatSync(path.dirname(destination), { throwIfNoEntry: false });
  if (!parent?.isDirectory() || parent.isSymbolicLink()) {
    throw new BackupError("Backup extraction requires a real existing parent directory.");
  }
  try {
    fs.mkdirSync(destination, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BackupError(`Extraction target already exists: ${destination}`);
    }
    throw error;
  }
  // Only after mkdir succeeds do we own this path. Clean it on failures,
  // including errors during archive opening / header checks before the
  // archive reader's own streaming cleanup path is established.
  return readArchive(file, { ...options, extractTo: destination }).catch((error: unknown) => {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  });
}

/**
 * Refuse existing Home symlinks that redirect an otherwise valid archive
 * entry outside the user-owned root. Check once before DB import and again
 * immediately before file mutation; aliases above the Home root are allowed.
 */
export function assertSafeRestoreFileTarget(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const rootEntry = fs.lstatSync(resolvedRoot, { throwIfNoEntry: false });
  if (!rootEntry?.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new BackupError("The LiOS restore destination must be a real Home directory.");
  }
  const target = path.resolve(resolvedRoot, relative);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new BackupError(`Unsafe path in backup: ${relative}`);
  }
  const parts = path.relative(resolvedRoot, target).split(path.sep);
  let current = resolvedRoot;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!entry) continue;
    if (entry.isSymbolicLink()) {
      throw new BackupError(`Refusing linked restore destination: ${relative}`);
    }
    if (index < parts.length - 1 && !entry.isDirectory()) {
      throw new BackupError(`Restore parent is not a directory: ${relative}`);
    }
    if (index === parts.length - 1 && !entry.isFile()) {
      throw new BackupError(`Restore target is not a regular file: ${relative}`);
    }
  }
  return target;
}

/**
 * Archive authentication only establishes that payload bytes match the
 * archive's own manifest. It does not authorize arbitrary Home mutation.
 * Check this before database import or any move of extracted files.
 */
export function assertRestorableHomeManifest(manifest: BackupManifest): void {
  const files = new Set<string>();
  for (const entry of manifest.entries) {
    const isDb = entry.path.startsWith("db/");
    const isFile = entry.path.startsWith("files/");
    if ((!isDb && !isFile) || (isDb && entry.kind !== "db") || (isFile && entry.kind !== "file")) {
      throw new BackupError(`Backup entry has an invalid restoration kind: ${entry.path}`);
    }
    if (!isFile) continue;
    if (entry.path === BACKUP_VAULT_MIGRATION_ENTRY) continue;
    const relative = entry.path.slice("files/".length);
    // The actual database is imported from db/**, never copied from files/**.
    // Also preserve root identity and transient state LiOS deliberately omits
    // when *creating* a backup; a self-consistent forged manifest is not
    // permission to overwrite those files during restoration.
    if (!relative
      || relative === "pgdata" || relative.startsWith("pgdata/")
      || relative === "PG_VERSION"
      || NEVER_ARCHIVED.some(([pattern]) => pattern.test(relative))
      || (!manifest.encrypted && (Boolean(SECRET_KEY_FILES[relative]) || relative.startsWith("execution-journal/")))) {
      throw new BackupError(`Protected LiOS Home path cannot be restored: ${entry.path}`);
    }
    // macOS/Windows volumes may be case-insensitive even when the backup
    // originated on a case-sensitive filesystem. Never allow ambiguous
    // archive paths to overwrite each other after the DB is imported.
    const key = relative.toLowerCase();
    if (files.has(key)) {
      throw new BackupError(`Colliding restore file names: ${entry.path}`);
    }
    files.add(key);
  }
  for (const relative of files) {
    const segments = relative.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      if (files.has(segments.slice(0, i).join("/"))) {
        throw new BackupError(`Restore archive contains a file/directory collision: ${relative}`);
      }
    }
  }
}

export interface RestoreResult {
  manifest: BackupManifest;
  filesRestored: number;
  /** Existing files that a restored file replaced; kept here, never deleted. */
  previousFilesDir: string | null;
  /** Passphrase-sealed portable credential payload. Never installed as Home state. */
  credentialMigrationEnvelope: Buffer | null;
}

export interface RestoreOptions {
  passphrase?: string | undefined;
  replace?: boolean;
  /** Destination credential custody is finalized under the same recovery/DB transaction. */
  finalizeCredentials?: (envelope: Buffer) => void;
}

/** Explicit offline operator recovery also resolves an ambiguous database commit after a crash. */
export async function recoverBackupRestore(db: DrizzleDb): Promise<{ retainedRecoveryDirectory: string }> {
  const root = dataRoot();
  assertHomeRestoreOffline(root);
  const recovery = HomeRestoreRecovery.open(root, assertSafeRestoreFileTarget);
  assertRestorableHomeManifest({
    format: BACKUP_FORMAT, createdAt: "", liosVersion: "", encrypted: true, sourceEngine: "pglite",
    database: { tables: 0, rows: 0, migrations: 0 }, skipped: [], notes: [],
    entries: recovery.journal.files.map((item) => ({ path: `files/${item.relative}`, kind: "file", sha256: "0".repeat(64), bytes: 0 })),
  });
  const release = recovery.claimRecovery();
  try {
    if (recovery.journal.phase !== "preparing") {
      readExportManifest(recovery.priorDatabase);
      recovery.phase("rolling_back");
      await withExclusiveDatabaseRestore(db, async (tx) => {
        await importDatabase(tx, recovery.priorDatabase, {
          replace: true, existingTransaction: true, refuseConcurrentWrites: true,
          beforeCommit: () => recovery.rollbackFiles(assertSafeRestoreFileTarget),
        });
      });
    }
    return { retainedRecoveryDirectory: recovery.retire("rolled_back") };
  } catch (error) {
    throw new BackupError(`${restoreRecoveryMessage(root)} Recovery could not finish: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    release();
  }
}

export async function restoreBackup(
  db: DrizzleDb,
  file: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const root = dataRoot();
  // Reject redirected Home storage *before* creating the extraction staging
  // folder. A later per-file preflight cannot undo writes through a
  // symlinked Home root made during archive extraction.
  const existingRoot = fs.lstatSync(root, { throwIfNoEntry: false });
  if (existingRoot && (!existingRoot.isDirectory() || existingRoot.isSymbolicLink())) {
    throw new BackupError("The LiOS restore destination must be a real Home directory.");
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const preparedRoot = fs.lstatSync(root);
  if (!preparedRoot.isDirectory() || preparedRoot.isSymbolicLink()) {
    throw new BackupError("The LiOS restore destination must be a real Home directory.");
  }
  assertHomeRestoreOffline(root);
  const staging = path.join(root, `.lios-restore-${process.pid}-${crypto.randomUUID()}`);
  const previous = reserveRestorePreviousDirectory(root);
  let recovery: HomeRestoreRecovery;
  try {
    recovery = HomeRestoreRecovery.reserve(root, staging, previous);
    assertHomeRestoreOffline(root);
  } catch (error) {
    // This uniquely owned, still-empty slot is the only path we may remove.
    fs.rmdirSync(previous);
    throw error;
  }
  let extractionOwned = false;
  let resolved = false;
  let committed = false;
  let credentialMigrationEnvelope: Buffer | null = null;
  try {
    const manifest = await extractBackup(file, staging, options);
    extractionOwned = true;
    assertRestorableHomeManifest(manifest);
    const files = manifest.entries.filter((entry) => entry.kind === "file" && entry.path !== BACKUP_VAULT_MIGRATION_ENTRY);
    const relatives = files.map((entry) => entry.path.slice("files/".length));
    if (options.finalizeCredentials) {
      for (const relative of ["vault.key", "credential-vault.enc.json"]) {
        if (!relatives.includes(relative)) relatives.push(relative);
      }
    }
    for (const relative of relatives) assertSafeRestoreFileTarget(root, relative);
    const envelope = manifest.entries.find((entry) => entry.path === BACKUP_VAULT_MIGRATION_ENTRY);
    if (envelope) credentialMigrationEnvelope = fs.readFileSync(path.join(staging, envelope.path));
    readExportManifest(path.join(staging, "db"));
    syncRestoreTree(staging);
    await withExclusiveDatabaseRestore(db, async (tx) => {
      await exportDatabase(tx, recovery.priorDatabase, process.env.DATABASE_URL ? "postgres" : "pglite", { existingTransaction: true });
      recovery.prepareFiles(relatives, assertSafeRestoreFileTarget);
      await importDatabase(tx, path.join(staging, "db"), {
        replace: options.replace === true, existingTransaction: true, refuseConcurrentWrites: true,
        beforeCommit: () => {
          recovery.phase("publishing");
          for (const entry of files) recovery.publish(entry.path.slice("files/".length), path.join(staging, entry.path), assertSafeRestoreFileTarget);
          if (credentialMigrationEnvelope && options.finalizeCredentials) {
            options.finalizeCredentials(credentialMigrationEnvelope);
            for (const relative of ["vault.key", "credential-vault.enc.json"]) {
              const target = assertSafeRestoreFileTarget(root, relative);
              if (fs.existsSync(target)) syncRestorePath(target);
            }
            syncRestorePath(root);
          }
          // Durable before COMMIT: its outcome may be unknowable after a crash.
          // Startup therefore refuses this Home until explicit prior-state recovery.
          recovery.phase("committing");
        },
      });
    });
    committed = true;
    recovery.retire("complete");
    resolved = true;
    return { manifest, filesRestored: files.length, previousFilesDir: recovery.journal.files.some((entry) => entry.original) ? previous : null, credentialMigrationEnvelope };
  } catch (error) {
    credentialMigrationEnvelope?.fill(0);
    if (committed) {
      throw new BackupError(`Restore database and Home files committed, but final audit retirement failed. Preserve recovery custody and inspect before another restore. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (recovery.journal.phase === "preparing") {
      recovery.discardUnprepared();
      resolved = true;
      throw new BackupError(`Restore refused before Home publication; existing database and files were not replaced. ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await recoverBackupRestore(db);
      resolved = true;
    } catch (rollbackError) {
      throw new BackupError(`Restore failed; Home remains blocked pending recovery. ${restoreRecoveryMessage(root)} Restore: ${error instanceof Error ? error.message : String(error)} Recovery: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    throw new BackupError(`Restore failed; the prior database and Home files were restored. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // After a durable terminal outcome this is only owned extraction cleanup.
    // Leave it for inspection on failure; cleanup must never mask a commit.
    if (resolved && extractionOwned) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* Terminal journal retains the outcome and prior-state custody. */ }
    }
  }
}

export interface RestoreTestResult {
  tables: number;
  rows: number;
  /** True when the scratch database re-exported to exactly the digests recorded in the backup. */
  digestsMatch: boolean;
}

/**
 * Proves a backup can actually be restored without touching this Home: extracts it, loads it into a throw-away
 * PGlite database at the current schema, and compares every table's content digest with the backup's own record.
 */
export async function restoreTestBackup(file: string, options: { passphrase?: string | undefined } = {}): Promise<RestoreTestResult> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-test-"));
  const client = new PGlite(path.join(scratch, "pg"));
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    const extracted = path.join(scratch, "extracted");
    await extractBackup(file, extracted, options);
    const exportDir = path.join(extracted, "db");
    const original = readExportManifest(exportDir);
    const imported = await importDatabase(db, exportDir, { replace: true });
    const again = await exportDatabase(db, path.join(scratch, "again"), "pglite");
    const digestsMatch = again.tables.length === original.tables.length
      && again.tables.every((table, index) => table.name === original.tables[index]?.name && table.contentDigest === original.tables[index]?.contentDigest);
    return { tables: imported.tables, rows: imported.rows, digestsMatch };
  } finally {
    await client.close().catch(() => undefined);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
