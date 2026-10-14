import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PgliteBackupAction = "fresh_database" | "unchanged" | "backed_up";

export interface PgliteBackupResult {
  action: PgliteBackupAction;
  fingerprint: string;
  backupPath: string | null;
}

function filesUnder(root: string, current = root): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return filesUnder(root, full);
    return [full];
  });
}

export function fingerprintMigrations(migrationsFolder: string): string {
  if (!fs.existsSync(migrationsFolder)) throw new Error(`Migrations folder does not exist: ${migrationsFolder}`);
  const hash = crypto.createHash("sha256");
  const files = filesUnder(migrationsFolder)
    .filter((file) => file.endsWith(".sql") || file.endsWith("_journal.json"))
    .sort((a, b) => path.relative(migrationsFolder, a).localeCompare(path.relative(migrationsFolder, b)));
  if (!files.length) throw new Error(`No migration SQL or journal files found in ${migrationsFolder}`);
  for (const file of files) {
    hash.update(path.relative(migrationsFolder, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function markerPath(dataDir: string): string {
  return path.join(path.dirname(dataDir), `.${path.basename(dataDir)}-migration-fingerprint`);
}

function backupRoot(dataDir: string): string {
  return `${dataDir}-backups`;
}

function removeOldBackups(root: string, maxBackups: number): void {
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ path: path.join(root, entry.name), mtime: fs.statSync(path.join(root, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries.slice(Math.max(1, maxBackups))) {
    fs.rmSync(entry.path, { recursive: true, force: true });
  }
}

/**
 * Run only while the caller owns the exclusive PGlite owner marker and
 * before `new PGlite(dataDir)`. Copying an open PGlite directory is not a
 * consistent backup; the single-writer owner is what makes this snapshot
 * safe.
 */
export function preparePgliteMigrationBackup(input: {
  dataDir: string;
  migrationsFolder: string;
  freshDatabase: boolean;
  maxBackups?: number;
}): PgliteBackupResult {
  const fingerprint = fingerprintMigrations(input.migrationsFolder);
  if (input.freshDatabase) return { action: "fresh_database", fingerprint, backupPath: null };

  const marker = markerPath(input.dataDir);
  const previous = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (previous === fingerprint) return { action: "unchanged", fingerprint, backupPath: null };

  const root = backupRoot(input.dataDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(root, `pre-migration-${stamp}-${fingerprint.slice(0, 12)}`);
  fs.cpSync(input.dataDir, destination, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return name !== "postmaster.pid" && name !== ".limuria-pglite-owner.json";
    },
  });
  fs.writeFileSync(path.join(destination, "backup-manifest.json"), `${JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    source: input.dataDir,
    migrationFingerprint: fingerprint,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  removeOldBackups(root, input.maxBackups ?? 3);
  return { action: "backed_up", fingerprint, backupPath: destination };
}

export function markPgliteMigrationsApplied(dataDir: string, fingerprint: string): void {
  const marker = markerPath(dataDir);
  const temp = `${marker}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${fingerprint}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, marker);
}
