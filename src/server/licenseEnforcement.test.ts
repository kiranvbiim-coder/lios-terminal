import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-enforcement-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "user");
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.LIOS_LICENSE_CACHE_DIR;
delete process.env.LIOS_DESKTOP_DEVICE_ID;

const { LICENSE_TRUST_ANCHORS } = await import("@shared/licenseTrust");
const { closeDb, getDb, initDb } = await import("./db");
const { organizationLicenses, organizations } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createSignedAsymmetricOfflineLicenseLease, licenseKeyId } = await import("./licenseLease");
const { importLicenseFile } = await import("./licenseFile");
const { serializeLicenseFile } = await import("./licenseFile");
const { resolveLocalEffectiveAccess } = await import("./effectiveAccess");
const { requireExecutableTrialOrClient } = await import("./trialAccess");
const { selfServeTrialsEnabled } = await import("./auth");
const { featureIsEntitled } = await import("@shared/identityContracts");

const vendor = generateKeyPairSync("ed25519");
const vendorPublic = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = licenseKeyId(vendorPublic);
// The pinned set is a plain object at runtime; the test adds a key it controls, in this process only.
(LICENSE_TRUST_ANCHORS as Record<string, string>)[keyId] = vendorPublic;

function licence(days = 30, featureKeys = ["engine.valuation"]): string {
  const now = new Date();
  return serializeLicenseFile(createSignedAsymmetricOfflineLicenseLease({
    organizationId: 1, licenseId: 1, status: "active", seatsPurchased: 3,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    keyId, entitlementMode: "allowlist", featureKeys, planCode: "pro",
  }, vendor.privateKey.export({ type: "pkcs8", format: "pem" }).toString()));
}

test.before(async () => {
  await initDb();
});
test.after(async () => {
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

async function organization(stage: "trial" | "client", licenseStatus: "active" | "suspended", trialEnd: Date | null): Promise<number> {
  const db = getDb();
  const [org] = await db.insert(organizations).values({ name: `Org ${Math.random()}`, slug: `org-${Math.random().toString(36).slice(2)}`, status: "active", lifecycleStage: stage }).returning();
  await db.insert(organizationLicenses).values({ organizationId: org!.id, planId: null, status: licenseStatus, seatsPurchased: 1, billingState: stage === "trial" ? "trial" : "current", trialEndsAt: trialEnd });
  return org!.id;
}

function execute(orgId: number): Promise<{ status: number | null; passed: boolean }> {
  return new Promise((resolve) => {
    const result: { status: number | null; passed: boolean } = { status: null, passed: false };
    const res = { status(code: number) { result.status = code; return this; }, json() { resolve(result); return this; } };
    requireExecutableTrialOrClient({ user: { organizationId: orgId } } as never, res as never, () => { result.passed = true; resolve(result); }).catch(() => resolve(result));
  });
}

test("desktop installs offer the local trial by default; a server Home does not; the switch overrides both", () => {
  assert.equal(selfServeTrialsEnabled({ NODE_ENV: "production" }), true, "desktop_local is the default mode");
  assert.equal(selfServeTrialsEnabled({ NODE_ENV: "production", HOST: "0.0.0.0" }), false);
  assert.equal(selfServeTrialsEnabled({ NODE_ENV: "production", LIOS_SELF_SERVE_TRIALS: "false" }), false);
  assert.equal(selfServeTrialsEnabled({ NODE_ENV: "production", HOST: "0.0.0.0", LIOS_SELF_SERVE_TRIALS: "true" }), true);
});

test("an expired trial is locked until a vendor licence is imported, then paid execution is allowed", async () => {
  const orgId = await organization("trial", "active", new Date(Date.now() - 86_400_000));
  assert.deepEqual(await execute(orgId), { status: 402, passed: false });
  importLicenseFile(licence());
  assert.equal((await execute(orgId)).passed, true);
});

test("a licence supplies the entitlements, but a lock set by the Home's administrator still wins", async () => {
  const licensedOrg = await organization("client", "active", null);
  const user = { id: 1, email: "a@example.test", name: "A", role: "client_admin" as const, organizationId: licensedOrg };
  const snapshot = await resolveLocalEffectiveAccess({ user });
  assert.equal(snapshot.license.reason, "license_file");
  assert.equal(featureIsEntitled(snapshot, "engine.valuation"), true);
  assert.equal(featureIsEntitled(snapshot, "engine.other"), false);

  const lockedOrg = await organization("client", "suspended", null);
  const locked = await resolveLocalEffectiveAccess({ user: { ...user, organizationId: lockedOrg } });
  assert.equal(locked.license.canUseEntitledFeatures, false);
  assert.equal(locked.license.reason, "license_suspended");
  assert.equal(await getDb().select().from(organizations).where(eq(organizations.id, lockedOrg)).then((rows) => rows.length), 1);
});

test("only the Home owner reaches licence and backup controls: a customer admin counts as the owner on Desktop Local only", async () => {
  const { isHomeOwner } = await import("./auth");
  assert.equal(isHomeOwner({ role: "internal_admin" }, { HOST: "0.0.0.0" }), true);
  assert.equal(isHomeOwner({ role: "client_admin" }, {}), true, "single-user desktop");
  assert.equal(isHomeOwner({ role: "client_admin" }, { HOST: "0.0.0.0" }), false, "tenant on a server Home");
  for (const role of ["client_user", "internal_analyst", "internal_compliance"]) assert.equal(isHomeOwner({ role: role as never }, {}), false, role);
  assert.equal(isHomeOwner(undefined, {}), false);
});
