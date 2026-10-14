import assert from "node:assert/strict";
import test from "node:test";
import {
  executeConversationRuntime,
  planConversationWorkflow,
  getConversationTool,
  registerConversationTool,
} from "./conversationRuntime";
import type { OHLCVBar, Quote } from "./marketData";
import { createAttribution } from "./byoaiRouter";
import { normalizeConversationDraft } from "./artifactDiff";
import { REPORT_TEMPLATES } from "./reportEngine";

function canonicalFixtureTool(toolId: string) {
  const tool = getConversationTool(toolId);
  assert.ok(tool, `Missing canonical governed tool fixture source: ${toolId}`);
  return tool;
}

function bars(): OHLCVBar[] {
  return Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.25 + Math.sin(index / 5) * 2;
    return {
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000 + index * 1_000,
    };
  });
}

function quote(): Quote {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 215,
    change: 2,
    changePercent: 0.94,
    volume: 48_000_000,
    marketCap: 3_200_000_000_000,
    pe: 31.2,
    eps: 6.9,
    revenue: 395_000_000_000,
    high52: 230,
    low52: 165,
    open: 213,
    previousClose: 213,
    dayHigh: 216,
    dayLow: 211,
    avgVolume: 52_000_000,
    exchange: "NASDAQ",
    sector: "Technology",
    quoteSource: "test-market",
    isLive: false,
    status: {
      provider: "Limuria Intelligence",
      freshness: "delayed",
      asOf: "2026-09-26T00:00:00.000Z",
      delayLabel: "Delayed fixture",
      isFallback: false,
    },
    currency: "$",
    entitlement: {
      state: "delayed_available",
      servedTier: "delayed",
      bestAvailableTier: "delayed",
      entitlementRequired: false,
      upgradeConnectorId: null,
      upgradeConnectorLabel: null,
      reason: "test fixture",
    },
  };
}


function p5StatementReport(reportType: "income" | "balance" | "cashflow", data: Record<string, number>) {
  return {
    symbol: "AAPL",
    report_type: reportType,
    date: "2026-09-25",
    fiscal_year: "2026",
    period: "FY",
    reported_currency: "USD",
    filing_date: "2026-09-25",
    data: JSON.stringify(data),
  };
}

function p5StatementResolution(reportType: "income" | "balance" | "cashflow", data: Record<string, number>, conflicts: any[] = []) {
  const report = p5StatementReport(reportType, data);
  return {
    capability: "financial_statements",
    entity: "AAPL",
    authoritative: { providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: [report] },
    observations: [
      { providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: [report] },
    ],
    attemptedProviders: ["sec_edgar"],
    failures: [],
    conflicts,
    authoritativeReason: "SEC EDGAR ranked highest among providers that returned data.",
    resolvedAt: "2026-09-26T10:00:00.000Z",
  };
}

function installP5CompanyFixtures(capture?: { identityInput?: Record<string, unknown> }) {
  installBundleFixtures();
  registerConversationTool({
    ...canonicalFixtureTool("lios.instrument-master"),
    label: "Fixture instrument master",
    invoke: async (input) => {
      if (capture) capture.identityInput = input;
      return {
        output: {
          entityId: "lios:entity:apple",
          listingId: "lios:listing:aapl",
          symbol: "AAPL",
          name: "Apple Inc.",
          canonical: true,
        },
        summary: "Apple → AAPL",
        deterministic: true,
        sourceRefs: ["fixture:instrument-master"],
      };
    },
  });
  registerConversationTool({
    ...canonicalFixtureTool("lios.company-intelligence"),
    label: "Fixture company intelligence",
    invoke: async () => {
      const conflict = {
        key: "income:2026:FY",
        field: "revenue",
        material: true,
        values: [
          { providerId: "sec_edgar", value: 420_000_000_000 },
          { providerId: "finnhub", value: 410_000_000_000 },
        ],
      };
      return {
        output: {
          income: p5StatementResolution("income", { revenue: 420_000_000_000, netIncome: 110_000_000_000 }, [conflict]),
          balance: p5StatementResolution("balance", { totalAssets: 370_000_000_000, cash: 60_000_000_000 }),
          cashflow: p5StatementResolution("cashflow", { operatingCashFlow: 130_000_000_000, freeCashFlow: 105_000_000_000 }),
          sourceRefs: ["provider:sec_edgar", "provider:finnhub"],
          warnings: ["1 income statement conflict(s) preserved for review."],
        },
        summary: "FY statements resolved with one preserved provider conflict.",
        deterministic: false,
        sourceRefs: ["provider:sec_edgar", "provider:finnhub"],
      };
    },
  });
}

