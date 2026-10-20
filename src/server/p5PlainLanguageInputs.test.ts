import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import { advancedQuantInputProvenanceSchema, resolveAdvancedQuantInputProvenance } from "@shared/quantModelRegistry";
import {
  P5_MANUAL_ASSUMPTIONS_LABEL,
  buildP5GuidedInputs,
  formatP5GuidedAssumptionsMessage,
  validateP5GuidedValues,
} from "@shared/p5GuidedInputs";
import { resolveConversationCapabilities } from "./conversationCapabilityResolver";
import { describeP5InputGap } from "./p5ProfessionalWorkflow";
import { extractP5PlainLanguageInputs, type P5PlainLanguageGap } from "./p5PlainLanguageInputs";

function request(message: string) {
  return conversationRequestSchema.parse({ requestId: crypto.randomUUID(), message });
}

const JSON_MESSAGE = 'Run DCF sensitivity for AAPL {"modelPath":"valuation/dcf-sensitivity","parameters":{"freeCashFlows":[100,110,120],"waccPct":10,"terminalMethod":"gordon_growth","terminalGrowthPct":3,"netDebt":50,"sharesOutstanding":10,"waccGridPct":[9,10,11],"terminalGrowthGridPct":[2,3,4],"bearCase":{"freeCashFlows":[90,95,100],"waccPct":11,"terminalMethod":"gordon_growth","terminalGrowthPct":2},"bullCase":{"freeCashFlows":[110,125,140],"waccPct":9,"terminalMethod":"gordon_growth","terminalGrowthPct":4}}}';

const PLAIN_MESSAGE = [
  "Run a DCF sensitivity for AAPL.",
  "Free cash flows are 100, 110 and 120. WACC is 10%, terminal growth is 3%, net debt is 50 and shares outstanding is 10.",
  "WACC grid: 9%, 10%, 11%. Terminal growth grid: 2%, 3%, 4%.",
  "Bear case: free cash flows 90, 95, 100; WACC 11%; terminal growth 2%.",
  "Bull case: free cash flows 110, 125, 140; WACC 9%; terminal growth 4%.",
].join("\n");

function valuation(message: string) {
  const capabilities = resolveConversationCapabilities(request(message));
  assert.deepEqual(capabilities.map((item) => item.id), ["company.valuation"], message);
  return capabilities[0];
}

function gapOf(message: string): P5PlainLanguageGap {
  const extraction = extractP5PlainLanguageInputs(message, "valuation/dcf-sensitivity");
  assert.ok(extraction && extraction.status === "incomplete");
  return extraction.gap;
}

test("complete plain-language assumptions produce the same parameters as the expert JSON path", () => {
  const fromJson = valuation(JSON_MESSAGE);
  const fromText = valuation(PLAIN_MESSAGE);
  assert.equal(fromText.availability, "ready");
  assert.deepEqual(fromText.missingInputs, []);
  assert.equal(fromText.parameters.modelPath, "valuation/dcf-sensitivity");
  assert.deepEqual(fromText.parameters.modelParameters, fromJson.parameters.modelParameters);
  assert.equal(fromText.parameters.inputGap, null);
});

test("plain-language assumptions carry manual provenance with the exact user text and unchanged parameters", () => {
  const capability = valuation(PLAIN_MESSAGE);
  const parameters = capability.parameters.modelParameters as Record<string, unknown>;
  const provenance = advancedQuantInputProvenanceSchema.parse(capability.parameters.inputProvenance);
  assert.equal(provenance.dataClassification, "manual");
  assert.deepEqual(provenance.manualInputs, parameters);
  assert.ok(provenance.transformations[0].startsWith(P5_MANUAL_ASSUMPTIONS_LABEL));
  const verbatim = provenance.transformations.filter((line) => line.startsWith("Verbatim assumptions you wrote")).map((line) => line.slice(line.indexOf("): ") + 3));
  assert.equal(verbatim.join(""), PLAIN_MESSAGE);
  // The engine accepts this provenance exactly as it accepts the JSON path's.
  const resolved = resolveAdvancedQuantInputProvenance(parameters, provenance);
  assert.equal(resolved.success, true);
});

