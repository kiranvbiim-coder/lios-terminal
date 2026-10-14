import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p3-control-"));
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.LIOS_TELEMETRY_ENABLED;

const { initDb, closeDb, getDb } = await import("./db");
const {
  buildPublicDistributionManifest,
  markExportCustodyDeleted,
  publicHttpsUrl,
  purgeExpiredProductionMetadata,
  purgeOrganizationOperationalMetadata,
  recordDiagnosticEvent,
  registerExportCustodyReceipt,
  sanitizeDiagnosticDetails,
  updateProductionRetentionPolicy,
} = await import("./productionControlPlane");
const {
  dataDeletionReceipts,
  diagnosticEvents,
  exportCustodyReceipts,
  organizationEnterprisePolicies,
  organizations,
  users,
} = await import("@shared/schema");
const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");

await initDb();

let organizationId = 0;
let userId = 0;
test.before(async () => {
  const db = getDb();
  const [organization] = await db.insert(organizations).values({
    name: "P3 Test Organization",
    slug: `p3-test-${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  const [user] = await db.insert(users).values({
    email: `p3-${crypto.randomUUID().slice(0, 8)}@example.test`,
    passwordHash: "not-used-in-test",
    role: "client_admin",
    organizationId: organization.id,
    name: "P3 Test User",
  }).returning();
  organizationId = organization.id;
  userId = user.id;
});

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("P3 migration enables tenant RLS for client-visible hosted metadata", () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), "migrations/0059_production_control_plane.sql"), "utf8");
  for (const table of ["diagnostic_events", "export_custody_receipts"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ["']?${table}["']? ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`CREATE POLICY ["']?li_os_${table}_tenant["']?`));
  }
  assert.match(migration, /organization_id.*li_os_current_organization_id/s);
});

test("P3 public HTTPS URL and distribution manifest fail closed", () => {
  assert.equal(publicHttpsUrl("http://downloads.example.test/file"), null);
  assert.equal(publicHttpsUrl("https://localhost/file"), null);
  assert.equal(publicHttpsUrl("https://downloads.invalid/file"), null);
  assert.equal(publicHttpsUrl("https://downloads.example.test/file"), "https://downloads.example.test/file");

  const manifest = buildPublicDistributionManifest({
    LIOS_UPDATE_URL: "https://updates.example.test/lios/",
    LIOS_DOWNLOAD_MAC_URL: "https://downloads.example.test/lios.dmg",
    LIOS_DOWNLOAD_WINDOWS_URL: "https://downloads.example.test/lios.exe",
    LIOS_PUBLIC_APP_URL: "https://app.example.test/",
    LIOS_PUBLIC_VERSION: "1.0.0",
  });
  assert.equal(manifest.ready, true);
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.blockers.length, 0);

  const blocked = buildPublicDistributionManifest({});
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.length >= 4);
});

test("P3 diagnostics accept only allow-listed aggregate details and remain disabled by default", async () => {
  const sanitized = sanitizeDiagnosticDetails({
    durationMs: 120,
    count: 3,
    code: "E_TEST",
    launchCount: 8,
    rawQuery: "do not persist",
    prompt: "secret prompt",
    stack: "full stack should not persist",
    nested: { private: true },
  });
  assert.deepEqual(sanitized, {
    durationMs: 120,
    count: 3,
    code: "E_TEST",
    launchCount: 8,
  });

  const disabled = await recordDiagnosticEvent({
    organizationId,
    userId,
    category: "performance",
    eventName: "terminal.aggregate",
    severity: "info",
    details: { count: 1 },
  });
  assert.equal(disabled.accepted, false);
  assert.equal(disabled.reason, "remote_diagnostics_disabled");

  const forced = await recordDiagnosticEvent({
    organizationId,
    userId,
    category: "crash",
    eventName: "test.crash",
    severity: "error",
    fingerprint: "a".repeat(64),
    details: { code: "TEST", prompt: "must-drop" },
    force: true,
    now: new Date("2026-09-19T10:00:00.000Z"),
  });
  assert.equal(forced.accepted, true);
  const rows = await getDb().select().from(diagnosticEvents);
  const row = rows.find((item) => item.id === forced.id);
  assert.equal(row?.details.code, "TEST");
  assert.equal("prompt" in (row?.details ?? {}), false);
});

test("P3 export custody persists only hashes/size/format and supports tombstoning", async () => {
  await updateProductionRetentionPolicy({
    telemetryDays: 1,
    deletionReceiptDays: 365,
    exportReceiptDays: 30,
  }, userId);

  const artifactName = "Client Board Report Q3.xlsx";
  const artifactNameHash = crypto.createHash("sha256").update(artifactName).digest("hex");
  const sha256 = crypto.createHash("sha256").update("fake-local-export-bytes").digest("hex");
  const receipt = await registerExportCustodyReceipt({
    organizationId,
    userId,
    format: "xlsx",
    artifactNameHash,
    sha256,
    byteSize: 12345,
    generatedAt: new Date("2026-09-19T10:10:00.000Z"),
  }, new Date("2026-09-19T10:11:00.000Z"));

  assert.equal(receipt.custody, "local_only");
  assert.equal(receipt.sha256, sha256);
  assert.equal(receipt.byteSize, 12345);
  assert.notEqual(receipt.artifactNameHash, artifactName);
  assert.equal(receipt.artifactNameHash, artifactNameHash);

  const stored = await getDb().select().from(exportCustodyReceipts);
  assert.equal(JSON.stringify(stored).includes(artifactName), false);

  const deleted = await markExportCustodyDeleted(receipt.id, organizationId, userId, new Date("2026-09-19T10:12:00.000Z"));
  assert.ok(deleted?.deletedAt);
});


