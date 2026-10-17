import fs from "node:fs";
import path from "node:path";
import { closeDb, initDb } from "../server/db";
import { restoreBackup, restoreTestBackup } from "../server/backupArchive";
import {
  VAULT_SECRET_HANDOFF,
  invalidateVaultCache,
  restoreVaultMigrationEnvelope,
} from "../server/credentialVault";

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

  const db = await initDb();
  let credentialsRekeyed = 0;
  try {
    const result = await restoreBackup(db, request.archivePath, {
      passphrase: request.passphrase ?? undefined,
      replace: true,
      finalizeCredentials: (envelope) => {
        if (!request.passphrase) throw new Error("Portable credential migration requires the encrypted backup passphrase.");
        credentialsRekeyed = restoreVaultMigrationEnvelope(envelope, request.passphrase);
      },
    });
    result.credentialMigrationEnvelope?.fill(0);
    invalidateVaultCache();
    process.stdout.write(JSON.stringify({
      ok: true, createdAt: result.manifest.createdAt, rows: result.manifest.database.rows,
      filesRestored: result.filesRestored, previousFilesPreserved: result.previousFilesDir !== null,
      preflightTables: proof.tables, credentialsRekeyed,
    }) + "\n");
  } finally {
    invalidateVaultCache();
    await closeDb();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Restore failed.";
  process.stderr.write(message.slice(0, 4_000) + "\n");
  process.exitCode = 1;
});
