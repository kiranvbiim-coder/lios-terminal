import assert from "node:assert/strict";
import test from "node:test";
import type { CalculationJob } from "@shared/schema";
import { z } from "zod";
import {
  FACTOR_RISK_CALCULATION_KIND,
  SCENARIO_PIPELINE_CALCULATION_KIND,
} from "./calculationJobRunners";
import type { CalculationJobOwner, CalculationJobScope } from "./calculationJobService";
import {
  createFinanceMCPHandlers,
  FINANCE_MCP_TOOL_IDS,
  financeMCPJobView,
} from "./mcpFinanceTools";
import { mcpVisibleToolIdsForRole } from "./mcpRoutes";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const DATASET_ID = "22222222-2222-4222-8222-222222222222";

function makeJob(overrides: Partial<CalculationJob> = {}): CalculationJob {
  return {
    id: JOB_ID,
    kind: FACTOR_RISK_CALCULATION_KIND,
    input: { confidential: "server-only-input" },
    status: "queued",
    progressPct: 0,
    result: null,
    error: null,
    cancellationRequested: false,
    recoveryReason: null,
    retryCount: 0,
    maxRetries: 2,
    ownerUserId: 7,
    organizationId: 12,
    leaseOwner: "worker-secret",
    leaseExpiresAt: null,
    queuedAt: new Date("2026-09-04T10:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date("2026-09-04T10:00:00.000Z"),
    ...overrides,
  } as CalculationJob;
}

function handlerById(
  handlers: ReturnType<typeof createFinanceMCPHandlers>,
  toolId: string,
) {
  const handler = handlers.find((candidate) => candidate.descriptor.id === toolId);
  assert.ok(handler, `missing handler ${toolId}`);
  return handler;
}

function invocationContext(userId: number, organizationId: number | null) {
  return {
    requestId: "33333333-3333-4333-8333-333333333333",
    userId,
    organizationId,
    role: "internal_analyst",
    projectId: null,
  };
}

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

test("finance MCP handlers declare canonical governed execution facts", () => {
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async () => makeJob(),
    getCalculationJob: async () => null,
  });
  assert.deepEqual(
    handlers.map((handler) => handler.descriptor.id),
    [...FINANCE_MCP_TOOL_IDS],
  );
  const factor = handlerById(handlers, "lios.factor_risk_capture").descriptor;
  assert.equal(factor.permissionClass, "user_confirm");
  assert.equal(factor.access, "write");
  assert.equal(factor.sideEffect, "internal_write");
  assert.equal(factor.replaySafe, false);
  const scenario = handlerById(handlers, "lios.scenario_pipeline").descriptor;
  assert.equal(scenario.permissionClass, "user_confirm");
  assert.equal(scenario.access, "write");
  assert.equal(scenario.sideEffect, "internal_write");
  assert.equal(scenario.replaySafe, false);
  const lookup = handlerById(handlers, "lios.calculation_job").descriptor;
  assert.equal(lookup.access, "read");
  assert.equal(lookup.sideEffect, "none");
  assert.equal(lookup.replaySafe, true);
});

test("factor-risk MCP tool validates input and derives durable job ownership from invocation context", async () => {
  const capture: { value?: { kind: string; input: unknown; owner: CalculationJobOwner } } = {};
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async (kind, input, owner) => {
      capture.value = { kind, input, owner };
      return makeJob({ kind, input: input as Record<string, unknown>, ownerUserId: owner.userId, organizationId: owner.organizationId });
    },
    getCalculationJob: async () => null,
  });

  const result = await handlerById(handlers, "lios.factor_risk_capture").invoke(
    { symbols: ["aapl", "msft"], range: "3Y" },
    invocationContext(41, 19),
    liveSignal(),
  ) as Record<string, unknown>;

  assert.ok(capture.value);
  assert.equal(capture.value.kind, FACTOR_RISK_CALCULATION_KIND);
  assert.deepEqual(capture.value.owner, { userId: 41, organizationId: 19 });
  assert.deepEqual(capture.value.input, {
    symbols: ["aapl", "msft"],
    benchmarkSymbol: "^GSPC",
    range: "3Y",
  });
  assert.equal(result.kind, FACTOR_RISK_CALCULATION_KIND);
  assert.deepEqual(result.execution, {
    deterministic: true,
    durable: true,
    kind: FACTOR_RISK_CALCULATION_KIND,
  });
});

