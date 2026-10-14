import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createExecutionPolicySnapshot,
  ExecutionAuthorizationInvalidError,
  ExecutionAuthorizationLease,
} from "./execution-authorization";

const revision = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

test("policy snapshots accept only approval permission classes and opaque SHA-256 revisions", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
  });
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.permissionClass, "user_confirm");
  assert.equal(Object.isFrozen(snapshot), true);

  assert.throws(() => createExecutionPolicySnapshot({
    permissionClass: "safe_auto" as never,
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
  }), /confirm permission class/);
  assert.throws(() => createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: "not-a-digest",
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
  }), /SHA-256/);
  assert.throws(() => createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 2_000,
    expiresAtMs: 2_000,
  }), /expire after/);
});

test("matching policy remains usable before expiry", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "admin_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 5_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot);
  assert.deepEqual(
    lease.assertCurrent({
      permissionClass: "admin_confirm",
      policyRevision: revision("policy-v1"),
    }, 4_999),
    snapshot,
  );
  assert.equal(lease.active, true);
  assert.equal(lease.signal.aborted, false);
});

test("policy drift permanently invalidates the lease and cannot revive after rollback", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot);
  assert.throws(() => lease.assertCurrent({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v2"),
  }, 2_000), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "policy-changed");
    return true;
  });
  assert.equal(lease.active, false);
  assert.equal(lease.signal.aborted, true);

  assert.throws(() => lease.assertCurrent({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
  }, 2_001), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "policy-changed");
    return true;
  });
});

test("permission drift permanently invalidates approval", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot);
  assert.throws(() => lease.assertCurrent({
    permissionClass: "admin_confirm",
    policyRevision: revision("policy-v1"),
  }, 2_000), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "permission-changed");
    return true;
  });
});

test("expiry is fail-closed at the exact boundary", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot);
  assert.throws(() => lease.assertCurrent({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
  }, 2_000), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "expired");
    return true;
  });
  assert.equal(lease.reason, "expired");
});

test("source cancellation invalidates immediately and never revives", () => {
  const source = new AbortController();
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot, [source.signal, source.signal]);
  source.abort(new Error("conversation cancelled"));

  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.reason, "cancelled");
  assert.throws(() => lease.assertCurrent({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
  }, 2_000), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "cancelled");
    return true;
  });
});

test("an already-aborted source creates an inactive lease", () => {
  const source = AbortSignal.abort();
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot, [source]);
  assert.equal(lease.active, false);
  assert.equal(lease.reason, "cancelled");
});

test("explicit close is idempotent and permanently invalidates", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const lease = new ExecutionAuthorizationLease(snapshot);
  lease.close();
  lease.close();
  assert.equal(lease.reason, "closed");
  assert.throws(() => lease.assertCurrent({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
  }, 2_000), (error: unknown) => {
    assert.ok(error instanceof ExecutionAuthorizationInvalidError);
    assert.equal(error.reason, "closed");
    return true;
  });
});

test("a cancellation source attached after issue revokes the lease and later sources are ignored", () => {
  const snapshot = createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: revision("policy-v1"),
    issuedAtMs: 1_000,
    expiresAtMs: 9_000,
  });
  const current = { permissionClass: "user_confirm" as const, policyRevision: revision("policy-v1") };

  const lease = new ExecutionAuthorizationLease(snapshot);
  const run = new AbortController();
  lease.attachCancellationSource(undefined);
  lease.attachCancellationSource(run.signal);
  assert.equal(lease.active, true);
  lease.assertCurrent(current, 2_000);
  run.abort(new Error("run cancelled"));
  assert.equal(lease.active, false);
  assert.equal(lease.reason, "cancelled");
  assert.throws(() => lease.assertCurrent(current, 2_000), ExecutionAuthorizationInvalidError);

  const preAborted = new ExecutionAuthorizationLease(snapshot);
  preAborted.attachCancellationSource(AbortSignal.abort());
  assert.equal(preAborted.reason, "cancelled");

  const closed = new ExecutionAuthorizationLease(snapshot);
  closed.close();
  closed.attachCancellationSource(AbortSignal.abort());
  assert.equal(closed.reason, "closed", "a lease that already ended keeps its first reason");
});
