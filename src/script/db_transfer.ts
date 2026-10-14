import path from "node:path";
import { closeDb, initDb } from "../server/db";
import { databaseHealth, exportDatabase, importDatabase } from "../server/databaseTransfer";

const USAGE = `Usage:
  npm run db:export -- <directory>           write a verified logical export of the current database
  npm run db:import -- <directory> [--replace]  load an export into the current database
  npm run db:health                          check migrations and constraints

The "current database" is DATABASE_URL when set, otherwise the local PGlite database in the LiOS data root
(LIOS_DATA_ROOT). Stop LiOS first; a running Home or Desktop holds the local database. Credentials in the export are
encrypted with the vault key, so copy the data root's vault.key (or set the same vault secret) to the destination.`;

const [command, ...rest] = process.argv.slice(2);
const engine = process.env.DATABASE_URL ? "postgres" : "pglite";

async function main(): Promise<void> {
  if (command !== "export" && command !== "import" && command !== "health") {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const directory = rest.find((arg) => !arg.startsWith("--"));
  if (command !== "health" && !directory) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const db = await initDb();
  try {
    if (command === "export" && directory) {
      const manifest = await exportDatabase(db, directory, engine);
      const rows = manifest.tables.reduce((sum, table) => sum + table.rows, 0);
      console.log(`Exported ${manifest.tables.length} tables, ${rows} rows from ${engine} to ${path.resolve(directory)}.`);
    } else if (command === "import" && directory) {
      const result = await importDatabase(db, directory, { replace: rest.includes("--replace") });
      console.log(`Imported ${result.tables} tables, ${result.rows} rows into ${engine}${result.replaced ? " (replaced existing accounts)" : ""}. Every table was re-verified.`);
    } else {
      const health = await databaseHealth(db, path.resolve(process.cwd(), "migrations"));
      console.log(JSON.stringify({ engine, ...health }, null, 2));
      if (!health.ok) process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
