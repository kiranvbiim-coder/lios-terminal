import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import zlib from "node:zlib";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-backup-test-"));
const rootA = path.join(base, "home-a");
const rootB = path.join(base, "home-b");
process.env.HOME = path.join(base, "home");
process.env.LIOS_DATA_ROOT = rootA;
delete process.env.DATABASE_URL;

const { closeDb, getDb, initDb } = await import("./db");
const { sql } = await import("drizzle-orm");
const { users } = await import("@shared/schema");
const { BackupDecryptStream, BackupEncryptStream } = await import("./backupCrypto");
const {
  BACKUP_VAULT_MIGRATION_ENTRY,
  BackupError,
  assertSafeRestoreFileTarget,
  assertRestorableHomeManifest,
  createBackup,
  extractBackup,
  reserveRestorePreviousDirectory,
  restoreBackup,
  verifyBackup,
} = await import("./backupArchive");
const { TAR_END, padTo512, tarFileHeader } = await import("./tarFormat");

const PASS = "correct horse battery staple";
const LONG = `project-attachments/1/2/${"nested-".repeat(20)}/ünïcode-${"x".repeat(40)}.blob`;
const JOURNAL = "execution-journal/550e8400-e29b-41d4-a716-446655440000";

function plant(root: string): void {
  const put = (relative: string, content: string | Buffer) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o600 });
  };
  put("vault.key", "VAULT-KEY-MATERIAL");
  put("data/storage.key", "STORAGE-KEY-MATERIAL");
  put("data/device-tls/identity.json", "TLS-PRIVATE-KEY-MATERIAL");
  put(JOURNAL, "LIOSENC1-PRIVATE-EXECUTION-TRANSCRIPT");
  put("data/session-secret", "SESSION");
  put("data/observability/log.txt", "diag");
  put("project-attachments/1/2/a.blob", "attachment-one");
  put(LONG, "long-named");
  put("empty.bin", "");
  fs.symlinkSync(path.join(root, "vault.key"), path.join(root, "link.key"));
}

test.before(async () => {
  await initDb();
  await getDb().execute(sql`truncate table users cascade`);
  await getDb().insert(users).values({ email: "a@example.test", passwordHash: "h", role: "internal_admin", name: "Alpha", active: true });
  plant(rootA);
});
test.after(async () => {
  await closeDb();
  fs.rmSync(base, { recursive: true, force: true });
});

const common = { engine: "pglite", liosVersion: "test" } as const;

test("an unencrypted backup is standard tar.gz, verifies, and never contains key material", async () => {
  const dest = path.join(base, "plain");
  const { file, manifest } = await createBackup(getDb(), { ...common, destination: dest });
  assert.match(path.basename(file), /^lios-backup-\d{8}T\d{6}Z\.tar\.gz$/);
  const paths = manifest.entries.map((entry) => entry.path);
  assert.ok(paths.includes("files/project-attachments/1/2/a.blob"));
  assert.ok(paths.includes(`files/${LONG}`), "long unicode path survives via pax headers");
  assert.ok(paths.includes("files/empty.bin"));
  assert.ok(paths.includes("db/manifest.json"));
  for (const secret of ["files/vault.key", "files/data/storage.key", "files/data/device-tls/identity.json", "files/data/session-secret", "files/link.key"]) assert.ok(!paths.includes(secret), secret);
  assert.ok(manifest.skipped.some((item) => item.path === "vault.key" && /encrypted backup/.test(item.reason)));
  assert.ok(manifest.skipped.some((item) => item.path === "link.key" && item.reason === "symbolic link"));
  assert.ok(manifest.skipped.some((item) => item.path === "pgdata"));
  assert.equal(zlib.gunzipSync(fs.readFileSync(file)).includes("KEY-MATERIAL"), false);
  assert.equal(paths.some((entry) => entry.startsWith("files/execution-journal/")), false);
  assert.equal(paths.includes(BACKUP_VAULT_MIGRATION_ENTRY), false, "unencrypted backup has no portable credential envelope");
  assert.ok(manifest.skipped.some((item) => item.path === "execution-journal" && /encrypted backup/.test(item.reason)));
  assert.equal(zlib.gunzipSync(fs.readFileSync(file)).includes("PRIVATE-EXECUTION-TRANSCRIPT"), false);
  if (process.platform !== "win32") {
    // GNU tar prints non-ASCII names as octal escapes unless the locale is UTF-8 (a container with no LANG does). The archive
    // is the same either way, so pin the locale instead of depending on the ambient one. bsdtar (macOS) needs no override.
    const env = process.platform === "linux" ? { ...process.env, LC_ALL: "C.UTF-8" } : process.env;
    const listing = spawnSync("tar", ["-tzf", file], { encoding: "utf8", env });
    assert.equal(listing.status, 0, listing.stderr);
    assert.ok(listing.stdout.includes("files/project-attachments/1/2/a.blob"));
    assert.ok(listing.stdout.normalize("NFC").includes(LONG), "system tar reads the same long path (bsdtar prints NFD on macOS)");
  }
  assert.equal((await verifyBackup(file)).database.tables, manifest.database.tables);
});