test("P4 enterprise legal hold blocks expiry purge, explicit purge, and export tombstoning", async () => {
  const legalHoldPolicy = {
    ...DEFAULT_ENTERPRISE_POLICY,
    retention: {
      ...DEFAULT_ENTERPRISE_POLICY.retention,
      legalHold: true,
    },
  };
  await getDb().insert(organizationEnterprisePolicies).values({
    organizationId,
    policy: legalHoldPolicy,
    revision: 1,
    updatedByUserId: userId,
  }).onConflictDoUpdate({
    target: organizationEnterprisePolicies.organizationId,
    set: { policy: legalHoldPolicy, revision: 2, updatedByUserId: userId, updatedAt: new Date() },
  });

  const now = new Date("2026-09-19T14:00:00.000Z");
  const [heldDiagnostic] = await getDb().insert(diagnosticEvents).values({
    organizationId,
    userId,
    category: "runtime",
    eventName: "legal.hold.expired",
    severity: "info",
    details: {},
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-02T00:00:00.000Z"),
  }).returning();
  const heldExport = await registerExportCustodyReceipt({
    organizationId,
    userId,
    format: "pdf",
    artifactNameHash: "b".repeat(64),
    sha256: "c".repeat(64),
    byteSize: 42,
    generatedAt: new Date("2026-09-01T00:00:00.000Z"),
  }, new Date("2026-09-01T00:01:00.000Z"));
  await getDb().update(exportCustodyReceipts)
    .set({ expiresAt: new Date("2026-09-02T00:00:00.000Z") })
    .where(eq(exportCustodyReceipts.id, heldExport.id));

  await purgeExpiredProductionMetadata(now);
  const diagnosticsAfter = await getDb().select().from(diagnosticEvents);
  const exportsAfter = await getDb().select().from(exportCustodyReceipts);
  assert.ok(diagnosticsAfter.some((row) => row.id === heldDiagnostic.id), "legal hold must retain expired diagnostics");
  assert.ok(exportsAfter.some((row) => row.id === heldExport.id), "legal hold must retain expired export custody receipts");

  await assert.rejects(
    () => markExportCustodyDeleted(heldExport.id, organizationId, userId, now),
    /legal hold/i,
  );

  const blocked = await purgeOrganizationOperationalMetadata(
    organizationId,
    userId,
    "P4 legal-hold purge test",
    now,
  );
  assert.equal(blocked.receipt.status, "blocked");
  assert.equal(blocked.counts.diagnosticEvents, 0);

  const releasedPolicy = {
    ...legalHoldPolicy,
    retention: { ...legalHoldPolicy.retention, legalHold: false },
  };
  await getDb().update(organizationEnterprisePolicies)
    .set({ policy: releasedPolicy, revision: 3, updatedAt: new Date() })
    .where(eq(organizationEnterprisePolicies.organizationId, organizationId));
});

test("P3 retention purge and organization purge create durable deletion receipts", async () => {
  await getDb().insert(diagnosticEvents).values({
    organizationId,
    userId,
    category: "runtime",
    eventName: "expired.test",
    severity: "info",
    details: {},
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-02T00:00:00.000Z"),
  });
  const purge = await purgeExpiredProductionMetadata(new Date("2026-09-19T12:00:00.000Z"));
  assert.ok(purge.counts.diagnosticEvents >= 1);
  assert.equal(purge.receipt.scope, "retention_expiry");
  assert.equal(purge.receipt.status, "completed");

  await recordDiagnosticEvent({
    organizationId,
    userId,
    category: "runtime",
    eventName: "org.purge.test",
    severity: "info",
    details: { operation: "test" },
    force: true,
    now: new Date("2026-09-19T12:10:00.000Z"),
  });
  const orgPurge = await purgeOrganizationOperationalMetadata(
    organizationId,
    userId,
    "Approved P3 test purge",
    new Date("2026-09-19T12:11:00.000Z"),
  );
  assert.ok(orgPurge.counts.diagnosticEvents >= 1);
  assert.equal(orgPurge.receipt.scope, "operational_diagnostics");

  const receipts = await getDb().select().from(dataDeletionReceipts);
  assert.ok(receipts.some((item) => item.id === purge.receipt.id));
  assert.ok(receipts.some((item) => item.id === orgPurge.receipt.id));
});
