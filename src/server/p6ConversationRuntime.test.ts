import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeConversationRuntime, planConversationWorkflow } from "./conversationRuntime";

const personalFinance = {
  schemaVersion: "1" as const,
  asOf: "2026-09-22",
  accounts: [
    { id: "bank", kind: "bank" as const, balance: 200000, currency: "INR" },
    { id: "loan", kind: "loan" as const, balance: -50000, currency: "INR" },
  ],
  transactions: [
    { id: "salary", at: "2026-09-05", amount: 100000, category: "salary", accountId: "bank" },
    { id: "rent", at: "2026-09-06", amount: -30000, category: "rent", accountId: "bank" },
  ],
  debts: [],
  goals: [],
  retirement: null,
};

function conversationRequest(message: string) {
  return {
    requestId: randomUUID(),
    continuationOf: null,
    message,
    executionMode: "deterministic_first" as const,
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured" as const,
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      dataClassification: "private" as const,
    },
    context: {},
  };
}

test("P6 conversation planner recognizes a governed deterministic backtest request", () => {
  const plan = planConversationWorkflow({
    requestId: "11111111-1111-4111-8111-111111111111",
    continuationOf: null,
    message: "Backtest RSI strategy for AAPL with fees 12 bps and slippage 8 bps and capital 250000",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private",
    },
    context: {},
  });
  assert.equal(plan.intent.parameters.workflow, "p6_backtest");
  assert.equal(plan.intent.entityRefs[0], "AAPL");
  assert.equal((plan.intent.parameters.strategy as { kind: string }).kind, "rsi_mean_reversion");
  assert.equal(plan.intent.parameters.feesBps, 12);
  assert.equal(plan.intent.parameters.slippageBps, 8);
  assert.equal(plan.intent.parameters.startingCapital, 250000);
  const run = plan.steps.find((step) => step.id === "run-backtest");
  assert.equal(run?.permissionClass, "user_confirm");
  assert.equal(run?.componentId, "lios.backtest.core-v1");
});

test("P6 conversation planner never routes a backtest to AI-direct calculation", () => {
  const plan = planConversationWorkflow({
    requestId: "22222222-2222-4222-8222-222222222222",
    continuationOf: null,
    message: "Backtest moving average crossover for MSFT",
    executionMode: "ai_assisted",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private",
    },
    context: {},
  });
  assert.equal(plan.intent.requiresAI, false);
  assert.equal(plan.intent.requiresDeterministicCompute, true);
  assert.ok(plan.steps.every((step) => step.kind !== "ai"));
});

test("P6 conversation planner routes personal finance to the deterministic engine", () => {
  const plan = planConversationWorkflow({
    ...conversationRequest("Show my net worth and retirement progress"),
    context: { personalFinance },
  });
  assert.equal(plan.intent.parameters.workflow, "p6_personal_finance");
  assert.equal(plan.intent.requiresAI, false);
  assert.equal(plan.intent.requiresDeterministicCompute, true);
  assert.equal(plan.steps.find((step) => step.id === "run-personal-finance")?.componentId, "lios.personal-finance.core-v1");
  assert.ok(plan.steps.every((step) => step.kind !== "ai"));
});

test("P6 conversation runtime executes personal finance and emits a decision artifact", async () => {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: 1, role: "client_user" },
    scope: "quick",
    chatId: null,
    projectId: null,
    history: [],
    request: { ...conversationRequest("Calculate my personal finances"), context: { personalFinance } },
    emit: (event) => { events.push(event as { type: string; [key: string]: unknown }); },
  });
  assert.equal(result.label, "deterministic");
  assert.equal(result.receiptIds.length, 1);
  assert.equal(result.artifacts[0]?.artifactType, "personal-finance.decision");
  assert.equal((result.artifacts[0]?.data as { kind: string }).kind, "decision");
  assert.match(result.text, /Net worth: 150000/);
  assert.ok(events.some((event) => event.type === "receipt"));
  assert.ok(events.some((event) => event.type === "artifact"));
});

