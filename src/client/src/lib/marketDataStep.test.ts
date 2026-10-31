import assert from "node:assert/strict";
import test from "node:test";
import { decideMarketDataStep, selectionWithYahoo } from "./marketDataStep";

const base = { enabled: true, retail: true, dismissed: false } as const;

test("the market-data step appears only when no usable source is set and the person has not deferred it", () => {
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: [] }, consents: [] }), "show");
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: ["yahoo_finance"] }, consents: [] }), "show", "a selected source that still needs consent is not usable");
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: ["yahoo_finance"] }, consents: [{ scope: "yahoo_community", active: true }] }), "skip");
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: ["twelve_data"] }, consents: [] }), "skip", "a keyed source needs no community consent");
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: [] }, consents: [], dismissed: true }), "skip");
  assert.equal(decideMarketDataStep({ ...base, enabled: false, setup: { selectedConnectorIds: [] }, consents: [] }), "skip");
  assert.equal(decideMarketDataStep({ ...base, setup: undefined, consents: [] }), "checking");
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: [] }, consents: undefined }), "checking");
});

test("revoked consent does not count", () => {
  assert.equal(decideMarketDataStep({ ...base, setup: { selectedConnectorIds: ["yahoo_finance"] }, consents: [{ scope: "yahoo_community", active: false }] }), "show");
});

test("choosing Yahoo keeps the saved AI, runtime and other sources", () => {
  const next = selectionWithYahoo({
    selectedConnectorIds: ["fred"], providerStackOrder: ["fred", "ollama"], pythonRuntimeId: "system-auto", pythonEnvironmentPath: null,
    pythonPackIds: ["core", "quant"], aiProviderId: "ollama", aiModelId: "llama3.2:latest",
  });
  assert.deepEqual(next.selectedConnectorIds, ["fred", "yahoo_finance"]);
  assert.deepEqual(next.providerStackOrder, ["fred", "ollama", "yahoo_finance"]);
  assert.equal(next.aiProviderId, "ollama");
  assert.equal(next.aiModelId, "llama3.2:latest");
  assert.equal(next.pythonRuntimeId, "system-auto");
  assert.deepEqual(next.pythonPackIds, ["core", "quant"]);
  assert.deepEqual(selectionWithYahoo(selectionWithYahoo(null)).selectedConnectorIds, ["yahoo_finance"], "choosing twice does not duplicate it");
});
