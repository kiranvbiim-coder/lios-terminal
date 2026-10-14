import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  createExecutionJournal,
  type ExecutionOwner,
  type ExecutionTrustFacts,
} from "./execution-journal";

const OWNER: ExecutionOwner = { userId: 1, projectId: 2, chatId: 3 };
const EXECUTION_ID = "550e8400-e29b-41d4-a716-446655440010";
const DENIED_ID = "550e8400-e29b-41d4-a716-446655440011";
const RUNTIME_RECEIPT_ID = "550e8400-e29b-41d4-a716-446655440012";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-execution-trust-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = {
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  };
  return { root, options, journal: await createExecutionJournal(options) };
}

function approvedTrust(overrides: Partial<ExecutionTrustFacts> = {}): ExecutionTrustFacts {
  return {
    version: 1,
    requestId: "550e8400-e29b-41d4-a716-446655440020",
    operationDigest: SHA_A,
    approvalDigest: SHA_B,
    permissionClass: "user_confirm",
    policyRevision: SHA_B,
    decision: "approved",
    denialReason: null,
    backendId: "lios.execution.container",
    deviceId: null,
    backendGenerationId: "lios-exec-generation-1",
    runtimeReceiptId: null,
    ...overrides,
  };
}

test("approved trust facts persist through the existing encrypted execution journal", async (t) => {
  const { journal, options } = await fixture(t);
  const trust = approvedTrust();
  await journal.begin({ id: EXECUTION_ID, owner: OWNER, label: "Approved calculation", trust });
  await journal.finish(EXECUTION_ID, "completed", 0, { runtimeReceiptId: RUNTIME_RECEIPT_ID });

  const restarted = await createExecutionJournal(options);
  const record = await restarted.read(EXECUTION_ID, OWNER);
  assert.ok(record);
  assert.equal(record.status, "completed");
  assert.deepEqual(record.trust, { ...trust, runtimeReceiptId: RUNTIME_RECEIPT_ID });
  assert.equal(JSON.stringify(record.trust).includes("argv"), false);
  assert.equal(JSON.stringify(record.trust).includes("environment"), false);
  assert.equal(JSON.stringify(record.trust).includes("stdin"), false);
});

test("approved interactive session journals only safe input digests", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: EXECUTION_ID, owner: OWNER, label: "Read-only console", trust: approvedTrust() });
  await journal.appendInteractiveInputDigest(EXECUTION_ID, SHA_A);
  const record = await journal.read(EXECUTION_ID, OWNER);
  assert.deepEqual(record?.trust?.interactiveInputDigests, [SHA_A]);
  await assert.rejects(
    journal.appendInteractiveInputDigest(EXECUTION_ID, "raw command"),
    /digest/i,
  );
});

test("denied work receives a terminal trust receipt without ever becoming a running execution", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.recordDenied({
    id: DENIED_ID,
    owner: OWNER,
    label: "Denied operation",
    trust: approvedTrust({
      decision: "denied",
      denialReason: "policy-denied",
      backendId: null,
      approvalDigest: null,
      backendGenerationId: null,
    }),
  });

  const restarted = await createExecutionJournal(options);
  const record = await restarted.read(DENIED_ID, OWNER);
  assert.ok(record);
  assert.equal(record.status, "denied");
  assert.equal(record.exitCode, null);
  assert.equal(record.stdout, "");
  assert.equal(record.stderr, "");
  assert.equal(record.trust?.decision, "denied");
  assert.equal(record.trust?.denialReason, "policy-denied");
  await assert.rejects(journal.append(DENIED_ID, "stdout", "must not run"), /finalized/);
  await assert.rejects(journal.finish(DENIED_ID, "completed", 0), /finalized/);
});

test("pre-admission denial is truthful without inventing operation/backend identity", async (t) => {
  const { journal } = await fixture(t);
  await journal.recordDenied({
    id: DENIED_ID,
    owner: OWNER,
    label: "Unsupported privileged command",
    trust: approvedTrust({
      decision: "denied",
      denialReason: "unsupported",
      operationDigest: null,
      approvalDigest: null,
      backendId: null,
      backendGenerationId: null,
    }),
  });
  const record = await journal.read(DENIED_ID, OWNER);
  assert.ok(record);
  assert.equal(record.status, "denied");
  assert.equal(record.trust?.operationDigest, null);
  assert.equal(record.trust?.approvalDigest, null);
  assert.equal(record.trust?.backendId, null);
});

test("journal records without GM-11 trust facts remain valid and expose trust as null", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: EXECUTION_ID, owner: OWNER, label: "Legacy-compatible run" });
  await journal.finish(EXECUTION_ID, "completed", 0);
  const record = await (await createExecutionJournal(options)).read(EXECUTION_ID, OWNER);
  assert.ok(record);
  assert.equal(record.trust, null);
});

test("trust facts fail closed on malformed digests, identifiers and inconsistent decisions", async (t) => {
  const { journal } = await fixture(t);
  for (const trust of [
    approvedTrust({ operationDigest: "not-a-digest" }),
    approvedTrust({ approvalDigest: "not-a-digest" }),
    approvedTrust({ operationDigest: null }),
    approvedTrust({ approvalDigest: null }),
    approvedTrust({ policyRevision: "not-a-digest" }),
    approvedTrust({ backendId: "bad backend id" }),
    approvedTrust({ decision: "approved", denialReason: "policy-denied" }),
    approvedTrust({ decision: "denied", denialReason: null, backendId: null }),
    approvedTrust({ decision: "denied", denialReason: "policy-denied", operationDigest: null, approvalDigest: null, backendId: null, runtimeReceiptId: RUNTIME_RECEIPT_ID }),
    approvedTrust({ decision: "denied", denialReason: "unsupported", operationDigest: null, approvalDigest: SHA_A, backendId: null }),
    approvedTrust({ decision: "denied", denialReason: "unsupported", operationDigest: null, approvalDigest: null, backendId: null, backendGenerationId: "generation" }),
  ]) {
    assert.throws(
      () => journal.begin({ id: EXECUTION_ID, owner: OWNER, label: "Rejected", trust }),
      /trust/i,
    );
  }
  assert.equal(await journal.read(EXECUTION_ID, OWNER), null);
});

test("runtime receipt links are UUID-bound and can only be attached while finalizing a running execution", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: EXECUTION_ID, owner: OWNER, label: "Runtime receipt", trust: approvedTrust() });
  await assert.rejects(
    journal.finish(EXECUTION_ID, "completed", 0, { runtimeReceiptId: "not-a-uuid" }),
    /runtime receipt/i,
  );
  assert.equal((await journal.read(EXECUTION_ID, OWNER))?.status, "running");
  await journal.finish(EXECUTION_ID, "completed", 0, { runtimeReceiptId: RUNTIME_RECEIPT_ID });
  assert.equal((await journal.read(EXECUTION_ID, OWNER))?.trust?.runtimeReceiptId, RUNTIME_RECEIPT_ID);
});