test("P6 ai-assisted personal finance preserves deterministic authority and adds AI synthesis", async () => {
  const events: Array<{ type: string; [key: string]: any }> = [];
  const base = conversationRequest("Calculate my personal finances and explain what matters");
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: 1, role: "client_user" },
    scope: "quick",
    chatId: 777,
    projectId: null,
    history: [],
    preferredProvider: "openai",
    preferredModel: "test-model",
    aiCompletion: async (request) => {
      assert.equal(request.preferredProvider, "openai");
      assert.equal(request.preferredModel, "test-model");
      assert.equal(request.providerPolicy?.allow?.includes("openai"), true);
      assert.match(request.messages[1]?.content ?? "", /Authoritative deterministic LiOS result/);
      return {
        provider: "openai",
        model: "test-model",
        text: "The deterministic snapshot shows positive net worth and positive monthly cash flow.",
        attribution: {
          id: "ai-attribution-test",
          provider: "openai",
          model: "test-model",
          promptHash: "a".repeat(64),
          outputHash: "b".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: "2026-09-24T00:00:00.000Z",
        },
      };
    },
    request: {
      ...base,
      executionMode: "ai_assisted",
      transmissionPolicy: {
        ...base.transmissionPolicy,
        providerAllow: ["openai"],
        allowToolCalling: true,
      },
      context: { personalFinance },
    },
    emit: (event) => { events.push(event as any); },
  });

  assert.equal(result.label, "ai_derived");
  assert.equal(result.artifacts[0]?.artifactType, "personal-finance.decision");
  assert.equal(result.receiptIds.length, 2);
  assert.match(result.text, /Net worth: 150000/);
  assert.match(result.text, /### AI synthesis/);
  assert.match(result.text, /positive net worth/);

  const receipts = events.filter((event) => event.type === "receipt").map((event) => event.receipt);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0]?.deterministic, true);
  assert.equal(receipts[0]?.aiDerived, false);
  assert.equal(receipts[1]?.deterministic, false);
  assert.equal(receipts[1]?.aiDerived, true);
  assert.ok((receipts[1]?.sourceRefs ?? []).some((ref: string) => ref.startsWith("execution-receipt:")));
  assert.ok((receipts[1]?.warnings ?? []).some((warning: string) => /deterministic LiOS receipts/i.test(warning)));
});

test("P6 ai-assisted synthesis failure falls back to the deterministic result and Artifact", async () => {
  const events: Array<{ type: string; [key: string]: any }> = [];
  const base = conversationRequest("Calculate my personal finances and explain what matters");
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: 1, role: "client_user" },
    scope: "quick",
    chatId: 778,
    projectId: null,
    history: [],
    preferredProvider: "openai",
    preferredModel: "test-model",
    aiCompletion: async () => {
      throw new Error("simulated provider outage");
    },
    request: {
      ...base,
      executionMode: "ai_assisted",
      transmissionPolicy: {
        ...base.transmissionPolicy,
        providerAllow: ["openai"],
        allowToolCalling: true,
      },
      context: { personalFinance },
    },
    emit: (event) => { events.push(event as any); },
  });

  assert.equal(result.label, "deterministic");
  assert.equal(result.receiptIds.length, 1);
  assert.equal(result.artifacts[0]?.artifactType, "personal-finance.decision");
  assert.match(result.text, /Net worth: 150000/);
  assert.ok(events.some((event) => event.type === "status" && /AI synthesis unavailable/i.test(String(event.message))));
});

test("P6 personal-finance conversation reports a governed data gap without inputs", async () => {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  await assert.rejects(
    () => executeConversationRuntime({
      tenant: { userId: 1, organizationId: 1, role: "client_user" },
      scope: "quick",
      chatId: null,
      projectId: null,
      history: [],
      request: conversationRequest("Show my net worth"),
      emit: (event) => { events.push(event as { type: string; [key: string]: unknown }); },
    }),
    /inputs are not available/i,
  );
  assert.ok(events.some((event) => event.type === "data_gap"));
});
