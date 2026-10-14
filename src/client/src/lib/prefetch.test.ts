import test from "node:test";
import assert from "node:assert/strict";
import { getPanelPrefetchUrls, getPrefetchPlanForTests } from "./prefetch";

test("prefetch fabric exposes adjacent data for high-value workspaces", () => {
  assert.deepEqual(getPanelPrefetchUrls("macrodashboard"), ["/api/economics/indicators", "/api/fred/yieldcurve"]);
  assert.ok(getPanelPrefetchUrls("market").includes("/api/finance/breadth"));
  assert.ok(getPanelPrefetchUrls("screener").includes("/api/finance/sentiment"));
});

test("unknown views do not invent network prefetch work", () => {
  assert.deepEqual(getPanelPrefetchUrls("not-a-view"), []);
});

test("returned prefetch URL lists are copies", () => {
  const first = getPanelPrefetchUrls("market");
  first.length = 0;
  assert.ok(getPanelPrefetchUrls("market").length > 0);
});


test("symbol-aware prefetch plans target the same React Query keys as destination hooks", () => {
  const quotePlan = getPrefetchPlanForTests("quote", "aapl");
  assert.ok(quotePlan.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(["/api/finance/quote", "AAPL"])));
  assert.ok(quotePlan.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(["/api/finance/news", "AAPL", ""])));

  const companyPlan = getPrefetchPlanForTests("companyfundamentals", "msft");
  assert.ok(companyPlan.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(["/api/lse/company", "MSFT"])));
  assert.ok(companyPlan.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(["/api/lse/financials", "MSFT", "income", "FY"])));
  assert.ok(companyPlan.some((item) => JSON.stringify(item.queryKey) === JSON.stringify(["/api/lse/dividends", "MSFT"])));
});

test("prefetch plans de-duplicate base and symbol-specific tasks", () => {
  const plan = getPrefetchPlanForTests("companyfundamentals", "AAPL");
  const identities = plan.map((item) => JSON.stringify(item.queryKey));
  assert.equal(new Set(identities).size, identities.length);
});
