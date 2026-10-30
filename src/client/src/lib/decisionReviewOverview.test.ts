import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decisionArtifactContentSchema } from "@shared/artifactContracts";
import { decisionReviewOverview } from "./decisionReviewOverview";
import DecisionReviewSummary from "../components/terminal/DecisionReviewSummary";

const content = decisionArtifactContentSchema.parse({
  kind: "decision",
  objective: "Evaluate the investment option",
  recommendation: "Hold until an independent cash-flow review",
  selectedAlternativeId: "hold",
  alternatives: [
    { id: "hold", label: "Wait", risks: ["Opportunity cost"], expectedOutcomes: ["More evidence"], tradeoffs: ["Slower entry"] },
    { id: "buy", label: "Buy", risks: ["Capital loss"], expectedOutcomes: [], tradeoffs: [] },
  ],
  linkedRefs: { sources: ["source:filing:1"], models: ["artifact:model:1"], scenarios: [], backtests: [], monitors: [] },
  dissent: ["Reviewer disputes liquidity assumption"],
  uncertainties: ["Customer concentration"],
  constraints: ["Maximum sector exposure"],
  nextActions: ["Request independent valuation"],
  actions: [
    { id: "1", description: "Check liquidity", status: "blocked" },
    { id: "2", description: "Send internal memo", status: "completed" },
  ],
  outcome: { status: "observed", summary: "Analyst recorded an outcome" },
});

test("decision review separates recommendation, evidence references, risk, dissent and proposed action", () => {
  const review = decisionReviewOverview(content);
  assert.equal(review.recommendation, "Hold until an independent cash-flow review");
  assert.deepEqual(review.alternative, { id: "hold", label: "Wait" });
  assert.equal(review.evidence.total, 2);
  assert.deepEqual(review.risk.selectedAlternativeRisks, ["Opportunity cost"]);
  assert.deepEqual(review.risk.dissent, ["Reviewer disputes liquidity assumption"]);
  assert.deepEqual(review.risk.uncertainties, ["Customer concentration"]);
  assert.deepEqual(review.risk.constraints, ["Maximum sector exposure"]);
  assert.deepEqual(review.action.proposed, ["Request independent valuation"]);
  assert.equal(review.action.blocked, 1);
  assert.equal(review.action.completed, 1);
  assert.equal(review.outcome?.status, "observed");
  assert.deepEqual(review.gaps, []);
  // The read-only map does not invent an approval or evidence-verification field.
  assert.ok(!Object.hasOwn(review, "approved"));
  assert.ok(!Object.hasOwn(review.evidence, "verified"));
});

test("empty/unresolved decision reports gaps, never an inferred approval or selected alternative", () => {
  const minimal = decisionArtifactContentSchema.parse({ kind: "decision", objective: "Review this case", selectedAlternativeId: "missing", linkedRefs: { sources: [] } });
  const review = decisionReviewOverview(minimal);
  assert.equal(review.recommendation, null);
  assert.equal(review.alternative, null);
  assert.equal(review.selectedAlternativeMissing, true);
  assert.equal(review.evidence.total, 0);
  assert.equal(review.action.recorded, 0);
  assert.equal(review.outcome, null);
  assert.match(review.gaps.join(" "), /unresolved.*reference|Selected alternative ID is unresolved/);
  assert.match(review.gaps.join(" "), /No authored evidence references/);
  assert.match(review.gaps.join(" "), /risks/);
  assert.match(review.gaps.join(" "), /actions/);
});

test("summary never hides dissent or relabels completed tracking as execution", () => {
  const markup = renderToStaticMarkup(createElement(DecisionReviewSummary, { content, dirty: true }));
  for (const label of ["Authored decision", "Evidence references", "Risks and dissent", "Proposed actions · not orders", "Review gaps", "Unsaved authored draft"]) {
    assert.ok(markup.includes(label), `missing review boundary: ${label}`);
  }
  assert.match(markup, /not an approved decision|not an approved|not orders/);
  assert.match(markup, /marked completed/);
  assert.match(markup, /These statuses are not execution proof/);
  assert.match(markup, /Authored references do not prove claims/);
  assert.ok(!markup.includes("CURRENT APPROVAL: APPROVED"));
  assert.match(markup, /Reviewer disputes liquidity assumption/);
});

