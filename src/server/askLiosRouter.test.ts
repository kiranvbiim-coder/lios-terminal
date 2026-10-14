import assert from "node:assert/strict";
import test from "node:test";
import { classifyAskLiosIntent, formatAskLiosDelegation } from "@shared/askLiosRouter";

test("Ask LiOS routes valuation language to the DCF engine instead of inventing a number", () => {
  const intent = classifyAskLiosIntent("Run a DCF on the current company");
  assert.equal(intent.kind, "compute");
  if (intent.kind !== "compute") return;
  assert.equal(intent.engineId, "valuation.dcf");
  const delegation = formatAskLiosDelegation(intent);
  assert.match(delegation, /I won’t invent this calculation/);
  assert.match(delegation, /deterministic engine/);
  assert.match(delegation, /execute the governed engine when the required inputs are explicit/);
  assert.match(delegation, /surface exactly what is required and a contextual workspace action/);
  assert.match(delegation, /<<NAVIGATE: valuation>>/);
});

test("Ask LiOS resolve intent extracts a ticker and leaves ordinary questions as chat", () => {
  const intent = classifyAskLiosIntent("Please resolve AAPL in the instrument master");
  assert.equal(intent.kind, "resolve");
  if (intent.kind !== "resolve") return;
  assert.equal(intent.ticker, "AAPL");
  assert.equal(classifyAskLiosIntent("What changed in Pulse this morning?").kind, "chat");
});
