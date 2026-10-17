import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { DEFAULT_ENTERPRISE_POLICY, DECISION_PERMISSIONS } from "@shared/enterpriseContracts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-decision-policy-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Database modules capture the Home root on import; exercise that module-loading boundary only after isolating this Home.
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, decisionCases, decisionReceiptVersions, decisionApprovals, researchInvestigations, organizationEnterprisePolicies, auditEvents } = await import("@shared/schema");
const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
const { registerDecisionRoutes, readCanonicalDecisionReview, submitCanonicalDecisionReview } = await import("./decisionRoutes");
const { getDecisionAuthorization, assertDecisionPermission } = await import("./decisionAuthorization");
const { decisionSnapshotHash } = await import("./decisionEngine");

test("enterprise Decision permissions converge current account, tenant, HTTP and exact review replay", { timeout: 120_000 }, async (t) => {
  await initDb();
  const db = getDb();
  const [org, foreign] = await db.insert(organizations).values([
    { name: "Decision policy", slug: crypto.randomUUID() }, { name: "Other policy", slug: crypto.randomUUID() },
  ]).returning();
  const [admin, analyst, reviewer, client] = await db.insert(users).values([
    { role: "internal_admin" as const }, { role: "internal_analyst" as const }, { role: "internal_compliance" as const }, { role: "client_admin" as const },
  ].map((item) => ({ ...item, name: item.role, email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", organizationId: org.id }))).returning();
  const policy = structuredClone(DEFAULT_ENTERPRISE_POLICY);
  await saveEnterprisePolicy(org.id, policy, admin);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = Number(req.header("x-test-user"));
    req.user = [admin, analyst, reviewer, client].find((user) => user.id === id);
    next();
  });
  registerDecisionRoutes(app);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function request(userId: number, method: string, pathname: string, body?: unknown) {
    const response = await fetch(base + pathname, { method, headers: { "x-test-user": String(userId), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function makeDecision(organizationId: number | null = null) {
    const investigation = organizationId === null ? null : (await db.insert(researchInvestigations).values({ title: "Institutional evidence", question: "Should we rebalance?", organizationId, ownerUserId: analyst.id }).returning())[0]!;
    const [decision] = await db.insert(decisionCases).values({ title: "Policy bound review", question: "Should we rebalance?", decisionType: "investment", materiality: "routine", status: "review", ownerUserId: analyst.id, organizationId, investigationId: investigation?.id ?? null }).returning();
    const payload = { decisionId: decision.id, version: 1, question: decision.question, recommendation: "Do not rebalance.", interpretation: "Review only.", evidence: [], sources: [], assumptions: [], calculations: [], models: [], scenarios: [], alternatives: [], counterarguments: [], contradictions: [], confidence: {}, monitoringTriggers: [], provenance: [], requiredEvidenceCount: 1, completeness: { complete: true, missing: [] }, createdByUserId: analyst.id };
    const [receipt] = await db.insert(decisionReceiptVersions).values({ ...payload, snapshotHash: decisionSnapshotHash(payload) }).returning();
    return { decision, receipt };
  }
  const reviewInput = (receiptVersionId: number, policyDigest: string) => ({ receiptVersionId, policyDigest, requestId: crypto.randomUUID(), outcome: "rejected" as const, finalDecision: "Do not rebalance.", rationale: "Keep current exposure pending further evidence." });

  await t.test("default current policy permits owner authorship and same-tenant institutional review reads", async () => {
    const created = await request(analyst.id, "POST", "/api/decisions", { title: "Current author", question: "Should we rebalance?" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { decision } = await makeDecision(org.id);
    const read = await readCanonicalDecisionReview(decision.id, reviewer);
    assert.equal(read.canReview, true);
    assert.equal(read.permissions.author_decisions, false);
    assert.match(read.policyDigest, /^[a-f0-9]{64}$/);
  });

  await t.test("legacy persisted policy preserves original ceilings and records audited version-two edits", async () => {
    const legacy = structuredClone(policy);
    legacy.version = 1;
    legacy.roles.grants.internal_compliance = ["view_audit"];
    await db.update(organizationEnterprisePolicies).set({ policy: legacy }).where(eq(organizationEnterprisePolicies.organizationId, org.id));
    assert.equal((await getDecisionAuthorization(reviewer)).grants.review_decisions, true);
    const saved = await saveEnterprisePolicy(org.id, legacy, admin);
    assert.equal(saved.policy.version, 2);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "enterprise_policy_updated"));
    assert.ok(events.some((event) => event.details.organizationId === org.id && event.details.revision === saved.revision
      && typeof event.details.policyDigest === "string" && typeof event.details.previousPolicyDigest === "string"));
    await saveEnterprisePolicy(org.id, policy, admin);
  });

  await t.test("configured grants never widen the original author/reviewer/client ceilings", async () => {
    const widened = structuredClone(policy);
    widened.roles.grants.internal_analyst.push("review_decisions");
    widened.roles.grants.internal_compliance.push("author_decisions");
    widened.roles.grants.client_admin.push(...DECISION_PERMISSIONS);
    await saveEnterprisePolicy(org.id, widened, admin);
    const { decision, receipt } = await makeDecision();
    assert.equal((await request(client.id, "GET", "/api/decisions")).status, 403);
    assert.equal((await request(reviewer.id, "POST", "/api/decisions", { title: "Not an author", question: "Should we rebalance?" })).status, 403);
    assert.equal((await request(analyst.id, "POST", `/api/decisions/${decision.id}/approval`, reviewInput(receipt.id, (await getDecisionAuthorization(analyst)).digest))).status, 403);
    const analystAuthority = await getDecisionAuthorization(analyst);
    assert.throws(() => assertDecisionPermission(analystAuthority, "review_decisions"), /cannot widen/);
    await saveEnterprisePolicy(org.id, policy, admin);
  });

  await t.test("policy reductions deny HTTP and service reads/authorship without changing the security role", async () => {
    const { decision } = await makeDecision();
    const reduced = structuredClone(policy);
    reduced.roles.grants.internal_analyst = reduced.roles.grants.internal_analyst.filter((grant) => grant !== "author_decisions");
    reduced.roles.grants.internal_compliance = reduced.roles.grants.internal_compliance.filter((grant) => grant !== "read_decisions");
    await saveEnterprisePolicy(org.id, reduced, admin);
    assert.equal((await request(analyst.id, "POST", "/api/decisions", { title: "Policy denied", question: "Should we rebalance?" })).status, 403);
    assert.equal((await request(reviewer.id, "GET", `/api/decisions/${decision.id}`)).status, 403);
    await assert.rejects(readCanonicalDecisionReview(decision.id, reviewer), /Organization policy denies/);
    assert.equal((await getDecisionAuthorization(reviewer)).grants.review_decisions, false, "review also requires read");
    await saveEnterprisePolicy(org.id, policy, admin);
  });

  await t.test("read policy digest binds exact review and duplicate replay remains current-rights dependent", async () => {
    const { decision, receipt } = await makeDecision();
    const initial = await request(reviewer.id, "GET", `/api/decisions/${decision.id}`);
    assert.equal(initial.status, 200);
    const input = reviewInput(receipt.id, String(initial.body.policyDigest));
    assert.equal((await request(reviewer.id, "POST", `/api/decisions/${decision.id}/approval`, input)).status, 201);
    assert.equal((await request(reviewer.id, "POST", `/api/decisions/${decision.id}/approval`, input)).status, 200);
    await saveEnterprisePolicy(org.id, policy, admin);
    assert.equal((await request(reviewer.id, "POST", `/api/decisions/${decision.id}/approval`, input)).status, 409, "even unchanged grants at a newer policy revision stale the prior binding");
    const reduced = structuredClone(policy);
    reduced.roles.grants.internal_compliance = ["read_decisions"];
    await saveEnterprisePolicy(org.id, reduced, admin);
    await assert.rejects(submitCanonicalDecisionReview(decision.id, reviewer, input), /Organization policy denies/);
    assert.equal((await request(reviewer.id, "POST", `/api/decisions/${decision.id}/approval`, input)).status, 403);
    const rows = await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id));
    assert.equal(rows.length, 1);
    await saveEnterprisePolicy(org.id, policy, admin);
  });

  await t.test("policy changes during release are reloaded in its transaction before any approval insert", async () => {
    const { decision, receipt } = await makeDecision();
    const authority = await getDecisionAuthorization(reviewer);
    const input = reviewInput(receipt.id, authority.digest);
    const reduced = structuredClone(policy);
    reduced.roles.grants.internal_compliance = ["read_decisions"];
    await assert.rejects(submitCanonicalDecisionReview(decision.id, reviewer, input, {
      binding: {
        homeId: crypto.randomUUID(), deviceId: null, userId: reviewer.id, decisionId: decision.id,
        receiptVersionId: receipt.id, snapshotHash: receipt.snapshotHash, decisionHead: "0".repeat(64), policyDigest: authority.digest,
        issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      revalidate: async (tx) => {
        // Controlled mutation at the actual release seam, after service preflight but
        // before transactional admission. The failed release rolls this write back.
        await tx.update(organizationEnterprisePolicies).set({ policy: reduced }).where(eq(organizationEnterprisePolicies.organizationId, org.id));
        return authority.digest;
      },
    }), /Organization policy denies/);
    assert.equal((await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))).length, 0);
    await saveEnterprisePolicy(org.id, policy, admin);
  });

  await t.test("foreign tenant, stale role/account and malformed persisted policy all refuse", async () => {
    const { decision } = await makeDecision(foreign.id);
    assert.equal((await request(admin.id, "GET", `/api/decisions/${decision.id}`)).status, 404);
    await db.update(users).set({ role: "client_user" }).where(eq(users.id, reviewer.id));
    await assert.rejects(getDecisionAuthorization(reviewer), /Security role or organization changed/);
    await db.update(users).set({ role: reviewer.role, active: false }).where(eq(users.id, reviewer.id));
    await assert.rejects(getDecisionAuthorization(reviewer), /Current account state/);
    await db.update(users).set({ active: true }).where(eq(users.id, reviewer.id));
    await db.update(organizationEnterprisePolicies).set({ policy: { version: 2 } }).where(eq(organizationEnterprisePolicies.organizationId, org.id));
    await assert.rejects(getDecisionAuthorization(reviewer), /policy is invalid/);
    await saveEnterprisePolicy(org.id, policy, admin);
    await assert.rejects(saveEnterprisePolicy(org.id, { version: 2 }, admin));
  });
});
