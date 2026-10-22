import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import {
  extractP5JsonObject,
  inferP5AdvancedModelPath,
  p5InputsFromArtifact,
  resolveP5ProfessionalIntents,
} from "./p5ProfessionalWorkflow";
import { REPORT_TEMPLATES } from "./reportEngine";
import { resolveConversationCapabilities } from "./conversationCapabilityResolver";

test("P5 routes named institutional model families without module selection", () => {
  const cases = [
    ["Run a reverse DCF", "valuation/reverse-dcf"],
    ["Run a DCF sensitivity with WACC by terminal growth", "valuation/dcf-sensitivity"],
    ["Build a Black-Litterman portfolio", "portfolio/black-litterman"],
    ["Calculate key-rate DV01", "fixed-income/key-rate-risk"],
    ["Run Black-Scholes Greeks", "derivatives/black-scholes-greeks"],
    ["Estimate recession probability", "macro/recession-probability"],
    ["Compare filings", "research/filing-diff"],
    ["Build a three-statement model", "financial-modeling/three-statement"],
  ] as const;
  for (const [message, expected] of cases) {
    assert.equal(inferP5AdvancedModelPath(message), expected, message);
  }
});

test("P5 parses explicit fenced JSON inputs without inventing assumptions", () => {
  const parsed = extractP5JsonObject(`Run reverse DCF with:
\`\`\`json
{"parameters":{"shares":100,"currentPrice":25},"modelPath":"valuation/reverse-dcf"}
\`\`\``);
  assert.deepEqual(parsed, {
    parameters: { shares: 100, currentPrice: 25 },
    modelPath: "valuation/reverse-dcf",
  });
});

test("P5 leaves conceptual questions to the model wherever the question words appear, but still runs explicit calculations", () => {
  const intentsFor = (message: string) => resolveP5ProfessionalIntents(conversationRequestSchema.parse({ requestId: "33333333-3333-4333-8333-333333333333", message, sourceScope: "auto" }));
  assert.equal(intentsFor("In two sentences, what is bond duration?").length, 0);
  assert.equal(intentsFor("Briefly describe the difference between convexity and duration").length, 0);
  assert.equal(intentsFor("What is the duration of a 10 year 5% bond").some(item => item.family === "fixed_income"), true, "Explicit figures keep engine routing.");
  assert.equal(intentsFor("Calculate bond duration").some(item => item.family === "fixed_income"), true, "A command verb keeps engine routing.");
});

test("P5 resolves cross-asset professional intents and preserves active Artifact context", () => {
  const artifactId = "artifact:11111111-1111-4111-8111-111111111111";
  const request = conversationRequestSchema.parse({
    requestId: "22222222-2222-4222-8222-222222222222",
    message: "Create a risk report from this artifact",
    sourceScope: "my_data",
    context: { activeObjectRefs: [artifactId] },
  });
  const intents = resolveP5ProfessionalIntents(request);
  assert.equal(intents.some((item) => item.family === "research_reporting"), true);
  assert.equal(intents.find((item) => item.family === "research_reporting")?.activeArtifactRef, artifactId);
});

test("all contextual report templates plan only assembly even with company or DCF cues", () => {
  const artifactId = "artifact:11111111-1111-4111-8111-111111111111";
  for (const template of REPORT_TEMPLATES) {
    const request = conversationRequestSchema.parse({
      requestId: "22222222-2222-4222-8222-222222222222",
      message: `Create ${template.name} from this Artifact for AAPL`,
      sourceScope: "my_data",
      context: { activeObjectRefs: [artifactId], symbol: "AAPL" },
    });
    const intents = resolveP5ProfessionalIntents(request);
    assert.equal(intents.length, 1, template.name);
    assert.equal(intents[0].requiresEntity, false);
    assert.equal(intents[0].modelPath, null);
    assert.deepEqual(intents[0].parameters, { templateId: template.id, templateSelectionError: null });
    const capabilities = resolveConversationCapabilities(request);
    assert.deepEqual(capabilities.map((item) => item.id), ["research.report"], template.name);
    assert.equal(capabilities[0].availability, "ready");
    assert.deepEqual(capabilities[0].missingInputs, []);
    assert.deepEqual(capabilities[0].parameters.modelParameters, intents[0].parameters);
  }
});

