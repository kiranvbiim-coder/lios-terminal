import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactContent } from "@shared/artifactContracts";
import { inspectRecordedValuationHeadline, recordedValuationReviewSection } from "./finrobotValuationHeadline";

function artifact(outputs: Record<string, unknown>): ArtifactContent {
  return {kind:"valuation",symbol:"ABC",modelId:"dcf",assumptions:{},summary:{},outputs};
}

test("FinRobot thesis gate cannot resurrect raw DCF target when withhold is recorded", () => {
  const value = inspectRecordedValuationHeadline(artifact({
    structured: {
      thesis: {price_target:null, target_price:null},
      valuation_withheld:true,
      financial_modeling:{implied_price:20.38},
      implied_price:20.38,
    },
  }));
  assert.deepEqual([value.status,value.targetPrice,value.reason,value.sourcePath],
    ["withheld",null,"explicit_withhold",null]);
  assert.equal(JSON.stringify(value).includes("20.38"),false);
  assert.equal(value.investmentRecommendation,false);
  assert.equal(value.recalculatedValue,false);
  assert.equal(value.verifiedMarketData,false);
});

test("a thesis object with no trusted headline blocks raw flat implied price fallback", () => {
  const summary = inspectRecordedValuationHeadline(artifact({
    structured:{thesis:{price_target:null},implied_price:180,financial_modeling:{implied_price:180}},
  }));
  assert.equal(summary.status,"withheld");
  assert.equal(summary.reason,"authoritative_thesis_without_target");
  assert.equal(summary.targetPrice,null);
});

test("an explicitly allowed recorded thesis headline wins over conflicting raw valuation values", () => {
  const res = inspectRecordedValuationHeadline(artifact({
    structured:{thesis:{price_target:145},implied_price:250},
  }));
  assert.equal(res.status,"recorded_unverified");
  assert.equal(res.targetPrice,145);
  assert.equal(res.sourcePath,"outputs.structured.thesis.price_target");
  assert.equal(res.verifiedMarketData,false);
});

test("flat DCF and DDM recorded outputs only surface a finite positive number", () => {
  const dcf=inspectRecordedValuationHeadline(artifact({implied_price:102.5}));
  const ddm=inspectRecordedValuationHeadline(artifact({equity_value_per_share:93.2}));
  assert.deepEqual([dcf.targetPrice,dcf.sourcePath],[102.5,"outputs.implied_price"]);
  assert.deepEqual([ddm.targetPrice,ddm.sourcePath],[93.2,"outputs.equity_value_per_share"]);
  for(const invalid of [Infinity,-Infinity,NaN,-3,0,"200","Infinity",null]) {
    const x=inspectRecordedValuationHeadline(artifact({implied_price:invalid}));
    assert.equal(x.status,"unavailable");
    assert.equal(x.targetPrice,null);
  }
});

test("malformed structured payload and malformed/true withhold gate fail closed", () => {
  const malformed=inspectRecordedValuationHeadline(artifact({structured:"unsafe",implied_price:220}));
  assert.equal(malformed.status,"unavailable");
  for(const flag of [true,"true",null,0]) {
    const x=inspectRecordedValuationHeadline(artifact({valuation_withheld:flag,implied_price:200}));
    assert.equal(x.status,"withheld");
    assert.equal(x.targetPrice,null);
  }
  const explicitFalse=inspectRecordedValuationHeadline(artifact({valuation_withheld:false,implied_price:200}));
  assert.equal(explicitFalse.status,"recorded_unverified");
});

test("only valuation Artifacts publish a saved target headline", () => {
  const report=inspectRecordedValuationHeadline({kind:"report",templateId:null,blocks:[],sections:[],editorPreference:"builtin"});
  assert.equal(report.status,"not_valuation");
  assert.equal(report.targetPrice,null);
  assert.equal(report.investmentRecommendation,false);
});

test("P4 review-package section uses withhold-safe audit without leaking unapproved model price", () => {
  const section = recordedValuationReviewSection(artifact({
    valuation_withheld: true,
    structured: { thesis: { price_target: null }, implied_price: 21.42 },
  }));
  assert.ok(section);
  assert.match(section.title, /unverified, not investment advice/i);
  assert.match(section.text, /"status": "withheld"/);
  assert.match(section.text, /"targetPrice": null/);
  assert.doesNotMatch(section.text, /21\.42/);
  assert.equal(recordedValuationReviewSection({
    kind: "report", templateId: null, blocks: [], sections: [], editorPreference: "builtin",
  }), null);
});
