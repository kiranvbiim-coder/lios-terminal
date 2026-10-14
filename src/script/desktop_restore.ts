import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb } from "../server/db";
import { createBackup, restoreBackup, restoreTestBackup } from "../server/backupArchive";
import {
  VAULT_SECRET_HANDOFF,
  invalidateVaultCache,
  restoreVaultMigrationEnvelope,
} from "../server/credentialVault";
import packageJson from "../package.json";

interface DesktopRestoreRequest {
  version: 1;
  archivePath: string;
  passphrase: string | null;
  destinationVaultSecret: string | null;
}

function readRequest(): DesktopRestoreRequest {
  const raw = fs.readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("Restore request is too large.");
  const parsed = JSON.parse(raw) as Partial<DesktopRestoreRequest>;
  if (parsed.version !== 1) throw new Error("Restore request version is unsupported.");
  if (typeof parsed.archivePath !== "string" || !path.isAbsolute(parsed.archivePath) || parsed.archivePath.includes("\0")) {
    throw new Error("Restore archive path is invalid.");
  }
  if (parsed.passphrase !== null && parsed.passphrase !== undefined) {
    if (typeof parsed.passphrase !== "string" || parsed.passphrase.length > 512 || parsed.passphrase.includes("\0")) {
      throw new Error("Restore passphrase is invalid.");
    }
  }
  if (parsed.destinationVaultSecret !== null && parsed.destinationVaultSecret !== undefined) {
    if (
      typeof parsed.destinationVaultSecret !== "string" ||
      parsed.destinationVaultSecret.length < 16 ||
      parsed.destinationVaultSecret.length > 512 ||
      parsed.destinationVaultSecret.includes("\0")
    ) {
      throw new Error("Destination vault custody is invalid.");
    }
  }
  return {
    version: 1,
    archivePath: path.resolve(parsed.archivePath),
    passphrase: typeof parsed.passphrase === "string" && parsed.passphrase.length ? parsed.passphrase : null,
    destinationVaultSecret:
      typeof parsed.destinationVaultSecret === "string" && parsed.destinationVaultSecret.length
        ? parsed.destinationVaultSecret
        : null,
  };
}

async function main(): Promise<void> {
  const request = readRequest();
  if (request.destinationVaultSecret) {
    (globalThis as Record<symbol, unknown>)[VAULT_SECRET_HANDOFF] = request.destinationVaultSecret;
    invalidateVaultCache();
  }
  const stat = fs.statSync(request.archivePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Restore archive is not a readable file.");

  // Prove decryption, archive integrity and logical DB import in scratch before
  // touching the live Home. A wrong passphrase/corrupt backup therefore cannot
  // begin a destructive restore.
  const proof = await restoreTestBackup(request.archivePath, {
    passphrase: request.passphrase ?? undefined,
  });
  if (!proof.digestsMatch) throw new Error("Restore preflight did not reproduce the backup database exactly.");

  const safetyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lios-pre-restore-"));
  const safetyPassphrase = crypto.randomBytes(32).toString("base64url");
  const db = await initDb();
  let safetyFile: string | null = null;
  try {
    const safety = await createBackup(db, {
      destination: safetyRoot,
      engine: process.env.DATABASE_URL ? "postgres" : "pglite",
      liosVersion: process.env.LIOS_PUBLIC_VERSION ?? packageJson.version,
      passphrase: safetyPassphrase,
      keep: 1,
    });
    safetyFile = safety.file;

    try {
      const result = await restoreBackup(db, request.archivePath, {
        passphrase: request.passphrase ?? undefined,
        replace: true,
      });
      let credentialsRekeyed = 0;
      if (result.credentialMigrationEnvelope) {
        if (!request.passphrase) {
          throw new Error("Portable credential migration requires the encrypted backup passphrase.");
        }
        try {
          credentialsRekeyed = restoreVaultMigrationEnvelope(
            result.credentialMigrationEnvelope,
            request.passphrase,
          );
        } finally {
          result.credentialMigrationEnvelope.fill(0);
        }
        invalidateVaultCache();
      }
      process.stdout.write(JSON.stringify({
        ok: true,
        createdAt: result.manifest.createdAt,
        rows: result.manifest.database.rows,
        filesRestored: result.filesRestored,
        previousFilesPreserved: result.previousFilesDir !== null,
        preflightTables: proof.tables,
        credentialsRekeyed,
      }) + "\n");
    } catch (restoreError) {
      if (!safetyFile) throw restoreError;
      try {
        await restoreBackup(db, safetyFile, {
          passphrase: safetyPassphrase,
          replace: true,
        });
      } catch (rollbackError) {
        const restoreMessage = restoreError instanceof Error ? restoreError.message : "restore failed";
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : "rollback failed";
        throw new Error(`Restore failed and automatic rollback also failed. Restore: ${restoreMessage}. Rollback: ${rollbackMessage}.`);
      }
      const message = restoreError instanceof Error ? restoreError.message : "Restore failed.";
      throw new Error(`${message} The prior Home was restored automatically.`);
    }
  } finally {
    await closeDb();
    fs.rmSync(safetyRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Restore failed.";
  process.stderr.write(message.slice(0, 4_000) + "\n");
  process.exitCode = 1;
});