test("contextual ambiguous or unsupported templates preserve visible selection errors", () => {
  for (const message of [
    "Create a Risk Report and Investment Memo from this Artifact",
    "Create a liquidity report from this Artifact",
  ]) {
    const intents = resolveP5ProfessionalIntents(conversationRequestSchema.parse({
      requestId: "22222222-2222-4222-8222-222222222222",
      message,
      sourceScope: "my_data",
      context: { activeObjectRefs: ["artifact:11111111-1111-4111-8111-111111111111"] },
    }));
    assert.equal(intents.length, 1);
    assert.equal(intents[0].parameters?.templateId, null);
    assert.equal(typeof intents[0].parameters?.templateSelectionError, "string");
  }
});

test("outside an active Artifact company research and deterministic valuation stay unchanged", () => {
  const research = resolveP5ProfessionalIntents(conversationRequestSchema.parse({
    requestId: "22222222-2222-4222-8222-222222222222",
    message: "Create an investment memo for AAPL",
  }));
  assert.ok(research.some((intent) => intent.capabilityId === "company.research" && intent.requiresEntity));
  const valuation = resolveP5ProfessionalIntents(conversationRequestSchema.parse({
    requestId: "22222222-2222-4222-8222-222222222222",
    message: "Run reverse DCF for AAPL",
  }));
  assert.equal(valuation[0].modelPath, "valuation/reverse-dcf");
  assert.equal(valuation[0].requiresEntity, true);
});

test("P5 advanced rerun recovers model path and assumptions from a versioned Valuation Artifact", () => {
  const content = artifactContentSchema.parse({
    kind: "valuation",
    symbol: "AAPL",
    modelId: "lios.valuation.reverse-dcf-v1",
    assumptions: { shares: 100, currentPrice: 25 },
    outputs: { impliedGrowth: 0.08 },
    summary: {
      modelPath: "valuation/reverse-dcf",
      modelVersion: "1.0.0",
      outputSnapshotHash: "a".repeat(64),
    },
  });
  const inputs = p5InputsFromArtifact(content, null);
  assert.equal(inputs.modelPath, "valuation/reverse-dcf");
  assert.deepEqual(inputs.parameters, { shares: 100, currentPrice: 25 });
  assert.equal(inputs.inputProvenance?.dataClassification, "model_derived");
});

test("P5 generic family requests remain readiness intents until a concrete model is selected", () => {
  const request = conversationRequestSchema.parse({
    requestId: "33333333-3333-4333-8333-333333333333",
    message: "Run bond analytics and duration analysis",
  });
  const intents = resolveP5ProfessionalIntents(request);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].family, "fixed_income");
  assert.equal(intents[0].modelPath, null);
  assert.equal(intents[0].requiresEntity, false);
});

test("P5 accepts explicit DCF sensitivity JSON without inventing model inputs", () => {
  const request = conversationRequestSchema.parse({
    requestId: "55555555-5555-4555-8555-555555555555",
    message: 'Run DCF sensitivity for AAPL {"modelPath":"valuation/dcf-sensitivity","parameters":{"freeCashFlows":[100,110,120],"waccPct":10,"terminalMethod":"gordon_growth","terminalGrowthPct":3,"netDebt":50,"sharesOutstanding":10,"waccGridPct":[9,10,11],"terminalGrowthGridPct":[2,3,4],"bearCase":{"freeCashFlows":[90,95,100],"waccPct":11,"terminalMethod":"gordon_growth","terminalGrowthPct":2},"bullCase":{"freeCashFlows":[110,125,140],"waccPct":9,"terminalMethod":"gordon_growth","terminalGrowthPct":4}}}',
  });
  const intents = resolveP5ProfessionalIntents(request);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].modelPath, "valuation/dcf-sensitivity");
  assert.equal(intents[0].parameters?.waccPct, 10);
  assert.equal(intents[0].requiresEntity, true);
});

test("an explicit complete parameter object is not attributed to an unused selected Artifact", () => {
  const req = conversationRequestSchema.parse({
    requestId: "11111111-1111-4111-8111-111111111111",
    message: 'Run reverse DCF for AAPL {"modelPath":"valuation/reverse-dcf","parameters":{"currentRevenue":100,"marketEquityValue":100,"netDebt":0,"waccPct":10,"terminalGrowthPct":2,"ebitMarginPct":20,"taxRatePct":20,"reinvestmentRatePct":10,"years":5,"solveFor":"revenue_growth"}}',
    context: { activeObjectRefs: ["artifact:22222222-2222-4222-8222-222222222222"] },
  });
  const intent = resolveP5ProfessionalIntents(req).find(item => item.modelPath === "valuation/reverse-dcf");
  assert.ok(intent?.parameters);
  assert.equal(intent.activeArtifactRef, null);
});
