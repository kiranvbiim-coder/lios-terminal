import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionCaseBridgePayload, buildDecisionEngineHandoffUrl } from "./researchDecisionBridge";

test("decision bridge preserves investigation evidence context without inventing a recommendation", () => {
  assert.deepEqual(buildDecisionCaseBridgePayload({ id: 7, title: "AAPL review", question: "What changes the thesis?", primarySymbol: " aapl " }), {
    title: "AAPL review decision",
    question: "What changes the thesis?",
    decisionType: "investment",
    materiality: "material",
    symbol: "aapl",
    investigationId: 7,
    brainRunId: null,
  });
});

test("decision engine handoff encodes a readable workspace query once", () => {
  const url = buildDecisionEngineHandoffUrl("AAPL", "http://localhost:5052/?source=research");
  const parsed = new URL(url);
  assert.equal(parsed.hash, "#/" );
  assert.deepEqual(JSON.parse(parsed.searchParams.get("ws") ?? "null"), {
    primary: { view: "decisionengine", symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  });
  assert.equal(parsed.searchParams.get("ws")?.includes("%"), false);
});

test("brief titles produce deterministic linked case titles", () => {
  assert.equal(buildDecisionCaseBridgePayload({ id: 9, title: "Research", question: "Assess risk", primarySymbol: null }, "  Q4 evidence  ").title, "Q4 evidence decision");
});