function installBundleFixtures() {
  const history = bars();
  registerConversationTool({
    ...canonicalFixtureTool("lios.instrument-master"),
    label: "Fixture instrument master",
    invoke: async () => ({
      output: {
        entityId: "lios:entity:1",
        listingId: "lios:listing:1",
        symbol: "AAPL",
        name: "Apple Inc.",
        canonical: true,
      },
      summary: "Apple → AAPL",
      deterministic: true,
      sourceRefs: ["fixture:instrument-master"],
    }),
  });
  registerConversationTool({
    ...canonicalFixtureTool("lios.market-data"),
    label: "Fixture market data",
    invoke: async () => ({
      output: { quote: quote(), bars: history },
      summary: `${history.length} fixture bars`,
      deterministic: false,
      sourceRefs: ["fixture:market-data"],
    }),
  });
  registerConversationTool({
    ...canonicalFixtureTool("lios.finance.technical"),
    label: "Fixture technical engine",
    invoke: async () => ({
      output: {
        rsi14: 58.4,
        macdHistogram: 0.42,
        macdCrossover: "bullish",
        support20: 121,
        resistance20: 132,
      },
      summary: "RSI, MACD and support/resistance calculated",
      deterministic: true,
      sourceRefs: ["fixture:market-data", "engine:technical"],
    }),
  });
}

test("Legacy research phrasing converges to the active P5 professional DAG", () => {
  const plan = planConversationWorkflow({
    requestId: "b09e4e6c-43f7-44e5-9164-8fd1eafcd44d",
    message: "Research Apple",
    executionMode: "deterministic_first",
  });
  assert.equal(plan.intent.parameters.workflow, "p5_professional_bundle");
  assert.deepEqual(plan.capabilities.map((item) => item.id), ["company.research"]);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    "resolve-security",
    "retrieve-market-data",
    "retrieve-financial-statements",
    "calculate-research-technicals",
    "emit-company-research-artifact",
    "emit-research-report-artifact",
  ]);
});

test("contextual report display phrases converge to one governed assembler DAG without provider or model work", () => {
  for (const template of REPORT_TEMPLATES) {
    const plan = planConversationWorkflow({
      requestId: "b09e4e6c-43f7-44e5-9164-8fd1eafcd44d",
      message: `Create ${template.name} from this Artifact for AAPL`,
      executionMode: "deterministic_first",
      sourceScope: "my_data",
      context: { activeObjectRefs: ["artifact:11111111-1111-4111-8111-111111111111"], symbol: "AAPL" },
    });
    assert.equal(plan.intent.parameters.workflow, "p5_professional_bundle");
    assert.deepEqual(plan.capabilities.map((capability) => capability.id), ["research.report"]);
    assert.deepEqual(plan.capabilities[0].parameters.modelParameters, { templateId: template.id, templateSelectionError: null });
    assert.deepEqual(plan.steps.map((step) => step.componentId), ["lios.p5.report-assembler"]);
    assert.equal(plan.steps.some((step) => /research-report|market|python|finance|instrument-master/.test(step.componentId ?? "")), false);
  }
});

test("P2 multi-capability plan preflights backtest approval before any tool execution", async () => {
  installBundleFixtures();
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 9,
    projectId: null,
    history: [],
    request: {
      requestId: "3df72c46-69a6-48be-afca-af4499a1835a",
      message: "Analyze AAPL, show technicals, and backtest RSI strategy",
      executionMode: "deterministic_first",
      approvals: [],
      sourceScope: "auto",
    },
    emit: (event) => { events.push(event); },
  });

  assert.equal(result.awaitingApproval, true);
  assert.equal(events.some((event) => event.type === "approval_required" && event.action === "RunBacktest"), true);
  assert.equal(events.some((event) => event.type === "tool_start"), false);
});