test("an encrypted backup includes the keys, is authenticated, and rejects wrong passphrases and damage", async () => {
  const dest = path.join(base, "enc");
  const { file, manifest } = await createBackup(getDb(), { ...common, destination: dest, passphrase: PASS });
  assert.match(path.basename(file), /\.liosbak$/);
  assert.ok(manifest.entries.some((entry) => entry.path === "files/vault.key"));
  assert.ok(manifest.entries.some((entry) => entry.path === "files/data/storage.key"));
  assert.ok(manifest.entries.some((entry) => entry.path === "files/data/device-tls/identity.json"));
  assert.ok(manifest.entries.some((entry) => entry.path === `files/${JOURNAL}`));
  assert.ok(manifest.entries.some((entry) => entry.path === BACKUP_VAULT_MIGRATION_ENTRY), "encrypted backup includes portable credential envelope");
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.includes("VAULT-KEY-MATERIAL"), false);
  assert.equal(bytes.includes("attachment-one"), false);
  assert.equal(bytes.includes("PRIVATE-EXECUTION-TRANSCRIPT"), false);
  await verifyBackup(file, { passphrase: PASS });
  await assert.rejects(verifyBackup(file, { passphrase: "wrong passphrase value" }), /Wrong passphrase/);
  await assert.rejects(verifyBackup(file), /encrypted/);
  const flipped = Buffer.from(bytes);
  flipped[Math.floor(flipped.length / 2)] ^= 0x01;
  const damaged = path.join(dest, "damaged.liosbak");
  fs.writeFileSync(damaged, flipped);
  await assert.rejects(verifyBackup(damaged, { passphrase: PASS }), /Wrong passphrase|corrupted/);
  const truncated = path.join(dest, "truncated.liosbak");
  fs.writeFileSync(truncated, bytes.subarray(0, bytes.length - 40));
  await assert.rejects(verifyBackup(truncated, { passphrase: PASS }));
  await assert.rejects(createBackup(getDb(), { ...common, destination: path.join(base, "weak"), passphrase: "short" }), /at least 12/);
});

test("encryption frames are order- and length-authenticated across multiple 1 MiB frames", async () => {
  const payload = crypto.randomBytes(3 * 1024 * 1024 + 123);
  const chunks: Buffer[] = [];
  await pipeline(Readable.from([payload]), new BackupEncryptStream(PASS), new (await import("node:stream")).Writable({ write(chunk, _e, cb) { chunks.push(chunk); cb(); } }));
  const sealed = Buffer.concat(chunks);
  const decrypt = async (input: Buffer): Promise<Buffer> => {
    const out: Buffer[] = [];
    await pipeline(Readable.from([input]), new BackupDecryptStream(PASS), new (await import("node:stream")).Writable({ write(chunk, _e, cb) { out.push(chunk); cb(); } }));
    return Buffer.concat(out);
  };
  assert.deepEqual(await decrypt(sealed), payload);
  // Drop the final frame: detected as truncation even though every remaining frame is authentic.
  const headerBytes = 8 + 3 + 16 + 4;
  let offset = headerBytes;
  const frames: Buffer[] = [];
  while (offset < sealed.length) {
    const length = sealed.readUInt32BE(offset + 1);
    frames.push(sealed.subarray(offset, offset + 5 + length));
    offset += 5 + length;
  }
  assert.ok(frames.length >= 4);
  await assert.rejects(decrypt(Buffer.concat([sealed.subarray(0, headerBytes), ...frames.slice(0, -1)])), /truncated|malformed|Wrong passphrase/);
  await assert.rejects(decrypt(Buffer.concat([sealed.subarray(0, headerBytes), frames[1] as Buffer, frames[0] as Buffer, ...frames.slice(2)])), /Wrong passphrase/);
});