test("percent words, ranges and a first-year cash flow with growth normalize to the same shape", () => {
  const message = [
    "Run a DCF sensitivity for AAPL.",
    "First-year free cash flow 100 growing 10% per year for 3 years. WACC 10 percent, terminal growth 3 per cent, net debt of 50 and 10 shares outstanding.",
    "WACC from 9% to 11% in steps of 1%. Terminal growth sensitivity: 2%, 3%, 4%.",
    "Bear case: free cash flows 90, 95, 100; WACC 11%; terminal growth 2%.",
    "Bull case: free cash flows 110, 125, 140; WACC 9%; terminal growth 4%.",
  ].join("\n");
  const capability = valuation(message);
  assert.equal(capability.availability, "ready");
  const expected = valuation(JSON_MESSAGE).parameters.modelParameters as Record<string, unknown>;
  assert.deepEqual(capability.parameters.modelParameters, { ...expected, freeCashFlows: [100, 110, 121] });
  const provenance = advancedQuantInputProvenanceSchema.parse(capability.parameters.inputProvenance);
  assert.ok(provenance.transformations.some((line) => line.includes("100, 110, 121")), "derived cash flows are disclosed");
});

test("the expert JSON path is unchanged and never reads plain-language text", () => {
  const capability = valuation(JSON_MESSAGE);
  assert.equal(capability.availability, "ready");
  assert.equal(capability.parameters.inputProvenance, undefined);
  assert.equal(capability.parameters.inputGap, null);
});

test("missing assumptions return a precise gap and nothing is invented", () => {
  const capability = valuation("Run a DCF sensitivity for AAPL. WACC 10%, terminal growth 3%.");
  assert.equal(capability.availability, "needs_input");
  assert.equal(capability.parameters.modelParameters, null);
  assert.equal(capability.parameters.inputProvenance, undefined);
  assert.ok(capability.missingInputs.includes("structured_model_inputs_or_active_artifact"));
  for (const key of ["freeCashFlows", "netDebt", "sharesOutstanding", "waccGridPct", "terminalGrowthGridPct", "bearCase.freeCashFlows", "bullCase.terminalGrowthPct"]) {
    assert.ok(capability.missingInputs.includes("model_input:" + key), key);
  }
  assert.equal(capability.missingInputs.includes("model_input:waccPct"), false);
  assert.equal(capability.missingInputs.includes("model_input:terminalGrowthPct"), false);
  const gap = capability.parameters.inputGap as P5PlainLanguageGap;
  assert.equal(gap.provided.waccPct, "10");
  assert.equal(gap.provided.terminalGrowthPct, "3");
  assert.equal(gap.provided.netDebt, undefined, "an unstated value is never defaulted");
  assert.deepEqual(gap.issues, []);
});

test("a request with no assumptions lists every required input", () => {
  const gap = gapOf("Run a DCF sensitivity for AAPL");
  assert.equal(gap.missing.length, 13);
  assert.deepEqual(gap.provided, {});
});

test("a bare percentage without a percent sign is refused, never guessed", () => {
  const message = PLAIN_MESSAGE.replace("WACC is 10%,", "WACC is 10,");
  const capability = valuation(message);
  assert.equal(capability.availability, "needs_input");
  assert.equal(capability.parameters.modelParameters, null);
  const gap = capability.parameters.inputGap as P5PlainLanguageGap;
  assert.ok(gap.issues.some((issue) => issue.key === "waccPct" && /percent sign/.test(issue.message)));
  assert.equal(gap.missing.includes("waccPct"), false, "an unclear value is reported as unclear, not as absent");
  assert.equal(gap.provided.waccPct, undefined);
  assert.ok(capability.missingInputs.includes("model_input:waccPct"));
});

