import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprintMigrations, markPgliteMigrationsApplied, preparePgliteMigrationBackup } from "./pgliteBackup";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-pglite-backup-"));
  const dataDir = path.join(root, "pgdata");
  const migrationsFolder = path.join(root, "migrations");
  fs.mkdirSync(dataDir);
  fs.mkdirSync(migrationsFolder);
  fs.writeFileSync(path.join(dataDir, "data.bin"), "original", "utf8");
  fs.writeFileSync(path.join(dataDir, "postmaster.pid"), `${process.pid}\n`, "utf8");
  fs.writeFileSync(path.join(dataDir, ".limuria-pglite-owner.json"), "owner", "utf8");
  fs.writeFileSync(path.join(migrationsFolder, "0001_init.sql"), "CREATE TABLE test(id int);", "utf8");
  return { root, dataDir, migrationsFolder };
}

test("migration fingerprint changes only when migration content changes", () => {
  const f = fixture();
  try {
    const first = fingerprintMigrations(f.migrationsFolder);
    assert.equal(fingerprintMigrations(f.migrationsFolder), first);
    fs.writeFileSync(path.join(f.migrationsFolder, "0002_more.sql"), "ALTER TABLE test ADD name text;", "utf8");
    assert.notEqual(fingerprintMigrations(f.migrationsFolder), first);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("pre-migration backup excludes live lock markers and writes a manifest", () => {
  const f = fixture();
  try {
    const result = preparePgliteMigrationBackup({ dataDir: f.dataDir, migrationsFolder: f.migrationsFolder, freshDatabase: false });
    assert.equal(result.action, "backed_up");
    assert.ok(result.backupPath);
    assert.equal(fs.readFileSync(path.join(result.backupPath!, "data.bin"), "utf8"), "original");
    assert.equal(fs.existsSync(path.join(result.backupPath!, "postmaster.pid")), false);
    assert.equal(fs.existsSync(path.join(result.backupPath!, ".limuria-pglite-owner.json")), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.backupPath!, "backup-manifest.json"), "utf8"));
    assert.equal(manifest.migrationFingerprint, result.fingerprint);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("applied migration fingerprint suppresses redundant startup backups", () => {
  const f = fixture();
  try {
    const first = preparePgliteMigrationBackup({ dataDir: f.dataDir, migrationsFolder: f.migrationsFolder, freshDatabase: false });
    markPgliteMigrationsApplied(f.dataDir, first.fingerprint);
    const second = preparePgliteMigrationBackup({ dataDir: f.dataDir, migrationsFolder: f.migrationsFolder, freshDatabase: false });
    assert.equal(second.action, "unchanged");
    assert.equal(second.backupPath, null);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("fresh database records the fingerprint without copying seed data", () => {
  const f = fixture();
  try {
    const result = preparePgliteMigrationBackup({ dataDir: f.dataDir, migrationsFolder: f.migrationsFolder, freshDatabase: true });
    assert.equal(result.action, "fresh_database");
    assert.equal(result.backupPath, null);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
