import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AgentExecutionReceipts from "./AgentExecutionReceipts";
import type { AgentReceiptActivity } from "@/lib/agentReceiptActivity";
import type { RuntimeExecutionReceipt } from "@shared/runtimeContracts";

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

function receipt(status: RuntimeExecutionReceipt["status"], id: string): RuntimeExecutionReceipt {
  return {
    id, requestId: REQUEST_ID, componentId: "quant.risk", operation: "risk_run",
    status, startedAt: "2026-10-27T01:00:00Z", completedAt: "2026-10-27T01:00:01Z",
    deterministic: true, aiDerived: false, inputHash: "a".repeat(64), outputHash: "b".repeat(64),
    sourceRefs: ["secret-provider-uri:do-not-expose"], warnings: ["SECRET_WARNING_DO_NOT_SHOW"],
    inputEvidence: { apiKey: "PRIVATE_KEY_VALUE" }, outputEvidence: { internalResult: "PRIVATE_OUTPUT_VALUE" },
  };
}

function activity(receipts: RuntimeExecutionReceipt[]): AgentReceiptActivity {
  return {
    requestId: REQUEST_ID, receipts,
    completed: receipts.filter(item => item.status === "completed").length,
    failed: receipts.filter(item => item.status === "failed").length,
    cancelled: receipts.filter(item => item.status === "cancelled").length,
    mismatched: 0, observedSteps: 0, lastStepLabel: null,
    hasReceiptProblems: receipts.some(item => item.status !== "completed"),
  };
}

test("receipt cards remain read-only, status-specific, and scoped to observed records", () => {
  const records: RuntimeExecutionReceipt[] = [
    receipt("completed", "33333333-3333-4333-8333-333333333333"),
    receipt("failed", "44444444-4444-4444-8444-444444444444"),
    receipt("cancelled", "55555555-5555-4555-8555-555555555555"),
  ];
  const html = renderToStaticMarkup(createElement(AgentExecutionReceipts, { activity: activity(records) }));
  assert.match(html, /Recorded execution receipts · 3/);
  assert.match(html, /1 completed · 1 failed · 1 cancelled/);
  for (const status of ["completed", "failed", "cancelled"]) assert.match(html, new RegExp(`data-receipt-status="${status}"`));
  assert.match(html, /quant.risk · risk run/);
  assert.match(html, /Exact receipt identity and hashes/);
  assert.match(html, /Input SHA-256/);
  assert.match(html, /33333333-3333-4333-8333-333333333333/);
  assert.match(html, /Receipts do not grant approval or prove an external action occurred/);
  assert.doesNotMatch(html, /PRIVATE_KEY_VALUE|PRIVATE_OUTPUT_VALUE|SECRET_WARNING_DO_NOT_SHOW|secret-provider-uri/);
  assert.doesNotMatch(html, /<button\b|<input\b|<iframe\b|<img\b|<script\b/);
});

test("there is no decorative card when the run has no actual receipts", () => {
  assert.equal(renderToStaticMarkup(createElement(AgentExecutionReceipts, { activity: activity([]) })), "");
});
