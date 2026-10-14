import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-backup-service-"));
process.env.HOME = path.join(base, "user");
process.env.LIOS_DATA_ROOT = path.join(base, "home");
delete process.env.DATABASE_URL;
fs.mkdirSync(process.env.HOME, { recursive: true });

const { closeDb, initDb } = await import("./db");
const service = await import("./backupService");
const { verifyBackup } = await import("./backupArchive");

test.before(async () => {
  await initDb();
});
test.after(async () => {
  await closeDb();
  fs.rmSync(base, { recursive: true, force: true });
});

const destination = path.join(base, "backups");
const settings = { enabled: true, destination, encrypt: true, keep: 2, intervalHours: 24 };

test("settings refuse a destination inside the data folder, a missing folder, a short passphrase and an encrypted schedule without a passphrase", () => {
  assert.throws(() => service.saveBackupSettings({ ...settings, destination: path.join(base, "home", "backups") }, "a-long-enough-passphrase"), /outside the LiOS data folder/);
  assert.throws(() => service.saveBackupSettings({ ...settings, destination: "relative/dir" }, "a-long-enough-passphrase"), /absolute/);
  assert.throws(() => service.saveBackupSettings({ ...settings, destination: null }, "a-long-enough-passphrase"), /Choose a backup folder/);
  assert.throws(() => service.saveBackupSettings(settings, "short"), /at least 12/);
  assert.throws(() => service.saveBackupSettings(settings), /Set a backup passphrase/);
  assert.equal(service.readBackupSettings().enabled, false, "nothing was saved by the refused attempts");
});

test("a manual run writes a verified encrypted backup, keeps only the newest, never returns the passphrase and records success", async () => {
  service.saveBackupSettings(settings, "a-long-enough-passphrase");
  assert.equal(service.readBackupStatus().passphraseSet, true);
  assert.equal(JSON.stringify(service.readBackupStatus()).includes("a-long-enough-passphrase"), false);
  const first = await service.runBackupNow();
  assert.match(first.file, /\.liosbak$/);
  await verifyBackup(first.file, { passphrase: "a-long-enough-passphrase" });
  const status = service.readBackupStatus();
  assert.equal(status.lastError, null);
  assert.equal(status.lastFile, first.file);
  assert.ok(status.lastSuccessAt);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await service.runBackupNow();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await service.runBackupNow();
  assert.equal(fs.readdirSync(destination).filter((name) => name.endsWith(".liosbak")).length, 2, "retention keeps the newest two");
});

test("the restore test loads the newest backup into a scratch database and every table matches", async () => {
  const result = await service.restoreTestLatest();
  assert.equal(result.digestsMatch, true);
  assert.ok(result.tables > 100 && result.rows > 0);
  assert.equal(service.readBackupStatus().lastRestoreTest?.ok, true);
});

test("a failed run is recorded as an explicit failure and does not erase the last success", async () => {
  const before = service.readBackupStatus();
  const blocked = path.join(base, "not-a-directory");
  fs.writeFileSync(blocked, "file");
  service.saveBackupSettings({ ...settings, destination: path.join(blocked, "inside") }, undefined);
  await assert.rejects(service.runBackupNow());
  const after = service.readBackupStatus();
  assert.ok(after.lastError && after.lastError.length > 0);
  assert.equal(after.lastSuccessAt, before.lastSuccessAt);
  assert.equal(after.running, false);
});

test("the schedule fires after the interval, retries a failure only after an hour, and never when disabled", () => {
  const hour = 3_600_000;
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const iso = (offset: number) => new Date(now - offset).toISOString();
  const status = (success: number | null, attempt: number | null) => ({
    running: false, lastAttemptAt: attempt === null ? null : iso(attempt), lastSuccessAt: success === null ? null : iso(success),
    lastFile: null, lastEntries: null, lastError: null, lastRestoreTest: null,
  });
  assert.equal(service.backupDueForTest(settings, status(null, null), now), true, "never backed up");
  assert.equal(service.backupDueForTest(settings, status(23 * hour, 23 * hour), now), false);
  assert.equal(service.backupDueForTest(settings, status(25 * hour, 25 * hour), now), true);
  assert.equal(service.backupDueForTest(settings, status(48 * hour, 10 * 60_000), now), false, "failed 10 minutes ago");
  assert.equal(service.backupDueForTest(settings, status(48 * hour, 2 * hour), now), true, "failed 2 hours ago");
  assert.equal(service.backupDueForTest({ ...settings, enabled: false }, status(null, null), now), false);
});