test("P2 approved multi-capability plan shares identity/data work and returns multiple work products", async () => {
  installBundleFixtures();
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 10,
    projectId: null,
    history: [],
    request: {
      requestId: "c3bf9360-d8e9-4864-b578-b55a25d6a49c",
      message: "Analyze AAPL, show technicals, and backtest RSI strategy",
      executionMode: "deterministic_first",
      approvals: [{ action: "RunBacktest", scope: "once" }],
      sourceScope: "auto",
    },
    emit: (event) => { events.push(event); },
  });

  assert.equal(result.awaitingApproval, false);
  assert.deepEqual(result.plan.capabilities.map((item) => item.id), [
    "strategy.backtest",
    "market.technical",
    "security.overview",
  ]);
  assert.equal(result.receiptIds.length, 2);
  assert.equal(result.artifacts.length, 2);
  assert.match(result.text, /deterministic security overview/i);
  assert.match(result.text, /historical simulation/i);

  const starts = events.filter((event) => event.type === "tool_start").map((event) => event.stepId);
  assert.equal(starts.filter((stepId) => stepId === "resolve-security").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "retrieve-market-data").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "calculate-technical").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "run-backtest").length, 1);
});

test("P2 capability bundle respects source scope before tools or approvals", async () => {
  installBundleFixtures();
  const events: any[] = [];
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 11,
    projectId: null,
    history: [],
    request: {
      requestId: "253faaf9-b680-4e8a-812f-df65e9c551a5",
      message: "Analyze AAPL, show technicals, and backtest RSI strategy",
      executionMode: "deterministic_first",
      approvals: [],
      sourceScope: "my_data",
    },
    emit: (event) => { events.push(event); },
  }), /does not permit external\/connected market data/);

  assert.equal(events.some((event) => event.type === "data_gap" && event.gap?.field === "source_scope"), true);
  assert.equal(events.some((event) => event.type === "approval_required"), false);
  assert.equal(events.some((event) => event.type === "tool_start"), false);
});


test("P2 deterministic engine capability emits structured missing-input recovery instead of manual module delegation", async () => {
  const events: any[] = [];
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 12,
    projectId: null,
    history: [],
    request: {
      requestId: "ecbd8e4e-8628-47c8-9cff-89739e1831aa",
      message: "Run a DCF valuation for AAPL",
      executionMode: "deterministic_first",
      sourceScope: "auto",
    },
    emit: (event) => { events.push(event); },
  }), /requires explicit deterministic model inputs/);

  const planEvent = events.find((event) => event.type === "plan");
  assert.equal(planEvent?.plan?.capabilities?.[0]?.id, "company.valuation");
  assert.equal(planEvent?.plan?.capabilities?.[0]?.availability, "needs_input");
  assert.equal(events.some((event) => event.type === "data_gap" && event.gap?.field === "professional_model_inputs"), true);
  assert.equal(events.some((event) => event.type === "tool_start"), false);
});

test("P2 AI-assisted synthesis preserves multi-capability deterministic work products as authoritative", async () => {
  installBundleFixtures();
  const events: any[] = [];
  let capturedPrompt = "";
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 13,
    projectId: null,
    history: [],
    request: {
      requestId: "35d617f3-c1c1-4d66-b9fd-6c73aa74140c",
      message: "Analyze AAPL, show technicals, and backtest RSI strategy",
      executionMode: "ai_assisted",
      approvals: [{ action: "RunBacktest", scope: "once" }],
      sourceScope: "auto",
    },
    aiCompletion: async (input) => {
      capturedPrompt = input.messages.map((message) => message.content).join("\n");
      return {
        provider: "openai",
        model: "test-model",
        text: "The deterministic overview and backtest are summarized without changing their calculations.",
        attribution: createAttribution({
          provider: "openai",
          model: "test-model",
          prompt: "fixture",
          output: "The deterministic overview and backtest are summarized without changing their calculations.",
        }),
      };
    },
    emit: (event) => { events.push(event); },
  });

  assert.equal(result.label, "ai_derived");
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.receiptIds.length, 3);
  assert.match(capturedPrompt, /Authoritative deterministic LiOS result/);
  assert.match(capturedPrompt, /deterministic security overview/i);
  assert.match(capturedPrompt, /historical simulation/i);
  assert.match(result.text, /### AI synthesis/);
  assert.equal(events.some((event) => event.type === "tool_result" && event.stepId === "ai-synthesis"), true);
});


