import assert from "node:assert/strict";
import test from "node:test";
import type { TrustManifest } from "@shared/trustContracts";
import { artifactExportDisclosure } from "./artifactExportDisclosure";

const manifest = (accessStates: Array<{ state: string; entitlementRequired?: boolean }>): TrustManifest =>
  ({ evidence: accessStates.map((access, index) => ({
    evidenceId: `source-${index}`, access: { ...access, entitlementRequired: access.entitlementRequired ?? null },
  })) } as unknown as TrustManifest);

test("WS-63 denied, revoked and expired source records block local exports", () => {
  for (const state of ["revoked", "denied", "blocked", "forbidden", "unauthorized", "access_denied", "rights_revoked", "license_expired", "expired", "Not Authorized"]) {
    const result = artifactExportDisclosure(manifest([{ state }]), ["source:one"]);
    assert.equal(result.blocked, true, state);
    assert.equal(result.blockedSourceCount, 1);
    assert.match(result.note, /Export is blocked/);
  }
});

test("WS-63 mixed permissions fail closed when ANY source is revoked", () => {
  const disclosure = artifactExportDisclosure(manifest([{ state: "allowed" }, { state: "revoked" }, { state: "denied" }]), ["a","b","c"]);
  assert.equal(disclosure.blocked, true);
  assert.equal(disclosure.blockedSourceCount, 2);
  assert.match(disclosure.note, /2 recorded sources/);
});

test("WS-63 source entitlement and unverified legacy metadata require rights review, never imply a grant", () => {
  const upgrade = artifactExportDisclosure(manifest([{ state: "allowed", entitlementRequired: true }]), ["licensed"]);
  assert.equal(upgrade.blocked, false, "may be served on an allowable tier; this UI is not a licensing authority");
  assert.equal(upgrade.rightsReviewRequired, true);
  assert.match(upgrade.note, /does not grant redistribution rights/);

  const legacy = artifactExportDisclosure(null, ["old:source"]);
  assert.equal(legacy.blocked, false);
  assert.match(legacy.note, /no recorded trust manifest/);

  const internal = artifactExportDisclosure(manifest([]), []);
  assert.equal(internal.blocked, false);
  assert.match(internal.note, /does not grant recipient access or source rights/);
});

test("WS-63 recorded state cannot be overwritten by content label or source count", () => {
  const result = artifactExportDisclosure(manifest([{ state: "access-denied" }]), []);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedSourceCount, 1);
});