function handmade(entries: Array<{ name: string; body: string }>, manifest: unknown): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body);
    parts.push(tarFileHeader(entry.name, body.length, new Date(0)), body, padTo512(body.length));
  }
  if (manifest !== null) {
    const body = Buffer.from(JSON.stringify(manifest));
    parts.push(tarFileHeader("lios-backup.json", body.length, new Date(0)), body, padTo512(body.length), TAR_END);
  } else {
    parts.push(TAR_END);
  }
  return zlib.gzipSync(Buffer.concat(parts));
}

function manifestFor(entries: Array<{ path: string; body: string; sha?: string }>) {
  return {
    format: "lios-backup/1",
    createdAt: new Date(0).toISOString(),
    liosVersion: "t",
    encrypted: false,
    sourceEngine: "pglite",
    database: { tables: 0, rows: 0, migrations: 0 },
    entries: entries.map((entry) => ({
      path: entry.path,
      kind: entry.path.startsWith("db/") ? "db" : "file",
      sha256: entry.sha ?? crypto.createHash("sha256").update(entry.body).digest("hex"),
      bytes: Buffer.byteLength(entry.body),
    })),
    skipped: [],
    notes: [],
  };
}

test("verification rejects path traversal, duplicates, unlisted, changed and missing entries and an absent manifest", async () => {
  const write = (name: string, data: Buffer) => {
    const file = path.join(base, name);
    fs.writeFileSync(file, data);
    return file;
  };
  const ok = [{ name: "files/a.txt", body: "hello", path: "files/a.txt" }];
  await verifyBackup(write("ok.tar.gz", handmade(ok, manifestFor(ok))));
  await assert.rejects(verifyBackup(write("trav.tar.gz", handmade([{ name: "files/../../escape", body: "x" }], manifestFor([])))), /traversal/);
  await assert.rejects(verifyBackup(write("abs.tar.gz", handmade([{ name: "/etc/passwd", body: "x" }], manifestFor([])))), /relative|Unexpected/);
  await assert.rejects(verifyBackup(write("dup.tar.gz", handmade([ok[0] as never, ok[0] as never], manifestFor(ok)))), /Duplicate/);
  await assert.rejects(verifyBackup(write("unlisted.tar.gz", handmade([...ok, { name: "files/b.txt", body: "b" }], manifestFor(ok)))), /unlisted files\/b\.txt/);
  await assert.rejects(verifyBackup(write("changed.tar.gz", handmade([{ name: "files/a.txt", body: "HELLO" }], manifestFor(ok)))), /changed files\/a\.txt/);
  await assert.rejects(verifyBackup(write("missing.tar.gz", handmade([], manifestFor(ok)))), /missing files\/a\.txt/);
  await assert.rejects(verifyBackup(write("nomanifest.tar.gz", handmade(ok, null))), /no manifest/);
  await assert.rejects(verifyBackup(write("other.tar.gz", handmade([{ name: "elsewhere/a.txt", body: "x" }], manifestFor([])))), /Unexpected entry/);
});