test("P2 AI synthesis remains available when provider tool calling is disabled", async () => {
  installBundleFixtures();
  let capturedSystem = "";
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 14,
    projectId: null,
    history: [],
    request: {
      requestId: "86187ae8-c553-452e-b823-dd93258bc909",
      message: "Research AAPL",
      executionMode: "ai_assisted",
      sourceScope: "auto",
      transmissionPolicy: {
        allowToolCalling: false,
      },
    },
    aiCompletion: async (input) => {
      capturedSystem = input.system ?? "";
      return {
        provider: "openai",
        model: "test-model",
        text: "Interpretation only; no provider tool calls were used.",
        attribution: createAttribution({
          provider: "openai",
          model: "test-model",
          prompt: "fixture",
          output: "Interpretation only; no provider tool calls were used.",
        }),
      };
    },
    emit: () => {},
  });

  assert.equal(result.label, "ai_derived");
  assert.match(capturedSystem, /Project policy forbids AI tool-calling/);
  assert.match(result.text, /Interpretation only/);
});


test("P2 security-overview and backtest drafts remain keepable by the canonical Artifact OS bridge", async () => {
  installBundleFixtures();
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "project",
    chatId: 15,
    projectId: 21,
    projectName: "Apple Research",
    history: [],
    request: {
      requestId: "8d9d8151-dde2-4537-b0c8-1f70d0aa74ca",
      message: "Analyze AAPL and backtest RSI strategy",
      executionMode: "deterministic_first",
      approvals: [{ action: "RunBacktest", scope: "once" }],
      sourceScope: "auto",
    },
    emit: () => {},
  });

  assert.equal(result.artifacts.length, 2);
  const normalized = result.artifacts.map((draft) => normalizeConversationDraft(draft));
  assert.deepEqual(normalized.map((content) => content.kind).sort(), ["backtest", "screen"]);
});


test("P5A planner turns Research Apple into one shared professional DAG", () => {
  const plan = planConversationWorkflow({
    requestId: "b09e4e6c-43f7-44e5-9164-8fd1eafcd44d",
    message: "Research Apple",
    executionMode: "deterministic_first",
    sourceScope: "auto",
  });
  assert.equal(plan.intent.parameters.workflow, "p5_professional_bundle");
  assert.deepEqual(plan.capabilities.map((item) => item.id), ["company.research"]);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    "resolve-security",
    "retrieve-market-data",
    "retrieve-financial-statements",
    "calculate-research-technicals",
    "emit-company-research-artifact",
    "emit-research-report-artifact",
  ]);
  assert.equal(plan.budget.maxSteps >= plan.steps.length, true);
});

test("P5A Research Apple executes shared identity, market, statements and trusted Artifacts end to end", async () => {
  const capture: { identityInput?: Record<string, unknown> } = {};
  installP5CompanyFixtures(capture);
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "project",
    chatId: 51,
    projectId: 21,
    projectName: "Apple Research",
    history: [],
    request: {
      requestId: "5dbe7c8e-6537-4909-844f-938846f49780",
      message: "Research Apple",
      executionMode: "deterministic_first",
      sourceScope: "auto",
    },
    emit: (event) => { events.push(event); },
  });

  assert.deepEqual(capture.identityInput, { name: "Apple" });
  assert.equal(result.plan.intent.parameters.workflow, "p5_professional_bundle");
  assert.equal(result.receiptIds.length, 1);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.artifactType), ["research", "report"]);
  assert.match(result.text, /professional research/i);
  assert.match(result.text, /warnings\/conflicts: 1/i);
  assert.equal(result.trustManifest?.summary.receiptCount, 1);

  const starts = events.filter((event) => event.type === "tool_start").map((event) => event.stepId);
  assert.equal(starts.filter((stepId) => stepId === "resolve-security").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "retrieve-market-data").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "retrieve-financial-statements").length, 1);
  assert.equal(starts.filter((stepId) => stepId === "calculate-research-technicals").length, 1);
  assert.equal(events.some((event) => event.type === "trust"), true);
});