test("decimal fractions, scale suffixes, thousands separators and value lists are refused as ambiguous", () => {
  const cases: Array<[string, string, RegExp]> = [
    [PLAIN_MESSAGE.replace("WACC is 10%,", "WACC is 0.10,"), "waccPct", /percent sign/],
    [PLAIN_MESSAGE.replace("net debt is 50", "net debt is 50m"), "netDebt", /scale suffix/],
    [PLAIN_MESSAGE.replace("shares outstanding is 10", "shares outstanding is 10 million"), "sharesOutstanding", /scale suffix/],
    [PLAIN_MESSAGE.replace("100, 110 and 120", "100m, 110m and 120m"), "freeCashFlows", /scale suffix/],
    [PLAIN_MESSAGE.replace("100, 110 and 120", "1,000, 1,100 and 1,200"), "_general", /commas/],
    [PLAIN_MESSAGE.replace("WACC is 10%,", "WACC is 10%, 11%,"), "waccPct", /list of values/],
    [PLAIN_MESSAGE.replace("WACC grid: 9%, 10%, 11%", "WACC grid: 9, 10, 11"), "waccGridPct", /percent sign/],
    [PLAIN_MESSAGE.replace("100, 110 and 120", "100, 110 and 120 over 5 years"), "freeCashFlows", /horizon/],
  ];
  for (const [message, key, pattern] of cases) {
    const capability = valuation(message);
    assert.equal(capability.availability, "needs_input", message);
    assert.equal(capability.parameters.modelParameters, null, message);
    const gap = capability.parameters.inputGap as P5PlainLanguageGap;
    assert.ok(gap.issues.some((issue) => issue.key === key && pattern.test(issue.message)), `${key}: ${JSON.stringify(gap.issues)}`);
  }
});

test("conflicting repeats of one assumption are refused", () => {
  const capability = valuation(PLAIN_MESSAGE + "\nActually WACC is 9%.");
  assert.equal(capability.availability, "needs_input");
  const gap = capability.parameters.inputGap as P5PlainLanguageGap;
  assert.ok(gap.issues.some((issue) => issue.key === "waccPct" && /Conflicting/.test(issue.message)));
});

test("a first-year cash flow without growth and horizon stays incomplete instead of inventing a path", () => {
  const gap = gapOf(PLAIN_MESSAGE.replace("Free cash flows are 100, 110 and 120.", "First-year free cash flow 100."));
  assert.ok(gap.missing.includes("freeCashFlows"));
  assert.ok(gap.notes.some((note) => /growth rate .* horizon/.test(note)));
});

test("a case is never filled from the base case", () => {
  const gap = gapOf(PLAIN_MESSAGE.replace(/\nBear case:.*$/m, "\nBear case: WACC 11%; terminal growth 2%."));
  assert.deepEqual(gap.missing, ["bearCase.freeCashFlows"]);
});

test("WACC and similar abbreviations are never read as a ticker", () => {
  const capability = valuation("Run a DCF sensitivity for Apple with WACC 10% and terminal growth 3%");
  assert.equal(capability.symbol, null);
  assert.equal(capability.entityQuery, "Apple");
  assert.equal(capability.availability, "needs_input");
});

test("the gap description names exactly what is missing and pre-fills what was understood", () => {
  const capability = valuation("Run a DCF sensitivity. WACC 10%, terminal growth 3%.");
  assert.ok(capability.missingInputs.includes("company_or_security"));
  const description = describeP5InputGap({
    label: capability.label,
    modelPath: "valuation/dcf-sensitivity",
    entity: capability.symbol ?? capability.entityQuery,
    missingInputs: capability.missingInputs,
    modelParameters: null,
    inputGap: capability.parameters.inputGap as P5PlainLanguageGap,
  });
  assert.match(description.message, /requires explicit deterministic model inputs/);
  assert.match(description.message, /Missing: .*Free cash flows by year/);
  assert.match(description.message, /Bear case free cash flows by year/);
  assert.match(description.message, /LiOS did not invent assumptions/);
  const guided = description.guidedInputs;
  assert.ok(guided);
  assert.equal(guided.entity, null);
  assert.equal(guided.fields[0].key, "entity");
  assert.ok(guided.missing.includes("entity"));
  assert.equal(guided.missing.includes("waccPct"), false);
  assert.equal(guided.provided.waccPct, "10");
  assert.ok(guided.fields.filter((field) => field.required).length >= 14);
});

test("an engine rejection keeps the entered values for the form and shows the engine's reason", () => {
  const capability = valuation(PLAIN_MESSAGE);
  const description = describeP5InputGap({
    label: capability.label,
    modelPath: "valuation/dcf-sensitivity",
    entity: "AAPL",
    missingInputs: [],
    modelParameters: capability.parameters.modelParameters as Record<string, unknown>,
    inputGap: null,
    detail: "Sensitivity grid WACC 9% must exceed terminal growth 10%.",
  });
  assert.equal(description.message, "Sensitivity grid WACC 9% must exceed terminal growth 10%.");
  assert.equal(description.guidedInputs?.entity, "AAPL");
  assert.deepEqual(description.guidedInputs?.missing, []);
  assert.equal(description.guidedInputs?.provided["bullCase.freeCashFlows"], "110, 125, 140");
});

