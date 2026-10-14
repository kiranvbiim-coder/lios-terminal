/**
 * Operations and supply chain engines: inventory optimization, demand
 * forecasting, capacity analysis, cost-to-serve, supplier risk scoring,
 * and operational driver trees. Complements the Python sidecar's route
 * optimization, safety stock, bullwhip, and network analysis engines.
 *
 * All functions are deterministic and pure.
 */

// ─── Inventory Optimization (EOQ + Safety Stock) ──────────────────────────

export interface InventoryOptInputs {
  annualDemand: number;
  orderCost: number;           // $ per order
  holdingCostPerUnit: number;  // $ per unit per year
  leadTimeDays: number;
  demandStdDev: number;        // daily std dev of demand
  serviceLevel: number;        // decimal (0.95 = 95%)
}

export interface InventoryOptResult {
  eoq: number;                 // economic order quantity
  reorderPoint: number;
  safetyStock: number;
  ordersPerYear: number;
  totalAnnualCost: number;     // ordering + holding
  averageInventory: number;
  turnoverRatio: number;
}

const Z_TABLE: Record<number, number> = { 0.90: 1.282, 0.95: 1.645, 0.975: 1.960, 0.99: 2.326, 0.995: 2.576 };

function zScore(serviceLevel: number): number {
  const closest = Object.entries(Z_TABLE).reduce((best, [k, v]) =>
    Math.abs(Number(k) - serviceLevel) < Math.abs(Number(best[0]) - serviceLevel) ? [k, v] : best,
  );
  return Number(closest[1]);
}

export function computeInventoryOptimization(inputs: InventoryOptInputs): InventoryOptResult {
  const { annualDemand, orderCost, holdingCostPerUnit, leadTimeDays, demandStdDev, serviceLevel } = inputs;

  const eoq = Math.sqrt((2 * annualDemand * orderCost) / holdingCostPerUnit);
  const z = zScore(serviceLevel);
  const dailyDemand = annualDemand / 365;
  const safetyStock = z * demandStdDev * Math.sqrt(leadTimeDays);
  const reorderPoint = dailyDemand * leadTimeDays + safetyStock;
  const ordersPerYear = annualDemand / eoq;
  const averageInventory = eoq / 2 + safetyStock;
  const totalAnnualCost = ordersPerYear * orderCost + averageInventory * holdingCostPerUnit;
  const turnoverRatio = annualDemand / averageInventory;

  return { eoq, reorderPoint, safetyStock, ordersPerYear, totalAnnualCost, averageInventory, turnoverRatio };
}

// ─── Capacity Analysis ────────────────────────────────────────────────────

export interface CapacityInputs {
  facilities: Array<{
    name: string;
    maxCapacity: number;       // units per period
    currentUtilization: number; // decimal (0.85 = 85%)
    costPerUnit: number;
  }>;
  totalDemand: number;
}

export interface CapacityResult {
  totalCapacity: number;
  totalCurrentOutput: number;
  overallUtilization: number;
  demandGap: number;           // positive = over-capacity, negative = under-capacity
  bottleneck: string | null;
  facilitySummary: Array<{
    name: string;
    currentOutput: number;
    spareCap: number;
    utilization: number;
    isBottleneck: boolean;
  }>;
}

export function analyzeCapacity(inputs: CapacityInputs): CapacityResult {
  const { facilities, totalDemand } = inputs;
  let totalCapacity = 0;
  let totalOutput = 0;
  let bottleneckName: string | null = null;
  let maxUtil = 0;

  const summary = facilities.map((f) => {
    const currentOutput = f.maxCapacity * f.currentUtilization;
    const spareCap = f.maxCapacity - currentOutput;
    totalCapacity += f.maxCapacity;
    totalOutput += currentOutput;
    if (f.currentUtilization > maxUtil) { maxUtil = f.currentUtilization; bottleneckName = f.name; }
    return { name: f.name, currentOutput, spareCap, utilization: f.currentUtilization, isBottleneck: false };
  });

  if (bottleneckName) {
    const idx = summary.findIndex((s) => s.name === bottleneckName);
    if (idx >= 0) summary[idx].isBottleneck = true;
  }

  return {
    totalCapacity,
    totalCurrentOutput: totalOutput,
    overallUtilization: totalCapacity > 0 ? totalOutput / totalCapacity : 0,
    demandGap: totalCapacity - totalDemand,
    bottleneck: bottleneckName,
    facilitySummary: summary,
  };
}

