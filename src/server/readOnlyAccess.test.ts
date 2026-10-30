import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-read-only-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "user");
process.env.LIOS_LICENSE_CACHE_DIR = path.join(root, "license-cache");
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.HOST;
delete process.env.LIOS_DESKTOP_DEVICE_ID;

// Dynamic imports: the data root and license cache must be isolated before any module opens them.
const { default: express } = await import("express");
const { LICENSE_TRUST_ANCHORS } = await import("@shared/licenseTrust");
const { closeDb, getDb, initDb } = await import("./db");
const { organizationLicenses, organizations } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createSignedAsymmetricOfflineLicenseLease, licenseKeyId } = await import("./licenseLease");
const { cacheOfflineLeaseBundle } = await import("./offlineLeaseCache");
const { serializeLicenseKey } = await import("./licenseFile");
const { assertExecutionAllowed, guardExecutionRoutes, ReadOnlyModeError, resolveInstallationAccess } = await import("./accessMode");
const { registerLicenseRoutes } = await import("./licenseRoutes");
const { requireExecutableTrialOrClient, startLocalTrial, TrialStartError } = await import("./trialAccess");
const { GovernedToolRegistry } = await import("./governedTools");
const { invokeAIProvider } = await import("./byoaiTransport");
const { startTemporaryRun, ConversationStartError } = await import("./conversationRunService");
const { executeP9Workflow } = await import("./p9AutomationService");

function signer() {
  const pair = generateKeyPairSync("ed25519");
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem, keyId: licenseKeyId(publicPem) };
}
// A throwaway keypair is trusted for this process only, through the same pinned-anchor object the app reads; nothing is pinned.
const vendor = signer();
(LICENSE_TRUST_ANCHORS as Record<string, string>)[vendor.keyId] = vendor.publicPem;

function lease(expiresAt: string, key = vendor) {
  return createSignedAsymmetricOfflineLicenseLease({
    organizationId: 1, licenseId: 1, status: "active", seatsPurchased: 1,
    issuedAt: new Date(Date.now() - 86_400_000).toISOString(), expiresAt, keyId: key.keyId,
    planCode: "pro", entitlementMode: "unrestricted",
  }, key.privatePem);
}
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let signedInAs: { id: number; role: string; organizationId: number | null } | null = null;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const request = req as unknown as { user?: unknown; isAuthenticated: () => boolean };
  request.isAuthenticated = () => signedInAs !== null;
  if (signedInAs) request.user = signedInAs;
  next();
});
guardExecutionRoutes(app, ["/api/setup"], "connection");
guardExecutionRoutes(app, ["/api/quant"], "analysis");
registerLicenseRoutes(app);
app.get("/api/setup/status", (_req, res) => res.json({ ok: true }));
app.put("/api/setup/credentials/:name", (_req, res) => res.json({ saved: true }));
app.delete("/api/setup/credentials/:name", (_req, res) => res.json({ removed: true }));
app.put("/api/setup/community-data-consent", (_req, res) => res.json({ consent: "updated" }));
app.get("/api/quant/data", (_req, res) => res.json({ rows: [1, 2, 3] }));
app.post("/api/quant/run", (_req, res) => res.json({ ran: true }));
const server = app.listen(0, "127.0.0.1");
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base()}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function resetInstall() {
  const db = getDb();
  await db.delete(organizationLicenses);
  await db.delete(organizations);
  fs.rmSync(process.env.LIOS_LICENSE_CACHE_DIR as string, { recursive: true, force: true });
}

async function accountWithPendingChoice(): Promise<number> {
  const db = getDb();
  const [org] = await db.insert(organizations).values({ name: "Owner Workspace", slug: `trial-${Math.random().toString(36).slice(2)}`, status: "active", lifecycleStage: "trial" }).returning();
  await db.insert(organizationLicenses).values({ organizationId: org!.id, planId: null, status: "active", seatsPurchased: 1, billingState: "trial_pending", trialEndsAt: null });
  signedInAs = { id: 1, role: "client_admin", organizationId: org!.id };
  return org!.id;
}

