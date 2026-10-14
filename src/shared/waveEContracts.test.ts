import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCrossDomainRelationships,
  canShareObject,
  diffPortableObjects,
  enforceWorkspacePlan,
  FIRST_PARTY_SKILL_PACKS,
  planDeclarativeWorkspace,
  rehydrateEntitlements,
  validateSkillManifest,
  type PortableAnalyticalObject,
  type ShareGrant,
} from "./waveEContracts";

const baseObject = (overrides: Partial<PortableAnalyticalObject> = {}): PortableAnalyticalObject => ({
  id: "object:1", ownerId: 7, kind: "dcf", title: "DCF", version: "1.0.0", payload: { revenue: 100, margin: 0.2 }, sourceReferences: [{ id: "snapshot:1", revision: "r1", licensed: true }], requiredCapabilities: ["finance:read"], visibility: "organization", forkOf: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), ...overrides,
});

test("portable object diff is deterministic and distinguishes additions, removals and changes", () => {
  const diff = diffPortableObjects(baseObject(), baseObject({ version: "2.0.0", payload: { revenue: 110, margin: 0.2, shares: 10 } }));
  assert.deepEqual(diff, { changed: ["revenue"], added: ["shares"], removed: [], status: "changed" });
  const reordered = diffPortableObjects(baseObject({ payload: { nested: { b: 2, a: 1 } } }), baseObject({ payload: { nested: { a: 1, b: 2 } } }));
  assert.deepEqual(reordered, { changed: [], added: [], removed: [], status: "identical" });
});

test("licensed references fail closed during recipient rehydration", () => {
  const blocked = rehydrateEntitlements(baseObject(), ["finance:read"], []);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.missingReferences, ["snapshot:1"]);
  const ready = rehydrateEntitlements(baseObject(), ["finance:read"], ["snapshot:1"]);
  assert.equal(ready.status, "ready");
});

test("sharing policy rejects licensed external sharing and non-owner grants", () => {
  const grant: ShareGrant = { id: "share:1", objectId: "object:1", grantorId: 7, recipientUserId: 8, organizationId: null, access: "view", external: true, expiresAt: null, createdAt: new Date(0).toISOString() };
  assert.equal(canShareObject(baseObject(), grant, 7).allowed, false);
  assert.equal(canShareObject(baseObject({ sourceReferences: [] }), grant, 8).allowed, false);
  assert.equal(canShareObject(baseObject({ sourceReferences: [] }), { ...grant, external: false }, 7).allowed, true);
});

test("cross-domain graph emits only governed relationships and marks missing evidence unavailable", () => {
  const nodes = [
    { kind: "macro" as const, key: "fedfunds", label: "Fed funds" },
    { kind: "company" as const, key: "ACME", label: "Acme" },
    { kind: "valuation" as const, key: "acme-dcf", label: "Acme DCF" },
    { kind: "portfolio" as const, key: "book-1", label: "Book 1" },
  ];
  const observed = buildCrossDomainRelationships(nodes, ["evidence:1"], new Date(0).toISOString());
  assert.ok(observed.some((relationship) => relationship.relation === "impacts" && relationship.status === "observed"));
  assert.ok(observed.some((relationship) => relationship.relation === "values"));
  assert.ok(observed.some((relationship) => relationship.relation === "exposes"));
  assert.ok(buildCrossDomainRelationships(nodes, []).every((relationship) => relationship.status === "unavailable"));
});

test("AI workspace planner uses only governed primitives and requires confirmation", () => {
  const plan = planDeclarativeWorkspace("Build a market chart, valuation metric and research report", "plan:1", 7, new Date(0));
  assert.deepEqual(plan.operations.map((operation) => operation.block?.primitive), ["quote", "chart", "metric", "news", "report"]);
  assert.equal(enforceWorkspacePlan(plan, [], false).allowed, false);
  assert.equal(enforceWorkspacePlan(plan, [], true).allowed, true);
});

test("first-party skill packs validate and third-party manifests remain approval-gated", () => {
  assert.equal(FIRST_PARTY_SKILL_PACKS.length, 3);
  assert.equal(validateSkillManifest(FIRST_PARTY_SKILL_PACKS[0]).valid, true);
  assert.equal(validateSkillManifest({ ...FIRST_PARTY_SKILL_PACKS[0], id: "third.party", firstParty: false, approval: "pending" }).valid, true);
  assert.equal(validateSkillManifest({ id: "not valid", name: "bad" }).valid, false);
});
