import path from "node:path";
import { closeDb, initDb } from "../server/db";
import { createBackup, extractBackup, restoreBackup, verifyBackup } from "../server/backupArchive";
import { readPrivateSecretFile } from "../server/privateSecretFile";
import packageJson from "../package.json";

const USAGE = `Usage:
  npm run backup:create  -- <destination-dir> (--passphrase-file <file> | --unencrypted) [--keep <n>]
  npm run backup:verify  -- <archive> [--passphrase-file <file>]
  npm run backup:extract -- <archive> <new-directory> [--passphrase-file <file>]
  npm run backup:restore -- <archive> [--passphrase-file <file>] [--replace]

create/restore act on the current database (DATABASE_URL, or the PGlite database in the LiOS data root) and data
root (LIOS_DATA_ROOT); stop LiOS first when it uses the local database. An encrypted backup contains the vault and
storage keys; an unencrypted one never does. Keep the passphrase somewhere other than next to the backup.`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionals(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--passphrase-file" || arg === "--keep") index += 1;
    else if (!arg.startsWith("--")) values.push(arg);
  }
  return values;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const [first, second] = positionals(args);
  const passphraseFile = option(args, "--passphrase-file");
  const passphrase = passphraseFile ? readPrivateSecretFile(path.resolve(passphraseFile), "backup passphrase file") : undefined;

  if (command === "verify" && first) {
    const manifest = await verifyBackup(path.resolve(first), { passphrase });
    console.log(`Verified ${manifest.entries.length} entries (${manifest.database.tables} tables, ${manifest.database.rows} rows) created ${manifest.createdAt}.`);
  } else if (command === "extract" && first && second) {
    const manifest = await extractBackup(path.resolve(first), path.resolve(second), { passphrase });
    console.log(`Extracted ${manifest.entries.length} verified entries to ${path.resolve(second)}.`);
  } else if (command === "create" && first && (passphrase !== undefined || args.includes("--unencrypted"))) {
    const db = await initDb();
    try {
      const keep = option(args, "--keep");
      const result = await createBackup(db, {
        destination: first,
        engine: process.env.DATABASE_URL ? "postgres" : "pglite",
        liosVersion: packageJson.version,
        passphrase,
        keep: keep ? Number(keep) : undefined,
      });
      console.log(`Backup written and verified: ${result.file}`);
      console.log(`  ${result.manifest.entries.length} entries, ${result.manifest.database.rows} database rows, ${result.manifest.skipped.length} item(s) intentionally not included.`);
      if (result.pruned.length) console.log(`  Removed ${result.pruned.length} older backup(s) beyond --keep.`);
      for (const note of result.manifest.notes) console.log(`  Note: ${note}`);
    } finally {
      await closeDb();
    }
  } else if (command === "restore" && first) {
    const db = await initDb();
    try {
      const result = await restoreBackup(db, path.resolve(first), { passphrase, replace: args.includes("--replace") });
      console.log(`Restored ${result.manifest.database.rows} database rows and ${result.filesRestored} files from the backup of ${result.manifest.createdAt}.`);
      if (result.previousFilesDir) console.log(`  Files that were replaced are kept in ${result.previousFilesDir}.`);
    } finally {
      await closeDb();
    }
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