test("SI-07.12 internally verified archives cannot overwrite protected Home state before DB import", async () => {
  const originalRoot = process.env.LIOS_DATA_ROOT;
  process.env.LIOS_DATA_ROOT = rootA;
  try {
    const before = (await getDb().select().from(users)).map((user) => user.email).sort();
    const existing = fs.readdirSync(rootA).filter((name) => name.startsWith(".lios-restore-")).sort();
    const protectedPaths = [
      "files/pgdata/PG_VERSION",
      "files/.lios-root.json",
      "files/data/session-secret",
      "files/restore-previous-old/private.txt",
      "files/data/observability/log.txt",
    ];
    for (const [index, entryPath] of protectedPaths.entries()) {
      const entry = { name: entryPath, path: entryPath, body: "FORGED-BUT-HASH-VERIFIED" };
      const file = path.join(base, `protected-member-${index}.tar.gz`);
      fs.writeFileSync(file, handmade([entry], manifestFor([entry])));
      const verified = await verifyBackup(file);
      assert.equal(verified.entries[0]?.path, entryPath, "archive SHA/manifest verification itself succeeds");
      await assert.rejects(restoreBackup(getDb(), file), /Protected LiOS Home path cannot be restored/);
      assert.deepEqual(
        (await getDb().select().from(users)).map((user) => user.email).sort(),
        before,
        "the protected file must be refused before database import",
      );
      assert.deepEqual(
        fs.readdirSync(rootA).filter((name) => name.startsWith(".lios-restore-")).sort(),
        existing,
        "a refused restore must clean its owned extraction slot",
      );
    }
  } finally {
    if (originalRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = originalRoot;
  }
});

test("SI-07.12 restore rejects misleading archive kinds and cross-platform filename collisions", async () => {
  const fixture = [
    { name: "files/Reports.txt", path: "files/Reports.txt", body: "first" },
    { name: "files/reports.TXT", path: "files/reports.TXT", body: "second" },
  ];
  const file = path.join(base, "ambiguous-restore.tar.gz");
  fs.writeFileSync(file, handmade(fixture, manifestFor(fixture)));
  const verified = await verifyBackup(file);
  assert.throws(() => assertRestorableHomeManifest(verified), /Colliding restore file names/);
  const ambiguous = manifestFor([
    { path: "files/cases", body: "file" },
    { path: "files/cases/child.txt", body: "nested" },
  ]);
  assert.throws(
    () => assertRestorableHomeManifest(ambiguous as unknown as Parameters<typeof assertRestorableHomeManifest>[0]),
    /file\/directory collision/,
  );
  const mismatched = manifestFor([{ path: "files/project.txt", body: "content" }]);
  mismatched.entries[0]!.kind = "db";
  assert.throws(
    () => assertRestorableHomeManifest(mismatched as unknown as Parameters<typeof assertRestorableHomeManifest>[0]),
    /invalid restoration kind/,
  );
});

test("SI-07.12 plaintext archives cannot claim encrypted rights or install protected secrets", async () => {
  const protectedSecret = { name: "files/vault.key", path: "files/vault.key", body: "FORGED-SECRET" };
  const plain = path.join(base, "forged-plaintext-secret.tar.gz");
  fs.writeFileSync(plain, handmade([protectedSecret], manifestFor([protectedSecret])));
  const verified = await verifyBackup(plain);
  assert.equal(verified.encrypted, false);
  assert.throws(() => assertRestorableHomeManifest(verified), /Protected LiOS Home path/);
  const falseEncryption = manifestFor([protectedSecret]);
  falseEncryption.encrypted = true;
  const forged = path.join(base, "forged-envelope-claim.tar.gz");
  fs.writeFileSync(forged, handmade([protectedSecret], falseEncryption));
  await assert.rejects(verifyBackup(forged), /encryption disagrees with the actual archive envelope/);
});

test("restore recreates database, files and keys in a fresh Home and keeps replaced files", async () => {
  const { file } = await createBackup(getDb(), { ...common, destination: path.join(base, "restore-src"), passphrase: PASS });
  await closeDb();
  process.env.LIOS_DATA_ROOT = rootB;
  const db = await initDb();
  assert.equal((await db.select().from(users)).length >= 0, true);
  await db.execute(sql`truncate table users cascade`);
  fs.mkdirSync(rootB, { recursive: true });
  fs.writeFileSync(path.join(rootB, "vault.key"), "DIFFERENT-OLD-KEY", { mode: 0o600 });

  const result = await restoreBackup(db, file, { passphrase: PASS });
  assert.equal((await db.select().from(users)).map((row) => row.email).join(), "a@example.test");
  assert.ok(result.credentialMigrationEnvelope, "portable credential envelope is returned in memory");
  assert.equal(
    fs.existsSync(path.join(rootB, "data", "credential-vault-portable.bin")),
    false,
    "portable credential envelope is never installed as Home state",
  );
  assert.equal(fs.readFileSync(path.join(rootB, "project-attachments/1/2/a.blob"), "utf8"), "attachment-one");
  assert.equal(fs.readFileSync(path.join(rootB, "vault.key"), "utf8"), "VAULT-KEY-MATERIAL");
  assert.equal(fs.readFileSync(path.join(rootB, "data/device-tls/identity.json"), "utf8"), "TLS-PRIVATE-KEY-MATERIAL");
  assert.equal(fs.readFileSync(path.join(rootB, JOURNAL), "utf8"), "LIOSENC1-PRIVATE-EXECUTION-TRANSCRIPT");
  assert.ok(result.previousFilesDir);
  assert.equal(fs.readFileSync(path.join(result.previousFilesDir as string, "vault.key"), "utf8"), "DIFFERENT-OLD-KEY");
  assert.equal(fs.existsSync(path.join(rootB, ".lios-restore-" + process.pid)), false, "staging removed");

  // The Home now has an account: a second restore is refused unless asked to replace, and then changes nothing.
  fs.writeFileSync(path.join(rootB, "project-attachments/1/2/a.blob"), "edited-after-restore");
  await assert.rejects(restoreBackup(db, file, { passphrase: PASS }), /user account/);
  assert.equal(fs.readFileSync(path.join(rootB, "project-attachments/1/2/a.blob"), "utf8"), "edited-after-restore");
  const secondRestore = await restoreBackup(db, file, { passphrase: PASS, replace: true });
  assert.ok(secondRestore.previousFilesDir);
  assert.notEqual(secondRestore.previousFilesDir, result.previousFilesDir,
    "each restore must preserve overwritten files in a newly owned recovery slot");
  assert.equal(fs.readFileSync(path.join(result.previousFilesDir as string, "vault.key"), "utf8"),
    "DIFFERENT-OLD-KEY", "the earlier restore's recovery files must survive later restores");
  assert.equal(fs.readFileSync(path.join(secondRestore.previousFilesDir as string, "project-attachments/1/2/a.blob"), "utf8"),
    "edited-after-restore", "the second restore keeps its own replaced file");
  assert.equal(fs.readFileSync(path.join(rootB, "project-attachments/1/2/a.blob"), "utf8"), "attachment-one");
  await closeDb();
  process.env.LIOS_DATA_ROOT = rootA;
  await initDb();
});

test("SI-07.12 restore target preflight rejects linked parents and linked files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-containment-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const outside = path.join(root, "outside");
  const targetDir = path.join(home, "documents");
  fs.mkdirSync(home);
  fs.mkdirSync(outside);
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(outside, "private.txt"), "PRIVATE-UNTOUCHED");

  assert.equal(assertSafeRestoreFileTarget(home, "documents/future.txt"), path.join(targetDir, "future.txt"));
  assert.throws(() => assertSafeRestoreFileTarget(home, "../outside/private.txt"), /Unsafe path/);
  assert.throws(() => assertSafeRestoreFileTarget(home, "documents"), /not a regular file/);
  assert.throws(() => assertSafeRestoreFileTarget(home, "documents/new/.././../.."), /Unsafe path/);

  const alias = path.join(home, "linked");
  const linkedFile = path.join(home, "linked.txt");
  try {
    fs.symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");
    fs.symlinkSync(path.join(outside, "private.txt"), linkedFile, "file");
  } catch (error) {
    t.skip("Host cannot create filesystem symlinks: " + String(error));
    return;
  }
  assert.throws(() => assertSafeRestoreFileTarget(home, "linked/private.txt"), /Refusing linked restore destination/);
  assert.throws(() => assertSafeRestoreFileTarget(home, "linked.txt"), /Refusing linked restore destination/);
  assert.equal(fs.readFileSync(path.join(outside, "private.txt"), "utf8"), "PRIVATE-UNTOUCHED");
});

