import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p3-acceptance-"));
process.env.LIMURIA_DATA_DIR = dataDir;
for (const key of [
  "LIOS_UPDATE_URL",
  "LIOS_DOWNLOAD_MAC_URL",
  "LIOS_DOWNLOAD_WINDOWS_URL",
  "LIOS_PUBLIC_APP_URL",
  "LIOS_RELEASE_NOTES_URL",
  "LIOS_PUBLIC_VERSION",
  "LIOS_TELEMETRY_ENABLED",
  "LIOS_OPERATIONS_ALERT_EMAIL",
  "SMTP_URL",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
]) delete process.env[key];

const { initDb, closeDb } = await import("./db");
const { ensureCommercialPlans } = await import("./platformBootstrap");
const { buildProductionAcceptanceSnapshot } = await import("./productionAcceptance");

await initDb();
await ensureCommercialPlans();

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("P3 production acceptance fully accounts code controls and external evidence", async () => {
  const snapshot = await buildProductionAcceptanceSnapshot(
    new Date("2026-09-19T14:00:00.000Z"),
    {},
  );

  assert.equal(snapshot.contractVersion, "1.0.0");
  assert.equal(snapshot.generatedAt, "2026-09-19T14:00:00.000Z");
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.counts.total, snapshot.rows.length);
  assert.equal(snapshot.rows.length, 15);

  for (const id of [
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
    assert.ok(snapshot.rows.some((row) => row.id === id), `missing P3 row ${id}`);
  }

  for (const id of [
    "production:distribution-contract",
    "production:retention-policy",
    "production:retention-worker-contract",
    "production:deletion-receipt-contract",
    "production:export-custody-contract",
    "production:diagnostics-contract",
    "production:notification-contract",
    "production:rollback-runbook",
  ]) {
    assert.equal(snapshot.rows.find((row) => row.id === id)?.state, "verified", `${id} should be code-verified`);
  }

  for (const id of [
    "production:distribution-live",
    "production:retention-worker-live",
    "production:deletion-live",
    "production:export-custody-live",
    "production:diagnostics-live",
    "production:crash-live",
    "production:notification-live",
  ]) {
    const row = snapshot.rows.find((entry) => entry.id === id);
    assert.equal(row?.state, "blocked", `${id} must not be promoted without deployment evidence`);
    assert.ok(row?.blockers.length, `${id} requires a named blocker`);
  }

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /SMTP_PASS/);
});
