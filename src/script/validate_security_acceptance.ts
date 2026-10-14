import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p5-acceptance-contract-"));
process.env.LIOS_DATA_ROOT = dataDir;
const { initDb, closeDb } = await import("../server/db");
const { buildSecurityAcceptanceSnapshot } = await import("../server/securityAcceptance");
await initDb();

try {
  const snapshot = await buildSecurityAcceptanceSnapshot();
  const ids = snapshot.rows.map((row) => row.id);

  if (new Set(ids).size !== ids.length) throw new Error("Security acceptance ledger contains duplicate row IDs.");
  if (snapshot.rows.length === 0) throw new Error("Security acceptance ledger is empty.");

  for (const row of snapshot.rows) {
    if (!row.nextAction.trim()) throw new Error(`${row.id}: every P5 row requires a next action.`);
    if (row.state === "verified") {
      if (row.blockers.length > 0) throw new Error(`${row.id}: verified rows cannot retain blockers.`);
      if (row.evidence.length === 0) throw new Error(`${row.id}: verified rows require evidence.`);
    } else if (row.blockers.length === 0) {
      throw new Error(`${row.id}: blocked rows must name at least one blocker.`);
    }
  }

  for (const category of ["desktop", "network", "session", "tenant", "uploads", "secrets", "privacy", "supply_chain", "external_review"] as const) {
    if (!snapshot.rows.some((row) => row.category === category)) throw new Error(`Security acceptance ledger is missing category ${category}.`);
  }

  for (const required of [
    "security:desktop-ipc",
    "security:connector-ssrf",
    "security:hosted-session",
    "security:tenant-isolation",
    "security:local-byod-boundary",
    "security:upload-validation",
    "security:secret-redaction",
    "security:native-secret-custody",
    "security:privacy-lifecycle",
    "security:privacy-live-evidence",
    "security:dependency-ci",
    "security:independent-security-scan",
    "security:independent-review",
  ]) {
    if (!snapshot.rows.some((row) => row.id === required)) throw new Error(`Security acceptance ledger is missing required row ${required}.`);
  }

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/i,
    /bearer\s+[a-z0-9._~+\/-]{8,}/i,
    /sk-[a-z0-9_-]{8,}/i,
    /password["']?\s*[:=]\s*["'][^"']{6,}/i,
  ]) {
    if (forbidden.test(serialized)) throw new Error("Security acceptance output appears to contain credential material.");
  }

  console.log(JSON.stringify({
    contractVersion: snapshot.contractVersion,
    generatedAt: snapshot.generatedAt,
    status: snapshot.status,
    counts: snapshot.counts,
    blockedIds: snapshot.rows.filter((row) => row.state === "blocked").map((row) => row.id),
  }, null, 2));
} finally {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
