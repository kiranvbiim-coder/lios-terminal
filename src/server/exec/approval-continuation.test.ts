import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionAuthorizationInvalidError,
  ExecutionAuthorizationLease,
  createExecutionPolicySnapshot,
} from "./execution-authorization";
import {
  RunApprovalResumeMismatchError,
  assertRunApprovalResumeCurrent,
  createRunApprovalResumeBinding,
  parseRunApprovalResumeBinding,
  releaseRunApproval,
  releaseRunApprovalAndContinue,
} from "./approval-continuation";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_HASH = "a".repeat(64);
const OTHER_PLAN_HASH = "b".repeat(64);
const INPUT_SHA256 = "e".repeat(64);
const OTHER_INPUT_SHA256 = "f".repeat(64);
const POLICY_REVISION = "c".repeat(64);
const OTHER_POLICY_REVISION = "d".repeat(64);
const STEP_ID = "step-send";
const TOOL_ID = "lios.test.send";
const TOOL_CALL_ID = "step-send-call";
const OWNER = { userId: 7, projectId: 41, chatId: 9 } as const;

function lease(sourceSignals: readonly AbortSignal[] = []) {
  return new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: POLICY_REVISION,
    issuedAtMs: 1_000,
    expiresAtMs: 10_000,
  }), sourceSignals);
}

function bindingFor(authorization: ExecutionAuthorizationLease) {
  return createRunApprovalResumeBinding({
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH.toUpperCase(),
    inputSha256: INPUT_SHA256.toUpperCase(),
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
    lease: authorization,
  });
}

function current(
  authorization: ExecutionAuthorizationLease,
  binding = bindingFor(authorization),
  overrides: Partial<Parameters<typeof assertRunApprovalResumeCurrent>[0]> = {},
) {
  return assertRunApprovalResumeCurrent({
    binding,
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: INPUT_SHA256,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
    lease: authorization,
    currentPolicy: { permissionClass: "user_confirm", policyRevision: POLICY_REVISION },
    nowMs: 2_000,
    ...overrides,
  });
}

test("binds approval continuation to the exact run, plan, step, tool and lease snapshot", () => {
  const authorization = lease();
  const binding = bindingFor(authorization);

  assert.deepEqual(
    { ...binding, leaseBindingId: "<live>" },
    {
      version: 1,
      requestId: REQUEST_ID,
      ownerUserId: OWNER.userId,
      projectId: OWNER.projectId,
      chatId: OWNER.chatId,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      leaseBindingId: "<live>",
      permissionClass: "user_confirm",
      policyRevision: POLICY_REVISION,
      issuedAtMs: 1_000,
      expiresAtMs: 10_000,
    },
  );
  assert.match(binding.leaseBindingId, /^[0-9a-f-]{36}$/);
  assert.ok(Object.isFrozen(binding));
  assert.equal(current(authorization, binding).policyRevision, POLICY_REVISION);
});

test("a persisted binding parses as data but never becomes approval authority by itself", () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  const parsed = parseRunApprovalResumeBinding(JSON.parse(JSON.stringify(binding)));

  assert.deepEqual(parsed, binding);
  assert.notEqual(parsed, binding);
  assert.ok(Object.isFrozen(parsed));
  assert.equal(current(authorization, parsed).permissionClass, "user_confirm");

  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, toolId: "" }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, expiresAtMs: 999 }), /expire after/);
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, unexpected: true }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, planHash: PLAN_HASH.toUpperCase() }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, inputSha256: INPUT_SHA256.toUpperCase() }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, policyRevision: POLICY_REVISION.toUpperCase() }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, stepId: "Step With Spaces" }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, toolId: "lios tool" }));
  assert.throws(() => parseRunApprovalResumeBinding({ ...binding, toolCallId: "call with prose" }));
});