test("factor-risk MCP tool rejects tenant identity injection before enqueue", async () => {
  let enqueueCount = 0;
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async () => {
      enqueueCount += 1;
      return makeJob();
    },
    getCalculationJob: async () => null,
  });

  await assert.rejects(
    () => handlerById(handlers, "lios.factor_risk_capture").invoke(
      { symbols: ["AAPL"], organizationId: 999, ownerUserId: 888 },
      invocationContext(41, 19),
      liveSignal(),
    ),
    (error) => error instanceof z.ZodError,
  );
  assert.equal(enqueueCount, 0);
});

test("scenario MCP tool queues the existing deterministic scenario pipeline kind", async () => {
  const capture: { kind?: string; owner?: CalculationJobOwner } = {};
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async (kind, input, owner) => {
      capture.kind = kind;
      capture.owner = owner;
      return makeJob({ kind, input: input as Record<string, unknown> });
    },
    getCalculationJob: async () => null,
  });

  await handlerById(handlers, "lios.scenario_pipeline").invoke({
    scenarioId: "downside",
    scenarioName: "Downside case",
    financialDatasetSnapshotId: DATASET_ID,
    scenarioAssumptions: { revenueGrowth: -0.1 },
    valuation: {
      discountRate: 0.1,
      terminalGrowth: 0.03,
      netDebt: 100,
      sharesOutstanding: 50,
    },
    factorRiskSnapshotId: "factor-snapshot-1",
    portfolioWeights: { AAPL: 1 },
    factorShocks: { market: -0.2 },
  }, invocationContext(51, null), liveSignal());

  assert.equal(capture.kind, SCENARIO_PIPELINE_CALCULATION_KIND);
  assert.deepEqual(capture.owner, { userId: 51, organizationId: null });
});

test("calculation-job MCP lookup is owner-only and redacts raw job internals", async () => {
  const capture: { scope?: CalculationJobScope } = {};
  const job = makeJob({
    status: "succeeded",
    progressPct: 100,
    result: { traceHash: "abc123", recommendation: "hold" },
    completedAt: new Date("2026-09-04T10:01:00.000Z"),
  });
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async () => job,
    getCalculationJob: async (_id, scope) => {
      capture.scope = scope;
      return job;
    },
  });

  const result = await handlerById(handlers, "lios.calculation_job").invoke(
    { jobId: JOB_ID },
    invocationContext(7, 12),
    liveSignal(),
  ) as Record<string, unknown>;

  assert.deepEqual(capture.scope, { userId: 7, organizationId: 12 });
  assert.equal(capture.scope?.includeOrganization, undefined);
  for (const forbidden of [
    "input",
    "ownerUserId",
    "organizationId",
    "leaseOwner",
    "leaseExpiresAt",
    "retryCount",
    "maxRetries",
    "cancellationRequested",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, forbidden), false, `${forbidden} must remain server-side`);
  }
  assert.deepEqual(result.result, { traceHash: "abc123", recommendation: "hold" });
  assert.equal(result.completedAt, "2026-09-04T10:01:00.000Z");
});

test("safe job projection never exposes raw input or worker ownership metadata", () => {
  const view = financeMCPJobView(makeJob()) as Record<string, unknown>;
  assert.equal("input" in view, false);
  assert.equal("ownerUserId" in view, false);
  assert.equal("organizationId" in view, false);
  assert.equal("leaseOwner" in view, false);
});

test("finance MCP visibility preserves the prior role boundaries through governed descriptors", () => {
  assert.deepEqual(mcpVisibleToolIdsForRole("client_user").sort(), ["lios.macro", "lios.quote"]);
  assert.deepEqual(mcpVisibleToolIdsForRole("client_admin").sort(), ["lios.macro", "lios.quote"]);
  assert.deepEqual(
    mcpVisibleToolIdsForRole("internal_compliance").sort(),
    ["lios.calculation_job", "lios.macro", "lios.quote"],
  );
  assert.deepEqual(
    mcpVisibleToolIdsForRole("internal_analyst").sort(),
    [...FINANCE_MCP_TOOL_IDS, "lios.macro", "lios.quote"].sort(),
  );
  assert.deepEqual(
    mcpVisibleToolIdsForRole("internal_admin").sort(),
    [...FINANCE_MCP_TOOL_IDS, "lios.macro", "lios.quote"].sort(),
  );
  assert.deepEqual(mcpVisibleToolIdsForRole("future_role"), []);
});

test("finance MCP tests contain no legacy MCP-local permission decision", () => {
  const handlers = createFinanceMCPHandlers({
    enqueueCalculationJob: async () => makeJob(),
    getCalculationJob: async () => null,
  });
  assert.equal(handlers.some((handler) => "approvedTools" in handler), false);
  assert.equal(handlers.every((handler) => handler.descriptor.kind === "mcp"), true);
});