test("SI-07.12 restore refuses symlinked Home parent before importing database", async (t) => {
  const file = (await createBackup(getDb(), { ...common, destination: path.join(base, "symlinked-restore-source"), passphrase: PASS })).file;
  const home = path.join(base, "symlink-restore-destination");
  const attached = path.join(home, "project-attachments");
  const outside = path.join(base, "restore-unrelated-data");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "private.txt"), "DO-NOT-REPLACE");
  try {
    fs.symlinkSync(outside, attached, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip("Host cannot create directory symlinks: " + String(error));
    return;
  }
  const before = (await getDb().select().from(users)).map((u) => u.email).sort();
  process.env.LIOS_DATA_ROOT = home;
  try {
    await assert.rejects(
      restoreBackup(getDb(), file, { passphrase: PASS, replace: true }),
      /Refusing linked restore destination/,
    );
    const after = (await getDb().select().from(users)).map((u) => u.email).sort();
    assert.deepEqual(after, before, "a refused file path must not commit the database import");
    assert.equal(fs.readFileSync(path.join(outside, "private.txt"), "utf8"), "DO-NOT-REPLACE");
    assert.deepEqual(fs.readdirSync(outside), ["private.txt"]);
    assert.equal(fs.existsSync(path.join(home, `.lios-restore-${process.pid}`)), false);
  } finally {
    process.env.LIOS_DATA_ROOT = rootA;
    fs.rmSync(attached, { force: true });
  }
});