test("models without a plain-language grammar keep the existing generic gap and no guided form", () => {
  const capability = resolveConversationCapabilities(request("Run a DCF valuation for AAPL"))[0];
  assert.equal(capability.availability, "needs_input");
  const description = describeP5InputGap({
    label: capability.label,
    modelPath: capability.parameters.modelPath as string,
    entity: "AAPL",
    missingInputs: capability.missingInputs,
    modelParameters: null,
    inputGap: null,
  });
  assert.equal(description.guidedInputs, undefined);
  assert.match(description.message, /requires explicit deterministic model inputs\. Missing: .*structured_model_inputs_or_active_artifact/);
});

test("guided form values round-trip through the same plain-language path to identical parameters", () => {
  const guided = buildP5GuidedInputs({ modelPath: "valuation/dcf-sensitivity", entity: null, missing: ["entity"], issues: [], provided: {} });
  assert.ok(guided);
  const values: Record<string, string> = {
    entity: "Apple Inc.",
    freeCashFlows: "100, 110, 120", waccPct: "10", terminalGrowthPct: "3", netDebt: "50", sharesOutstanding: "10",
    waccGridPct: "9, 10, 11", terminalGrowthGridPct: "2, 3, 4",
    "bearCase.freeCashFlows": "90, 95, 100", "bearCase.waccPct": "11%", "bearCase.terminalGrowthPct": "2",
    "bullCase.freeCashFlows": "110, 125, 140", "bullCase.waccPct": "9", "bullCase.terminalGrowthPct": "4",
  };
  const validation = validateP5GuidedValues(guided, values);
  assert.deepEqual(validation.errors, {});
  assert.ok(validation.parsed);
  const message = formatP5GuidedAssumptionsMessage("valuation/dcf-sensitivity", validation.parsed);
  assert.ok(message);
  const capability = valuation(message);
  assert.equal(capability.availability, "ready");
  assert.equal(capability.entityQuery, "Apple Inc");
  assert.deepEqual(capability.parameters.modelParameters, valuation(JSON_MESSAGE).parameters.modelParameters);
});

test("guided form validation refuses missing, non-numeric and inconsistent values", () => {
  const guided = buildP5GuidedInputs({ modelPath: "valuation/dcf-sensitivity", entity: "AAPL", missing: [], issues: [], provided: {} });
  assert.ok(guided);
  const empty = validateP5GuidedValues(guided, {});
  assert.equal(empty.parsed, null);
  assert.equal(empty.errors.waccPct, "Required");
  const bad = validateP5GuidedValues(guided, {
    freeCashFlows: "100", waccPct: "ten", terminalGrowthPct: "3", netDebt: "50m", sharesOutstanding: "0",
    waccGridPct: "9, 10", terminalGrowthGridPct: "10",
  });
  assert.match(bad.errors.freeCashFlows, /at least two years/);
  assert.match(bad.errors.waccPct, /plain number/);
  assert.match(bad.errors.netDebt, /plain number/);
  assert.match(bad.errors.sharesOutstanding, /above 0/);
  assert.match(bad.errors.terminalGrowthGridPct, /exceed every tested terminal growth/);
});

test("grid ranges with a step expand fully, with or without a lead word, and are disclosed", () => {
  for (const phrase of [
    "WACC range 9% to 11% in steps of 1%",
    "WACC grid from 9% to 11% in steps of 1%",
    "WACC values between 9% and 11% with 1% increments",
    "WACC grid 9% through 11% step 1%",
  ]) {
    const message = PLAIN_MESSAGE.replace("WACC grid: 9%, 10%, 11%.", phrase + ".");
    const capability = valuation(message);
    assert.equal(capability.availability, "ready", phrase);
    assert.deepEqual((capability.parameters.modelParameters as Record<string, unknown>).waccGridPct, [9, 10, 11], phrase);
  }
});