test("public release produces a deterministic bounded audit ref for the exact paused action", async () => {
  const authorization = lease();
  const journal = {
    async resumeAfterApproval() {
      return { kind: "tool_call_resumed" };
    },
  };
  const binding = bindingFor(authorization);
  const base = {
    journal,
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: INPUT_SHA256,
    lease: authorization,
    currentPolicy: { permissionClass: "user_confirm" as const, policyRevision: POLICY_REVISION },
    nowMs: 2_000,
  };

  const first = await releaseRunApproval({
    ...base,
    binding,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
  });
  const second = await releaseRunApproval({
    ...base,
    binding,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
  });
  assert.match(first.approvalRef, /^approval:[a-f0-9]{64}$/);
  assert.equal(second.approvalRef, first.approvalRef);

  const changed = createRunApprovalResumeBinding({
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: INPUT_SHA256,
    stepId: "step-other",
    toolId: TOOL_ID,
    toolCallId: "other-call",
    lease: authorization,
  });
  const other = await releaseRunApproval({
    ...base,
    binding: changed,
    stepId: "step-other",
    toolId: TOOL_ID,
    toolCallId: "other-call",
  });
  assert.notEqual(other.approvalRef, first.approvalRef);

  const changedInput = createRunApprovalResumeBinding({
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: OTHER_INPUT_SHA256,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
    lease: authorization,
  });
  const otherInput = await releaseRunApproval({
    ...base,
    binding: changedInput,
    inputSha256: OTHER_INPUT_SHA256,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
  });
  assert.notEqual(otherInput.approvalRef, first.approvalRef);
});

test("rejects a continuation for another requestId or owner before consulting policy", () => {
  for (const overrides of [
    { requestId: OTHER_REQUEST_ID },
    { owner: { ...OWNER, userId: 8 } },
    { owner: { ...OWNER, projectId: 42 } },
    { owner: { ...OWNER, chatId: 10 } },
  ]) {
    const authorization = lease();
    assert.throws(
      () => current(authorization, bindingFor(authorization), overrides),
      (error: unknown) => error instanceof RunApprovalResumeMismatchError && error.reason === "run-changed",
    );
    assert.equal(authorization.active, true);
  }
});

test("rejects re-planning or changing the paused step/tool under an existing approval", () => {
  const cases = [
    { planHash: OTHER_PLAN_HASH },
    { inputSha256: OTHER_INPUT_SHA256 },
    { stepId: "step-other" },
    { toolId: "lios.other.tool" },
    { toolCallId: "other-call" },
  ];
  for (const overrides of cases) {
    const authorization = lease();
    assert.throws(
      () => current(authorization, bindingFor(authorization), overrides),
      (error: unknown) => error instanceof RunApprovalResumeMismatchError && error.reason === "plan-changed",
    );
    assert.equal(authorization.active, true);
  }
});

test("rejects substituting or reconstructing the authorization lease, even with an identical snapshot", () => {
  const original = lease();
  const binding = bindingFor(original);
  const identicalSnapshotLease = lease();
  const differentSnapshotLease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    permissionClass: "user_confirm",
    policyRevision: POLICY_REVISION,
    issuedAtMs: 1_001,
    expiresAtMs: 10_000,
  }));

  for (const replacement of [identicalSnapshotLease, differentSnapshotLease]) {
    assert.throws(
      () => current(replacement, binding),
      (error: unknown) => error instanceof RunApprovalResumeMismatchError && error.reason === "lease-mismatch",
    );
  }
});

test("persisted binding data cannot resurrect approval authority after the live lease is gone", () => {
  const original = lease();
  const persisted = JSON.parse(JSON.stringify(bindingFor(original)));
  const parsed = parseRunApprovalResumeBinding(persisted);
  const reconstructed = lease();

  assert.throws(
    () => current(reconstructed, parsed),
    (error: unknown) => error instanceof RunApprovalResumeMismatchError && error.reason === "lease-mismatch",
  );
});

