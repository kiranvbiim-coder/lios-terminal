import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createExecutionJournal, type ExecutionOwner } from "../execution-journal";
import { localExecutionBackend } from "../backends/local";
import { createExecutionPolicySnapshot, ExecutionAuthorizationLease } from "../execution-authorization";
import { createProcessSupervisor } from "../supervisor";
import type { ExecutionBackend } from "../backends/types";
import { prepareAnalyzedGovernedCommand, prepareInternalExecIntent } from "./governed-command";
import { executeJournaledGovernedCommand, startJournaledGovernedInteractiveSession } from "./governed-command-journal";

const OWNER: ExecutionOwner = { userId: 13, projectId: 31, chatId: 42 };
const OTHER_OWNER: ExecutionOwner = { ...OWNER, chatId: 43 };
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440098";
const revision = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

async function fixture(t: TestContext, code: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-governed-receipt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const supervisor = createProcessSupervisor();
  t.after(() => supervisor.shutdown());
  const options = { directory: path.join(root, "journal"), keyDirectory: path.join(root, "keys") };
  const journal = await createExecutionJournal(options);
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: {
      argv: [process.execPath, "-e", code],
      cwd: root,
      isolation: { filesystem: "host", network: "inherit", processes: "host" },
      resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
    },
  });
  const policyRevision = revision("policy-v1");
  const lease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm", policyRevision,
    issuedAtMs: Date.now() - 1_000, expiresAtMs: Date.now() + 60_000,
  }));
  const decision = {
    decision: "approved" as const,
    approvedOperationDigest: prepared.operation.digest,
    approvedDigest: prepared.approvalDigest,
    lease,
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision }),
  };
  return { root, options, journal, prepared, decision, policyRevision, supervisor };
}

test("a denied exact operation creates a durable, owner-scoped receipt and no native side effect", { timeout: 15_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-denied-receipt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, "forbidden");
  const { journal, options, prepared, policyRevision } = await fixture(t,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`);
  const result = await executeJournaledGovernedCommand({
    requestId: REQUEST_ID, owner: OWNER, label: "User-reviewed operation", prepared, journal,
    decision: { decision: "denied", reason: "user-denied", policy: { permissionClass: "user_confirm", policyRevision } },
  });
  assert.equal(result, null);
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
  const reopened = await createExecutionJournal(options);
  assert.equal((await reopened.read(REQUEST_ID, OTHER_OWNER)), null);
  const receipt = await reopened.read(REQUEST_ID, OWNER);
  assert.equal(receipt?.status, "denied");
  assert.equal(receipt?.trust?.decision, "denied");
  assert.equal(receipt?.trust?.denialReason, "user-denied");
  assert.equal(receipt?.trust?.requestId, REQUEST_ID);
  assert.equal(receipt?.trust?.operationDigest, prepared.operation.digest);
});

test("approval for a different operation is rejected and recorded before launch", { timeout: 15_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-mismatch-receipt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, "forbidden");
  const { journal, prepared, decision } = await fixture(t,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`);
  await assert.rejects(() => executeJournaledGovernedCommand({
    requestId: REQUEST_ID, owner: OWNER, label: "Mismatched operation", prepared, journal,
    decision: { ...decision, approvedOperationDigest: revision("unrelated command") },
  }), /approval-digest-mismatch/);
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
  const receipt = await journal.read(REQUEST_ID, OWNER);
  assert.equal(receipt?.status, "denied");
  assert.equal(receipt?.trust?.denialReason, "approval-mismatch");
});

test("governed launch persists trust and output before completion is visible after restart", { timeout: 15_000 }, async (t) => {
  const { options, journal, prepared, decision, supervisor } = await fixture(t, "process.stdout.write('approved output')");
  const result = await executeJournaledGovernedCommand({
    requestId: REQUEST_ID, owner: OWNER, label: "Reviewed operation", prepared, journal, decision, supervisor,
  });
  assert.equal(result?.stdout, "approved output");
  const reopened = await createExecutionJournal(options);
  const receipt = await reopened.read(REQUEST_ID, OWNER);
  assert.equal(receipt?.status, "completed");
  assert.equal(receipt?.stdout, "approved output");
  assert.equal(receipt?.trust?.decision, "approved");
  assert.equal(receipt?.trust?.operationDigest, prepared.operation.digest);
  assert.equal(receipt?.trust?.approvalDigest, prepared.approvalDigest);
  assert.equal(receipt?.trust?.backendId, localExecutionBackend.id);
  assert.equal(receipt?.trust?.runtimeReceiptId, null);
  assert.equal(JSON.stringify(receipt?.trust).includes("approved output"), false);
  assert.equal((await reopened.read(REQUEST_ID, OTHER_OWNER)), null);
});

