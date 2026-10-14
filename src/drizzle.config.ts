import { defineConfig } from "drizzle-kit";
import { createRequire } from "node:module";

// Desktop Local and LiOS Home keep PGlite in the data root; DATABASE_URL selects a user-owned PostgreSQL.
// `generate` needs no connection; `push` targets whichever of the two the runtime would open.
const require = createRequire(import.meta.url);
const { databaseDir, resolveDataRoot } = require("./dataRootCore.cjs") as {
  databaseDir: (resolution: unknown) => string;
  resolveDataRoot: () => unknown;
};

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : { driver: "pglite" as const, dbCredentials: { url: databaseDir(resolveDataRoot()) } }),
});