function safeTool() {
  const tools = new GovernedToolRegistry<"act", { ok: boolean }>();
  tools.register({
    id: "lios.test.analysis", label: "Analysis", kind: "act", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
    inputSchema: z.object({}).strict(), outputSchema: z.object({ ok: z.boolean() }).strict(), cancel: null, invoke: async () => ({ ok: true }),
  });
  return tools;
}

async function refusedAsReadOnly(action: () => Promise<unknown>): Promise<boolean> {
  try { await action(); return false; } catch (error) {
    return error instanceof ReadOnlyModeError || (error instanceof ConversationStartError && error.body.code === "license_read_only");
  }
}

async function everyStartRefused(expected: boolean) {
  assert.equal(await refusedAsReadOnly(() => assertExecutionAllowed("analysis")), expected, "analysis/capability gate");
  assert.equal(await refusedAsReadOnly(() => safeTool().invoke("lios.test.analysis", {}, new AbortController().signal)), expected, "tool execution");
  assert.equal(await refusedAsReadOnly(() => invokeAIProvider({ provider: "openai", messages: [] } as never)), expected, "AI provider call");
  assert.equal(await refusedAsReadOnly(() => startTemporaryRun({} as never, {})), expected, "new conversation run");
  assert.equal(await refusedAsReadOnly(() => executeP9Workflow({ workflow: {} as never, triggerType: "manual" })), expected, "automation run");
  assert.equal((await call("PUT", "/api/setup/credentials/openai", {})).status, expected ? 402 : 200, "new provider connection");
  assert.equal((await call("POST", "/api/quant/run", {})).status, expected ? 402 : 200, "analysis compute route");
}

test.before(async () => { await initDb(); });
test.beforeEach(async () => { signedInAs = null; await resetInstall(); });
test.after(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("an install with no trial and no license record is not under commercial access", async () => {
  const access = await resolveInstallationAccess();
  assert.equal(access.mode, "full");
  assert.equal(access.reason, "unmanaged");
  await everyStartRefused(false);
});

test("a new owner account is read-only until they choose; reads, deletes and consent withdrawal still work", async () => {
  const orgId = await accountWithPendingChoice();
  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason, access.canStartTrial], ["read_only", "trial_not_started", true]);
  await everyStartRefused(true);

  const viaRoute = await call("GET", "/api/license/access");
  assert.deepEqual([viaRoute.json.mode, viaRoute.json.reason, viaRoute.json.isOwner], ["read_only", "trial_not_started", true]);

  const refused = await call("PUT", "/api/setup/credentials/openai", {});
  assert.equal(refused.status, 402);
  assert.equal(refused.json.code, "license_read_only");
  assert.match(String(refused.json.error), /read-only/i);
  assert.match(String(refused.json.error), /license key/i);

  assert.deepEqual(await call("GET", "/api/setup/status"), { status: 200, json: { ok: true } });
  assert.deepEqual(await call("GET", "/api/quant/data"), { status: 200, json: { rows: [1, 2, 3] } });
  assert.equal((await call("DELETE", "/api/setup/credentials/openai")).status, 200);
  assert.equal((await call("PUT", "/api/setup/community-data-consent", {})).status, 200);

  const settled = Promise.withResolvers<{ status: number | null; body: Record<string, unknown> | null }>();
  const result: { status: number | null; body: Record<string, unknown> | null } = { status: null, body: null };
  const res = { status(code: number) { result.status = code; return this; }, json(body: Record<string, unknown>) { result.body = body; settled.resolve(result); return this; } };
  requireExecutableTrialOrClient({ user: { organizationId: orgId } } as never, res as never, () => settled.resolve(result)).catch(() => settled.resolve(result));
  const executable = await settled.promise;
  assert.equal(executable.status, 402);
  assert.equal(executable.body?.code, "license_read_only");
});