test("policy drift permanently invalidates the live authorization", () => {
  const authorization = lease();
  const binding = bindingFor(authorization);

  assert.throws(
    () => current(authorization, binding, {
      currentPolicy: { permissionClass: "user_confirm", policyRevision: OTHER_POLICY_REVISION },
    }),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "policy-changed",
  );
  assert.equal(authorization.active, false);
  assert.throws(
    () => current(authorization, binding),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "policy-changed",
  );
});

test("permission-class drift permanently invalidates the live authorization", () => {
  const authorization = lease();
  const binding = bindingFor(authorization);

  assert.throws(
    () => current(authorization, binding, {
      currentPolicy: { permissionClass: "admin_confirm", policyRevision: POLICY_REVISION },
    }),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "permission-changed",
  );
  assert.equal(authorization.active, false);
  assert.throws(
    () => current(authorization, binding),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "permission-changed",
  );
});

test("expiry, cancellation and explicit close all fail closed", () => {
  const expired = lease();
  assert.throws(
    () => current(expired, bindingFor(expired), { nowMs: 10_000 }),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "expired",
  );

  const controller = new AbortController();
  const cancelled = lease([controller.signal]);
  const cancelledBinding = bindingFor(cancelled);
  controller.abort();
  assert.throws(
    () => current(cancelled, cancelledBinding),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "cancelled",
  );

  const closed = lease();
  const closedBinding = bindingFor(closed);
  closed.close();
  assert.throws(
    () => current(closed, closedBinding),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "closed",
  );
});

test("release sends exactly one opaque ref through L2 atomic resume after live revalidation", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  const calls: unknown[][] = [];
  const journal = {
    async resumeAfterApproval(...args: unknown[]) {
      calls.push(args);
      return { kind: "tool_call_resumed" };
    },
  };

  const released = await releaseRunApproval({
    journal,
    binding,
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: INPUT_SHA256,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
    lease: authorization,
    currentPolicy: { permissionClass: "user_confirm", policyRevision: POLICY_REVISION },
    nowMs: 2_000,
  });

  assert.match(released.approvalRef, /^approval:[a-f0-9]{64}$/);
  assert.equal(released.snapshot.policyRevision, POLICY_REVISION);
  assert.deepEqual(calls, [[
    REQUEST_ID,
    { userId: 7, projectId: 41, chatId: 9 },
    TOOL_CALL_ID,
    released.approvalRef,
  ]]);
});

test("release never touches L2 when the approval is stale or bound to another action", async () => {
  const cases: Array<{
    overrides: Partial<Parameters<typeof releaseRunApproval>[0]>;
    expected: "run-changed" | "plan-changed" | "policy-changed";
  }> = [
    { overrides: { requestId: OTHER_REQUEST_ID }, expected: "run-changed" },
    { overrides: { owner: { ...OWNER, userId: 8 } }, expected: "run-changed" },
    { overrides: { owner: { ...OWNER, projectId: 42 } }, expected: "run-changed" },
    { overrides: { owner: { ...OWNER, chatId: 10 } }, expected: "run-changed" },
    { overrides: { planHash: OTHER_PLAN_HASH }, expected: "plan-changed" },
    { overrides: { stepId: "step-other" }, expected: "plan-changed" },
    { overrides: { toolId: "lios.other.tool" }, expected: "plan-changed" },
    { overrides: { toolCallId: "other-call" }, expected: "plan-changed" },
    {
      overrides: { currentPolicy: { permissionClass: "user_confirm", policyRevision: OTHER_POLICY_REVISION } },
      expected: "policy-changed",
    },
  ];

  for (const { overrides, expected } of cases) {
    const authorization = lease();
    const binding = bindingFor(authorization);
    let touched = false;
    const journal = {
      async resumeAfterApproval() {
        touched = true;
      },
    };

    await assert.rejects(
      releaseRunApproval({
        journal,
        binding,
        requestId: REQUEST_ID,
        owner: OWNER,
        planHash: PLAN_HASH,
        inputSha256: INPUT_SHA256,
        stepId: STEP_ID,
        toolId: TOOL_ID,
        toolCallId: TOOL_CALL_ID,
        lease: authorization,
        currentPolicy: { permissionClass: "user_confirm", policyRevision: POLICY_REVISION },
        nowMs: 2_000,
        ...overrides,
      }),
      (error: unknown) =>
        expected === "policy-changed"
          ? error instanceof ExecutionAuthorizationInvalidError && error.reason === expected
          : error instanceof RunApprovalResumeMismatchError && error.reason === expected,
    );
    assert.equal(touched, false);
  }
});