test("SI-07.12 restore refuses a symlinked Home before creating extraction staging", async (t) => {
  const root = path.join(base, "restore-home-link");
  const outside = path.join(base, "restore-home-private");
  const file = path.join(base, "irrelevant-unreadable.liosbak");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "private.txt"), "PRESERVE-ME");
  try {
    fs.symlinkSync(outside, root, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip("Host cannot create directory symlinks: " + String(error));
    return;
  }
  process.env.LIOS_DATA_ROOT = root;
  try {
    // The archive deliberately does not exist. The Home path must be refused
    // before a restore attempts to read the archive or create staging.
    await assert.rejects(
      restoreBackup(getDb(), file),
      /destination must be a real Home directory/,
    );
    assert.deepEqual(fs.readdirSync(outside), ["private.txt"]);
    assert.equal(fs.readFileSync(path.join(outside, "private.txt"), "utf8"), "PRESERVE-ME");
  } finally {
    process.env.LIOS_DATA_ROOT = rootA;
    fs.rmSync(root, { force: true });
  }
});

test("SI-07.12 extraction refuses existing directories without deleting their contents", () => {
  const reserved = path.join(base, "existing-extraction-not-owned");
  fs.mkdirSync(reserved, { recursive: true });
  fs.writeFileSync(path.join(reserved, "private.txt"), "PRESERVE-UNOWNED-DATA");
  assert.throws(
    () => extractBackup(path.join(base, "nonexistent-backup.tar.gz"), reserved),
    /Extraction target already exists/,
  );
  assert.equal(fs.readFileSync(path.join(reserved, "private.txt"), "utf8"), "PRESERVE-UNOWNED-DATA");
});

test("SI-07.12 archive-open failure removes only the uniquely reserved extraction folder", async () => {
  const reserved = path.join(base, "new-extraction-owned");
  await assert.rejects(extractBackup(path.join(base, "missing-backup.tar.gz"), reserved), /ENOENT/);
  assert.equal(fs.existsSync(reserved), false);
});

test("SI-07.12 refused restore preserves a pre-existing PID staging directory", async () => {
  const legacy = path.join(rootA, `.lios-restore-${process.pid}`);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "private.txt"), "OLD-STAGING-MUST-SURVIVE");
  const invalidArchive = path.join(base, "corrupt-staging-test.tar.gz");
  fs.writeFileSync(invalidArchive, "not a gzipped LiOS backup");
  const before = fs.readdirSync(rootA).filter((name) => name.startsWith(`.lios-restore-${process.pid}-`)).sort();
  try {
    await assert.rejects(restoreBackup(getDb(), invalidArchive));
    assert.equal(fs.readFileSync(path.join(legacy, "private.txt"), "utf8"), "OLD-STAGING-MUST-SURVIVE");
    const after = fs.readdirSync(rootA).filter((name) => name.startsWith(`.lios-restore-${process.pid}-`)).sort();
    assert.deepEqual(after, before, "the failed restore must clean only the staging folder it reserved");
  } finally {
    fs.rmSync(legacy, { recursive: true, force: true });
  }
});

test("SI-07.12 recovery slots are unique even at an identical timestamp, and never touch prior copies", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-history-reservation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const when = new Date("2026-10-16T08:00:00.000Z");
  const legacy = path.join(root, "restore-previous-20261016T080000Z");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "sentinel.txt"), "HISTORICAL-COPY");
  const first = reserveRestorePreviousDirectory(root, when);
  fs.writeFileSync(path.join(first, "a.txt"), "FIRST-RECOVERY");
  const second = reserveRestorePreviousDirectory(root, when);
  fs.writeFileSync(path.join(second, "a.txt"), "SECOND-RECOVERY");
  assert.notEqual(first, second);
  assert.notEqual(first, legacy);
  assert.notEqual(second, legacy);
  assert.match(path.basename(first), /^restore-previous-20261016T080000Z-/);
  assert.match(path.basename(second), /^restore-previous-20261016T080000Z-/);
  assert.equal(fs.readFileSync(path.join(legacy, "sentinel.txt"), "utf8"), "HISTORICAL-COPY");
  assert.equal(fs.readFileSync(path.join(first, "a.txt"), "utf8"), "FIRST-RECOVERY");
  assert.equal(fs.readFileSync(path.join(second, "a.txt"), "utf8"), "SECOND-RECOVERY");
});