test("interactive sandbox intent rejects arbitrary input and persists only approved input digests", { timeout: 15_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-governed-interactive-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const supervisor = createProcessSupervisor();
  t.after(() => supervisor.shutdown());
  const requestId = "550e8400-e29b-41d4-a716-446655440100";
  const journalOptions = { directory: path.join(root, "journal"), keyDirectory: path.join(root, "keys") };
  const journal = await createExecutionJournal(journalOptions);
  const backend: ExecutionBackend = {
    id: "test.execution.readonly",
    capabilities: {
      filesystem: ["host"], network: ["inherit"], processes: ["host"],
      resourceControls: ["wall-time", "captured-output"],
    },
    async prepare(request) {
      return {
        backendId: this.id,
        spawn: {
          mode: "child",
          argv: [...request.argv],
          cwd: request.cwd,
          env: request.env ? { ...request.env } : undefined,
          envProfile: request.envProfile,
          timeoutMs: request.resources.maxWallTimeMs,
          maxCapturedOutputChars: request.resources.maxCapturedOutputChars,
          captureOutput: true,
          stdinMode: request.stdinMode,
          interactiveInputPolicy: request.interactiveInputPolicy,
          scopeKey: request.scopeKey,
        },
        signal: request.signal,
        facts: { isolation: { ...request.isolation }, resources: { ...request.resources } },
      };
    },
  };
  const prepared = await prepareInternalExecIntent({
    backend,
    intent: { intentId: "sandbox.terminal.readonly", executable: "/bin/sh" },
    cwd: root,
    scopeKey: `conversation:${requestId}`,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
  });
  const policyRevision = revision("interactive-policy");
  const lease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision,
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 60_000,
  }));
  const decision = {
    decision: "approved" as const,
    approvedOperationDigest: prepared.operation.digest,
    approvedDigest: prepared.approvalDigest,
    lease,
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision }),
  };
  const session = await startJournaledGovernedInteractiveSession({
    requestId,
    owner: OWNER,
    label: "Restricted read-only terminal",
    prepared,
    decision,
    journal,
    supervisor,
  });
  await assert.rejects(() => session.writeInput("pwd; touch forbidden"), /launch-invalid/);
  await session.writeInput("pwd");
  await session.writeInput("id -u");
  await session.writeInput("exit");
  const result = await session.wait();
  assert.match(result.stdout, /Read-only sandbox console/);
  assert.ok(result.stdout.includes(root));
  assert.ok(result.stdout.includes(String(process.getuid())));
  const reopened = await createExecutionJournal(journalOptions);
  const receipt = await reopened.read(requestId, OWNER);
  assert.equal(receipt?.status, "completed");
  assert.deepEqual(receipt?.trust?.interactiveInputDigests, ["pwd", "id -u", "exit"].map((input) => revision(input)));
  assert.equal(JSON.stringify(receipt?.trust).includes("pwd"), false);
  assert.equal((await fs.stat(path.join(root, "forbidden")).then(() => true, () => false)), false);
});

test("changed policy records prelaunch denial and interrupted approved records never restart commands", { timeout: 15_000 }, async (t) => {
  const { options, journal, prepared, decision } = await fixture(t, "process.stdout.write('should not execute')");
  await assert.rejects(() => executeJournaledGovernedCommand({
    requestId: REQUEST_ID, owner: OWNER, label: "Stale policy", prepared, journal,
    decision: { ...decision, currentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: revision("changed") }) },
  }), /stale/);
  assert.equal((await journal.read(REQUEST_ID, OWNER))?.trust?.denialReason, "stale-policy");

  const nextId = "550e8400-e29b-41d4-a716-446655440099";
  const fresh = await fixture(t, "process.stdout.write('not resumed')");
  await fresh.journal.begin({
    id: nextId, owner: OWNER, label: "Interrupted operation",
    trust: {
      version: 1, requestId: nextId, operationDigest: fresh.prepared.operation.digest,
      approvalDigest: fresh.prepared.approvalDigest, permissionClass: "user_confirm",
      policyRevision: fresh.policyRevision, decision: "approved", denialReason: null,
      backendId: fresh.prepared.facts.backendId, backendGenerationId: null,
      deviceId: null, runtimeReceiptId: null,
    },
  });
  const restarted = await createExecutionJournal(fresh.options);
  await restarted.recoverInterrupted();
  assert.equal((await restarted.read(nextId, OWNER))?.status, "interrupted");
  assert.equal((await (await createExecutionJournal(options)).read(REQUEST_ID, OWNER))?.status, "denied");
});
