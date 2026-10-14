import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { users } from "@shared/schema";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-si01-restore-v2-"));
const sourceRoot = path.join(base, "source-home");
const destinationRoot = path.join(base, "destination-home");
const backupDir = path.join(base, "backups");
process.env.HOME = path.join(base, "user-home");
delete process.env.DATABASE_URL;
fs.mkdirSync(process.env.HOME, { recursive: true });

const SOURCE_SECRET = "source-os-secret-si01-v2-abcdefghijklmnopqrstuvwxyz";
const DESTINATION_SECRET = "destination-os-secret-si01-v2-abcdefghijklmnopqrstuvwxyz";
const BACKUP_PASSPHRASE = "si01-v2-portable-backup-passphrase";
const CREDENTIAL_VALUE = "si01-v2-provider-secret";
const globalSecrets = globalThis as Record<symbol, unknown>;

async function run(): Promise<void> {
  const dbModule = await import("../server/db");
  const backup = await import("../server/backupArchive");
  const vault = await import("../server/credentialVault");

  try {
    process.env.LIOS_DATA_ROOT = sourceRoot;
    globalSecrets[vault.VAULT_SECRET_HANDOFF] = SOURCE_SECRET;
    vault.invalidateVaultCache();

    let db = await dbModule.initDb();
    await db.execute(sql`truncate table users cascade`);
    await db.insert(users).values({
      email: "source@example.test",
      passwordHash: "source-hash",
      role: "internal_admin",
      name: "Source owner",
      active: true,
    });
    vault.setVaultCredential("providerApiKey", CREDENTIAL_VALUE, "Provider API key");
    const attachment = path.join(sourceRoot, "project-attachments", "1", "proof.txt");
    fs.mkdirSync(path.dirname(attachment), { recursive: true, mode: 0o700 });
    fs.writeFileSync(attachment, "source-state", { mode: 0o600 });

    const created = await backup.createBackup(db, {
      destination: backupDir,
      engine: "pglite",
      liosVersion: "si01-v2",
      passphrase: BACKUP_PASSPHRASE,
      keep: 1,
    });
    assert.ok(created.manifest.entries.some((entry) => entry.path === backup.BACKUP_VAULT_MIGRATION_ENTRY));
    await dbModule.closeDb();

    process.env.LIOS_DATA_ROOT = destinationRoot;
    globalSecrets[vault.VAULT_SECRET_HANDOFF] = DESTINATION_SECRET;
    vault.invalidateVaultCache();

    db = await dbModule.initDb();
    await db.execute(sql`truncate table users cascade`);
    await db.insert(users).values({
      email: "destination-before@example.test",
      passwordHash: "destination-hash",
      role: "internal_admin",
      name: "Destination before restore",
      active: true,
    });
    vault.setVaultCredential("destinationOnly", "rollback-proof", "Destination-only");
    await dbModule.closeDb();

    const worker = path.resolve("dist/desktop-restore.cjs");
    assert.equal(fs.existsSync(worker), true, "npm run build must produce dist/desktop-restore.cjs");

    const child = spawnSync(process.execPath, [worker], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        LIOS_DATA_ROOT: destinationRoot,
      },
      input: JSON.stringify({
        version: 1,
        archivePath: created.file,
        passphrase: BACKUP_PASSPHRASE,
        destinationVaultSecret: DESTINATION_SECRET,
      }) + "\n",
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || child.stdout || "desktop restore worker failed");

    process.env.LIOS_DATA_ROOT = destinationRoot;
    globalSecrets[vault.VAULT_SECRET_HANDOFF] = DESTINATION_SECRET;
    vault.invalidateVaultCache();
    db = await dbModule.initDb();

    const restoredUsers = await db.select().from(users);
    assert.deepEqual(restoredUsers.map((row) => row.email), ["source@example.test"]);
    assert.equal(vault.getVaultCredential("providerApiKey"), CREDENTIAL_VALUE);
    assert.equal(vault.getVaultCredential("destinationOnly"), null);
    assert.equal(
      fs.readFileSync(path.join(destinationRoot, "project-attachments", "1", "proof.txt"), "utf8"),
      "source-state",
    );
    assert.equal(
      fs.existsSync(path.join(destinationRoot, "data", "credential-vault-portable.bin")),
      false,
      "portable migration envelope must never become persistent Home state",
    );
    assert.equal(fs.existsSync(path.join(destinationRoot, "vault.key")), false);

    const workerResultLine = child.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    assert.ok(workerResultLine, "restore worker did not emit a result");
    const workerResult = JSON.parse(workerResultLine) as {
      ok?: boolean;
      credentialsRekeyed?: number;
      preflightTables?: number;
    };
    assert.equal(workerResult.ok, true);
    assert.equal(workerResult.credentialsRekeyed, 1);
    assert.ok((workerResult.preflightTables ?? 0) > 0);

    await dbModule.closeDb();
    console.log("SI-01.07 V2 restore integration: PASS");
  } finally {
    await dbModule.closeDb().catch(() => undefined);
    delete globalSecrets[(await import("../server/credentialVault")).VAULT_SECRET_HANDOFF];
    fs.rmSync(base, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
