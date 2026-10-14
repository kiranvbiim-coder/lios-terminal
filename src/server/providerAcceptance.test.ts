import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-provider-acceptance-"));
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.WAVE_D_WEBHOOK_ALLOWLIST;
delete process.env.SMTP_URL;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const { initDb, closeDb } = await import("./db");
const { buildProviderAcceptanceSnapshot } = await import("./providerAcceptance");
const { recordConnectorVerification, resetConnectorVerificationsForTests } = await import("./connectorVerification");

await initDb();
test.after(async () => {
  resetConnectorVerificationsForTests();
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("P1 provider acceptance emits a complete truthful ledger without secrets", async () => {

  const snapshot = await buildProviderAcceptanceSnapshot(new Date("2026-09-19T12:00:00.000Z"));
  assert.equal(snapshot.contractVersion, "1.0.0");
  assert.equal(snapshot.generatedAt, "2026-09-19T12:00:00.000Z");
  assert.equal(snapshot.counts.total, snapshot.rows.length);
  assert.equal(snapshot.status, "partial");

  for (const id of [
    "ai:mistral",
    "ai:groq",
    "ai:together",
    "connector:fred",
    "connector:imf",
    "news:google_rss",
    "communications:gmail",
    "communications:microsoft365",
    "communications:imap",
    "communications:smtp",
    "communications:slack",
    "communications:teams",
    "communications:webhook",
  ]) {
    assert.ok(snapshot.rows.some((entry) => entry.id === id), `missing P1 row ${id}`);
  }

  const imf = snapshot.rows.find((entry) => entry.id === "connector:imf");
  assert.equal(imf?.state, "blocked");
  assert.equal(imf?.configured, true);
  assert.equal(imf?.liveVerified, false);
  assert.match(imf?.blockers.join(" ") ?? "", /no live endpoint call/i);
  assert.doesNotMatch(imf?.blockers.join(" ") ?? "", /not implemented/i);

  const gmail = snapshot.rows.find((entry) => entry.id === "communications:gmail");
  assert.equal(gmail?.state, "blocked");
  assert.match(gmail?.blockers.join(" ") ?? "", /adapter|consent/i);

  assert.equal(snapshot.rows.some((entry) => entry.category !== "ai" && entry.id.startsWith("billing:")), false);

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /api[_-]?key\s*[:=]\s*["'][^"']+/i);
  assert.doesNotMatch(serialized, /password\s*[:=]\s*["'][^"']+/i);
});

test("P1 provider acceptance promotes only dated live evidence with current configuration", async () => {
  const previousMistral = process.env.MISTRAL_API_KEY;
  const previousAllowlist = process.env.WAVE_D_WEBHOOK_ALLOWLIST;
  process.env.MISTRAL_API_KEY = "test-mistral-key";
  process.env.WAVE_D_WEBHOOK_ALLOWLIST = "https://hooks.example.test";
  recordConnectorVerification("mistral", true, "Mistral responded to a governed completion.");
  recordConnectorVerification("communication:webhook", true, "Allow-listed webhook delivered.");

  const snapshot = await buildProviderAcceptanceSnapshot(new Date("2026-09-19T12:05:00.000Z"));
  const mistral = snapshot.rows.find((entry) => entry.id === "ai:mistral");
  const webhook = snapshot.rows.find((entry) => entry.id === "communications:webhook");

  assert.equal(mistral?.state, "verified");
  assert.equal(mistral?.liveVerified, true);
  assert.ok(mistral?.evidenceAt);

  assert.equal(webhook?.state, "verified");
  assert.equal(webhook?.liveVerified, true);
  assert.ok(webhook?.evidenceAt);

  if (previousMistral === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = previousMistral;
  if (previousAllowlist === undefined) delete process.env.WAVE_D_WEBHOOK_ALLOWLIST;
  else process.env.WAVE_D_WEBHOOK_ALLOWLIST = previousAllowlist;
});
