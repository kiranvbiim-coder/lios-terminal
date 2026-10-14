import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFinanceFormula } from "@shared/financeFormula";
import { getFinancialMetricDefinition, resolveFinancialMetric, searchFinancialMetrics, type FinancialMetricObservation } from "@shared/financialMetricRegistry";
import { buildFinancialMetricResolutionPlan } from "@shared/financialMissingDataResolver";
import { getFinanceSectorPack, inferFinanceSectorPack } from "@shared/financeSectorPacks";
import { createFinancialObject } from "@shared/financialObjectModel";

function obs(metricId: string, value: number, status: FinancialMetricObservation["status"] = "filed"): FinancialMetricObservation {
  return { metricId, value, status, source: "test", period: "CURRENT" };
}

test("V6 formula engine evaluates arithmetic without eval", () => {
  const result = evaluateFinanceFormula("(grossDebt - cash) / ebitda", { grossDebt: 120, cash: 20, ebitda: 25 });
  assert.equal(result.error, undefined);
  assert.equal(result.value, 4);
  assert.deepEqual(new Set(result.dependencies), new Set(["grossDebt", "cash", "ebitda"]));
});

test("V6 formula engine exposes missing dependencies", () => {
  const result = evaluateFinanceFormula("enterpriseValue / ebitda", { enterpriseValue: 500 });
  assert.equal(result.value, null);
  assert.deepEqual(result.missing, ["ebitda"]);
});

test("V6 derives enterprise value and EV/EBITDA from canonical components", () => {
  const observations = [
    obs("marketCap", 1000), obs("shortTermDebt", 50), obs("longTermDebt", 150), obs("cash", 100), obs("ebitda", 200),
  ];
  const evDerived = resolveFinancialMetric("enterpriseValueDerived", observations);
  assert.equal(evDerived?.value, 1100);

  const withEv: FinancialMetricObservation[] = [...observations, { metricId: "enterpriseValue", value: evDerived!.value, status: "derived", source: "test" }];
  const multiple = resolveFinancialMetric("EV/EBITDA", withEv);
  assert.equal(multiple?.value, 5.5);
  assert.equal(multiple?.status, "derived");
});

test("manual observations outrank filed values for explicit analyst overrides", () => {
  const observations: FinancialMetricObservation[] = [
    obs("epsDiluted", 5, "filed"), { metricId: "epsDiluted", value: 7, status: "manual", manualOverride: true, source: "analyst" }, obs("price", 70, "live"),
  ];
  const pe = resolveFinancialMetric("pe", observations);
  assert.equal(pe?.value, 10);
  assert.equal(pe?.trace.find(item => item.metricId === "epsDiluted")?.status, "manual");
});

test("missing data resolver explains how to complete EV/EBITDA", () => {
  const observations = [obs("marketCap", 1000), obs("cash", 100), obs("ebitda", 200)];
  const plan = buildFinancialMetricResolutionPlan("evEbitda", observations);
  assert.ok(plan);
  assert.equal(plan!.resolved.status, "missing");
  assert.ok(plan!.actions.some(action => action.kind === "enter-direct"));
  assert.ok(plan!.missing.length >= 1);
});

test("metric registry understands institutional aliases", () => {
  assert.equal(getFinancialMetricDefinition("EV to EBITDA")?.id, "evEbitda");
  assert.equal(searchFinancialMetrics("net interest margin")[0]?.id, "bank.nim");
});

test("sector packs infer bank and SaaS workflows", () => {
  assert.equal(inferFinanceSectorPack("Financial Services", "Banks - Regional")?.id, "banks");
  assert.equal(getFinanceSectorPack("software")?.id, "saas");
});

test("resolved metrics become portable financial objects", () => {
  const resolved = resolveFinancialMetric("fcfYield", [obs("fcf", 50), obs("marketCap", 1000)]);
  assert.ok(resolved);
  const object = createFinancialObject("AAPL", resolved!);
  assert.equal(object.kind, "financial-metric");
  assert.equal(object.symbol, "AAPL");
  assert.equal(object.metricId, "fcfYield");
  assert.equal(object.value, 0.05);
});