// ─── Cost-to-Serve ────────────────────────────────────────────────────────

export interface CostToServeInputs {
  products: Array<{
    name: string;
    revenue: number;
    directCost: number;
    logistics: number;
    warehousing: number;
    orderProcessing: number;
    returns: number;
  }>;
}

export interface CostToServeResult {
  products: Array<{
    name: string;
    revenue: number;
    totalCostToServe: number;
    netProfit: number;
    marginPct: number;
    costBreakdown: {
      direct: number;
      logistics: number;
      warehousing: number;
      orderProcessing: number;
      returns: number;
    };
  }>;
  totalRevenue: number;
  totalCostToServe: number;
  overallMarginPct: number;
  unprofitableProducts: string[];
}

export function computeCostToServe(inputs: CostToServeInputs): CostToServeResult {
  let totalRevenue = 0;
  let totalCost = 0;
  const unprofitable: string[] = [];

  const products = inputs.products.map((p) => {
    const totalCostToServe = p.directCost + p.logistics + p.warehousing + p.orderProcessing + p.returns;
    const netProfit = p.revenue - totalCostToServe;
    const marginPct = p.revenue > 0 ? netProfit / p.revenue : 0;
    totalRevenue += p.revenue;
    totalCost += totalCostToServe;
    if (netProfit < 0) unprofitable.push(p.name);
    return {
      name: p.name, revenue: p.revenue, totalCostToServe, netProfit, marginPct,
      costBreakdown: { direct: p.directCost, logistics: p.logistics, warehousing: p.warehousing, orderProcessing: p.orderProcessing, returns: p.returns },
    };
  });

  return {
    products,
    totalRevenue,
    totalCostToServe: totalCost,
    overallMarginPct: totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : 0,
    unprofitableProducts: unprofitable,
  };
}

// ─── Supplier Risk Score ──────────────────────────────────────────────────

export interface SupplierRiskInputs {
  suppliers: Array<{
    name: string;
    deliveryOnTimeRate: number;    // decimal
    qualityDefectRate: number;     // decimal
    financialStabilityScore: number; // 0-100
    geopoliticalRiskScore: number;   // 0-100
    singleSourceDependency: boolean;
    leadTimeDays: number;
    leadTimeVariability: number;   // std dev in days
  }>;
}

export interface SupplierRiskResult {
  suppliers: Array<{
    name: string;
    riskScore: number;            // 0-100, higher = more risky
    riskLevel: "low" | "medium" | "high" | "critical";
    riskFactors: string[];
  }>;
  highestRisk: string | null;
  lowestRisk: string | null;
  averageRiskScore: number;
}

