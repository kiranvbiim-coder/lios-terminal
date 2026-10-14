import assert from "node:assert/strict";
import test from "node:test";
import { getProductNavigation, PRODUCT_NAV_ORDER } from "./productNavigation";

const internalFinance = {
  domain: "finance" as const,
  isInternal: true,
  isClientBuild: false,
  isTrial: false,
};

const clientFinance = {
  domain: "finance" as const,
  isInternal: false,
  isClientBuild: true,
  isTrial: false,
};

test("keeps the launch navigation in the focused product order", () => {
  assert.deepEqual(PRODUCT_NAV_ORDER, [
    "projects",
    "pulse",
    "explore",
    "workbench",
    "signals",
    "library",
    "data",
    "settings",
  ]);
});

test("classifies flagship finance workflows into one section each", () => {
  const sections = getProductNavigation(internalFinance);
  const locations = new Map<string, string>();
  for (const section of sections) {
    for (const item of section.items) {
      assert.equal(locations.has(item.view), false, `${item.view} appears in more than one top-level section`);
      locations.set(item.view, section.key);
    }
  }

  assert.equal(locations.get("missioncontrol"), "home");
  assert.equal(locations.get("valuation"), "modeling");
  assert.equal(locations.get("financialstatements"), "research");
  assert.equal(locations.get("agent"), "intelligence");
  assert.equal(locations.get("workspaces"), "outputs");
});

test("client navigation physically excludes internal-only capabilities", () => {
  const allViews = getProductNavigation(clientFinance).flatMap((section) => section.items.map((item) => item.view));
  assert.equal(allViews.includes("developer"), false);
  assert.equal(allViews.includes("adminconsole"), false);
  assert.equal(allViews.includes("brain"), false);
  assert.equal(allViews.includes("decisionengine"), false);
  assert.equal(allViews.includes("connectors"), false);
});

test("Pro-style trial keeps analytical workflows visible; consulting portal remains separate", () => {
  const allViews = getProductNavigation({ ...clientFinance, isTrial: true }).flatMap((section) => section.items.map((item) => item.view));
  assert.equal(allViews.includes("watchlist"), true);
  assert.equal(allViews.includes("alerts"), true);
  assert.equal(allViews.includes("advisory"), false);
  assert.equal(allViews.includes("clientdata"), false);
});

test("domain navigation does not leak finance-only analysis into supply chain", () => {
  const sections = getProductNavigation({ ...internalFinance, domain: "supply_chain" });
  const allViews = sections.flatMap((section) => section.items.map((item) => item.view));
  assert.equal(allViews.includes("missioncontrol"), true);
  assert.equal(allViews.includes("supplychaindashboard"), true);
  assert.equal(allViews.includes("valuation"), false);
  assert.equal(allViews.includes("market"), false);
});
