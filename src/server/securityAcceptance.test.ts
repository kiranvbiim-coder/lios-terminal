import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p5-acceptance-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb } = await import("./db");
const { buildSecurityAcceptanceSnapshot } = await import("./securityAcceptance");
await initDb();

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("P5 security acceptance ledger distinguishes repository proof from external evidence", async () => {
  const snapshot = await buildSecurityAcceptanceSnapshot(
    new Date("2026-09-19T00:00:00.000Z"),
    { NODE_ENV: "test" },
  );
  const ids = snapshot.rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
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
  ]) assert.ok(ids.includes(required), `missing ${required}`);

  for (const row of snapshot.rows) {
    assert.ok(row.nextAction.trim().length > 0);
    if (row.state === "verified") assert.equal(row.blockers.length, 0);
    else assert.ok(row.blockers.length > 0);
  }
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.rows.find((row) => row.id === "security:independent-review")?.state, "blocked");
});
