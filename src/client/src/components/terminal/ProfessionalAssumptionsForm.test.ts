import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildP5GuidedInputs, P5_MANUAL_ASSUMPTIONS_LABEL } from "@shared/p5GuidedInputs";
import ProfessionalAssumptionsForm from "./ProfessionalAssumptionsForm";

const COMPLETE = {
  freeCashFlows: "100, 110, 120", waccPct: "10", terminalGrowthPct: "3", netDebt: "50", sharesOutstanding: "10",
  waccGridPct: "9, 10, 11", terminalGrowthGridPct: "2, 3, 4",
  "bearCase.freeCashFlows": "90, 95, 100", "bearCase.waccPct": "11", "bearCase.terminalGrowthPct": "2",
  "bullCase.freeCashFlows": "110, 125, 140", "bullCase.waccPct": "9", "bullCase.terminalGrowthPct": "4",
};

function guided(entity: string | null, provided: Record<string, string>, issues: Array<{ key: string; message: string }> = []) {
  const built = buildP5GuidedInputs({ modelPath: "valuation/dcf-sensitivity", entity, missing: ["freeCashFlows"], issues, provided });
  assert.ok(built);
  return built;
}

function render(props: Parameters<typeof ProfessionalAssumptionsForm>[0]): string {
  return renderToStaticMarkup(createElement(ProfessionalAssumptionsForm, props));
}

test("the guided form has labelled, unit-annotated, required fields and pre-fills only what was understood", () => {
  const markup = render({ guided: guided("AAPL", { waccPct: "10" }), onSubmit: () => {}, onCancel: () => {} });
  assert.match(markup, /<form\b[^>]*aria-labelledby/);
  assert.equal((markup.match(/<label\b/g) ?? []).length, 13, "one label per field");
  assert.match(markup, /<label for="[^"]+-waccPct"[^>]*>WACC/);
  assert.match(markup, /aria-required="true"/);
  assert.match(markup, /sr-only[^>]*> \(required\)/, "required is announced, not only drawn");
  assert.match(markup, /Unit: %/);
  assert.match(markup, /Unit: currency units, the same for every amount/);
  assert.match(markup, /<legend[^>]*>Bear case<\/legend>/);
  assert.match(markup, /value="10"/);
  assert.equal((markup.match(/value="[^"]+"/g) ?? []).length, 1, "unstated values stay blank");
  assert.doesNotMatch(markup, /Company or ticker/, "a known company is not asked for again");
});

test("an unknown company is asked for as a required field", () => {
  const markup = render({ guided: guided(null, {}), onSubmit: () => {}, onCancel: () => {} });
  assert.match(markup, /Company or ticker/);
});

test("ambiguity reported by LiOS is shown beside its field and never silently resolved", () => {
  const markup = render({
    guided: guided("AAPL", {}, [
      { key: "waccPct", message: "WACC \"10\" has no percent sign. Write it as 10% or 10 percent." },
      { key: "_general", message: "Numbers written with commas are ambiguous." },
    ]),
    onSubmit: () => {},
    onCancel: () => {},
  });
  assert.match(markup, /WACC &quot;10&quot; has no percent sign/);
  assert.match(markup, /role="status"[^>]*>.*Numbers written with commas are ambiguous/);
});

test("the confirmation preview shows the exact values and the manual-provenance label before anything runs", () => {
  const markup = render({ guided: guided("AAPL", COMPLETE), onSubmit: () => {}, onCancel: () => {}, initialStep: "review" });
  assert.match(markup, new RegExp(`>${P5_MANUAL_ASSUMPTIONS_LABEL}<`));
  assert.match(markup, /exactly these values/);
  assert.match(markup, /Company: AAPL/);
  assert.match(markup, />10%<\/dd>/, "percent fields show their unit");
  assert.match(markup, />100, 110, 120<\/dd>/);
  assert.match(markup, />9%, 10%, 11%<\/dd>/);
  assert.match(markup, />Run with these values<\/button>/);
  assert.match(markup, />Edit values<\/button>/);
  assert.doesNotMatch(markup, /<input\b/, "the preview is read-only");
});

test("an incomplete form cannot reach the confirmation step", () => {
  const markup = render({ guided: guided("AAPL", { waccPct: "10" }), onSubmit: () => {}, onCancel: () => {}, initialStep: "review" });
  assert.doesNotMatch(markup, /Run with these values/);
  assert.match(markup, /<form\b/);
  assert.match(markup, /role="alert"[^>]*>Required/);
});

test("form text stays at 12px or larger", () => {
  const markup = render({ guided: guided("AAPL", COMPLETE), onSubmit: () => {}, onCancel: () => {} });
  assert.doesNotMatch(markup, /text-\[(?:[0-9]|1[01])px\]/);
});