test("L2 atomic release failure is visible and does not execute or fabricate a second transition", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  let calls = 0;
  const journal = {
    async resumeAfterApproval() {
      calls += 1;
      throw new Error("journal unavailable");
    },
  };

  await assert.rejects(
    releaseRunApproval({
      journal,
      binding,
      requestId: REQUEST_ID,
      owner: OWNER,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      lease: authorization,
      currentPolicy: { permissionClass: "user_confirm", policyRevision: POLICY_REVISION },
      nowMs: 2_000,
    }),
    /journal unavailable/,
  );
  assert.equal(calls, 1);
  assert.equal(authorization.active, true);
});

test("continuation runs only after the validated atomic L2 release succeeds", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  const order: string[] = [];
  const result = await releaseRunApprovalAndContinue({
    assertExternalCurrent: async () => { order.push("external"); },
    journal: {
      async resumeAfterApproval(requestId, owner, toolCallId, approvalRef) {
        order.push("journal");
        assert.equal(requestId, REQUEST_ID);
        assert.deepEqual(owner, { userId: 7, projectId: 41, chatId: 9 });
        assert.equal(toolCallId, TOOL_CALL_ID);
        assert.match(approvalRef, /^approval:[a-f0-9]{64}$/);
      },
    },
    binding,
    requestId: REQUEST_ID,
    owner: OWNER,
    planHash: PLAN_HASH,
    inputSha256: INPUT_SHA256,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    toolCallId: TOOL_CALL_ID,
    lease: authorization,
    getCurrentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: POLICY_REVISION }),
    nowMs: 2_000,
    continueRun: async () => {
      order.push("continue");
      return "continued";
    },
  });

  assert.equal(result, "continued");
  assert.deepEqual(order, ["external", "journal", "external", "continue"]);
});

test("external authority failure before release never touches L2 or cleanup", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  let journalCalls = 0;
  let cleanupCalls = 0;

  await assert.rejects(
    releaseRunApprovalAndContinue({
      journal: { async resumeAfterApproval() { journalCalls += 1; } },
      binding,
      requestId: REQUEST_ID,
      owner: OWNER,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      lease: authorization,
      getCurrentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: POLICY_REVISION }),
      assertExternalCurrent: async () => { throw new Error("project grant revoked"); },
      onReleasedInvalid: async () => { cleanupCalls += 1; },
      continueRun: async () => undefined,
    }),
    /project grant revoked/,
  );

  assert.equal(journalCalls, 0);
  assert.equal(cleanupCalls, 0);
});

test("external authority failure after release triggers terminalization hook and blocks continuation", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  let externalCalls = 0;
  let cleanupCalls = 0;
  let continuationCalls = 0;

  await assert.rejects(
    releaseRunApprovalAndContinue({
      journal: { async resumeAfterApproval() {} },
      binding,
      requestId: REQUEST_ID,
      owner: OWNER,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      lease: authorization,
      getCurrentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: POLICY_REVISION }),
      nowMs: 2_000,
      assertExternalCurrent: async () => {
        externalCalls += 1;
        if (externalCalls === 2) throw new Error("project grant revoked");
      },
      onReleasedInvalid: async (error) => {
        cleanupCalls += 1;
        assert.match(error instanceof Error ? error.message : "", /revoked/);
      },
      continueRun: async () => {
        continuationCalls += 1;
      },
    }),
    /project grant revoked/,
  );

  assert.equal(externalCalls, 2);
  assert.equal(cleanupCalls, 1);
  assert.equal(continuationCalls, 0);
});

