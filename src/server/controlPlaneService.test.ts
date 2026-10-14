import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated data dir, same requirement as dataSpineIngestionMonitor.test.ts /
// entityResolver.test.ts -- process.env.LIMURIA_DATA_DIR must be set before
// ./db (transitively imported by ./controlPlaneService) is first evaluated,
// so the static imports below are deferred to dynamic ones.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-control-plane-service-"));
process.env.LIMURIA_DATA_DIR = dataDir;

// Exception to static-import convention: this ordering requirement is a
// genuine runtime constraint (LIMURIA_DATA_DIR must be set before ./db's
// top-level PGLITE_DIR const evaluates), not a stylistic choice -- matches
// the same established exception in dataSpineIngestionMonitor.test.ts.
const { sessionMatchesControl, sessionUserId, getOrganizationLicenseSummary } = await import("./controlPlaneService");
const { insertSessionControlSchema, upsertOrganizationLicenseSchema, organizations, organizationLicenses } = await import("@shared/schema");
const { initDb, closeDb, getDb } = await import("./db");

test("sessionUserId reads Passport session ids without trusting arbitrary JSON", () => {
  assert.equal(sessionUserId(null), null);
  assert.equal(sessionUserId({}), null);
  assert.equal(sessionUserId({ passport: {} }), null);
  assert.equal(sessionUserId({ passport: { user: 42 } }), 42);
  assert.equal(sessionUserId({ passport: { user: "42" } }), 42);
  assert.equal(sessionUserId({ passport: { user: "42x" } }), null);
});

test("session controls match global, session, user, and organization scopes", () => {
  const session = { sid: "sid-a", sessionData: { passport: { user: 7 } } };
  const userOrgById = new Map<number, number | null>([[7, 11]]);

  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "global" }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "session", sid: "sid-a" }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "session", sid: "sid-b" }, userOrgById), false);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "user", targetUserId: 7 }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "user", targetUserId: 8 }, userOrgById), false);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "organization", organizationId: 11 }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_logout", scope: "organization", organizationId: 12 }, userOrgById), false);
});

test("force reauth controls use the same session matching semantics as force logout", () => {
  const session = { sid: "sid-a", sessionData: { passport: { user: 7 } } };
  const userOrgById = new Map<number, number | null>([[7, 11]]);

  assert.equal(sessionMatchesControl(session, { controlType: "force_reauth", scope: "global" }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_reauth", scope: "session", sid: "sid-a" }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_reauth", scope: "user", targetUserId: 7 }, userOrgById), true);
  assert.equal(sessionMatchesControl(session, { controlType: "force_reauth", scope: "organization", organizationId: 11 }, userOrgById), true);
});

test("control-plane schemas enforce lifecycle and scoped session inputs", () => {
  assert.equal(upsertOrganizationLicenseSchema.safeParse({ status: "security_locked", seatsPurchased: 2 }).success, true);
  assert.equal(upsertOrganizationLicenseSchema.safeParse({ status: "paused", seatsPurchased: 2 }).success, false);

  assert.equal(insertSessionControlSchema.safeParse({ controlType: "force_logout", scope: "organization", organizationId: 4, reason: "security incident" }).success, true);
  assert.equal(insertSessionControlSchema.safeParse({ controlType: "force_logout", scope: "global", reason: "ok" }).success, false);
  assert.equal(insertSessionControlSchema.safeParse({ controlType: "force_reauth", scope: "user", targetUserId: 4, reason: "security incident" }).success, true);
  assert.equal(insertSessionControlSchema.safeParse({ controlType: "force_reauth", scope: "organization", reason: "security incident" }).success, false);
  assert.equal(insertSessionControlSchema.safeParse({ controlType: "restart", scope: "global", reason: "security incident" }).success, false);
});

test("getOrganizationLicenseSummary (LV4-02-08)", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const db = getDb();

  await t.test("returns null when the organization has no license row yet", async () => {
    const [org] = await db.insert(organizations).values({ name: "No License Org", slug: "no-license-org" }).returning();
    assert.equal(await getOrganizationLicenseSummary(org.id), null);
  });

  await t.test("grace: reflects an active grace period and its reason distinctly from billing_hold", async () => {
    const [org] = await db.insert(organizations).values({ name: "Grace Org", slug: "grace-org" }).returning();
    const graceEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await db.insert(organizationLicenses).values({ organizationId: org.id, status: "grace", graceEndsAt });

    const summary = await getOrganizationLicenseSummary(org.id);
    assert.equal(summary?.status, "grace");
    assert.equal(summary?.reason, "license_in_grace");
    assert.equal(summary?.canUseEntitledFeatures, true);
    assert.equal(summary?.graceEndsAt?.getTime(), graceEndsAt.getTime());
  });

  await t.test("grace: an expired grace period flips both the reason and canUseEntitledFeatures", async () => {
    const [org] = await db.insert(organizations).values({ name: "Expired Grace Org", slug: "expired-grace-org" }).returning();
    const graceEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(organizationLicenses).values({ organizationId: org.id, status: "grace", graceEndsAt });

    const summary = await getOrganizationLicenseSummary(org.id);
    assert.equal(summary?.reason, "license_grace_expired");
    assert.equal(summary?.canUseEntitledFeatures, false);
  });

  await t.test("billing_hold: authenticates but flags feature access as blocked, distinct from grace", async () => {
    const [org] = await db.insert(organizations).values({ name: "Billing Hold Org", slug: "billing-hold-org" }).returning();
    await db.insert(organizationLicenses).values({ organizationId: org.id, status: "billing_hold" });

    const summary = await getOrganizationLicenseSummary(org.id);
    assert.equal(summary?.status, "billing_hold");
    assert.equal(summary?.reason, "license_billing_hold");
    assert.equal(summary?.canUseEntitledFeatures, false);
    assert.equal(summary?.graceEndsAt, null);
  });

  await t.test("active: the common case returns canUseEntitledFeatures true and no banner-triggering reason", async () => {
    const [org] = await db.insert(organizations).values({ name: "Active Org", slug: "active-org" }).returning();
    await db.insert(organizationLicenses).values({ organizationId: org.id, status: "active" });

    const summary = await getOrganizationLicenseSummary(org.id);
    assert.equal(summary?.reason, "license_active");
    assert.equal(summary?.canUseEntitledFeatures, true);
  });
});
