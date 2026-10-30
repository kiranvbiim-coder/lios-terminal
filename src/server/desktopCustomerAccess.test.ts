import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-desktop-customer-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "user");
process.env.LIOS_LICENSE_CACHE_DIR = path.join(root, "license-cache");
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.HOST;
delete process.env.LIOS_DESKTOP_DEVICE_ID;
// Set by the Electron main process for the server it spawns; the packaged desktop is the managed customer install.
process.env.LIOS_DESKTOP_PACKAGED = "true";

// Dynamic imports: the data root, cache and packaging flag must be in place before any module reads them.
const { default: express } = await import("express");
const { default: session } = await import("express-session");
const { default: passport } = await import("passport");
const { LICENSE_TRUST_ANCHORS } = await import("@shared/licenseTrust");
const { closeDb, getDb, initDb } = await import("./db");
const { organizationLicenses, organizations, users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { configurePassport, registerAuthRoutes } = await import("./auth");
const { registerLicenseRoutes } = await import("./licenseRoutes");
const { assertExecutionAllowed, guardExecutionRoutes, resolveInstallationAccess, ReadOnlyModeError } = await import("./accessMode");
const { createSignedAsymmetricOfflineLicenseLease, licenseKeyId } = await import("./licenseLease");
const { serializeLicenseKey } = await import("./licenseFile");

const pair = generateKeyPairSync("ed25519");
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = licenseKeyId(publicPem);
// A throwaway keypair trusted for this process only through the existing anchor object; nothing is pinned.
(LICENSE_TRUST_ANCHORS as Record<string, string>)[keyId] = publicPem;
const validKey = () => serializeLicenseKey(createSignedAsymmetricOfflineLicenseLease({
  organizationId: 1, licenseId: 1, status: "active", seatsPurchased: 1, issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), keyId, planCode: "pro", entitlementMode: "unrestricted",
}, pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()));

const app = express();
app.use(express.json());
app.use(session({ secret: "desktop-customer-test", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
configurePassport();
guardExecutionRoutes(app, ["/api/setup"], "connection");
registerAuthRoutes(app);
registerLicenseRoutes(app);
app.put("/api/setup/credentials/:name", (_req, res) => res.json({ saved: true }));
const server = app.listen(0, "127.0.0.1");
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let cookie = "";

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base()}${url}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: base(), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] as string;
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function readOnly(action: () => Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof ReadOnlyModeError; }
}

test.before(async () => { await initDb(); });
test.after(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a fresh packaged-desktop owner (internal_admin, no organization) is read-only until they start the trial or enter a key", async () => {
  assert.equal((await call("GET", "/api/auth/bootstrap/status")).json.setupRequired, true);
  const created = await call("POST", "/api/auth/bootstrap/complete", { email: "owner@example.test", name: "Desktop Owner", password: "Zx9!kQ4#vLm2$Rt8" });
  assert.equal(created.status, 201);
  const [owner] = await getDb().select().from(users).where(eq(users.email, "owner@example.test"));
  assert.deepEqual([owner?.role, owner?.organizationId], ["internal_admin", null]);

  const access = await call("GET", "/api/license/access");
  assert.deepEqual([access.json.mode, access.json.reason, access.json.canStartTrial, access.json.isOwner], ["read_only", "trial_not_started", true, true]);

  const [installation] = await getDb().select({ stage: organizations.lifecycleStage, billing: organizationLicenses.billingState, endsAt: organizationLicenses.trialEndsAt })
    .from(organizationLicenses).innerJoin(organizations, eq(organizations.id, organizationLicenses.organizationId));
  assert.deepEqual([installation?.stage, installation?.billing, installation?.endsAt], ["trial", "trial_pending", null]);

  assert.equal(await readOnly(() => assertExecutionAllowed("conversation")), true);
  const refused = await call("PUT", "/api/setup/credentials/openai", {});
  assert.equal(refused.status, 402);
  assert.equal(refused.json.code, "license_read_only");
});

