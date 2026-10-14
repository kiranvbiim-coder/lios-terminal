import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createExecutionPolicySnapshot,
  ExecutionAuthorizationInvalidError,
  ExecutionAuthorizationLease,
} from "../execution-authorization";
import { localExecutionBackend } from "../backends/local";
import {
  executePreparedGovernedCommand,
  prepareAnalyzedGovernedCommand,
} from "./governed-command";
import { createProcessSupervisor } from "../supervisor";
import { withProcessResourceReservations } from "../resource-supervisor";
import { LocalResourceReservationPool } from "../../si01ResourceReservation";

const revision = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function lease(policyRevision: string): ExecutionAuthorizationLease {
  const now = Date.now();
  return new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision,
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
  }));
}

function governedRequest(argv: string[], cwd: string) {
  return {
    argv,
    cwd,
    isolation: { filesystem: "host" as const, network: "inherit" as const, processes: "host" as const },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 8_192 },
  };
}

test("real native side effect is absent when policy becomes stale at the final launch fence", { timeout: 15_000 }, async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-real-denial-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const marker = path.join(cwd, "must-not-exist");
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: governedRequest([
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`,
    ], cwd),
  });

  const approved = revision("policy-v1");
  const changed = revision("policy-v2");
  let checks = 0;
  await assert.rejects(
    () => executePreparedGovernedCommand(prepared, {
      approvedOperationDigest: prepared.operation.digest,
      approvedDigest: prepared.approvalDigest,
      lease: lease(approved),
      currentPolicy: () => ({
        permissionClass: "user_confirm" as const,
        policyRevision: checks++ === 0 ? approved : changed,
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAuthorizationInvalidError);
      assert.equal(error.reason, "policy-changed");
      return true;
    },
  );
  assert.equal(checks, 2);
  assert.equal(fs.existsSync(marker), false, "denied operation must create no native side effect");
});

test("independent approval for command B cannot cause command A's native side effect", { timeout: 15_000 }, async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-real-digest-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const marker = path.join(cwd, "must-not-exist");
  const commandA = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: governedRequest([
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`,
    ], cwd),
  });
  const commandB = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: governedRequest([process.execPath, "-e", "process.stdout.write('B')"], cwd),
  });
  const approved = revision("policy-v1");
  await assert.rejects(
    () => executePreparedGovernedCommand(commandA, {
      approvedOperationDigest: commandB.operation.digest,
      approvedDigest: commandA.approvalDigest,
      lease: lease(approved),
      currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision: approved }),
    }),
    /approval-digest-mismatch/,
  );
  assert.equal(fs.existsSync(marker), false);
});

test("real approved governed command reaches GM-10 and completes normally", { timeout: 15_000 }, async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-governed-real-positive-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const GiB = 1024 * 1024 * 1024;
  const reservations = new LocalResourceReservationPool((activeHeavyReservations) => ({
    totalMemoryBytes: 8 * GiB, freeMemoryBytes: 4 * GiB,
    totalDiskBytes: 256 * GiB, freeDiskBytes: 100 * GiB, activeHeavyReservations,
  }));
  const supervisor = withProcessResourceReservations(createProcessSupervisor(), reservations);
  t.after(() => supervisor.shutdown());
  const marker = path.join(cwd, "created");
  const prepared = await prepareAnalyzedGovernedCommand({
    backend: localExecutionBackend,
    request: governedRequest([
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"); process.stdout.write("done")`,
    ], cwd),
  });

  const approved = revision("policy-v1");
  const result = await executePreparedGovernedCommand(prepared, {
    approvedOperationDigest: prepared.operation.digest,
    approvedDigest: prepared.approvalDigest,
    lease: lease(approved),
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision: approved }),
  }, supervisor);
  assert.equal(result.stdout, "done");
  assert.equal(fs.readFileSync(marker, "utf8"), "ok");
  assert.equal(reservations.activeHeavyReservations, 0, "native extinction releases the admitted reservation");
});
