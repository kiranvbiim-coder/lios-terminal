/**
 * Resets the local test environment to a clean state:
 * - Deletes all source connections for the test user
 * - Resets the environment setup (completedAt = null)
 * - Clears the credential vault
 *
 * Run: npm run reset:test
 * Then restart the server: npm run dev
 */
import fs from "node:fs";
import path from "node:path";
import { databaseDir, dataRoot } from "../server/dataRoot";

const dataDir = dataRoot();

// 1. Clear the credential vault
const vaultPath = path.join(dataDir, "credential-vault.enc.json");
if (fs.existsSync(vaultPath)) {
  fs.unlinkSync(vaultPath);
  console.log("✓ Credential vault cleared:", vaultPath);
} else {
  console.log("· No credential vault found (already clean)");
}

// 2. Delete the PGlite database so it rebuilds from migrations
const pgDataDir = databaseDir();
if (fs.existsSync(pgDataDir)) {
  fs.rmSync(pgDataDir, { recursive: true, force: true });
  console.log("✓ PGlite database deleted:", pgDataDir);
}

// 3. Clear any cached config
const configPath = path.join(dataDir, "config.json");
if (fs.existsSync(configPath)) {
  // Preserve the file but clear credential entries
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const cleaned: Record<string, unknown> = {};
    // Keep non-credential settings
    for (const [key, value] of Object.entries(config)) {
      if (!/key|secret|token|password|credential/i.test(key)) {
        cleaned[key] = value;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(cleaned, null, 2), "utf8");
    console.log("✓ Config credentials cleared (non-credential settings preserved)");
  } catch {
    console.log("· Could not parse config.json, skipping");
  }
}

console.log("\n✓ Test environment reset complete.");
console.log("  Next: restart the server with `npm run dev`");
console.log("  No default administrator account exists. On first launch,");
console.log("  complete the one-time local first-run admin enrollment screen.");
console.log("  You should see an empty Data Connection Center.");