test("SI-07.12 recovery reservation refuses a linked root without changing outside files", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restore-recovery-root-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, "outside");
  const linked = path.join(base, "home-link");
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "private.txt"), "PRIVATE");
  try {
    fs.symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip("Host cannot create a directory symlink: " + String(error));
    return;
  }
  assert.throws(() => reserveRestorePreviousDirectory(linked), /real Home directory/);
  assert.deepEqual(fs.readdirSync(real), ["private.txt"]);
});

test("SI-07.12 backup uses privately owned staging and preserves abandoned prior PID data", async () => {
  const destination = path.join(base, "backup-owned-staging");
  const old = path.join(destination, `.lios-backup-${process.pid}`);
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "private.txt"), "UNOWNED-HISTORY");
  const now = new Date("2026-10-16T07:00:00.000Z");
  const result = await createBackup(getDb(), { ...common, destination, now });
  assert.equal(fs.readFileSync(path.join(old, "private.txt"), "utf8"), "UNOWNED-HISTORY");
  assert.equal((await verifyBackup(result.file)).format, "lios-backup/1");
  assert.deepEqual(fs.readdirSync(destination).filter((n) => n.startsWith(`.lios-backup-${process.pid}-`)), []);
  await assert.rejects(createBackup(getDb(), { ...common, destination, now }), /already exists/);
  assert.equal(fs.readFileSync(path.join(old, "private.txt"), "utf8"), "UNOWNED-HISTORY");
});

test("SI-07.12 colliding final backup publication never overwrites another writer", async (t) => {
  const destination = path.join(base, "backup-publish-collision");
  const now = new Date("2026-10-16T07:01:00.000Z");
  const output = path.join(destination, "lios-backup-20261016T070100Z.tar.gz");
  const actualLink = fs.linkSync.bind(fs);
  let intercepted = false;
  const stub = t.mock.method(fs, "linkSync", (source: fs.PathLike, target: fs.PathLike) => {
    if (String(target) === output) {
      intercepted = true;
      fs.writeFileSync(output, "OTHER-WRITER-ARCHIVE");
    }
    return actualLink(source, target);
  });
  try {
    await assert.rejects(createBackup(getDb(), { ...common, destination, now }), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === "EEXIST");
  } finally {
    stub.mock.restore();
  }
  assert.equal(intercepted, true, "the test simulates a different writer winning immediately before publication");
  assert.equal(fs.readFileSync(output, "utf8"), "OTHER-WRITER-ARCHIVE");
  assert.deepEqual(fs.readdirSync(destination).filter((n) => n.startsWith(`.lios-backup-${process.pid}-`)), []);
});

test("SI-07.12 backup refuses a symlink alias physically nested inside Home before creating destination", (t) => {
  const alias = path.join(base, "backup-home-alias");
  const target = path.join(alias, "data", "backup-must-not-appear");
  try {
    fs.symlinkSync(rootA, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip("Host cannot create a directory symlink: " + String(error));
    return;
  }
  assert.throws(
    () => createBackup(getDb(), { ...common, destination: target }),
    /outside the LiOS data folder/,
  );
  assert.equal(fs.existsSync(path.join(rootA, "data", "backup-must-not-appear")), false);
});

test("retention keeps the newest backups only after a verified success; destinations inside the data root are refused", async () => {
  const dest = path.join(base, "retention");
  for (const minute of [1, 2, 3]) {
    await createBackup(getDb(), { ...common, destination: dest, now: new Date(Date.UTC(2026, 0, 1, 0, minute, 0)), keep: 2 });
  }
  const kept = fs.readdirSync(dest).filter((name) => name.endsWith(".tar.gz")).sort();
  assert.equal(kept.length, 2);
  assert.match(kept[0] as string, /T000200Z/);
  await assert.rejects(createBackup(getDb(), { ...common, destination: path.join(rootA, "inside") }), BackupError);
  assert.equal(fs.readdirSync(dest).some((name) => name.includes("partial") || name.startsWith(".")), false, "no partial or staging leftovers");
});