test("request headers and bodies cannot make a packaged desktop unmanaged", async () => {
  const spoof = { "x-lios-desktop-packaged": "false", "x-lios-unmanaged": "true", "x-forwarded-host": "server.example", "x-lios-license": "valid" };
  const access = await call("GET", "/api/license/access", undefined, spoof);
  assert.deepEqual([access.json.mode, access.json.reason], ["read_only", "trial_not_started"]);
  const refused = await call("PUT", "/api/setup/credentials/openai", { unmanaged: true, desktopPackaged: false, mode: "full" }, spoof);
  assert.equal(refused.status, 402);
  const forged = await call("POST", "/api/license/import", { license: "LIOS1-AAAAAAAAAAAA", unmanaged: true });
  assert.equal(forged.status, 400);
  assert.equal((await call("GET", "/api/license/access")).json.mode, "read_only");
});

test("only the explicit packaging signal manages an install: not unset, not look-alike values, not an empty database", async () => {
  const now = new Date();
  const only = (value: string | undefined) => resolveInstallationAccess(now, { ...process.env, LIOS_DESKTOP_PACKAGED: value });
  assert.equal((await only("true")).mode, "read_only");
  for (const value of [undefined, "false", "TRUE", "1", " true", ""]) {
    const access = await only(value);
    assert.deepEqual([value, access.mode], [value, "read_only"], "an installation with a trial record is governed by its record");
  }
  await getDb().delete(organizationLicenses);
  await getDb().delete(organizations);
  // A server Home or development run has no records and no packaging signal: unmanaged.
  for (const value of [undefined, "false", "TRUE", "1"]) {
    const access = await only(value);
    assert.deepEqual([value, access.mode, access.reason], [value, "full", "unmanaged"]);
  }
  // The packaged desktop never reads "no rows" as "unmanaged": the record is re-created not-started.
  const packaged = await only("true");
  assert.deepEqual([packaged.mode, packaged.reason], ["read_only", "trial_not_started"]);
  const [recreated] = await getDb().select({ billing: organizationLicenses.billingState }).from(organizationLicenses);
  assert.equal(recreated?.billing, "trial_pending");
});

test("Start 7-day trial from the desktop owner begins the clock once; winding the system clock back does not extend it", async () => {
  const started = await call("POST", "/api/license/trial/start");
  assert.equal(started.status, 200);
  assert.deepEqual([started.json.mode, started.json.reason, started.json.daysLeft], ["full", "trial_active", 7]);
  assert.equal((await call("POST", "/api/license/trial/start")).status, 409);
  assert.equal(await readOnly(() => assertExecutionAllowed("ai")), false);

  const day = 86_400_000;
  const t0 = Date.now();
  const twoDaysIn = await resolveInstallationAccess(new Date(t0 + 2 * day));
  assert.equal(twoDaysIn.daysLeft, 5);
  const windedBack = await resolveInstallationAccess(new Date(t0));
  assert.equal(windedBack.daysLeft, 5, "a clock set back to the start still counts the days already seen");
  const expired = await resolveInstallationAccess(new Date(t0 + 8 * day));
  assert.deepEqual([expired.mode, expired.reason], ["read_only", "trial_expired"]);
  const windedBackAgain = await resolveInstallationAccess(new Date(t0 + day));
  assert.deepEqual([windedBackAgain.mode, windedBackAgain.reason], ["read_only", "trial_expired"], "winding the clock back cannot revive an ended trial");
});

test("a valid pasted key lifts an ended trial on the packaged desktop", async () => {
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000), updatedAt: new Date() });
  assert.equal(await readOnly(() => assertExecutionAllowed("tool")), true);
  assert.equal((await call("POST", "/api/license/import", { license: validKey() })).status, 200);
  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason], ["full", "license_valid"]);
  assert.equal(await readOnly(() => assertExecutionAllowed("tool")), false);
});