test("a grid range is never silently truncated to its first value", () => {
  const cases: Array<[string, string]> = [
    ["WACC range 9% to 11%", "waccGridPct"],
    ["WACC grid 9% to 11% in steps of 0.7%", "waccGridPct"],
    ["terminal growth grid 2% to 4%", "terminalGrowthGridPct"],
  ];
  for (const [phrase, key] of cases) {
    const message = PLAIN_MESSAGE.replace("WACC grid: 9%, 10%, 11%. Terminal growth grid: 2%, 3%, 4%.", phrase + ".");
    const capability = valuation(message);
    assert.equal(capability.availability, "needs_input", phrase);
    assert.equal(capability.parameters.modelParameters, null, phrase);
    const gap = capability.parameters.inputGap as P5PlainLanguageGap;
    assert.ok(gap.issues.some((issue) => issue.key === key), `${phrase}: ${JSON.stringify(gap.issues)}`);
    assert.notEqual(gap.provided[key], "9", phrase);
  }
});

test("a single WACC followed by 'to' another value is refused as a range, not read as the first number", () => {
  const capability = valuation(PLAIN_MESSAGE.replace("WACC is 10%,", "WACC is 10% to 12%,"));
  assert.equal(capability.availability, "needs_input");
  const gap = capability.parameters.inputGap as P5PlainLanguageGap;
  assert.ok(gap.issues.some((issue) => /range/.test(issue.message)));
  assert.equal(gap.provided.waccPct, undefined);
});

test("partial stated assumptions are never replaced by an active Artifact's stored parameters", () => {
  const artifactRef = "artifact:11111111-1111-4111-8111-111111111111";
  const withArtifact = (message: string) => resolveConversationCapabilities(conversationRequestSchema.parse({
    requestId: crypto.randomUUID(), message, sourceScope: "my_data", context: { activeObjectRefs: [artifactRef] },
  }))[0];

  const partial = withArtifact("Run a DCF sensitivity with WACC 10% and terminal growth 3%");
  assert.equal(partial.availability, "needs_input");
  assert.ok(partial.missingInputs.includes("structured_model_inputs_or_active_artifact"));
  assert.ok(partial.missingInputs.includes("model_input:freeCashFlows"));
  const gap = partial.parameters.inputGap as P5PlainLanguageGap;
  assert.equal(gap.provided.waccPct, "10");
  assert.equal(gap.provided.terminalGrowthPct, "3");
  const description = describeP5InputGap({
    label: partial.label,
    modelPath: "valuation/dcf-sensitivity",
    entity: partial.symbol ?? partial.entityQuery,
    missingInputs: partial.missingInputs,
    modelParameters: null,
    inputGap: gap,
  });
  assert.equal(description.guidedInputs?.provided.waccPct, "10", "the form is pre-filled with the user's own values");

  const ambiguous = withArtifact("Run a DCF sensitivity with WACC 10 and terminal growth 3%");
  assert.equal(ambiguous.availability, "needs_input");

  // Nothing stated: the Artifact's own governed inputs are still used.
  const plain = withArtifact("Run a DCF sensitivity for AAPL on this model");
  assert.equal(plain.availability, "ready");
  assert.equal(plain.parameters.activeArtifactRef, artifactRef);
});

test("currency markers cannot silently lose identity or combine monetary units", () => {
  for (const message of [
    PLAIN_MESSAGE.replace("net debt is 50", "net debt is €50").replace("100, 110 and 120", "$100, $110 and $120"),
    PLAIN_MESSAGE.replace("net debt is 50", "net debt is $50"),
  ]) {
    const extraction = extractP5PlainLanguageInputs(message, "valuation/dcf-sensitivity");
    assert.equal(extraction?.status, "incomplete");
    assert.ok(extraction?.status === "incomplete" && extraction.gap.issues.some(issue => issue.key === "_general"));
  }
});

test("standalone horizon and growth overrides cannot reuse old Artifact assumptions", () => {
  for (const message of ["Rerun DCF sensitivity for AAPL over 5 years", "Rerun DCF sensitivity for AAPL with cash flow growth 4%"]) {
    const req = request(message);
    req.context = { ...req.context, activeObjectRefs: ["artifact:11111111-1111-4111-8111-111111111111"] };
    const cap = resolveConversationCapabilities(req).find(item => item.id === "company.valuation");
    assert.equal(cap?.availability, "needs_input");
    assert.equal(cap?.parameters.modelParameters, null);
  }
});

