import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conversationRuntimeEventSchema, type ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { governedReviewRisk, legacyReviewFacts } from "./approvalReviewTruth";

const REQUEST = "22222222-2222-4222-8222-222222222222";
const binding = {
  toolId: "external.email.send", stepId: "step-1", toolCallId: "call-1",
  inputSha256: "a".repeat(64), planSha256: "b".repeat(64),
  chatId: 7, projectId: 3,
};
const makeReview = (overrides: Record<string, unknown> = {}) => conversationRuntimeEventSchema.parse({
  type: "governed_tool_approval_required", requestId: REQUEST, at: "2026-10-24T10:00:00.000Z",
  reviewId: "33333333-3333-4333-8333-333333333333",
  label: "Send summary", message: "Sends a requested summary", permissionClass: "user_confirm",
  sideEffect: "external", externalSideEffect: true, replaySafe: false,
  choices: ["allow_once", "allow_project", "deny"], expiresAt: "2026-10-25T00:00:00.000Z",
  reviewBinding: binding, ...overrides,
}) as Extract<ConversationRuntimeEvent, { type: "governed_tool_approval_required" }>;

test("wire contract accepts canonical server-only hashes and omits raw inputs, credentials and target data", () => {
  const review = makeReview();
  assert.deepEqual(review.reviewBinding, binding);
  assert.throws(() => makeReview({ reviewBinding: { ...binding, args: { apiKey: "secret" } } }), /unrecognized_keys|Unrecognized/);
  assert.throws(() => makeReview({ reviewBinding: { ...binding, inputSha256: "not-a-hash" } }), /invalid_string|Invalid/);
  assert.throws(() => makeReview({ reviewBinding: { ...binding, planSha256: "bad" } }), /invalid_string|Invalid/);
});

test("risk scales with impact, scope, required identity and exact hash availability", () => {
  const risk = governedReviewRisk(makeReview(), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(risk.effect, "external");
  assert.equal(risk.highRisk, true);
  assert.equal(risk.expired, false);
  assert.equal(risk.exactBinding, true);
  assert.equal(risk.blockAllow, false);
  assert.equal(risk.projectScope, true);
  assert.match(risk.scopeLabel, /Project 3 · Chat 7/);
  assert.match(risk.inputDisclosure, /Raw input and external target are NOT exposed/);

  const expired = governedReviewRisk(makeReview(), Date.parse("2026-10-25T00:00:00Z"));
  assert.equal(expired.expired, true);
  assert.equal(expired.blockAllow, true);
  const missing = governedReviewRisk(makeReview({ reviewBinding: undefined }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(missing.blockAllow, true, "no privileged approval without exact input binding");
  assert.equal(missing.projectScope, false);
  const unknown = governedReviewRisk(makeReview({ reviewBinding: undefined, sideEffect: undefined }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(unknown.highRisk, true);
  assert.equal(unknown.blockAllow, true);
  const internal = governedReviewRisk(makeReview({ sideEffect: "internal_write", externalSideEffect: false }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(internal.blockAllow, false);
  assert.equal(internal.highRisk, false);
  const admin = governedReviewRisk(makeReview({ permissionClass: "admin_confirm", sideEffect: "none" }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(admin.highRisk, true);
  const oldSafe = governedReviewRisk(makeReview({ reviewBinding: undefined, permissionClass: "user_confirm", sideEffect: "none", externalSideEffect: false }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(oldSafe.blockAllow, false);
  const chat = governedReviewRisk(makeReview({ reviewBinding: { ...binding, projectId: null }, choices: ["allow_once", "deny"] }), Date.parse("2026-10-24T11:00:00Z"));
  assert.equal(chat.projectScope, false);
});

test("legacy action displays target and effect while never granting receipt-like authority", () => {
  const legacy = conversationRuntimeEventSchema.parse({
    type: "approval_required", requestId: REQUEST, at: "2026-10-24T10:00:00.000Z",
    action: "RunBacktest",
    actionRequest: {
      id: "runbacktest", componentId: "finance.backtest", action: "run",
      permissionClass: "user_confirm", targetRef: "portfolio:exact:1",
      summary: "Historical backtest", reversible: false, externalSideEffect: false,
      arguments: { strategyId: "alpha" },
    },
    choices: ["allow_once", "deny"], message: "Review historical backtest",
  }) as Extract<ConversationRuntimeEvent, { type: "approval_required" }>;
  const facts = legacyReviewFacts(legacy);
  assert.equal(facts.target, "portfolio:exact:1");
  assert.equal(facts.component, "finance.backtest");
  assert.equal(facts.permission, "user_confirm");
  assert.ok(!JSON.stringify(facts).includes("alpha"));
});

test("server emits only hashes from canonical proposed grant; browser never sees raw arguments", () => {
  const server = readFileSync(new URL("../../../server/conversationRunService.ts", import.meta.url), "utf8");
  const source = server.slice(server.indexOf("governedApprovalEvent = {"), server.indexOf("governedApprovalEvent = {") + 1900);
  for (const text of [
    "toolId: proposal.binding.toolId", "stepId: proposal.binding.stepId",
    "toolCallId: proposal.binding.toolCallId", "inputSha256: proposal.binding.inputSha256",
    "planSha256: proposal.binding.planHash", "projectId: proposal.binding.projectId",
  ]) assert.ok(source.includes(text));
  assert.doesNotMatch(source, /input: step.input|args: step.input/);
  const client = readFileSync(new URL("../components/terminal/ConversationRuntimeTrace.tsx", import.meta.url), "utf8");
  assert.match(client, /governedReviewRisk\(governedApproval, Date.now\(\)\)/);
  assert.match(client, /reviewRisk\.blockAllow/);
  assert.match(client, /governedApproval\.choices\.includes\(decision\)/);
  assert.match(client, /acknowledgedRiskKey !== reviewKey/);
  assert.match(client, /reviewOutcome\.decision === "deny"/);
  assert.match(client, /Review submission failed/);
  assert.match(client, /Legacy review; exact server input fingerprint is not included/);
});
