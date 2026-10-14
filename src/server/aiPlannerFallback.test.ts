import assert from "node:assert/strict";
import test from "node:test";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import { looksLikeNamedSecurityRequest, parsePlannerChoice, routedRequest } from "./aiPlannerFallback";
import { planConversationWorkflow } from "./conversationRuntime";

test("gate: named companies and tickers qualify, plain concept questions do not", () => {
  assert.equal(looksLikeNamedSecurityRequest("Any thoughts on how Nvidia is positioned?"), true);
  assert.equal(looksLikeNamedSecurityRequest("what do you make of TSLA lately"), true);
  assert.equal(looksLikeNamedSecurityRequest("explain how operating leverage works"), false);
  assert.equal(looksLikeNamedSecurityRequest("Explain DCF and RSI"), false);
});

test("a valid pick is accepted only when the entity is in the user's own words", () => {
  const message = "Any thoughts on how Nvidia is positioned?";
  assert.deepEqual(parsePlannerChoice('{"capability":"company.research","entity":"Nvidia"}', message), { capability: "company.research", entity: "Nvidia" });
  assert.equal(parsePlannerChoice('{"capability":"company.research","entity":"NVIDIA Corporation"}', message), null);
  assert.equal(parsePlannerChoice('{"capability":"company.research","entity":"Microsoft"}', message), null);
});

test("unknown tools, none, bad JSON and template text are rejected", () => {
  const message = "Thoughts on Nvidia?";
  assert.equal(parsePlannerChoice('{"capability":"portfolio.rebalance","entity":"Nvidia"}', message), null);
  assert.equal(parsePlannerChoice('{"capability":"none","entity":null}', message), null);
  assert.equal(parsePlannerChoice("I think research", message), null);
  assert.equal(parsePlannerChoice('```json\n{"capability":"market.technical","entity":"Nvidia"}\n```', message)?.capability, "market.technical");
});

test("every catalog pick becomes a request the deterministic router plans with the entity", () => {
  const base = conversationRequestSchema.parse({ requestId: crypto.randomUUID(), message: "Any thoughts on how Nvidia is positioned?" });
  for (const capability of ["company.research", "market.technical", "company.valuation"] as const) {
    const plan = planConversationWorkflow(routedRequest(base, { capability, entity: "Nvidia" }));
    assert.ok(plan.capabilities.some((item) => item.id === capability), `${capability} is planned`);
    assert.ok(plan.capabilities.some((item) => /nvidia/i.test(item.entityQuery ?? "")), `${capability} keeps the entity`);
  }
});
