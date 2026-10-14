import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p3-acceptance-contract-"));
process.env.LIOS_DATA_ROOT = dataDir;

const { initDb, closeDb } = await import("../server/db");
const { buildProductionAcceptanceSnapshot } = await import("../server/productionAcceptance");

await initDb();

try {
const snapshot = await buildProductionAcceptanceSnapshot();
const ids = snapshot.rows.map((row) => row.id);

if (new Set(ids).size !== ids.length) throw new Error("Production acceptance ledger contains duplicate row IDs.");
if (snapshot.rows.length === 0) throw new Error("Production acceptance ledger is empty.");

for (const row of snapshot.rows) {
  if (!row.nextAction.trim()) throw new Error(`${row.id}: every P3 row requires a next action.`);
  if (row.state === "verified") {
    if (row.blockers.length > 0) throw new Error(`${row.id}: verified rows cannot retain blockers.`);
  } else if (row.blockers.length === 0) {
    throw new Error(`${row.id}: non-verified rows must name at least one blocker.`);
  }
}

for (const category of ["distribution", "retention", "custody", "diagnostics", "notifications", "runbook"] as const) {
  if (!snapshot.rows.some((row) => row.category === category)) {
    throw new Error(`Production acceptance ledger is missing category ${category}.`);
  }
}

for (const requiredId of [
  "production:distribution-contract",
  "production:distribution-live",
  "production:retention-policy",
  "production:retention-worker-contract",
  "production:retention-worker-live",
  "production:deletion-receipt-contract",
  "production:deletion-live",
  "production:export-custody-contract",
  "production:export-custody-live",
  "production:diagnostics-contract",
  "production:diagnostics-live",
  "production:crash-live",
  "production:notification-contract",
  "production:notification-live",
  "production:rollback-runbook",
]) {
  if (!snapshot.rows.some((row) => row.id === requiredId)) {
    throw new Error(`Production acceptance ledger is missing required P3 row ${requiredId}.`);
  }
}

const serialized = JSON.stringify(snapshot);
for (const forbidden of [
  /SMTP_PASS/i,
  /bearer\s+[a-z0-9._-]{8,}/i,
  /sk-[a-z0-9_-]{8,}/i,
]) {
  if (forbidden.test(serialized)) throw new Error("Production acceptance output appears to contain credential material.");
}

console.log(JSON.stringify({
  contractVersion: snapshot.contractVersion,
  generatedAt: snapshot.generatedAt,
  status: snapshot.status,
  counts: snapshot.counts,
  blockedIds: snapshot.rows.filter((row) => row.state !== "verified").map((row) => row.id),
}, null, 2));

} finally {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