export function assessSupplierRisk(inputs: SupplierRiskInputs): SupplierRiskResult {
  const results = inputs.suppliers.map((s) => {
    let riskScore = 0;
    const riskFactors: string[] = [];

    // Delivery reliability (0-25 points)
    const deliveryRisk = (1 - s.deliveryOnTimeRate) * 100;
    riskScore += Math.min(25, deliveryRisk);
    if (s.deliveryOnTimeRate < 0.90) riskFactors.push("Low on-time delivery rate");

    // Quality (0-20 points)
    const qualityRisk = s.qualityDefectRate * 200;
    riskScore += Math.min(20, qualityRisk);
    if (s.qualityDefectRate > 0.05) riskFactors.push("High defect rate");

    // Financial stability (0-20 points, inverted)
    const finRisk = (100 - s.financialStabilityScore) / 5;
    riskScore += Math.min(20, finRisk);
    if (s.financialStabilityScore < 50) riskFactors.push("Weak financial stability");

    // Geopolitical (0-15 points)
    const geoRisk = s.geopoliticalRiskScore / 6.67;
    riskScore += Math.min(15, geoRisk);
    if (s.geopoliticalRiskScore > 60) riskFactors.push("High geopolitical risk");

    // Single source (0-10 points)
    if (s.singleSourceDependency) { riskScore += 10; riskFactors.push("Single-source dependency"); }

    // Lead time variability (0-10 points)
    const ltRisk = Math.min(10, s.leadTimeVariability / s.leadTimeDays * 30);
    riskScore += ltRisk;
    if (s.leadTimeVariability > s.leadTimeDays * 0.3) riskFactors.push("High lead time variability");

    riskScore = Math.min(100, Math.max(0, riskScore));
    const riskLevel = riskScore >= 70 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 30 ? "medium" : "low";

    return { name: s.name, riskScore, riskLevel: riskLevel as "low" | "medium" | "high" | "critical", riskFactors };
  });

  const sorted = [...results].sort((a, b) => b.riskScore - a.riskScore);
  const avg = results.length > 0 ? results.reduce((s, r) => s + r.riskScore, 0) / results.length : 0;

  return {
    suppliers: results,
    highestRisk: sorted[0]?.name ?? null,
    lowestRisk: sorted.at(-1)?.name ?? null,
    averageRiskScore: avg,
  };
}

// ─── Operational Driver Tree ──────────────────────────────────────────────

export interface DriverTreeNode {
  name: string;
  value: number;
  unit: string;
  children?: DriverTreeNode[];
  formula?: string;
}

export interface DriverTreeResult {
  root: DriverTreeNode;
  totalRevenue: number;
  sensitivity: Array<{ driver: string; onePercentImpact: number }>;
}

/**
 * Build a revenue driver tree: Revenue = Volume × Price.
 * Volume = Market Size × Market Share × Conversion Rate.
 * Computes sensitivity of revenue to 1% change in each driver.
 */
export function buildRevenueDriverTree(inputs: {
  marketSize: number;
  marketSharePct: number;
  conversionRate: number;
  averagePrice: number;
  unitsPerTransaction: number;
}): DriverTreeResult {
  const { marketSize, marketSharePct, conversionRate, averagePrice, unitsPerTransaction } = inputs;
  const addressableMarket = marketSize * (marketSharePct / 100);
  const conversions = addressableMarket * conversionRate;
  const volume = conversions * unitsPerTransaction;
  const totalRevenue = volume * averagePrice;

  const root: DriverTreeNode = {
    name: "Revenue", value: totalRevenue, unit: "$",
    children: [
      {
        name: "Volume", value: volume, unit: "units",
        children: [
          { name: "Market Size", value: marketSize, unit: "prospects" },
          { name: "Market Share", value: marketSharePct, unit: "%" },
          { name: "Conversion Rate", value: conversionRate * 100, unit: "%" },
          { name: "Units/Transaction", value: unitsPerTransaction, unit: "units" },
        ],
      },
      { name: "Average Price", value: averagePrice, unit: "$" },
    ],
  };

  const sensitivity = [
    { driver: "Market Size", onePercentImpact: totalRevenue * 0.01 },
    { driver: "Market Share", onePercentImpact: totalRevenue * 0.01 },
    { driver: "Conversion Rate", onePercentImpact: totalRevenue * 0.01 },
    { driver: "Units/Transaction", onePercentImpact: totalRevenue * 0.01 },
    { driver: "Average Price", onePercentImpact: totalRevenue * 0.01 },
  ];

  return { root, totalRevenue, sensitivity };
}