test("Start 7-day trial lifts read-only for seven days, exactly once per installation", async () => {
  await accountWithPendingChoice();
  const started = await call("POST", "/api/license/trial/start");
  assert.equal(started.status, 200);
  assert.deepEqual([started.json.mode, started.json.reason, started.json.daysLeft], ["full", "trial_active", 7]);
  await everyStartRefused(false);

  assert.equal((await call("POST", "/api/license/trial/start")).status, 409, "a second start cannot restart the clock");

  const db = getDb();
  const [second] = await db.insert(organizations).values({ name: "Second", slug: `trial-${Math.random().toString(36).slice(2)}`, status: "active", lifecycleStage: "trial" }).returning();
  await db.insert(organizationLicenses).values({ organizationId: second!.id, planId: null, status: "active", seatsPurchased: 1, billingState: "trial_pending", trialEndsAt: null });
  await assert.rejects(() => startLocalTrial(second!.id), (error) => error instanceof TrialStartError && error.status === 409);
});

test("an expired trial is read-only: reads and export-style GETs work, every start is refused", async () => {
  const orgId = await accountWithPendingChoice();
  await startLocalTrial(orgId);
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(organizationLicenses.organizationId, orgId));

  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason, access.daysLeft, access.canStartTrial], ["read_only", "trial_expired", null, false]);
  await everyStartRefused(true);
  assert.equal((await call("GET", "/api/quant/data")).status, 200);
  assert.equal((await call("GET", "/api/setup/status")).status, 200);
  assert.equal((await call("GET", "/api/license/status")).status, 200, "the owner can always see license status");
});

test("pasting a valid key through the real import route lifts read-only and shows days left", async () => {
  const orgId = await accountWithPendingChoice();
  await startLocalTrial(orgId);
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(organizationLicenses.organizationId, orgId));
  await everyStartRefused(true);

  const pasted = `\n  ${serializeLicenseKey(lease(inDays(30))).replace(/(.{60})/g, "$1\n")}  \n`;
  const imported = await call("POST", "/api/license/import", { license: pasted });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.state, "valid");

  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason], ["full", "license_valid"]);
  assert.ok(access.daysLeft !== null && access.daysLeft >= 29 && access.daysLeft <= 30, `daysLeft ${access.daysLeft}`);
  await everyStartRefused(false);
});

test("an expired key puts the install back to read-only and a fresh key lifts it again", async () => {
  const orgId = await accountWithPendingChoice();
  await startLocalTrial(orgId);
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(organizationLicenses.organizationId, orgId));
  // A lease that was valid when stored and has since run out (import itself refuses an already-expired key).
  cacheOfflineLeaseBundle({ lease: lease(new Date(Date.now() - 1000).toISOString()) });

  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason], ["read_only", "license_expired"]);
  await everyStartRefused(true);
  assert.equal((await call("GET", "/api/quant/data")).status, 200);

  assert.equal((await call("POST", "/api/license/import", { license: serializeLicenseKey(lease(inDays(365))) })).status, 200);
  assert.deepEqual((({ mode, reason }) => [mode, reason])(await resolveInstallationAccess()), ["full", "license_valid"]);
  await everyStartRefused(false);
});

test("foreign-signed, altered, truncated or oversized pasted keys are refused by the route and change nothing", async () => {
  const orgId = await accountWithPendingChoice();
  await startLocalTrial(orgId);
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(organizationLicenses.organizationId, orgId));

  const good = serializeLicenseKey(lease(inDays(30)));
  const foreign = serializeLicenseKey(lease(inDays(30), signer()));
  const altered = good.slice(0, 120) + (good[120] === "A" ? "B" : "A") + good.slice(121);
  for (const license of [foreign, altered, good.slice(0, good.length - 20), `LIOS1-${"A".repeat(20_000)}`, "LIOS1-"]) {
    const refused = await call("POST", "/api/license/import", { license });
    assert.equal(refused.status, 400, license.slice(0, 20));
    assert.equal(typeof refused.json.error, "string");
  }
  const access = await resolveInstallationAccess();
  assert.deepEqual([access.mode, access.reason], ["read_only", "trial_expired"]);
  await everyStartRefused(true);
});
