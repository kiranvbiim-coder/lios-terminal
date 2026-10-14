import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getContextHeroActions,
  getExperienceViewLabel,
  getNextBestAction,
} from "./terminalExperience";

test("company workflow promotes DCF as a hero action", () => {
  const actions = getContextHeroActions("financialstatements");
  assert.ok(actions.some((action) => action.view === "valuation" && action.shortLabel === "DCF"));
  assert.ok(actions.some((action) => action.view === "peercomp"));
  assert.ok(actions.some((action) => action.view === "advancedrisk"));
});

test("company next-best-action chain is Financials -> DCF -> Peers -> Risk", () => {
  assert.equal(getNextBestAction("entity", false)?.view, "financialstatements");
  assert.equal(getNextBestAction("financialstatements", false)?.view, "valuation");
  assert.equal(getNextBestAction("valuation", false)?.view, "peercomp");
  assert.equal(getNextBestAction("peercomp", false)?.view, "advancedrisk");
});

test("next-best action respects internal and client evidence destinations", () => {
  assert.equal(getNextBestAction("news", true)?.view, "research");
  assert.equal(getNextBestAction("news", false)?.view, "alerts");
});

test("experience labels use human-readable analytical names", () => {
  assert.equal(getExperienceViewLabel("valuation"), "DCF");
  assert.equal(getExperienceViewLabel("financialstatements"), "Financials");
  assert.equal(getExperienceViewLabel("peercomp"), "Peer Comps");
});
