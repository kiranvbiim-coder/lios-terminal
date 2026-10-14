import test from "node:test";
import assert from "node:assert/strict";
import {
  computeInventoryOptimization,
  analyzeCapacity,
  computeCostToServe,
  assessSupplierRisk,
  buildRevenueDriverTree,
} from "./operationsEngines";

test("EOQ: classic formula produces correct order quantity", () => {
  // D=10000, S=50, H=2 → EOQ = sqrt(2×10000×50/2) = sqrt(500000) ≈ 707
  const result = computeInventoryOptimization({
    annualDemand: 10_000, orderCost: 50, holdingCostPerUnit: 2,
    leadTimeDays: 5, demandStdDev: 10, serviceLevel: 0.95,
  });
  assert.ok(Math.abs(result.eoq - 707.1) < 1);
  assert.ok(result.safetyStock > 0);
  assert.ok(result.reorderPoint > 0);
  assert.ok(result.turnoverRatio > 0);
  assert.ok(result.totalAnnualCost > 0);
});

test("capacity: identifies bottleneck facility", () => {
  const result = analyzeCapacity({
    facilities: [
      { name: "Plant A", maxCapacity: 1000, currentUtilization: 0.95, costPerUnit: 10 },
      { name: "Plant B", maxCapacity: 800, currentUtilization: 0.60, costPerUnit: 12 },
    ],
    totalDemand: 1500,
  });
  assert.equal(result.bottleneck, "Plant A");
  assert.ok(result.totalCapacity === 1800);
  assert.ok(result.demandGap === 300); // 300 units overcapacity
  assert.ok(result.facilitySummary.find((f) => f.name === "Plant A")?.isBottleneck);
});

test("cost-to-serve: identifies unprofitable products", () => {
  const result = computeCostToServe({
    products: [
      { name: "Widget A", revenue: 100, directCost: 40, logistics: 10, warehousing: 5, orderProcessing: 3, returns: 2 },
      { name: "Widget B", revenue: 50, directCost: 45, logistics: 8, warehousing: 4, orderProcessing: 2, returns: 1 },
    ],
  });
  assert.equal(result.unprofitableProducts.length, 1);
  assert.equal(result.unprofitableProducts[0], "Widget B");
  assert.ok(result.overallMarginPct > 0); // portfolio is profitable overall
  const widgetA = result.products.find((p) => p.name === "Widget A");
  assert.ok(widgetA && widgetA.marginPct > 0);
});

test("supplier risk: scores risk factors correctly", () => {
  const result = assessSupplierRisk({
    suppliers: [
      { name: "Reliable Co", deliveryOnTimeRate: 0.98, qualityDefectRate: 0.01, financialStabilityScore: 85, geopoliticalRiskScore: 10, singleSourceDependency: false, leadTimeDays: 14, leadTimeVariability: 2 },
      { name: "Risky Corp", deliveryOnTimeRate: 0.75, qualityDefectRate: 0.08, financialStabilityScore: 30, geopoliticalRiskScore: 70, singleSourceDependency: true, leadTimeDays: 30, leadTimeVariability: 15 },
    ],
  });
  const reliable = result.suppliers.find((s) => s.name === "Reliable Co");
  const risky = result.suppliers.find((s) => s.name === "Risky Corp");
  assert.ok(reliable && reliable.riskScore < 30);
  assert.ok(risky && risky.riskScore > 50);
  assert.equal(result.highestRisk, "Risky Corp");
  assert.equal(result.lowestRisk, "Reliable Co");
  assert.ok(risky.riskFactors.includes("Single-source dependency"));
});

test("revenue driver tree: revenue = volume × price", () => {
  const result = buildRevenueDriverTree({
    marketSize: 100_000, marketSharePct: 10, conversionRate: 0.05,
    averagePrice: 50, unitsPerTransaction: 2,
  });
  // Volume = 100000 × 0.10 × 0.05 × 2 = 1000
  // Revenue = 1000 × 50 = 50000
  assert.ok(Math.abs(result.totalRevenue - 50_000) < 1);
  assert.equal(result.root.name, "Revenue");
  assert.ok(result.root.children && result.root.children.length === 2);
  assert.equal(result.sensitivity.length, 5);
  // 1% impact = 50000 × 0.01 = 500
  assert.ok(Math.abs(result.sensitivity[0].onePercentImpact - 500) < 1);
});