test("guided forecasts admit fifty years while sensitivity grids remain bounded to twenty-five", () => {
  const guided = buildP5GuidedInputs({ modelPath: "valuation/dcf-sensitivity", entity: "AAPL", missing: [], issues: [], provided: {} });
  assert.ok(guided);
  const flows = Array.from({ length: 50 }, (_, index) => String(100 + index)).join(", ");
  const values = { freeCashFlows: flows, waccPct: "10", terminalGrowthPct: "2", netDebt: "50", sharesOutstanding: "10", waccGridPct: "9, 10, 11", terminalGrowthGridPct: "1, 2, 3",
    "bearCase.freeCashFlows": flows, "bearCase.waccPct": "11", "bearCase.terminalGrowthPct": "1",
    "bullCase.freeCashFlows": flows, "bullCase.waccPct": "9", "bullCase.terminalGrowthPct": "3" };
  assert.deepEqual(validateP5GuidedValues(guided, values).errors, {});
  assert.equal(validateP5GuidedValues(guided, { ...values, freeCashFlows: `${flows}, 200` }).parsed, null);
  const grid = Array.from({ length: 26 }, (_, index) => String(9 + index)).join(", ");
  assert.equal(validateP5GuidedValues(guided, { ...values, waccGridPct: grid }).parsed, null);
});

test("dollar tickers are not currency markers but dollar amounts still are", () => {
  const ticker = extractP5PlainLanguageInputs(PLAIN_MESSAGE.replace("for AAPL", "for $AAPL"), "valuation/dcf-sensitivity");
  assert.equal(ticker?.status, "complete");
  const amount = extractP5PlainLanguageInputs(PLAIN_MESSAGE.replace("net debt is 50", "net debt is $50"), "valuation/dcf-sensitivity");
  assert.equal(amount?.status, "incomplete");
});

test("bare growth is ambiguous and never becomes a silent cash-flow forecast", () => {
  for (const growth of ["growth 5%", "revenue growth 5%"]) {
    const gap = gapOf(`First-year free cash flow 100 for 3 years, ${growth}. WACC 10%, terminal growth 3%, net debt 50, 10 shares outstanding.`);
    assert.ok(gap.issues.some((issue) => issue.key === "freeCashFlows"), growth);
    assert.equal(gap.provided.freeCashFlows, undefined, growth);
  }
  const qualified = extractP5PlainLanguageInputs(
    "First-year free cash flow 100, free cash flow growth 10% for 3 years. WACC 10%, terminal growth 3%, net debt 50, 10 shares outstanding.",
    "valuation/dcf-sensitivity",
  );
  assert.ok(qualified && qualified.status === "incomplete");
  assert.equal(qualified.gap.provided.freeCashFlows, "100, 110, 121");
});

test("multiline case blocks assign their body to the labeled case", () => {
  const multiline = [
    "Run a DCF sensitivity for AAPL.",
    "Free cash flows are 100, 110 and 120. WACC is 10%, terminal growth is 3%, net debt is 50 and shares outstanding is 10.",
    "WACC grid: 9%, 10%, 11%. Terminal growth grid: 2%, 3%, 4%.",
    "Bear case:",
    "free cash flows 90, 95, 100",
    "WACC 11%",
    "terminal growth 2%",
    "Bull case:",
    "free cash flows 110, 125, 140",
    "WACC 9%",
    "terminal growth 4%",
  ].join("\n");
  const extraction = extractP5PlainLanguageInputs(multiline, "valuation/dcf-sensitivity");
  const reference = extractP5PlainLanguageInputs(PLAIN_MESSAGE, "valuation/dcf-sensitivity");
  assert.equal(extraction?.status, "complete");
  assert.deepEqual(extraction && extraction.status === "complete" ? extraction.parameters : null, reference && reference.status === "complete" ? reference.parameters : undefined);
});

test("guided form builds with fifty nine-digit prefilled cash flows", () => {
  const flows = Array.from({ length: 50 }, (_, index) => String(900000000 + index)).join(", ");
  const guided = buildP5GuidedInputs({ modelPath: "valuation/dcf-sensitivity", entity: "AAPL", missing: ["netDebt"], issues: [], provided: { freeCashFlows: flows, "bearCase.freeCashFlows": flows, "bullCase.freeCashFlows": flows } });
  assert.ok(guided);
});
