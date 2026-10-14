import assert from "node:assert/strict";
import test from "node:test";
import { comparePrimarySourceFilings } from "./p7FilingDiff";

test("P7 filing diff reports section additions removals changes and evidence refs", () => {
  const result=comparePrimarySourceFilings({
    priorRef:"sec:10-k:2025",filingRef:"sec:10-k:2026",generatedAt:"2026-09-22T00:00:00.000Z",
    priorSections:[{id:"1A",title:"Risk Factors",text:"Demand is stable.\nCosts are stable."},{id:"7",title:"MD&A",text:"Revenue grew."},{id:"old",title:"Old section",text:"Legacy."}],
    currentSections:[{id:"1A",title:"Risk Factors",text:"Demand weakened.\nCosts are stable."},{id:"7",title:"MD&A",text:"Revenue grew."},{id:"new",title:"New section",text:"New disclosure."}],
  });
  assert.equal(result.changedSections.length,1);
  assert.equal(result.addedSections[0].id,"new");
  assert.equal(result.removedSections[0].id,"old");
  assert.equal(result.unchangedSectionCount,1);
  assert.ok(result.changedSections[0].addedLines.includes("Demand weakened."));
  assert.ok(result.evidenceRefs.includes("sec:10-k:2026#section:1A"));
});
