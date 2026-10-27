import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The project source TSX uses Vite JSX, but the offline tsx test loader emits
// classic React.createElement. Provide that runtime only in this test process.
Object.assign(globalThis, { React });
import { ReceiptSelect } from "./AnalyticalStudio";
import {
  clearEvidence, getEvidenceSnapshot, publishCalculationReceipt, type CalculationReceipt,
} from "@/lib/terminalEvidence";
import { resolveRecordedReceiptPair } from "@/lib/sprintDComparisonGuard";

const receipt = (id: string): CalculationReceipt => ({
  id, label: `Receipt ${id}`, engine: "recorded", createdAt: "2026-10-27",
  inputs: { sample: id }, parameters: {}, outputs: {},
  diagnostics: [], warnings: [], reproducibilityId: `hash-${id}`,
});

const renderChoice = (selected: string | null) => renderToStaticMarkup(
  createElement(ReceiptSelect, {
    receipts: getEvidenceSnapshot().receipts, value: selected, label: "A",
    onChange: () => undefined,
  }),
);

test("the real React receipt selector retains the original ID when a new result is published", () => {
  clearEvidence();
  try {
    publishCalculationReceipt(receipt("old"));
    publishCalculationReceipt(receipt("second"));
    const selected = "old";
    assert.match(renderChoice(selected), /<option(?=[^>]*value="old")(?=[^>]*selected)[^>]*>/);
    assert.deepEqual(
      resolveRecordedReceiptPair(getEvidenceSnapshot().receipts, "old", "second")?.map(x => x.id),
      ["old", "second"],
    );
    publishCalculationReceipt(receipt("new"));
    const markup = renderChoice(selected);
    assert.match(markup, /<option(?=[^>]*value="old")(?=[^>]*selected)[^>]*>/);
    assert.doesNotMatch(markup, /<option(?=[^>]*value="new")(?=[^>]*selected)[^>]*>/);
    assert.deepEqual(
      resolveRecordedReceiptPair(getEvidenceSnapshot().receipts, "old", "second")?.map(x => x.id),
      ["old", "second"],
    );
  } finally {
    clearEvidence();
  }
});

test("the real React receipt selector shows a revoked choice instead of substituting another model", () => {
  clearEvidence();
  try {
    publishCalculationReceipt(receipt("old"));
    publishCalculationReceipt(receipt("second"));
    clearEvidence();
    publishCalculationReceipt(receipt("replacement"));
    const markup = renderChoice("old");
    assert.match(markup, /Previously selected receipt unavailable/);
    assert.match(markup, /<option(?=[^>]*value="old")(?=[^>]*disabled)(?=[^>]*selected)[^>]*>/);
    assert.doesNotMatch(markup, /<option(?=[^>]*value="replacement")(?=[^>]*selected)[^>]*>/);
    assert.equal(resolveRecordedReceiptPair(getEvidenceSnapshot().receipts, "old", "second"), null);
  } finally {
    clearEvidence();
  }
});

test("empty receipt selection exposes an explicit choose option, not an invented default", () => {
  clearEvidence();
  try {
    publishCalculationReceipt(receipt("available"));
    const markup = renderChoice(null);
    assert.match(markup, /Choose receipt/);
    assert.match(markup, /<option(?=[^>]*value="")(?=[^>]*selected)[^>]*>/);
    assert.doesNotMatch(markup, /<option(?=[^>]*value="available")(?=[^>]*selected)[^>]*>/);
  } finally {
    clearEvidence();
  }
});
