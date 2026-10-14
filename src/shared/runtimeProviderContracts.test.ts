import assert from "node:assert/strict";
import test from "node:test";
import { runtimeComponentDescriptorSchema, type RuntimeComponentDescriptor } from "./runtimeContracts";
import {
  HOME_PROVIDER_SLOTS,
  PROVIDER_OPERATOR_USER,
  PROVIDER_OPERATOR_VENDOR,
  evaluateHomeProfile,
  homeProfileSchema,
  providerModeCapability,
  type HomeProfile,
  type HomeProviderSlot,
} from "./runtimeProviderContracts";

function provider(id: string, slot: HomeProviderSlot, tags: string[] = [PROVIDER_OPERATOR_USER, providerModeCapability("desktop_local")]): RuntimeComponentDescriptor {
  return runtimeComponentDescriptorSchema.parse({
    contractVersion: "1", id, kind: HOME_PROVIDER_SLOTS[slot], name: id, version: "1", lifecycle: "builtin",
    executionScopes: ["local_api"], capabilities: tags, source: { origin: "lios" },
  });
}

const descriptors = [
  provider("t.db", "database"), provider("t.store", "storage"), provider("t.secret", "secrets"), provider("t.exec", "execution"),
  provider("t.id", "identity"), provider("t.lic", "license"), provider("t.net", "network"), provider("t.bak", "backup"),
  provider("t.vendor-id", "identity", [PROVIDER_OPERATOR_VENDOR, providerModeCapability("desktop_local")]),
  provider("t.server-only-net", "network", [PROVIDER_OPERATOR_USER, providerModeCapability("user_home_server")]),
  provider("t.undeclared", "storage", [providerModeCapability("desktop_local")]),
];

const profile: HomeProfile = {
  mode: "desktop_local", database: "t.db", storage: "t.store", secrets: ["t.secret"], execution: "t.exec",
  identity: "t.id", license: "t.lic", network: "t.net", backup: ["t.bak"], notification: null, browser: null,
};
const issueCodes = (candidate: HomeProfile) => evaluateHomeProfile(candidate, descriptors).issues.map((issue) => `${issue.slot}:${issue.code}`);

test("a profile of user-operated, mode-compatible providers is conformant", () => {
  const report = evaluateHomeProfile(profile, descriptors);
  assert.equal(report.conformant, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.selected.length, 8);
});

test("selecting a vendor-operated provider breaks zero-LiOS-server conformance", () => {
  assert.deepEqual(issueCodes({ ...profile, identity: "t.vendor-id" }), ["identity:vendor_operated_runtime_dependency"]);
});

test("a provider that does not say who operates it is reported, not assumed user-owned", () => {
  assert.deepEqual(issueCodes({ ...profile, storage: "t.undeclared" }), ["storage:operator_undeclared"]);
});

test("unknown providers, wrong-kind providers and mode mismatches are each reported", () => {
  assert.deepEqual(issueCodes({ ...profile, database: "t.missing" }), ["database:unknown_provider"]);
  assert.deepEqual(issueCodes({ ...profile, database: "t.store" }), ["database:wrong_kind"]);
  assert.deepEqual(issueCodes({ ...profile, network: "t.server-only-net" }), ["network:mode_incompatible"]);
});

test("an empty required chain is a reported gap, not a silent pass", () => {
  assert.deepEqual(issueCodes({ ...profile, backup: [] }), ["backup:required_slot_empty"]);
  assert.equal(evaluateHomeProfile({ ...profile, secrets: [] }, descriptors).conformant, false);
});

test("every issue is reported, not just the first", () => {
  assert.deepEqual(issueCodes({ ...profile, identity: "t.vendor-id", database: "t.missing", backup: [] }).sort(), [
    "backup:required_slot_empty", "database:unknown_provider", "identity:vendor_operated_runtime_dependency",
  ]);
});

test("profile schema rejects unknown slots and repeated chain members", () => {
  assert.equal(homeProfileSchema.safeParse({ ...profile, cloud: "lios" }).success, false);
  assert.equal(homeProfileSchema.safeParse({ ...profile, secrets: ["t.secret", "t.secret"] }).success, false);
  assert.equal(homeProfileSchema.safeParse({ ...profile, mode: "lios_cloud" }).success, false);
});