test("continuation is unreachable when authorization or L2 release fails", async () => {
  for (const mode of ["authorization", "journal"] as const) {
    const authorization = lease();
    const binding = bindingFor(authorization);
    let journalCalls = 0;
    let continuationCalls = 0;

    await assert.rejects(
      releaseRunApprovalAndContinue({
        journal: {
          async resumeAfterApproval() {
            journalCalls += 1;
            if (mode === "journal") throw new Error("journal unavailable");
          },
        },
        binding,
        requestId: REQUEST_ID,
        owner: OWNER,
        planHash: mode === "authorization" ? OTHER_PLAN_HASH : PLAN_HASH,
        inputSha256: INPUT_SHA256,
        stepId: STEP_ID,
        toolId: TOOL_ID,
        toolCallId: TOOL_CALL_ID,
        lease: authorization,
        getCurrentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: POLICY_REVISION }),
        nowMs: 2_000,
        continueRun: async () => {
          continuationCalls += 1;
        },
      }),
      mode === "authorization" ? RunApprovalResumeMismatchError : /journal unavailable/,
    );

    assert.equal(journalCalls, mode === "authorization" ? 0 : 1);
    assert.equal(continuationCalls, 0);
  }
});

test("continuation revalidates after the durable release and closes cancellation TOCTOU", async () => {
  const controller = new AbortController();
  const authorization = lease([controller.signal]);
  const binding = bindingFor(authorization);
  let continuationCalls = 0;

  await assert.rejects(
    releaseRunApprovalAndContinue({
      journal: {
        async resumeAfterApproval() {
          // Simulate the canonical run being cancelled while the L2 atomic save is in flight.
          controller.abort();
        },
      },
      binding,
      requestId: REQUEST_ID,
      owner: OWNER,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      lease: authorization,
      getCurrentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: POLICY_REVISION }),
      nowMs: 2_000,
      continueRun: async () => {
        continuationCalls += 1;
      },
    }),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "cancelled",
  );

  assert.equal(continuationCalls, 0);
});

test("continuation re-reads policy after the durable release and rejects mid-save policy drift", async () => {
  const authorization = lease();
  const binding = bindingFor(authorization);
  let currentPolicy = { permissionClass: "user_confirm" as const, policyRevision: POLICY_REVISION };
  let continuationCalls = 0;

  await assert.rejects(
    releaseRunApprovalAndContinue({
      journal: {
        async resumeAfterApproval() {
          currentPolicy = { permissionClass: "user_confirm", policyRevision: OTHER_POLICY_REVISION };
        },
      },
      binding,
      requestId: REQUEST_ID,
      owner: OWNER,
      planHash: PLAN_HASH,
      inputSha256: INPUT_SHA256,
      stepId: STEP_ID,
      toolId: TOOL_ID,
      toolCallId: TOOL_CALL_ID,
      lease: authorization,
      getCurrentPolicy: () => currentPolicy,
      nowMs: 2_000,
      continueRun: async () => {
        continuationCalls += 1;
      },
    }),
    (error: unknown) => error instanceof ExecutionAuthorizationInvalidError && error.reason === "policy-changed",
  );

  assert.equal(continuationCalls, 0);
});

test("invalid ids, hashes and paused action identifiers are rejected before a resumable binding exists", () => {
  const authorization = lease();
  const base = { owner: OWNER, planHash: PLAN_HASH, inputSha256: INPUT_SHA256, stepId: STEP_ID, toolId: TOOL_ID, toolCallId: TOOL_CALL_ID, lease: authorization };
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: "not-a-request" }), /lowercase UUID/);
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, planHash: "not-a-hash" }), /SHA-256/);
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, inputSha256: "not-a-hash" }), /SHA-256/);
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, stepId: "" }));
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, toolId: "" }));
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, stepId: "step with prose" }));
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, toolId: "lios tool" }));
  assert.throws(() => createRunApprovalResumeBinding({ ...base, requestId: REQUEST_ID, toolCallId: "call with prose" }));
});