test("P5 valuation awaiting model inputs does not cancel the ready research bundle in the same request", async () => {
  installP5CompanyFixtures({});
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "project",
    chatId: 52,
    projectId: 22,
    projectName: "Apple Research",
    history: [],
    request: {
      requestId: "0c2f1a52-6c3b-4f0e-9d6f-2f4d3b8f6a11",
      message: "Analyze Apple: key fundamentals, technicals and a valuation",
      executionMode: "deterministic_first",
      sourceScope: "auto",
    },
    emit: (event) => { events.push(event); },
  });

  assert.deepEqual(result.artifacts.map((artifact) => artifact.artifactType), ["research", "report"]);
  assert.equal(result.receiptIds.length >= 1, true);
  assert.match(result.text, /Professional inputs still required/);
  assert.match(result.text, /Valuation/i);
  assert.match(result.text, /did not invent assumptions/i);
  assert.equal(events.some((event) => event.type === "error"), false);
  assert.equal(events.some((event) => event.type === "tool_start" && event.stepId === "resolve-security"), true);
});

test("P5 generic valuation remains a visible readiness workflow instead of guessing assumptions", () => {
  const plan = planConversationWorkflow({
    requestId: "73736988-b765-4078-becd-fbdc84ac93a7",
    message: "Value AAPL",
    executionMode: "deterministic_first",
    sourceScope: "auto",
  });
  assert.equal(plan.intent.parameters.workflow, "p5_professional_bundle");
  assert.deepEqual(plan.capabilities.map((item) => item.id), ["company.valuation"]);
  assert.equal(plan.capabilities[0].availability, "needs_input");
  assert.equal(plan.steps.some((step) => step.id === "run-professional-company-valuation" && /Validate inputs/.test(step.label)), true);
});

test("P5 explicit derivatives model becomes a deterministic professional run plus Artifact step", () => {
  const plan = planConversationWorkflow({
    requestId: "4899d94d-381f-4e55-b8c9-f6457446aad2",
    message: 'Run Black-Scholes Greeks {"spot":100,"strike":105,"rate":0.05,"volatility":0.2,"maturity":1}',
    executionMode: "deterministic_first",
    sourceScope: "auto",
  });
  assert.deepEqual(plan.capabilities.map((item) => item.id), ["derivatives.analytics"]);
  assert.equal(plan.capabilities[0].availability, "ready");
  assert.equal(plan.steps.some((step) => step.componentId === "python.advanced.derivatives.black-scholes-greeks"), true);
  assert.equal(plan.steps.some((step) => step.id === "emit-professional-derivatives-analytics-artifact"), true);
});


test("P5C personal finance Artifact reconciles to its deterministic receipt and canonical P4 exports", async () => {
  const personalFinance = {
    schemaVersion: "1" as const,
    asOf: "2026-09-26",
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
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: 1, role: "client_user" },
    scope: "project",
    chatId: 91,
    projectId: 21,
    projectName: "Household",
    history: [],
    request: {
      requestId: "6783a8af-f264-4991-b535-9ad1d2e4e4b9",
      message: "Calculate my personal finances",
      executionMode: "deterministic_first",
      sourceScope: "my_data",
      context: { personalFinance },
    },
    emit: (event) => { events.push(event); },
  });

  const receipt = events.find((event) => event.type === "receipt")?.receipt;
  assert.equal(Boolean(receipt), true);
  assert.equal(result.artifacts[0]?.artifactType, "personal-finance.decision");
  const decision = result.artifacts[0]?.data;
  if (!decision || decision.kind !== "decision") throw new Error("Expected personal-finance Decision Artifact.");
  const reconciliation = decision.assumptions.professionalReconciliation as Record<string, unknown>;
  const exportProfile = decision.assumptions.professionalExport as { authority: string; formats: string[] };
  assert.equal(reconciliation.inputHash, receipt.inputHash);
  assert.equal(reconciliation.outputHash, receipt.outputHash);
  assert.equal(reconciliation.calculatorOfRecord, "lios.personal-finance.core-v1");
  assert.equal(exportProfile.authority, "p4_artifact_export_plan");
  assert.equal(exportProfile.formats.includes("pdf"), true);
  assert.equal(exportProfile.formats.includes("pptx"), true);
  assert.equal(result.artifacts[0]?.persistence, "project_candidate");
});
