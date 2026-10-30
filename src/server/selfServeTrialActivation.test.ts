import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-self-serve-trial-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "user");
process.env.LIOS_LICENSE_CACHE_DIR = path.join(root, "license-cache");
process.env.HOST = "0.0.0.0";
process.env.NODE_ENV = "production";
process.env.LIOS_SELF_SERVE_TRIALS = "true";
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.LIOS_DESKTOP_PACKAGED;
delete process.env.LIOS_DESKTOP_DEVICE_ID;

// These imports intentionally defer the database/auth module-loading boundary until the isolated Home is configured.
const { default: express } = await import("express");
const { default: session } = await import("express-session");
const { default: passport } = await import("passport");
const { closeDb, getDb, initDb } = await import("./db");
const { domains, organizations, organizationLicenses, users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { configurePassport, registerAuthRoutes, requireAuth } = await import("./auth");
const { registerLicenseRoutes } = await import("./licenseRoutes");
const { assertExecutionAllowed, resolveInstallationAccess, respondReadOnly, INSTALLATION_ORG_SLUG } = await import("./accessMode");
const { runWithRequestIdentity } = await import("./requestContext");
const { startSelfServeTrial, TrialStartError } = await import("./trialAccess");

const app = express();
app.use(express.json());
app.use(session({ secret: "isolated-self-serve-session-fixture", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
configurePassport();
app.use((req, _res, next) => runWithRequestIdentity({
  userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null,
}, next));
registerAuthRoutes(app);
registerLicenseRoutes(app);
let effects = 0;
app.post("/api/trial-execution-probe", requireAuth, async (_req, res, next) => {
  try {
    await assertExecutionAllowed("analysis");
    effects++;
    res.json({ executed: true });
  } catch (error) { if (!respondReadOnly(res, error)) next(error); }
});
const server = app.listen(0, "127.0.0.1");
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const password = "Zx9!kQ4#vLm2$Rt8";
type Browser = { cookie: string };
const browser = (): Browser => ({ cookie: "" });

async function call(client: Browser, method: string, url: string, body?: unknown) {
  const response = await fetch(`${base()}${url}`, {
    method, headers: { "Content-Type": "application/json", Origin: base(), ...(client.cookie ? { Cookie: client.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) client.cookie = setCookie.split(";")[0]!;
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

async function register(client: Browser, label: string) {
  const email = `${label}@example.test`;
  assert.equal((await call(client, "POST", "/api/auth/register", { email, password, name: `Trial ${label}`, organizationName: `Customer ${label}` })).status, 201);
  const [actor] = await getDb().select().from(users).where(eq(users.email, email));
  assert.ok(actor?.organizationId);
  assert.equal(actor.role, "client_admin");
  return actor;
}

async function license(organizationId: number) {
  const [row] = await getDb().select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId));
  assert.ok(row);
  return row;
}

async function access(client: Browser) {
  const response = await call(client, "GET", "/api/license/access");
  assert.equal(response.status, 200);
  return response.json;
}

async function probe(client: Browser, status: number) {
  const before = effects;
  const response = await call(client, "POST", "/api/trial-execution-probe", {});
  assert.equal(response.status, status);
  assert.equal(effects, before + (status === 200 ? 1 : 0));
  if (status === 402) assert.equal(response.json.code, "license_read_only");
}

test.before(async () => {
  await initDb();
  await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true }).onConflictDoNothing();
});
test.after(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("authenticated server-Home enrollment activates only the customer's own explicit trial without Home authority", async () => {
  assert.equal((await call(browser(), "POST", "/api/license/trial/start")).status, 401);
  const first = browser();
  const second = browser();
  const a = await register(first, "alpha");
  const b = await register(second, "beta");
  const aOrg = a.organizationId!;
  const bOrg = b.organizationId!;
  for (const client of [first, second]) {
    const pending = await access(client);
    assert.deepEqual([pending.mode, pending.reason, pending.canStartTrial, pending.isOwner], ["read_only", "trial_not_started", true, false]);
    await probe(client, 402);
    assert.equal((await call(client, "GET", "/api/license/status")).status, 403);
    assert.equal((await call(client, "POST", "/api/license/import", { license: "not-a-license" })).status, 403);
  }
  assert.equal((await call(first, "POST", "/api/license/trial/start", { organizationId: bOrg })).status, 400);
  assert.equal((await call(first, "POST", `/api/license/trial/start?organizationId=${bOrg}`)).status, 400);
  assert.equal((await call(first, "POST", "/api/license/trial/start", { trialEndsAt: "2099-01-01T00:00:00Z" })).status, 400);
  assert.equal((await license(aOrg)).trialEndsAt, null);
  assert.equal((await license(bOrg)).trialEndsAt, null);
  const before = Date.now();
  const started = await call(first, "POST", "/api/license/trial/start");
  assert.equal(started.status, 200);
  assert.deepEqual([started.json.mode, started.json.reason, started.json.canStartTrial, started.json.isOwner], ["full", "trial_active", false, false]);
  const firstEnd = (await license(aOrg)).trialEndsAt!;
  assert.ok(firstEnd.getTime() >= before + 7 * 86_400_000 && firstEnd.getTime() <= Date.now() + 7 * 86_400_000);
  await probe(first, 200);
  await probe(second, 402);
  assert.equal((await access(second)).reason, "trial_not_started");
  assert.equal((await resolveInstallationAccess()).reason, "unmanaged", "customer activation never changes installation-wide access");
  assert.equal((await call(first, "POST", "/api/license/trial/start")).status, 409);
  assert.equal((await license(aOrg)).trialEndsAt!.getTime(), firstEnd.getTime());

  const competing = await Promise.all([call(second, "POST", "/api/license/trial/start"), call(second, "POST", "/api/license/trial/start")]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await license(aOrg)).trialEndsAt!.getTime(), firstEnd.getTime());
  await getDb().update(organizationLicenses).set({ trialEndsAt: new Date(Date.now() - 60_000) }).where(eq(organizationLicenses.organizationId, aOrg));
  assert.equal((await access(first)).reason, "trial_expired");
  assert.equal((await access(second)).reason, "trial_active");
  await probe(first, 402);
  await probe(second, 200);
  assert.equal((await call(first, "POST", "/api/license/trial/start")).status, 409);

  const third = browser();
  const c = await register(third, "gamma");
  const cOrg = c.organizationId!;
  assert.equal((await access(third)).canStartTrial, true, "another customer's expiry cannot block enrollment");
  await assert.rejects(
    runWithRequestIdentity({ userId: c.id, organizationId: bOrg }, () => assertExecutionAllowed("analysis")),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 402,
    "a stale or substituted organization in request context cannot borrow another customer's active trial",
  );

  const [owner] = await getDb().insert(users).values({ email: "home-owner@example.test", name: "Home Owner", passwordHash: a.passwordHash, role: "internal_admin", organizationId: null, active: true, mustChangePassword: false }).returning();
  assert.ok(owner);
  const home = browser();
  assert.equal((await call(home, "POST", "/api/auth/login", { email: owner.email, password })).status, 200);
  assert.equal((await call(home, "POST", "/api/license/trial/start", { organizationId: cOrg })).status, 400);
  assert.equal((await call(home, "POST", "/api/license/trial/start")).status, 200);
  const [installation] = await getDb().select().from(organizations).where(eq(organizations.slug, INSTALLATION_ORG_SLUG));
  assert.ok(installation);
  const installationEnd = (await license(installation.id)).trialEndsAt!.getTime();
  assert.equal((await license(cOrg)).billingState, "trial_pending", "the Home owner's trial does not activate customers");
  await probe(first, 402);
  await probe(third, 402);
  await probe(second, 200);

  assert.equal((await call(third, "POST", "/api/license/trial/start", { organizationId: installation.id })).status, 400);
  await getDb().update(users).set({ organizationId: installation.id }).where(eq(users.id, c.id));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  assert.equal((await license(installation.id)).trialEndsAt!.getTime(), installationEnd);
  await getDb().update(users).set({ organizationId: cOrg }).where(eq(users.id, c.id));

  process.env.LIOS_SELF_SERVE_TRIALS = "false";
  assert.equal((await access(third)).canStartTrial, false);
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  assert.equal((await call(browser(), "POST", "/api/auth/register", { email: "disabled@example.test", password, name: "Disabled Customer" })).status, 403);
  delete process.env.LIOS_SELF_SERVE_TRIALS;
  assert.equal((await access(third)).canStartTrial, false, "server Homes stay opt-in when the switch is unset");
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  process.env.LIOS_SELF_SERVE_TRIALS = "true";

  for (const role of ["client_user", "internal_analyst", "internal_compliance"] as const) {
    await getDb().update(users).set({ role }).where(eq(users.id, c.id));
    assert.equal((await access(third)).canStartTrial, false, role);
    assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403, role);
  }
  await getDb().update(users).set({ role: "client_admin", lockedUntil: new Date(Date.now() + 60_000) }).where(eq(users.id, c.id));
  assert.equal((await access(third)).canStartTrial, false);
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  await getDb().update(users).set({ lockedUntil: null, mustChangePassword: true }).where(eq(users.id, c.id));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  await getDb().update(users).set({ mustChangePassword: false, active: false }).where(eq(users.id, c.id));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 401);
  await getDb().update(users).set({ active: true }).where(eq(users.id, c.id));
  assert.equal((await call(third, "POST", "/api/auth/login", { email: c.email, password })).status, 200);

  await getDb().update(organizations).set({ status: "inactive" }).where(eq(organizations.id, cOrg));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  await getDb().update(organizations).set({ status: "active", lifecycleStage: "client" }).where(eq(organizations.id, cOrg));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  await getDb().update(organizations).set({ lifecycleStage: "trial" }).where(eq(organizations.id, cOrg));
  await getDb().update(organizationLicenses).set({ status: "suspended" }).where(eq(organizationLicenses.organizationId, cOrg));
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 403);
  await getDb().update(organizationLicenses).set({ status: "active" }).where(eq(organizationLicenses.organizationId, cOrg));
  await assert.rejects(startSelfServeTrial({ id: c.id, role: "client_admin", organizationId: bOrg }), (error) => error instanceof TrialStartError && error.status === 403);
  assert.equal((await license(cOrg)).trialEndsAt, null, "all denials preserve the pending trial");
  assert.equal((await call(third, "POST", "/api/license/trial/start")).status, 200);
  assert.equal((await license(installation.id)).trialEndsAt!.getTime(), installationEnd);
});
